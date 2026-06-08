// Acknowledgment credentials: build the commitment root R, and produce
// selective-disclosure proofs the holder shows to verifiers.
//
//   cF = Poseidon(fieldF, saltF)   for F in {P portrait, C course, X teacher, D date}
//   R  = Poseidon(cP, cC, cX, cD)
//
// R is what `issue_acknowledgment` stores on-chain. The holder later proves, for
// any chosen subset, the opening that hashes to R — revealing only what they
// pick — using circuits/ack_disclose.circom. See docs/acknowledgments.md.

import { buildPoseidon } from "circomlibjs";
import { groth16 } from "snarkjs";

const BN254_P =
  21888242871839275222246405745257275088696311157297823662689037894645226208583n;

export interface AckFields {
  ppp: bigint; // portrait/identity (e.g. hash of the image, as a field element)
  ccc: bigint; // course id
  xxx: bigint; // teacher's lineage identity commitment
  ddd: bigint; // date (unix seconds, < 2^32)
}

export interface AckOpening extends AckFields {
  saltP: bigint;
  saltC: bigint;
  saltX: bigint;
  saltD: bigint;
}

export interface BuiltAck {
  root: bigint; // R — store this on-chain
  opening: AckOpening; // keep secret; needed to disclose later
}

/** Map arbitrary bytes (an image hash, a course code, a date) into a field element. */
export function toField(x: bigint | number | string): bigint {
  const v = typeof x === "bigint" ? x : BigInt(x);
  return ((v % BN254_P) + BN254_P) % BN254_P;
}

let _poseidon: any;
async function poseidon() {
  if (!_poseidon) _poseidon = await buildPoseidon();
  return _poseidon;
}
async function H(inputs: bigint[]): Promise<bigint> {
  const p = await poseidon();
  return p.F.toObject(p(inputs));
}

/** Build the credential: per-field commitments and the root R. Salts must be kept. */
export async function buildAck(fields: AckFields, salts: [bigint, bigint, bigint, bigint]): Promise<BuiltAck> {
  const [saltP, saltC, saltX, saltD] = salts;
  const cP = await H([fields.ppp, saltP]);
  const cC = await H([fields.ccc, saltC]);
  const cX = await H([fields.xxx, saltX]);
  const cD = await H([fields.ddd, saltD]);
  const root = await H([cP, cC, cX, cD]);
  return { root, opening: { ...fields, saltP, saltC, saltX, saltD } };
}

/** 32-byte big-endian encoding (matches the on-chain `[u8; 32]` / Groth16 public inputs). */
export function to32BE(x: bigint): number[] {
  let v = ((x % BN254_P) + BN254_P) % BN254_P;
  const out = new Array<number>(32).fill(0);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

export interface Reveals {
  P: boolean;
  C: boolean;
  X: boolean;
  D: boolean;
}

/**
 * Produce a disclosure proof. `reveals` picks which fields are exposed;
 * `dateLowerBound` (0 disables) proves DDD >= bound WITHOUT revealing DDD.
 * Returns the snarkjs proof + publicSignals (order: dateOk, root, reveal flags,
 * values, dateLowerBound) for a verifier to check with `groth16.verify`.
 */
export async function proveDisclosure(
  ack: BuiltAck,
  reveals: Reveals,
  dateLowerBound: bigint = 0n,
  wasmPath = "build/ack_disclose_js/ack_disclose.wasm",
  zkeyPath = "build/ack_disclose_final.zkey"
) {
  const o = ack.opening;
  const flag = (b: boolean) => (b ? "1" : "0");
  const val = (b: boolean, v: bigint) => (b ? v.toString() : "0");

  const input = {
    root: ack.root.toString(),
    revealP: flag(reveals.P),
    revealC: flag(reveals.C),
    revealX: flag(reveals.X),
    revealD: flag(reveals.D),
    valueP: val(reveals.P, o.ppp),
    valueC: val(reveals.C, o.ccc),
    valueX: val(reveals.X, o.xxx),
    valueD: val(reveals.D, o.ddd),
    dateLowerBound: dateLowerBound.toString(),
    ppp: o.ppp.toString(),
    ccc: o.ccc.toString(),
    xxx: o.xxx.toString(),
    ddd: o.ddd.toString(),
    saltP: o.saltP.toString(),
    saltC: o.saltC.toString(),
    saltX: o.saltX.toString(),
    saltD: o.saltD.toString(),
  };

  const { proof, publicSignals } = await groth16.fullProve(input, wasmPath, zkeyPath);
  return { proof, publicSignals }; // publicSignals[0] = dateOk
}

/** A verifier checks the disclosure proof (off-chain) against the ack disclosure vkey. */
export async function verifyDisclosure(vkey: object, publicSignals: string[], proof: object): Promise<boolean> {
  return groth16.verify(vkey as any, publicSignals, proof as any);
}
