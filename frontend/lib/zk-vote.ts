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
async function orderedCommitments(circle: string): Promise<string[]> {
  const rows = await (readOnlyProgram().account as any).membership.all([{ memcmp: { offset: 8, bytes: circle } }]);
  return rows
    .map((r: any) => ({ c: toHex(Uint8Array.from(r.account.commitment)), t: Number(r.account.issuedAt), k: r.publicKey.toBase58() }))
    .sort((a: any, b: any) => (a.t - b.t) || a.k.localeCompare(b.k))
    .map((x: any) => x.c);
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
  return programWith(wallet)
    .methods.castVote(choice, nullifier, proofA, proofB, proofC)
    .accounts({ proposal, voteNullifier, payer: wallet.publicKey })
    .rpc();
}
