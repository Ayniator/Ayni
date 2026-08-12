// Browser ZK member voting (F6 + F28): a member proves, anonymously, that they
// belong to a proposal's snapshotted voter set and casts one ballot — without
// revealing which member they are. Heavy deps (snarkjs, circomlibjs) are
// dynamically imported so they only load when someone actually votes.
//
// Identity: a member's leaf is commitment = Poseidon(secret); the `secret` lives
// only on the member's device (localStorage). The circuit proves knowledge of a
// secret whose commitment is in the tree, emitting a per-proposal nullifier
// (one vote per member). See app/voting/prove.ts (node) + docs/member-voting.md.

import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID, SigningWallet, findMyMemberships, programWith, readOnlyProgram } from "./member";
import { relayerPubkey, relayInstruction } from "./relayer";
// Derivation contract only (no chain/network deps come with it).
import { zkSecretForCircle } from "./sharding";

// BN254 has TWO different primes and they must never be confused:
//   R = the SCALAR field r — the field the circuits (and Poseidon) live in; every
//       secret, commitment and nullifier is an element of it.
//   Q = the BASE field q — the coordinate field of G1/G2; used here only to
//       negate a G1 point (`Q - y`) when packing a proof for the on-chain
//       verifier.
// r < q, and r ends ...495617 while q ends ...208583. Historically `R` here held
// q's value; that was a latent bug (it is a no-op for existing secrets — see
// `secretScalarFromBytes` — but it makes any future full-range reduction produce
// a non-canonical, out-of-field scalar). Pinned by tests/zk-field-constants.test.mjs.
const R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const Q = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
const seed = (s: string) => new TextEncoder().encode(s);

const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string) => Uint8Array.from((h.match(/.{1,2}/g) ?? []).map((x) => parseInt(x, 16)));
function to32BE(x: bigint): number[] {
  const out = new Array<number>(32).fill(0);
  let v = x;
  for (let i = 31; i >= 0; i--) { out[i] = Number(v & 0xffn); v >>= 8n; }
  return out;
}
const beToBig = (b: Uint8Array | number[]): bigint => { let v = 0n; for (const x of b) v = (v << 8n) | BigInt(x); return v; };

/**
 * THE canonical bytes → BN254 scalar reduction. Every secret that will ever be
 * fed to a circuit goes through here, so there is exactly one definition.
 *
 * Big-endian interpretation, then `mod R` (the SCALAR field). Note the accepted
 * modulo bias: 2^256 is not a multiple of r, so the ~2^256 - 2^255.x residues in
 * [0, 2^256 mod r) are about 2.4x more likely than the rest. For a 254-bit field
 * that bias is ~2^-2 on a vanishing slice and is cryptographically irrelevant
 * here (the input is either a CSPRNG draw or a SHA-256 output). It is ACCEPTED
 * DELIBERATELY: do not "fix" it with rejection sampling or wide reduction in one
 * call site only — the derivation is a frozen contract (see
 * `zkSecretForCircle` in lib/sharding.ts) and any change rotates every derived
 * identity.
 */
export function secretScalarFromBytes(b: Uint8Array): bigint {
  return beToBig(b) % R;
}

let _poseidon: any = null;
async function poseidon() {
  if (!_poseidon) { const { buildPoseidon } = await import("circomlibjs"); _poseidon = await buildPoseidon(); }
  return _poseidon;
}

// --- identity + secret persistence (per-device) ---
const SK = (commitHex: string) => `aha:zk-secret:${commitHex}`;

/** Mint a fresh, votable anonymous identity: commitment = Poseidon(secret); the
 *  secret is saved on THIS device so the member can prove later. Returns the
 *  commitment bytes to issue the membership with.
 *
 *  Two ways to obtain the secret, ONE storage slot:
 *   - `opts` ABSENT (every call site today): a fresh CSPRNG draw. Device-bound —
 *     the secret exists nowhere else and shard recovery cannot restore it.
 *   - `opts` PRESENT: ROOTED in the master secret (the credential of record, per
 *     CLAUDE.md), via the frozen `zkSecretForCircle` contract. Reconstructing the
 *     master from shards re-derives this exact secret, so the identity survives
 *     device loss. `index` mints a fresh identity in the same Circle on rejoin.
 *
 *  Either way the decimal secret lands in the SAME `aha:zk-secret:<commitHex>`
 *  slot, so `getSecretFor` / `haveVotingKey` and every prove path stay identical
 *  and cannot tell the two classes apart — which is exactly why legacy keeps
 *  working untouched. */
