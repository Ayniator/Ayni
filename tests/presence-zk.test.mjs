// F59 — presence attestation, proved for real, offline (no validator).
// Run: node tests/presence-zk.test.mjs   (plain node, no framework)
//
// WHY THIS FILE EXISTS SEPARATELY FROM zk-e2e.test.mjs
// ---------------------------------------------------
// zk-e2e proves the member_vote CIRCUIT is sound. F59 does not add a circuit —
// it adds a PROTOCOL on top of the one already shipped, and every property it
// claims lives in how the two proofs are bound together, not in the circuit:
//
//   * two DIFFERENT people acted, enforced by comparing nullifiers taken under
//     the same external nullifier;
//   * the subject consented, enforced by proving against a root computed on
//     chain from their own commitment;
//   * a proof for one month, one Circle, or one INSTRUCTION cannot be replayed
//     as another.
//
// None of that is visible to a circuit test. All of it is testable here, with
// real Groth16 proofs, and it is worth testing because each property fails
// SILENTLY: a wrongly-bound protocol still produces proofs that verify.
//
// The claim under test that matters most is the shared-E one, because it reads
// like an implementation detail and is in fact the whole distinct-persons rule.
// Test 6 below demonstrates the attack it prevents rather than asserting the
// rule holds — one member, two proofs, two different external nullifiers, two
// different-looking nullifiers, and a check that would have waved it through.
//
// Deps and the node-18 webcrypto polyfill follow tests/zk-e2e.test.mjs.

import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const frontendRequire = createRequire(path.join(repoRoot, "frontend", "package.json"));
const rootRequire = createRequire(path.join(repoRoot, "package.json"));
const requireDep = (id) => {
  try { return frontendRequire(id); } catch { return rootRequire(id); }
};

const snarkjs = requireDep("snarkjs");
const { buildPoseidon } = requireDep("circomlibjs");

const FR = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// --- tiny harness (same shape as zk-e2e.test.mjs) --------------------------
let failed = 0, passed = 0, skipped = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("PASS  " + name); }
  catch (e) { failed++; console.log("FAIL  " + name + " — " + (e && e.message ? e.message : e)); }
}
function skip(name, why) { skipped++; console.log("SKIP  " + name + " — " + why); }
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

// --- Poseidon + Merkle (mirrors merkle.rs and zk-vote.ts) ------------------
const p = await buildPoseidon();
const F = p.F;
const h1 = (a) => F.toObject(p([a]));
const h2 = (a, b) => F.toObject(p([a, b]));

const DEPTH = 20; // merkle.rs CIRCUIT_DEPTH

class PoseidonTree {
  constructor(depth) {
    this.depth = depth;
    this.zeros = [0n];
    for (let i = 0; i < depth; i++) this.zeros.push(h2(this.zeros[i], this.zeros[i]));
    this.leaves = [];
    this.root = this.zeros[depth];
  }
  insert(leaf) { this.leaves.push(leaf); this.root = this.#fold(); return this.leaves.length - 1; }
  #fold() {
    let layer = [...this.leaves];
    for (let l = 0; l < this.depth; l++) {
      const next = [];
      for (let k = 0; k < Math.max(1, layer.length); k += 2) {
        const L = k < layer.length ? layer[k] : this.zeros[l];
        const R = k + 1 < layer.length ? layer[k + 1] : this.zeros[l];
        next.push(h2(L, R));
      }
      layer = next;
    }
    return layer[0];
  }
  proof(index) {
    const pathElements = [], pathIndices = [];
    let layer = [...this.leaves];
    let i = index;
    for (let l = 0; l < this.depth; l++) {
      const isRight = i % 2;
      const sib = isRight ? layer[i - 1] : (i + 1 < layer.length ? layer[i + 1] : this.zeros[l]);
      pathElements.push(sib);
      pathIndices.push(isRight);
      const next = [];
      for (let k = 0; k < Math.max(1, layer.length); k += 2) {
        const L = k < layer.length ? layer[k] : this.zeros[l];
        const R = k + 1 < layer.length ? layer[k + 1] : this.zeros[l];
        next.push(h2(L, R));
      }
      layer = next;
      i = Math.floor(i / 2);
    }
    return { pathElements, pathIndices };
  }
}

