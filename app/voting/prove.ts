// Off-chain prover for circuits/member_vote.circom.
//
// Mirrors the on-chain member-set tree (programs/ayni/src/merkle.rs) with
// circomlib Poseidon, builds the voter's Merkle path, runs snarkjs, and formats
// the proof for groth16-solana (proof_a negated; G2 Fp2 as c1||c0). See
// docs/member-voting.md.

import { buildPoseidon } from "circomlibjs";
import { groth16 } from "snarkjs";

// BN254 base field modulus q (for G1 negation of proof_a).
const Q =
  21888242871839275222246405745257275088696311157297823662689037894645226208583n;

export function to32BE(x: bigint | string): number[] {
  let v = BigInt(x);
  const out = new Array<number>(32).fill(0);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/** Depth-N incremental Poseidon Merkle tree; byte-identical to merkle.rs. */
export class MemberTree {
  readonly depth: number;
  private poseidon: any;
  private F: any;
  private zeros: bigint[] = [];
  private filled: bigint[] = [];
  private leaves: bigint[] = [];
  root = 0n;
  nextIndex = 0;

  private constructor(p: any, depth: number) {
    this.poseidon = p;
    this.F = p.F;
    this.depth = depth;
  }

  static async create(depth = 20): Promise<MemberTree> {
    const t = new MemberTree(await buildPoseidon(), depth);
    let z = 0n;
    t.zeros.push(z);
    for (let i = 0; i < depth; i++) {
      z = t.h2(z, z);
      t.zeros.push(z);
      t.filled.push(t.zeros[i]);
    }
    t.root = t.zeros[depth];
    return t;
  }

  h1(a: bigint): bigint {
    return this.F.toObject(this.poseidon([a]));
  }
  h2(a: bigint, b: bigint): bigint {
    return this.F.toObject(this.poseidon([a, b]));
  }

  /** Append a leaf (the member's identity commitment = Poseidon(secret)). */
  insert(leaf: bigint): number {
    const index = this.nextIndex;
    let i = index;
    let cur = leaf;
    for (let l = 0; l < this.depth; l++) {
      let left: bigint, right: bigint;
      if (i % 2 === 0) {
        left = cur;
        right = this.zeros[l];
        this.filled[l] = cur;
      } else {
        left = this.filled[l];
        right = cur;
      }
      cur = this.h2(left, right);
      i = Math.floor(i / 2);
    }
    this.leaves.push(leaf);
    this.root = cur;
    return this.nextIndex++;
  }

  proof(index: number): { pathElements: bigint[]; pathIndices: number[] } {
    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];
    let layer = [...this.leaves];
    let i = index;
    for (let l = 0; l < this.depth; l++) {
      const isRight = i % 2;
      const sib = isRight ? layer[i - 1] : i + 1 < layer.length ? layer[i + 1] : this.zeros[l];
      pathElements.push(sib);
      pathIndices.push(isRight);
      const next: bigint[] = [];
      for (let k = 0; k < layer.length; k += 2) {
        const L = layer[k];
        const R = k + 1 < layer.length ? layer[k + 1] : this.zeros[l];
        next.push(this.h2(L, R));
      }
      layer = next;
      i = Math.floor(i / 2);
    }
    return { pathElements, pathIndices };
  }
}

export interface VoteProof {
  nullifier: number[];
  proofA: number[];
  proofB: number[];
  proofC: number[];
}

/** Generate a member-vote proof for `cast_vote`. */
export async function proveVote(
  tree: MemberTree,
  secret: bigint,
  leafIndex: number,
  proposalId: bigint,
  choice: boolean,
  wasmPath = "build/member_vote_js/member_vote.wasm",
  zkeyPath = "build/member_vote_final.zkey"
): Promise<VoteProof> {
  const { pathElements, pathIndices } = tree.proof(leafIndex);
  const input = {
    root: tree.root.toString(),
    proposalId: proposalId.toString(),
    choice: choice ? "1" : "0",
    secret: secret.toString(),
    pathElements: pathElements.map(String),
    pathIndices: pathIndices.map(String),
  };

  const { proof, publicSignals } = await groth16.fullProve(input, wasmPath, zkeyPath);

  // publicSignals order (outputs first): [nullifier, root, proposalId, choice]
  const nullifier = to32BE(publicSignals[0]);

  const ax = BigInt(proof.pi_a[0]);
  const ay = (Q - (BigInt(proof.pi_a[1]) % Q)) % Q; // negate G1
  const proofA = [...to32BE(ax), ...to32BE(ay)];
  const proofB = [
    ...to32BE(proof.pi_b[0][1]),
    ...to32BE(proof.pi_b[0][0]),
    ...to32BE(proof.pi_b[1][1]),
    ...to32BE(proof.pi_b[1][0]),
  ];
  const proofC = [...to32BE(proof.pi_c[0]), ...to32BE(proof.pi_c[1])];

  return { nullifier, proofA, proofB, proofC };
}