export async function newMemberIdentity(opts?: { master: Uint8Array; circle: Uint8Array; index?: number }): Promise<Uint8Array> {
  const p = await poseidon();
  let secret: bigint;
  if (opts) {
    secret = secretScalarFromBytes(await zkSecretForCircle(opts.master, opts.circle, opts.index ?? 0));
  } else {
    const rnd = new Uint8Array(32);
    crypto.getRandomValues(rnd);
    rnd[0] &= 0x1f; // keep it in the field
    secret = secretScalarFromBytes(rnd);
  }
  const commitment = p.F.toObject(p([secret])) as bigint;
  const cBytes = Uint8Array.from(to32BE(commitment));
  try { localStorage.setItem(SK(toHex(cBytes)), secret.toString()); } catch {}
  return cBytes;
}

export function getSecretFor(commitHex: string): bigint | null {
  try { const s = localStorage.getItem(SK(commitHex)); return s ? BigInt(s) : null; } catch { return null; }
}
export function haveVotingKey(commitHex: string): boolean { return getSecretFor(commitHex) !== null; }

// --- mirror of the on-chain incremental Poseidon Merkle tree (merkle.rs) ---
class MemberTree {
  depth: number; p: any; F: any;
  zeros: bigint[] = []; filled: bigint[] = []; leaves: bigint[] = []; root = 0n; nextIndex = 0;
  private constructor(p: any, depth: number) { this.p = p; this.F = p.F; this.depth = depth; }
  static async create(depth = 20): Promise<MemberTree> {
    const t = new MemberTree(await poseidon(), depth);
    let z = 0n; t.zeros.push(z);
    for (let i = 0; i < depth; i++) { z = t.h2(z, z); t.zeros.push(z); t.filled.push(t.zeros[i]); }
    t.root = t.zeros[depth];
    return t;
  }
  h2(a: bigint, b: bigint): bigint { return this.F.toObject(this.p([a, b])); }
  insert(leaf: bigint): number {
    const index = this.nextIndex; let i = index; let cur = leaf;
    for (let l = 0; l < this.depth; l++) {
      let left: bigint, right: bigint;
      if (i % 2 === 0) { left = cur; right = this.zeros[l]; this.filled[l] = cur; }
      else { left = this.filled[l]; right = cur; }
      cur = this.h2(left, right); i = Math.floor(i / 2);
    }
    this.leaves.push(leaf); this.root = cur; return this.nextIndex++;
  }
  proof(index: number): { pathElements: bigint[]; pathIndices: number[] } {
    const pathElements: bigint[] = []; const pathIndices: number[] = [];
    let layer = [...this.leaves]; let i = index;
    for (let l = 0; l < this.depth; l++) {
      const isRight = i % 2;
      const sib = isRight ? layer[i - 1] : i + 1 < layer.length ? layer[i + 1] : this.zeros[l];
      pathElements.push(sib); pathIndices.push(isRight);
      const next: bigint[] = [];
      for (let k = 0; k < layer.length; k += 2) {
        const L = layer[k]; const Rr = k + 1 < layer.length ? layer[k + 1] : this.zeros[l];
        next.push(this.h2(L, Rr));
      }
      layer = next; i = Math.floor(i / 2);
    }
    return { pathElements, pathIndices };
  }
}

interface VoteProof { nullifier: number[]; proofA: number[]; proofB: number[]; proofC: number[] }

