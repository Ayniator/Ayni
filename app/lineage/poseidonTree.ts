// Off-chain mirror of the on-chain incremental Poseidon Merkle tree
// (programs/ayni/src/merkle.rs). Used to build authentication paths for the
// granter's credential. MUST use the same hash params (BN254 Poseidon) and the
// same zeros[0] = 0 convention. See docs/zk-lineage.md.

import { buildPoseidon } from "circomlibjs";

export type Hex = bigint;

export class PoseidonTree {
  readonly depth: number;
  private poseidon: any;
  private F: any;
  private zeros: bigint[] = [];
  private filledSubtrees: bigint[] = [];
  private leaves: bigint[] = [];
  root: bigint = 0n;
  nextIndex = 0;

  private constructor(depth: number, poseidon: any) {
    this.depth = depth;
    this.poseidon = poseidon;
    this.F = poseidon.F;
  }

  static async create(depth: number): Promise<PoseidonTree> {
    const t = new PoseidonTree(depth, await buildPoseidon());
    let z = 0n;
    t.zeros.push(z);
    for (let i = 0; i < depth; i++) {
      z = t.hash(z, z);
      t.zeros.push(z);
      t.filledSubtrees.push(t.zeros[i]);
    }
    t.root = t.zeros[depth];
    return t;
  }

  hash(a: bigint, b: bigint): bigint {
    return this.F.toObject(this.poseidon([a, b]));
  }

  hash1(a: bigint): bigint {
    return this.F.toObject(this.poseidon([a]));
  }

  /** Credential leaf = Poseidon(identityCommitment, level). */
  leaf(identityCommitment: bigint, level: number | bigint): bigint {
    return this.hash(identityCommitment, BigInt(level));
  }

  /** Append a leaf (mirrors merkle::insert) and return its index. */
  insert(leaf: bigint): number {
    const index = this.nextIndex;
    let i = index;
    let cur = leaf;
    for (let l = 0; l < this.depth; l++) {
      let left: bigint, right: bigint;
      if (i % 2 === 0) {
        left = cur;
        right = this.zeros[l];
        this.filledSubtrees[l] = cur;
      } else {
        left = this.filledSubtrees[l];
        right = cur;
      }
      cur = this.hash(left, right);
      i = Math.floor(i / 2);
    }
    this.leaves.push(leaf);
    this.root = cur;
    this.nextIndex += 1;
    return index;
  }

  /** Authentication path for the leaf at `index`: { pathElements, pathIndices }. */
  proof(index: number): { pathElements: bigint[]; pathIndices: number[] } {
    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];
    // Rebuild layer-by-layer from the stored leaves (simple, O(n·depth)).
    let layer = [...this.leaves];
    let i = index;
    for (let l = 0; l < this.depth; l++) {
      const isRight = i % 2;
      const siblingIdx = isRight ? i - 1 : i + 1;
      const sibling = siblingIdx < layer.length ? layer[siblingIdx] : this.zeros[l];
      pathElements.push(sibling);
      pathIndices.push(isRight);
      // build next layer
      const next: bigint[] = [];
      for (let k = 0; k < layer.length; k += 2) {
        const left = layer[k];
        const right = k + 1 < layer.length ? layer[k + 1] : this.zeros[l];
        next.push(this.hash(left, right));
      }
      layer = next;
      i = Math.floor(i / 2);
    }
    return { pathElements, pathIndices };
  }
}
