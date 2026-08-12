// Gas faucet (Trust Platform Epic 0): a per-Circle jar of "first gas" lamports.
// A one-time uniform grant goes to the neophyte's own wallet; a nullifier PDA
// (seeded by the neophyte's commitment) makes it one grant per identity per
// Circle, ever. Refills come only from a passed anonymous member vote
// committing to the exact amount.
//
// TWO activation paths, and the choice is not cosmetic (F35 → Epic 2):
//   * `activateFaucetAnonymously` — PREFERRED. A member_vote Groth16 proof that
//     the neophyte's OWN WING endorses the grant (F35-R2: the proof is made
//     against a tree whose only leaf is the wing's commitment, so only the
//     wing's secret satisfies it). No parrain account, signature, wallet or
//     lamport transfer in the transaction; relayed so the fee-payer isn't the
//     link. The endorser's COMMITMENT is derivable from the transaction — it is
//     already world-readable in `WingPeer`, but this makes the act a record.
//   * `activateFaucet` — DEPRECATED. The named pilot form, where the parrain
//     signs and pays and the transaction publishes the sponsor WALLET edge.
//     Kept only for a wing with no ZK key on this device — and it is now the
//     ONLY fallback, because F35-R2 removed "any tree member can activate".
// Callers must branch on `haveVotingKey(wingCommitment)` and take the anonymous
// path whenever it is available; when they cannot, tell the wing what the named
// path publishes before they sign it.

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  PROGRAM_ID,
  SigningWallet,
  connection,
  memberTreePda,
  membershipPda,
  programWith,
  readOnlyProgram,
  treasuryPda,
} from "./member";
import { wingPeerPda } from "./peers";
import { freshNonce } from "./admin";
import { proveWingEndorsement } from "./zk-vote";
import { relayerPubkey, relayInstruction } from "./relayer";

// The on-chain caps (mirrors programs/ayni/src/state.rs).
export const FAUCET_MAX_GRANT_LAMPORTS = 2_000_000; // 0.002 SOL — absolute cap
export const FAUCET_DEFAULT_GRANT_LAMPORTS = 1_500_000; // 0.0015 SOL
/** A single refill vote may move at most this many grants' worth (program-enforced). */
export const FAUCET_MAX_REFILL_GRANTS = 100;
/** Grants pause this long after the Treasurer retunes the amount (program-enforced). */
export const FAUCET_AMOUNT_COOLDOWN_SECS = 24 * 60 * 60;

const seed = (s: string) => new TextEncoder().encode(s);
const toBytes = (hex: string) => Uint8Array.from((hex.match(/.{1,2}/g) ?? []).map((b) => parseInt(b, 16)));
const toHex = (b: ArrayLike<number>) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
/** Big-endian 32 bytes → bigint (the circuit's field-element convention). */
const beToBig = (b: Uint8Array): bigint => { let v = 0n; for (const x of b) v = (v << 8n) | BigInt(x); return v; };

export const faucetPda = (circle: PublicKey) =>
  PublicKey.findProgramAddressSync([seed("faucet"), circle.toBytes()], PROGRAM_ID)[0];

/** Grant nullifier — one grant per membership commitment, per Circle. */
export const faucetNullPda = (circle: PublicKey, commitment: Uint8Array) =>
  PublicKey.findProgramAddressSync([seed("faucetnull"), circle.toBytes(), commitment], PROGRAM_ID)[0];

/** One-shot refill marker for a passed member proposal. */
export const faucetFillPda = (proposal: PublicKey) =>
  PublicKey.findProgramAddressSync([seed("faucetfill"), proposal.toBytes()], PROGRAM_ID)[0];