async function proveVote(tree: MemberTree, secret: bigint, leafIndex: number, proposalId: bigint, choice: boolean): Promise<VoteProof> {
  const { groth16 } = await import("snarkjs");
  const { pathElements, pathIndices } = tree.proof(leafIndex);
  const input = {
    root: tree.root.toString(), proposalId: proposalId.toString(), choice: choice ? "1" : "0",
    secret: secret.toString(), pathElements: pathElements.map(String), pathIndices: pathIndices.map(String),
  };
  const { proof, publicSignals } = await groth16.fullProve(input, "/zk/member_vote.wasm", "/zk/member_vote_final.zkey");
  const nullifier = to32BE(BigInt(publicSignals[0]));
  const ax = BigInt(proof.pi_a[0]);
  const ay = (Q - (BigInt(proof.pi_a[1]) % Q)) % Q; // negate G1
  const proofA = [...to32BE(ax), ...to32BE(ay)];
  const proofB = [...to32BE(proof.pi_b[0][1]), ...to32BE(proof.pi_b[0][0]), ...to32BE(proof.pi_b[1][1]), ...to32BE(proof.pi_b[1][0])];
  const proofC = [...to32BE(proof.pi_c[0]), ...to32BE(proof.pi_c[1])];
  return { nullifier, proofA, proofB, proofC };
}

/** All memberships of a Circle in insertion (issuance) order — matches the
 *  on-chain member tree's leaf order so a path can be reconstructed. */
/**
 * Reconstruct the MemberTree's exact insertion order (F54-aware).
 *
 * Sources, in precedence order:
 *  1. `EpochLeaf` markers — explicit (index, commitment) pairs written by
 *     `reinsert_member` after an epoch rebuild;
 *  2. `AdmissionAttestation.leaf_index` pins (1-based; 0 = unconfirmed) —
 *     written by `confirm_admission`, so confirmations that interleave with
 *     direct issuance land at their true position;
 *  3. every remaining (non-provisional, post-epoch) membership in
 *     (issued_at, pubkey) order, filling the unpinned slots — direct issuance
 *     inserts at issue time, so chronological order IS insertion order.
 * Provisional members are excluded: their commitment is not in the tree yet.
 * Any residual mismatch is caught by the caller's root-equality check.
 */
async function orderedCommitments(circle: string): Promise<string[]> {
  const program = readOnlyProgram();
  const circlePk = new PublicKey(circle);
  const rootsPda = PublicKey.findProgramAddressSync([seed("roots"), circlePk.toBytes()], PROGRAM_ID)[0];
  const rr: any = await (program.account as any).recentRoots.fetchNullable(rootsPda).catch(() => null);
  const epoch: bigint = rr ? BigInt(rr.epoch.toString()) : 0n;
  const epochStart: number = rr ? Number(rr.epochStartedAt) : 0;

  const rows = await (program.account as any).membership.all([{ memcmp: { offset: 8, bytes: circle } }]);
  const provisional = await (program.account as any).provisionalMember
    .all([{ memcmp: { offset: 8, bytes: circle } }])
    .catch(() => []);
  const provisionalSet = new Set(provisional.map((p: any) => toHex(Uint8Array.from(p.account.commitment))));

  const explicit = new Map<number, string>();
  if (epoch > 0n) {
    const leaves = await (program.account as any).epochLeaf.all([{ memcmp: { offset: 8, bytes: circle } }]);
    for (const l of leaves) {
      if (BigInt(l.account.epoch.toString()) === epoch) {
        explicit.set(Number(l.account.leafIndex), toHex(Uint8Array.from(l.account.commitment)));
      }
    }
  }
  const atts = await (program.account as any).admissionAttestation
    .all([{ memcmp: { offset: 8, bytes: circle } }])
    .catch(() => []);
  const explicitVals = new Set(explicit.values());
  for (const a of atts) {
    const idx = Number(a.account.leafIndex); // 1-based; 0 = not yet confirmed
    if (idx > 0 && BigInt(a.account.leafEpoch.toString()) === epoch) {
      const c = toHex(Uint8Array.from(a.account.newcomer));
      if (!explicitVals.has(c)) {
        explicit.set(idx - 1, c);
        explicitVals.add(c);
      }
    }
  }

  const fill = rows
    .map((r: any) => ({ c: toHex(Uint8Array.from(r.account.commitment)), t: Number(r.account.issuedAt), k: r.publicKey.toBase58() }))
    .filter((x: any) => !provisionalSet.has(x.c) && !explicitVals.has(x.c))
    // After a rebuild, only post-rebuild direct issues are in the tree; the
    // rest re-enter via EpochLeaf (above) or not at all (not in good standing).
    .filter((x: any) => (epoch > 0n ? x.t >= epochStart : true))
    .sort((a: any, b: any) => (a.t - b.t) || a.k.localeCompare(b.k))
    .map((x: any) => x.c);

  if (explicit.size === 0) return fill;
  // Interleave explicit pins with the chronological fill. Guard against a pin
  // index beyond the current length (e.g. a directly-issued member revoked
  // between snapshot and now) so we never emit `undefined`: any gap or overrun
  // is dropped, and the caller's root-equality check catches a genuine mismatch
  // rather than proving against a corrupt order.
  const maxIdx = Math.max(...explicit.keys());
  const total = Math.max(explicit.size + fill.length, maxIdx + 1);
  const out: string[] = [];
  let fi = 0;
  for (let i = 0; i < total; i++) {
    if (explicit.has(i)) out.push(explicit.get(i) as string);
    else if (fi < fill.length) out.push(fill[fi++]);
    // else: a hole (pin index past the fill) — skip rather than push undefined.
  }
  return out;
}

