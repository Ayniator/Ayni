// Build a `grant_level` Groth16 proof from a granter's secret + the lineage tree.
//
// Outputs the exact instruction args: granted_level, grantee_commitment,
// nullifier, proof_a (64B), proof_b (128B), proof_c (64B).
//
// CAVEAT: the byte encodings below (G1 negation of proof_a, the Fp2 c1||c0
// ordering for G2) follow the common snarkjs→groth16-solana convention. Verify
// them against the installed `groth16-solana` version — encoding bugs here are
// the usual reason a valid proof fails on-chain. See docs/zk-lineage.md.

import { groth16 } from "snarkjs";
import { PoseidonTree } from "./poseidonTree";

// BN254 base field modulus q (for G1/G2 negation).
const Q =
  21888242871839275222246405745257275088696311157297823662689037894645226208583n;

function to32BE(x: bigint | string): number[] {
  let v = BigInt(x);
  const out = new Array<number>(32).fill(0);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

export interface GrantArgs {
  grantedLevel: number;
  granteeCommitment: number[]; // 32B BE
  nullifier: number[]; // 32B BE
  proofA: number[]; // 64B
  proofB: number[]; // 128B
  proofC: number[]; // 64B
}

export interface GranterWitness {
  issuerSecret: bigint;
  issuerLevel: number;
  issuerLeafIndex: number; // position of the granter's credential in the tree
}

export async function proveGrant(
  tree: PoseidonTree,
  granter: GranterWitness,
  grantedLevel: number,
  granteeCommitment: bigint,
  wasmPath = "build/lineage_grant_js/lineage_grant.wasm",
  zkeyPath = "build/lineage_final.zkey"
): Promise<GrantArgs> {
  const { pathElements, pathIndices } = tree.proof(granter.issuerLeafIndex);

  const input = {
    root: tree.root.toString(),
    grantedLevel: grantedLevel.toString(),
    granteeCommitment: granteeCommitment.toString(),
    issuerSecret: granter.issuerSecret.toString(),
    issuerLevel: granter.issuerLevel.toString(),
    pathElements: pathElements.map((x) => x.toString()),
    pathIndices: pathIndices.map((x) => x.toString()),
  };

  const { proof, publicSignals } = await groth16.fullProve(input, wasmPath, zkeyPath);

  // publicSignals order (snarkjs: outputs first): [nullifier, root, grantedLevel, granteeCommitment]
  const nullifier = to32BE(publicSignals[0]);

  // proof_a = negate_g1(pi_a): (x, q - y)
  const ax = BigInt(proof.pi_a[0]);
  const ay = (Q - (BigInt(proof.pi_a[1]) % Q)) % Q;
  const proofA = [...to32BE(ax), ...to32BE(ay)];

  // proof_b: G2 with Fp2 components swapped to c1||c0 per coordinate.
  const proofB = [
    ...to32BE(proof.pi_b[0][1]),
    ...to32BE(proof.pi_b[0][0]),
    ...to32BE(proof.pi_b[1][1]),
    ...to32BE(proof.pi_b[1][0]),
  ];

  // proof_c = pi_c (no negation)
  const proofC = [...to32BE(proof.pi_c[0]), ...to32BE(proof.pi_c[1])];

  return {
    grantedLevel,
    granteeCommitment: to32BE(granteeCommitment),
    nullifier,
    proofA,
    proofB,
    proofC,
  };
}