const memberProposalPda = (circle: PublicKey, nonce: anchor.BN) =>
  PublicKey.findProgramAddressSync(
    [seed("mproposal"), circle.toBytes(), nonce.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  )[0];

// ---------------------------------------------------------------------------
// Reading the jar
// ---------------------------------------------------------------------------

export interface FaucetInfo {
  exists: boolean;
  grantLamports: number; // per-grant amount
  granted: number; // how many grants ever paid
  balanceLamports: number; // lamports sitting on the jar PDA (incl. rent)
}

export async function getFaucet(circle: PublicKey): Promise<FaucetInfo> {
  const jar = faucetPda(circle);
  try {
    const [a, balanceLamports] = await Promise.all([
      (readOnlyProgram().account as any).faucetJar.fetch(jar),
      connection().getBalance(jar),
    ]);
    return {
      exists: true,
      grantLamports: Number(a.grantLamports),
      granted: Number(a.granted),
      balanceLamports,
    };
  } catch {
    return { exists: false, grantLamports: FAUCET_DEFAULT_GRANT_LAMPORTS, granted: 0, balanceLamports: 0 };
  }
}

/** Has this membership (commitment hex) already received its Circle's grant? */
export async function hasFaucetGrant(circle: PublicKey, commitmentHex: string): Promise<boolean> {
  const info = await connection().getAccountInfo(faucetNullPda(circle, toBytes(commitmentHex)));
  return info !== null;
}

/** Has a passed refill proposal already been executed (one-shot marker exists)? */
export async function hasFaucetFill(proposal: PublicKey): Promise<boolean> {
  const info = await connection().getAccountInfo(faucetFillPda(proposal));
  return info !== null;
}

// ---------------------------------------------------------------------------
// Opening & tuning the jar (Council)
// ---------------------------------------------------------------------------

/** Create the Circle's faucet jar — any Council seat (pays the jar's rent). */
export async function initFaucet(wallet: SigningWallet, circle: PublicKey): Promise<string> {
  return programWith(wallet)
    .methods.initFaucet()
    .accounts({
      circle,
      jar: faucetPda(circle),
      seat: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

/** Treasurer-only: set the per-grant amount (0 < lamports ≤ the on-chain cap). */
export async function setFaucetAmount(wallet: SigningWallet, circle: PublicKey, lamports: number): Promise<string> {
  return programWith(wallet)
    .methods.setFaucetAmount(new anchor.BN(lamports))
    .accounts({ circle, jar: faucetPda(circle), treasurer: wallet.publicKey })
    .rpc();
}

// ---------------------------------------------------------------------------
// The grant — a member welcomes the neophyte with first gas
// ---------------------------------------------------------------------------

/**
 * The endorsement's external nullifier:
 * `SHA-256("AHA-faucet-grant" || circle || neophyte_commitment)` with the top 3
 * bits cleared so it is always a BN254 field element.
 *
 * MUST match `faucet_external_nullifier` in
 * `programs/ayni/src/instructions/activate_faucet_zk.rs` byte for byte — the
 * program recomputes it and feeds it to the verifier as a public input, so any
 * disagreement here shows up as "proof invalid", never as a silent weakening.
 * The domain tag is what keeps a faucet endorsement's nullifier independent of
 * the same member's admission attestation for the same neophyte.
 */
export async function faucetExternalNullifier(circle: PublicKey, neophyte: Uint8Array): Promise<Uint8Array> {
  const data = new Uint8Array([...seed("AHA-faucet-grant"), ...circle.toBytes(), ...neophyte]);
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  h[0] &= 0x1f; // BN254 p > 2^253 ⇒ always in field
  return h;
}

/**
 * **F35 → Epic 2 — the preferred path.** First gas for the neophyte, endorsed
 * ANONYMOUSLY by their own wing: a `member_vote` Groth16 proof against the tree
 * whose only leaf is `wing_peer.wing`, so the program can require it without any
 * parrain account, signature, wallet or transfer in the transaction. The old
 * named path put both parties and a transfer between them in one public
 * transaction — the sponsor edge Epic 2 exists to abolish.
 *
 * **F35-R2.** F35 as first shipped proved only "some member of the tree", which
 * dropped the one structural property the named path had (`establish_wing_peer`
 * refuses `mentee == wing`): an admitted neophyte could endorse their own first
 * gas. The wing-pinned root restores mandatory sponsorship without a new circuit
 * or a new ceremony. Cost, stated plainly: the endorser's commitment is now
 * derivable from the transaction, so the act becomes a public record rather than
 * a guess. The commitment was already world-readable in `WingPeer`; the wallet
 * layer — which is what F35 bought — is untouched.
 *
 * `parrainHex` is IGNORED for the proof and kept only for call-site
 * compatibility: the bond is refetched from chain, because a mentee can
 * re-point `establish_wing_peer` at any moment and a proof against a stale wing
 * cannot verify.
 *
 * Everything else is unchanged: the same `["faucetnull", circle, neophyte]`
 * one-shot guard (shared with the named path, so the two cannot be stacked), the
 * same uniform `jar.grant_lamports`, the same 24 h retune cooldown, the same
 * rent floor, paid to the same `Membership.owner` wallet.
 *
 * Relayed whenever a relayer is configured — a self-paid fee would name a wallet
 * at the exact moment of the endorsement, which is the link the proof exists to
 * remove. Without a relayer this still beats the named path (the program asserts
 * nothing about the payer, and no parrain membership account appears), but the
 * fee-payer is a correlation the UI must not pretend away.
 */
export async function activateFaucetAnonymously(
  wallet: SigningWallet,
  circle: PublicKey,
  parrainHex: string,
  neophyteHex: string
): Promise<string> {
  const neophyte = toBytes(neophyteHex);
  const neoMembership = membershipPda(circle, neophyte);
  const m: any = await (readOnlyProgram().account as any).membership.fetch(neoMembership);
  const owner: PublicKey = m.owner;
  if (!owner || owner.equals(PublicKey.default)) {
    throw new Error("This member has no wallet bound to their membership — the faucet needs a wallet to pay first gas to.");
  }

  // Refetch the bond: the program folds ITS `wing` into the root the proof must
  // match, and the mentee can re-point the bond at any time.
  const wingPeer = wingPeerPda(circle, neophyte);
  const wp: any = await (readOnlyProgram().account as any).wingPeer.fetch(wingPeer);
  if (!wp?.active) throw new Error("This member has no active wing — first gas is a sponsor's welcome, not a self-service tap.");
  const wingHex = toHex(Uint8Array.from(wp.wing as number[]));
  if (parrainHex && wingHex !== parrainHex) {
    // Not fatal — the chain is the authority — but the caller's idea of the bond
    // is stale, and only the CURRENT wing can produce a verifying proof.
    console.warn("faucet: wing bond changed on chain; proving as the current wing");
  }

  const extNull = await faucetExternalNullifier(circle, neophyte);
  const { root, nullifier, proofA, proofB, proofC } = await proveWingEndorsement(
    circle.toBase58(),
    wingHex,
    beToBig(extNull)
  );

  const accounts = {
    circle,
    memberTree: memberTreePda(circle),
    // NOT consulted since F35-R2 (a tree of one never goes stale, so the F54
    // ring is irrelevant here) — null keeps the account count the relay policy
    // pins at 10 and saves ~8k CU. Do NOT pass a wing-derived root to the ring.
    // (cast: Anchor's generated type for an Option account is not nullable, but
    // `null` is exactly what its runtime resolver wants — it substitutes the
    // program id, which keeps the account COUNT at the 10 the relay policy pins.)
    recentRoots: null as unknown as PublicKey,
    neophyteMembership: neoMembership,
    wingPeer,
    grantNullifier: faucetNullPda(circle, neophyte),
    jar: faucetPda(circle),
    recipient: owner,
    payer: PublicKey.default, // replaced below
    systemProgram: SystemProgram.programId,
  };

  const relayer = await relayerPubkey();
  if (relayer) {
    const ix = await readOnlyProgram()
      .methods.activateFaucetZk(root, nullifier, proofA, proofB, proofC)
      .accounts({ ...accounts, payer: relayer })
      .instruction();
    return relayInstruction(ix);
  }
  return programWith(wallet)
    .methods.activateFaucetZk(root, nullifier, proofA, proofB, proofC)
    .accounts({ ...accounts, payer: wallet.publicKey })
    .rpc();
}

/**
 * **DEPRECATED (F35 → Epic 2): prefer `activateFaucetAnonymously`.**
 *
 * The named pilot path: the parrain (the neophyte's designated WingPeer) signs
 * and pays, so the transaction publicly links the parrain's wallet AND
 * commitment to the neophyte's, with a lamport transfer between them — the
 * sponsor edge the Traditions audit rejects. Kept only as the fallback for a
 * parrain whose device holds no ZK voting key (a membership minted before
 * anonymous identities, or a second device); `haveVotingKey(parrainHex)` is the
 * test, and the UI must take the anonymous path whenever it is true.
 *
 * Pays exactly `jar.grant_lamports` to the neophyte's own wallet; the nullifier
 * makes a second grant for that membership impossible, in this Circle, ever.
 */
export async function activateFaucet(
  wallet: SigningWallet,
  circle: PublicKey,
  parrainHex: string,
  neophyteHex: string
): Promise<string> {
  const parrain = toBytes(parrainHex);
  const neophyte = toBytes(neophyteHex);
  const neoMembership = membershipPda(circle, neophyte);
  const m: any = await (readOnlyProgram().account as any).membership.fetch(neoMembership);
  const owner: PublicKey = m.owner;
  if (!owner || owner.equals(PublicKey.default)) {
    throw new Error("This member has no wallet bound to their membership — the faucet needs a wallet to pay first gas to.");
  }
  return programWith(wallet)
    .methods.activateFaucet()
    .accounts({
      circle,
      parrainMembership: membershipPda(circle, parrain),
      neophyteMembership: neoMembership,
      wingPeer: wingPeerPda(circle, neophyte),
      grantNullifier: faucetNullPda(circle, neophyte),
      jar: faucetPda(circle),
      recipient: owner,
      parrain: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export interface Mentee { commitment: string; establishedAt: number }

/** Active mentees (neophytes) whose designated wing is `wingHex`, in a circle. */
export async function listMenteesOf(circle: string, wingHex: string): Promise<Mentee[]> {
  const rows = await (readOnlyProgram().account as any).wingPeer.all([
    { memcmp: { offset: 8, bytes: circle } },
  ]);
  return rows
    .filter((r: any) => r.account.active && toHex(r.account.wing) === wingHex)
    .map((r: any): Mentee => ({ commitment: toHex(r.account.mentee), establishedAt: Number(r.account.establishedAt) }));
}

// ---------------------------------------------------------------------------
// Refills — group conscience moves treasury lamports into the jar
// ---------------------------------------------------------------------------

/** H("AHA-faucet-refill" || circle || amount_le_8) — the proposal's description_hash. */
async function refillHash(circle: PublicKey, lamports: number): Promise<Uint8Array> {
  const amount = new Uint8Array(8);
  new DataView(amount.buffer).setBigUint64(0, BigInt(lamports), true);
  const data = new Uint8Array([...seed("AHA-faucet-refill"), ...circle.toBytes(), ...amount]);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

/**
 * Open the member vote that authorizes moving exactly `lamports` from the
 * treasury into the faucet jar. The proposal's description_hash commits to
 * (circle, amount); once passed & finalized, anyone can execute the refill.
 */
export async function proposeFaucetRefill(
  wallet: SigningWallet,
  circle: PublicKey,
  lamports: number,
  votingPeriodSecs: number
): Promise<{ signature: string; proposal: PublicKey }> {
  const program = programWith(wallet);
  const nonce = freshNonce();
  const proposal = memberProposalPda(circle, nonce);
  const hashBytes = await refillHash(circle, lamports);
  const hashHex = toHex(hashBytes);
  rememberProposalText(hashHex, `Refill the gas faucet with ${lamports / 1e9} SOL from the treasury`);
  rememberRefillAmount(hashHex, lamports);
  const signature = await program.methods
    .createMemberProposal(nonce, [...hashBytes], new anchor.BN(votingPeriodSecs))
    .accounts({ circle, memberTree: memberTreePda(circle), proposal, proposer: wallet.publicKey })
    .rpc();
  return { signature, proposal };
}

/** Execute a passed refill vote (permissionless; one-shot per proposal). */
export async function refillFaucet(
  wallet: SigningWallet,
  circle: PublicKey,
  proposal: PublicKey,
  lamports: number
): Promise<string> {
  return programWith(wallet)
    .methods.refillFaucet(new anchor.BN(lamports))
    .accounts({
      circle,
      proposal,
      fillMarker: faucetFillPda(proposal),
      treasury: treasuryPda(circle),
      jar: faucetPda(circle),
      caller: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

// The voted amount can't be read back from the hash, so remember it locally
// (same pattern as the member-proposal text store): description_hash → lamports.
const REFILL_KEY = "aha:faucet-refills";
function rememberRefillAmount(hashHex: string, lamports: number) {
  if (typeof window === "undefined") return;
  try {
    const all = JSON.parse(localStorage.getItem(REFILL_KEY) || "{}");
    all[hashHex] = lamports;
    localStorage.setItem(REFILL_KEY, JSON.stringify(all));
  } catch {}
}

/** The refill amount a local proposal (by description_hash hex) committed to, or null. */
export function recallRefillAmount(hashHex: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    const v = JSON.parse(localStorage.getItem(REFILL_KEY) || "{}")[hashHex];
    return typeof v === "number" ? v : null;
  } catch {
    return null;
  }
}

// Member-proposal text lives off-chain (only its hash is on-chain). Same key +
// format as lib/admin.ts's private store, so listMemberProposals shows the label.
const TEXT_KEY = "aha:proposal-text";
function rememberProposalText(hash: string, text: string) {
  if (typeof window === "undefined") return;
  try {
    const all = JSON.parse(localStorage.getItem(TEXT_KEY) || "{}");
    all[hash] = text;
    localStorage.setItem(TEXT_KEY, JSON.stringify(all));
  } catch {}
}