/** PDA of a Circle's F54 recent-roots ring buffer. */
export function recentRootsPda(circlePk: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([seed("roots"), circlePk.toBytes()], PROGRAM_ID)[0];
}

/**
 * F54 crank: record the current member root in the ring buffer so the proof
 * we're about to make survives concurrent admissions. Relayed when possible so
 * the crank doesn't name the prover-to-be either.
 */
async function crankNoteRoot(wallet: SigningWallet, circlePk: PublicKey): Promise<void> {
  const memberTree = PublicKey.findProgramAddressSync([seed("members"), circlePk.toBytes()], PROGRAM_ID)[0];
  const recentRoots = recentRootsPda(circlePk);
  const relayer = await relayerPubkey();
  if (relayer) {
    const ix = await readOnlyProgram()
      .methods.noteRoot()
      .accounts({ circle: circlePk, memberTree, recentRoots, caller: relayer })
      .instruction();
    await relayInstruction(ix);
    return;
  }
  await programWith(wallet)
    .methods.noteRoot()
    .accounts({ circle: circlePk, memberTree, recentRoots, caller: wallet.publicKey })
    .rpc();
}

/** Cast an anonymous YES/NO ballot on a member proposal (or seat election). */
export async function castMemberVote(wallet: SigningWallet, circle: string, proposalPubkey: string, choice: boolean): Promise<string> {
  const program = readOnlyProgram();
  const prop: any = await (program.account as any).memberProposal.fetch(new PublicKey(proposalPubkey));
  const eligible = Number(prop.eligibleCount);
  const nonce = BigInt(prop.nonce.toString());
  const rootHex = toHex(Uint8Array.from(prop.memberRoot));

  const mine = await findMyMemberships(wallet.publicKey, []);
  const mm = mine.find((m) => m.circle === circle);
  if (!mm) throw new Error("You hold no membership in this Circle.");
  const secret = getSecretFor(mm.commitment);
  if (secret === null) throw new Error("Your voting key isn't on this device. Vote from the device you joined on, or rejoin to mint a votable membership.");

  const order = await orderedCommitments(circle);
  const tree = await MemberTree.create(20);
  let myIndex = -1;
  for (const c of order.slice(0, eligible)) {
    const idx = tree.insert(beToBig(fromHex(c)));
    if (c === mm.commitment) myIndex = idx;
  }
  if (myIndex < 0) throw new Error("Your membership isn't in this vote's voter snapshot (issued after it opened).");
  if (toHex(Uint8Array.from(to32BE(tree.root))) !== rootHex) throw new Error("Could not reconstruct the voter set for this proposal.");

  const { nullifier, proofA, proofB, proofC } = await proveVote(tree, secret, myIndex, nonce, choice);
  const proposal = new PublicKey(proposalPubkey);
  const voteNullifier = PublicKey.findProgramAddressSync([seed("vote_nullifier"), proposal.toBytes(), Uint8Array.from(nullifier)], PROGRAM_ID)[0];

  // F55: relay when possible — a self-paid ballot names the prover's wallet as
  // fee-payer, which is exactly the link the ZK proof exists to avoid.
  const relayer = await relayerPubkey();
  if (relayer) {
    const ix = await readOnlyProgram()
      .methods.castVote(choice, nullifier, proofA, proofB, proofC)
      .accounts({ proposal, voteNullifier, payer: relayer })
      .instruction();
    return relayInstruction(ix);
  }
  return programWith(wallet)
    .methods.castVote(choice, nullifier, proofA, proofB, proofC)
    .accounts({ proposal, voteNullifier, payer: wallet.publicKey })
    .rpc();
}

