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

// BN254 scalar field r (for the secret) and base field q (for G1 negation).
const R = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
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

let _poseidon: any = null;
async function poseidon() {
  if (!_poseidon) { const { buildPoseidon } = await import("circomlibjs"); _poseidon = await buildPoseidon(); }
  return _poseidon;
}

// --- identity + secret persistence (per-device) ---
const SK = (commitHex: string) => `aha:zk-secret:${commitHex}`;

/** Mint a fresh, votable anonymous identity: commitment = Poseidon(secret); the
 *  secret is saved on THIS device so the member can prove later. Returns the
 *  commitment bytes to issue the membership with. */
export async function newMemberIdentity(): Promise<Uint8Array> {
  const p = await poseidon();
  const rnd = new Uint8Array(32);
  crypto.getRandomValues(rnd);
  rnd[0] &= 0x1f; // keep it in the field
  const secret = beToBig(rnd) % R;
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
  const total = explicit.size + fill.length;
  const out: string[] = [];
  let fi = 0;
  for (let i = 0; i < total; i++) out.push(explicit.has(i) ? (explicit.get(i) as string) : fill[fi++]);
  return out;
}

/** PDA of a Circle's F54 recent-roots ring buffer. */
function recentRootsPda(circlePk: PublicKey): PublicKey {
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
  const secret = getSecretFor(parrainCommitmentHex);
  if (secret === null) throw new Error("Your membership key isn't on this device — attest from the device you joined on.");

  const order = await orderedCommitments(circle);
  const tree = await MemberTree.create(20);
  let myIndex = -1;
  for (const c of order) {
    const idx = tree.insert(beToBig(fromHex(c)));
    if (c === parrainCommitmentHex) myIndex = idx;
  }
  if (myIndex < 0) throw new Error("Your membership isn't in the current member tree (still provisional?).");

  const circlePk = new PublicKey(circle);

  // F54: crank the ring buffer FIRST, so the root we prove against stays
  // acceptable even if an admission lands while we're proving.
  await crankNoteRoot(wallet, circlePk);

  const newcomerId = beToBig(fromHex(newcomerCommitmentHex)); // external nullifier = newcomer commitment
  const root = to32BE(tree.root);
  const { nullifier, proofA, proofB, proofC } = await proveVote(tree, secret, myIndex, newcomerId, true);

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