// --- the external nullifiers, as the PROGRAM computes them -----------------
//
// The tags are read out of the Rust source rather than retyped here. A test
// that hardcodes its own copy of a domain tag cannot catch the one bug that
// matters — the program and the browser prover drifting apart — because both
// sides of its own comparison would move together. Read once, at startup, so a
// rename shows up as a hard failure here.
const ATTEST_SRC = path.join(repoRoot, "programs", "ayni", "src", "instructions", "attest_presence_zk.rs");
const CLEAR_SRC = path.join(repoRoot, "programs", "ayni", "src", "instructions", "clear_presence.rs");

function tagFrom(file, hint) {
  const src = readFileSync(file, "utf8");
  // The tag is the b"..." literal inside the hashv() call.
  const m = src.match(/hashv\(&\[\s*b"([^"]+)"/);
  if (!m) throw new Error(`no hashv tag literal found in ${path.basename(file)}`);
  if (!m[1].includes(hint)) throw new Error(`tag "${m[1]}" in ${path.basename(file)} does not look like a ${hint} tag`);
  return Buffer.from(m[1], "utf8");
}

const TAG_ATTEST = tagFrom(ATTEST_SRC, "presence");
const TAG_CLEAR = tagFrom(CLEAR_SRC, "presence");

/** SHA-256(tag ‖ circle ‖ commitment ‖ month_le32), top three bits cleared. */
function externalNullifier(tag, circle32, commitment32, month) {
  const le = Buffer.alloc(4);
  le.writeUInt32LE(month >>> 0, 0);
  const d = createHash("sha256")
    .update(Buffer.concat([tag, circle32, commitment32, le]))
    .digest();
  d[0] &= 0x1f; // p > 2^253, so this is always in-field and needs no reduction
  return BigInt("0x" + d.toString("hex"));
}

/** A field element as the program sees it: 32-byte big-endian. */
function be32(x) {
  let v = BigInt(x);
  const out = Buffer.alloc(32);
  for (let i = 31; i >= 0; i--) { out[i] = Number(v & 0xffn); v >>= 8n; }
  return out;
}

const WASM = path.join(repoRoot, "build", "member_vote_js", "member_vote.wasm");
const ZKEY = path.join(repoRoot, "build", "member_vote_final.zkey");

async function verifies(vk, publicSignals, proof) {
  try { return await snarkjs.groth16.verify(vk, publicSignals, proof); } catch { return false; }
}

console.log("=== F59 — presence attestation protocol tests (offline, no validator) ===");
console.log("(note: 'ERROR: ... in template ...' lines are the wasm witness calculator");
console.log(" rejecting deliberately-invalid inputs in the negative tests — expected)\n");

if (!existsSync(WASM) || !existsSync(ZKEY)) {
  skip("F59 presence protocol", `member_vote artifacts missing (${WASM})`);
} else {
  const vk = await snarkjs.zKey.exportVerificationKey(ZKEY);

  // A Circle with three members. The subject and the witness are two of them;
  // the third exists so the tree is not degenerate and the witness's anonymity
  // set is larger than one.
  const circle = Buffer.alloc(32, 7);
  const subjectSecret = 11111111111111111111111111111n % FR;
  const witnessSecret = 22222222222222222222222222222n % FR;
  const thirdSecret = 33333333333333333333333333333n % FR;
  const strangerSecret = 44444444444444444444444444444n % FR; // never in the tree

  const subjectCommitment = h1(subjectSecret);
  const tree = new PoseidonTree(DEPTH);
  const idxSubject = tree.insert(subjectCommitment);
  const idxWitness = tree.insert(h1(witnessSecret));
  tree.insert(h1(thirdSecret));

  // The subject-consent root: a depth-20 tree whose only leaf is the subject's
  // commitment. This mirrors merkle.rs single_leaf_root(), which the PROGRAM
  // computes — the caller never supplies it.
  const consent = new PoseidonTree(DEPTH);
  consent.insert(subjectCommitment);

  const MONTH = 674; // 2026-03, a closed month
  const NEXT_MONTH = 675;
  const commitBytes = be32(subjectCommitment);
  const E = externalNullifier(TAG_ATTEST, circle, commitBytes, MONTH);
  const E_next = externalNullifier(TAG_ATTEST, circle, commitBytes, NEXT_MONTH);
  const E_clear = externalNullifier(TAG_CLEAR, circle, commitBytes, MONTH);

  const CHOICE = "1"; // merkle::field_from_u8(1) — "I attest"

  const mkInput = (secret, t, idx, external) => {
    const { pathElements, pathIndices } = t.proof(idx);
    return {
      root: t.root.toString(),
      proposalId: external.toString(),
      choice: CHOICE,
      secret: secret.toString(),
      pathElements: pathElements.map(String),
      pathIndices: pathIndices.map(String),
    };
  };

  const prove = (input) => snarkjs.groth16.fullProve(input, WASM, ZKEY);

  // --- the happy path ------------------------------------------------------

  let subjectProof = null, subjectSignals = null;
  await test("subject consent: proves against the on-chain single-leaf root", async () => {
    const { proof, publicSignals } = await prove(mkInput(subjectSecret, consent, 0, E));
    subjectProof = proof; subjectSignals = publicSignals;
    assert(BigInt(publicSignals[1]) === consent.root, "public root is not single_leaf_root(commitment)");
    assert(BigInt(publicSignals[2]) === E, "public proposalId is not the presence external nullifier");
    assert(BigInt(publicSignals[0]) === h2(subjectSecret, E), "nullifier != Poseidon(secret, E)");
    assert(await verifies(vk, publicSignals, proof), "the subject's consent proof did not verify");
  });

  let witnessProof = null, witnessSignals = null;
  await test("witness: proves membership of the Circle under the SAME external nullifier", async () => {
    const { proof, publicSignals } = await prove(mkInput(witnessSecret, tree, idxWitness, E));
    witnessProof = proof; witnessSignals = publicSignals;
    assert(BigInt(publicSignals[1]) === tree.root, "public root is not the member tree root");
    assert(BigInt(publicSignals[2]) === E, "the witness proved under a different external nullifier");
    assert(await verifies(vk, publicSignals, proof), "the witness's proof did not verify");
  });

  await test("distinct persons: two different members yield two different nullifiers", async () => {
    assert(
      subjectSignals[0] !== witnessSignals[0],
      "two different members produced the same nullifier — the on-chain check would reject a VALID attestation",
    );
  });

  // --- the rule the program enforces, shown working ------------------------

  await test("self-attestation collapses: one member in both roles produces ONE nullifier", async () => {
    // The subject plays witness too — they are in the member tree, so they can
    // honestly produce both proofs. Under the shared E, Poseidon(secret, E) is
    // the same value both times, so require!(subject != witness) rejects it.
    // This is the whole distinct-persons rule, and it is enforced by
    // arithmetic rather than by anyone being watched.
    const { publicSignals } = await prove(mkInput(subjectSecret, tree, idxSubject, E));
    assert(
      publicSignals[0] === subjectSignals[0],
      "the same secret produced two different nullifiers under one E — self-attestation would pass",
    );
  });

  await test("the shared E is load-bearing: different Es would let ONE member fake two", async () => {
    // The attack the shared external nullifier prevents. Same person, same
    // Circle, two proofs — but taken under different Es, their nullifiers
    // differ, so a naive "the two nullifiers must differ" check passes while
    // only one person ever acted. This is why the program computes E once and
    // uses it for both verifications, and why comparing nullifiers taken under
    // different proposalIds would prove nothing at all.
    const { publicSignals: other } = await prove(mkInput(subjectSecret, tree, idxSubject, E_next));
    assert(
      other[0] !== subjectSignals[0],
      "same secret gave the same nullifier under a different E — this test no longer demonstrates anything",
    );
    // Stated as the conclusion, so a reader cannot mistake the assertion above
    // for a property we want: the check is only meaningful under a shared E.
  });

  // --- replay resistance ---------------------------------------------------

  await test("a proof for March does not verify as a proof for April", async () => {
    const t = [...subjectSignals];
    t[2] = E_next.toString();
    assert(!(await verifies(vk, t, subjectProof)), "a month's proof replayed into another month — CRITICAL");
  });

  await test("an attestation proof does not verify as an ERASURE proof", async () => {
    // Same circle, same commitment, same month: only the domain tag differs.
    // If this ever passes, a witness — who holds a proof under the attestation
    // E by design — could delete the record they were only entitled to co-sign.
    const t = [...subjectSignals];
    t[2] = E_clear.toString();
    assert(!(await verifies(vk, t, subjectProof)), "attest and clear proofs are interchangeable — CRITICAL");
    assert(E_clear !== E, "the two domain tags produced the same external nullifier — CRITICAL");
  });

  await test("a proof for one Circle does not verify for another", async () => {
    const otherCircle = Buffer.alloc(32, 8);
    const E_other = externalNullifier(TAG_ATTEST, otherCircle, commitBytes, MONTH);
    const t = [...subjectSignals];
    t[2] = E_other.toString();
    assert(!(await verifies(vk, t, subjectProof)), "a proof crossed Circles — CRITICAL");
  });

  // --- consent cannot be forged -------------------------------------------

  await test("nobody can be written about involuntarily: a fellow member cannot forge consent", async () => {
    // The witness is a genuine member of the Circle and knows the subject's
    // commitment (the QR handoff discloses it). They still cannot produce the
    // consent proof, because the only witness satisfying single_leaf_root(c) is
    // a secret s with Poseidon(s) == c.
    const bad = mkInput(subjectSecret, consent, 0, E);
    bad.secret = witnessSecret.toString();
    let threw = false;
    try { await prove(bad); } catch { threw = true; }
    assert(threw, "a fellow member generated the subject's consent proof — CRITICAL");
  });

  await test("a stranger cannot witness: a non-member cannot prove against the tree", async () => {
    const bad = mkInput(witnessSecret, tree, idxWitness, E);
    bad.secret = strangerSecret.toString();
    let threw = false;
    try { await prove(bad); } catch { threw = true; }
    assert(threw, "a non-member produced a witness proof — CRITICAL");
  });

  await test("this file's external nullifier agrees with the program's, byte for byte", async () => {
    // Reading the tag out of the Rust source catches a rename. It does NOT
    // catch a change to the field ORDER, the endianness of the month, or the
    // mask — all of which are reimplemented here and would drift silently,
    // leaving a browser prover that produces proofs the program rejects.
    //
    // So both implementations are pinned to the same literals: these are the
    // frozen vectors asserted in clear_presence.rs's `the_preimages_are_frozen`
    // (circle = [7; 32], commitment = [9; 32], month = 674). If either side
    // moves, one of the two tests fails.
    const c32 = Buffer.alloc(32, 7);
    const m32 = Buffer.alloc(32, 9);
    const hex = (x) => be32(x).toString("hex");
    assert(
      hex(externalNullifier(TAG_ATTEST, c32, m32, 674)) ===
        "0f00da98fa1aa249ffb34bc7887c2cd7e3642943e7cb3cc8cc3acf6238edd6f4",
      "the attest external nullifier drifted from the program's frozen vector",
    );
    assert(
      hex(externalNullifier(TAG_CLEAR, c32, m32, 674)) ===
        "1c0ec11835ea7861f11c80408e97a034885aa9f5aafa63027b6f1478e6e19270",
      "the clear external nullifier drifted from the program's frozen vector",
    );
  });

  await test("the consent root is not the member tree root", async () => {
    // merkle.rs states the invariant: single_leaf_root(...) must NEVER enter
    // RecentRoots, because the admission gate accepts anything in that ring. If
    // these two values could coincide, the invariant would be unenforceable.
    assert(consent.root !== tree.root, "single-leaf root collided with the member tree root");
    const empty = new PoseidonTree(DEPTH);
    assert(consent.root !== empty.root, "single-leaf root collided with the empty-tree root");
  });
}

console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
process.exit(failed === 0 ? 0 : 1);