/** The pieces an anonymous member-endorsement instruction needs on chain. */
export interface MemberEndorsement {
  /** The member root the proof was made against (32 BE bytes). */
  root: number[];
  /** Poseidon(secret, externalNullifier) — the circuit's public output. */
  nullifier: number[];
  proofA: number[];
  proofB: number[];
  proofC: number[];
}

/**
 * THE anonymous "some member of this Circle endorses X" primitive, shared by
 * every Epic 2 instruction that needs one (anonymous admission attestation,
 * F35 anonymous faucet activation). Proves — with `member_vote.circom`, reused
 * exactly as voting does — that the caller's membership is in the Circle's
 * current member tree, under the caller-supplied `externalNullifier`, and emits
 * `nullifier = Poseidon(secret, externalNullifier)`.
 *
 * The external nullifier is the caller's choice because it is what BINDS an
 * endorsement to one thing and DOMAIN-SEPARATES it from every other kind: reuse
 * the same value in two different instructions and the same member endorsing
 * both emits the same nullifier twice, which is a free correlation for anyone
 * reading the chain. Each call site must pass a distinct, domain-tagged value
 * that its program-side handler recomputes identically.
 *
 * NO identity of the prover touches the chain. Submit the resulting instruction
 * via the relayer so the fee-payer does not reintroduce the link.
 */
export async function proveMemberEndorsement(
  wallet: SigningWallet,
  circle: string,
  proverCommitmentHex: string,
  externalNullifier: bigint
): Promise<MemberEndorsement> {
  const secret = getSecretFor(proverCommitmentHex);
  if (secret === null) throw new Error("Your membership key isn't on this device — attest from the device you joined on.");

  const order = await orderedCommitments(circle);
  const tree = await MemberTree.create(20);
  let myIndex = -1;
  for (const c of order) {
    const idx = tree.insert(beToBig(fromHex(c)));
    if (c === proverCommitmentHex) myIndex = idx;
  }
  if (myIndex < 0) throw new Error("Your membership isn't in the current member tree (still provisional?).");

  // F54: crank the ring buffer FIRST, so the root we prove against stays
  // acceptable even if an admission lands while we're proving.
  await crankNoteRoot(wallet, new PublicKey(circle));

  const root = to32BE(tree.root);
  const { nullifier, proofA, proofB, proofC } = await proveVote(tree, secret, myIndex, externalNullifier, true);
  return { root, nullifier, proofA, proofB, proofC };
}

/**
 * F35-R2 — "I am this neophyte's WING, and I endorse their first gas."
 *
 * Same circuit, same artifacts, same ceremony key as `proveMemberEndorsement`;
 * the ONLY difference is which set `root` denotes. Here the tree has exactly one
 * leaf — the wing's own commitment, at index 0 — so the root is a value the
 * PROGRAM can recompute from `wing_peer.wing` (`merkle::single_leaf_root`), and
 * the only witness that satisfies it is the wing's secret. That is what makes
 * sponsorship mandatory again after F35 shipped an endorsement any tree member
 * (including the neophyte) could produce.
 *
 * Byte-compatibility with the program is load-bearing and is not an accident:
 * `MemberTree.create(20)` seeds `z = 0; z = h2(z, z)` exactly as `merkle.rs`
 * does, and `proof(0)` on a one-leaf tree returns `pathElements = [zeros[l]]`
 * with `pathIndices` all 0 — the same fold as `single_leaf_root`. Pinned on the
 * Rust side by `proptests::single_leaf_root_matches_a_fresh_tree_with_one_leaf`.
 *
 * Cheaper AND simpler than the member-tree path: no `orderedCommitments()`
 * roster rebuild (a multi-`getProgramAccounts` sweep), and no `note_root` crank
 * transaction — a tree of one has no concurrency race and never goes stale.
 *
 * BE HONEST WITH THE CALLER ABOUT WHAT THIS PUBLISHES: `root` is a deterministic
 * public function of the wing's commitment, which is already world-readable in
 * `WingPeer`. So the transaction now RECORDS that the holder of that commitment
 * acted at that moment, where before it supported only a guess. No wallet, no
 * signature, no membership account of the wing's appears — the F35 win is at the
 * wallet layer and it survives untouched.
 *
 * @param wingCommitmentHex the bond's CURRENT `wing` — refetch it immediately
 *   before proving. `establish_wing_peer` is mentee-signed and `init_if_needed`,
 *   so a mentee can re-point the bond and invalidate a proof already generated.
 */
