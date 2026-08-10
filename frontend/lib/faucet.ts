// Gas faucet (Trust Platform Epic 0): a per-Circle jar of "first gas" lamports.
// The parrain (the neophyte's WingPeer sponsor) triggers a one-time uniform
// grant to the neophyte's own wallet; a global nullifier (seeded by the
// neophyte's commitment alone) makes it one grant per identity, ever. Refills
// come only from a passed anonymous member vote committing to the exact amount.

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
// The grant — the parrain welcomes the neophyte with first gas
// ---------------------------------------------------------------------------

/**
 * The parrain (the neophyte's designated WingPeer) triggers the one-time grant.
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