export async function proveWingEndorsement(
  circle: string,
  wingCommitmentHex: string,
  externalNullifier: bigint
): Promise<MemberEndorsement> {
  const secret = getSecretFor(wingCommitmentHex);
  if (secret === null) {
    throw new Error(
      "Only this neophyte's wing can endorse their first gas, and the wing's key isn't on this device — endorse from the device you joined on."
    );
  }
  void circle; // the binding to the Circle lives in `externalNullifier`

  const tree = await MemberTree.create(20);
  tree.insert(beToBig(fromHex(wingCommitmentHex))); // the only leaf, index 0
  const root = to32BE(tree.root);
  const { nullifier, proofA, proofB, proofC } = await proveVote(tree, secret, 0, externalNullifier, true);
  return { root, nullifier, proofA, proofB, proofC };
}

/**
 * Epic 2 — attest for a newcomer ANONYMOUSLY. Proves (member_vote circuit,
 * reused exactly as voting does) that the caller's membership is in the Circle's
 * current member tree, with the newcomer's commitment as the external
 * nullifier. Emits `nullifier = Poseidon(secret, newcomer)` — deterministic per
 * (parrain, newcomer), so one member cannot double-attest. NO parrain identity
 * touches the chain: the sponsor edge never exists. Submit via the relayer so
 * the fee-payer does not reintroduce the link.
 */
export async function attestAdmissionAnonymously(
  wallet: SigningWallet,
  circle: string,
  parrainCommitmentHex: string,
  newcomerCommitmentHex: string
): Promise<string> {
  const circlePk = new PublicKey(circle);
  const newcomerId = beToBig(fromHex(newcomerCommitmentHex)); // external nullifier = newcomer commitment
  const { root, nullifier, proofA, proofB, proofC } = await proveMemberEndorsement(
    wallet,
    circle,
    parrainCommitmentHex,
    newcomerId
  );

  const newcomer = [...fromHex(newcomerCommitmentHex)];
  const attestation = PublicKey.findProgramAddressSync(
    [seed("attest"), circlePk.toBytes(), Uint8Array.from(newcomer)], PROGRAM_ID)[0];
  const vouchNull = PublicKey.findProgramAddressSync(
    [seed("vouchnull"), circlePk.toBytes(), Uint8Array.from(nullifier)], PROGRAM_ID)[0];
  const memberTree = PublicKey.findProgramAddressSync([seed("members"), circlePk.toBytes()], PROGRAM_ID)[0];
  const recentRoots = recentRootsPda(circlePk);

  // F55: relayed by default — the whole point is that no parrain wallet
  // appears anywhere near this attestation.
  const relayer = await relayerPubkey();
  if (relayer) {
    const ix = await readOnlyProgram()
      .methods.attestAdmissionZk(newcomer, root, nullifier, proofA, proofB, proofC)
      .accounts({ circle: circlePk, memberTree, recentRoots, attestation, vouchNullifier: vouchNull, payer: relayer })
      .instruction();
    return relayInstruction(ix);
  }
  return programWith(wallet)
    .methods.attestAdmissionZk(newcomer, root, nullifier, proofA, proofB, proofC)
    .accounts({ circle: circlePk, memberTree, recentRoots, attestation, vouchNullifier: vouchNull, payer: wallet.publicKey })
    .rpc();
}
