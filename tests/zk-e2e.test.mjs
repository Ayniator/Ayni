// F43 — end-to-end ZK proof tests for all three circuits, offline (no validator).
// Run: node tests/zk-e2e.test.mjs   (plain node, no framework, exits non-zero on failure)
//
// For each circuit (member_vote, lineage_grant, ack_disclose):
//   1. builds a VALID witness input (Poseidon Merkle trees mirroring
//      frontend/lib/zk-vote.ts's MemberTree / the on-chain merkle.rs),
//   2. generates a Groth16 proof with snarkjs (build/<c>_js/<c>.wasm +
//      build/<c>_final.zkey) and verifies it against the verification key
//      exported IN-PROCESS from the zkey (snarkjs.zKey.exportVerificationKey),
//   3. proves the NEGATIVE cases: a tampered public signal fails, identity A's
//      proof does not verify against identity B's public inputs, a wrong
//      Merkle root fails (both at verify time and at witness-generation time),
//   4. VK-consistency: parses programs/ayni/src/verifying_key*.rs (read-only)
//      and asserts the embedded curve points byte-equal the zkey-exported VK
//      (same encoding as scripts/vk_to_rust.js), and that IC length ==
//      nPublic + 1 per circuit.
//
// Complements tests/sentinel/zk-integrity.sh, which diffs committed vkey JSONs
// and regenerated Rust via shell; this file's added value is the actual
// prove/verify roundtrip plus a direct zkey→Rust byte comparison in-process.
//
// Deps resolve from frontend/node_modules first, root as fallback (same
// pattern as tests/recovery-keys.test.mjs); node 18 needs the webcrypto
// polyfill below.

import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const frontendRequire = createRequire(path.join(repoRoot, "frontend", "package.json"));
const rootRequire = createRequire(path.join(repoRoot, "package.json"));
const requireDep = (id) => {
  try { return frontendRequire(id); } catch { return rootRequire(id); }
};

// Node 18 has no WebCrypto global (unflagged only from node 19).
if (!globalThis.crypto?.subtle) {
  globalThis.crypto = (await import("node:crypto")).webcrypto;
}

const snarkjs = requireDep("snarkjs");
const { buildPoseidon } = requireDep("circomlibjs");

// BN254 scalar field r (the circuit field).
const FR = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// --- tiny harness ----------------------------------------------------------
let failed = 0, passed = 0, skipped = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log("PASS  " + name);
  } catch (e) {
    failed++;
    console.log("FAIL  " + name + " — " + (e && e.message ? e.message : e));
  }
}
function skip(name, why) {
  skipped++;
  console.log("SKIP  " + name + " — " + why);
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

// --- Poseidon + Merkle tree (mirrors frontend/lib/zk-vote.ts MemberTree) ----
const p = await buildPoseidon();
const F = p.F;
const h1 = (a) => F.toObject(p([a]));
const h2 = (a, b) => F.toObject(p([a, b]));
const h4 = (a, b, c, d) => F.toObject(p([a, b, c, d]));

class PoseidonTree {
  constructor(depth) {
    this.depth = depth;
    this.zeros = [0n];
    for (let i = 0; i < depth; i++) this.zeros.push(h2(this.zeros[i], this.zeros[i]));
    this.leaves = [];
    this.root = this.zeros[depth];
  }
  insert(leaf) {
    this.leaves.push(leaf);
    this.root = this.#fold();
    return this.leaves.length - 1;
  }
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

// --- artifact paths --------------------------------------------------------
const BUILD = path.join(repoRoot, "build");
const CIRCUITS = {
  member_vote: {
    wasm: path.join(BUILD, "member_vote_js", "member_vote.wasm"),
    zkey: path.join(BUILD, "member_vote_final.zkey"),
    rust: path.join(repoRoot, "programs", "ayni", "src", "verifying_key_vote.rs"),
    nPublic: 4, // nullifier (out), root, proposalId, choice
  },
  lineage_grant: {
    wasm: path.join(BUILD, "lineage_grant_js", "lineage_grant.wasm"),
    zkey: path.join(BUILD, "lineage_grant_final.zkey"),
    rust: path.join(repoRoot, "programs", "ayni", "src", "verifying_key.rs"),
    nPublic: 4, // nullifier (out), root, grantedLevel, granteeCommitment
  },
  ack_disclose: {
    wasm: path.join(BUILD, "ack_disclose_js", "ack_disclose.wasm"),
    zkey: path.join(BUILD, "ack_disclose_final.zkey"),
    rust: path.join(repoRoot, "programs", "ayni", "src", "verifying_key_ack.rs"),
    nPublic: 17, // 3 outputs (dateOk, courseAccredited, teacherRecognized) + 14 public inputs
  },
};

const haveCircom = (() => {
  try { execSync("command -v circom", { stdio: "ignore" }); return true; } catch { return false; }
})();

// --- VK helpers ------------------------------------------------------------
// Byte encoding identical to scripts/vk_to_rust.js / groth16-solana:
// G1 = x||y as 32-byte big-endian; G2 = (x.c1, x.c0, y.c1, y.c0) each 32-byte BE.
function be32(x) {
  let v = BigInt(x);
  const out = new Array(32);
  for (let i = 31; i >= 0; i--) { out[i] = Number(v & 0xffn); v >>= 8n; }
  return out;
}
const g1Bytes = (pt) => [...be32(pt[0]), ...be32(pt[1])];
const g2Bytes = (pt) => [...be32(pt[0][1]), ...be32(pt[0][0]), ...be32(pt[1][1]), ...be32(pt[1][0])];

// Parse the Rust Groth16Verifyingkey literal (read-only).
function parseRustVk(file) {
  const src = readFileSync(file, "utf8");
  const nums = (s) => s.split(",").map((t) => t.trim()).filter(Boolean).map((t) => {
    const m = t.match(/^(\d+)u8$/);
    if (!m) throw new Error(`unparseable byte literal "${t}" in ${file}`);
    return Number(m[1]);
  });
  const field = (name) => {
    const m = src.match(new RegExp(name + String.raw`:\s*\[([^\]]*)\]`));
    if (!m) throw new Error(`field ${name} not found in ${file}`);
    return nums(m[1]);
  };
  const np = src.match(/nr_pubinputs:\s*(\d+)/);
  if (!np) throw new Error(`nr_pubinputs not found in ${file}`);
  const icBlock = src.match(/vk_ic:\s*&\[([\s\S]*?)\]\s*,?\s*\};/);
  if (!icBlock) throw new Error(`vk_ic not found in ${file}`);
  const ic = [...icBlock[1].matchAll(/\[([^\]]*)\]/g)].map((m) => nums(m[1]));
  return {
    nrPubinputs: Number(np[1]),
    alpha: field("vk_alpha_g1"),
    beta: field("vk_beta_g2"),
    gamma: field("vk_gamme_g2"), // sic — groth16-solana's field name
    delta: field("vk_delta_g2"),
    ic,
  };
}

const bytesEq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// Export the verification key from a zkey, in-process.
async function exportVk(zkeyPath) {
  return snarkjs.zKey.exportVerificationKey(zkeyPath);
}

async function vkConsistency(name) {
  const c = CIRCUITS[name];
  const vk = await exportVk(c.zkey);

  await test(`${name}: zkey VK has nPublic=${c.nPublic} and IC length nPublic+1`, async () => {
    assert(vk.nPublic === c.nPublic, `zkey nPublic ${vk.nPublic} != expected ${c.nPublic} (circuit source)`);
    assert(vk.IC.length === c.nPublic + 1, `IC length ${vk.IC.length} != nPublic+1 (${c.nPublic + 1})`);
    assert(vk.protocol === "groth16" && String(vk.curve).toLowerCase().includes("bn"), "not a Groth16/BN254 vkey");
  });

  await test(`${name}: on-chain Rust VK (${path.basename(c.rust)}) byte-equals the zkey-exported VK`, async () => {
    const rs = parseRustVk(c.rust);
    assert(rs.nrPubinputs === vk.nPublic, `Rust nr_pubinputs ${rs.nrPubinputs} != zkey nPublic ${vk.nPublic}`);
    assert(rs.ic.length === vk.IC.length, `Rust IC count ${rs.ic.length} != zkey IC count ${vk.IC.length}`);
    assert(bytesEq(rs.alpha, g1Bytes(vk.vk_alpha_1)), "vk_alpha_g1 differs from zkey — VERIFIER DRIFT");
    assert(bytesEq(rs.beta, g2Bytes(vk.vk_beta_2)), "vk_beta_g2 differs from zkey — VERIFIER DRIFT");
    assert(bytesEq(rs.gamma, g2Bytes(vk.vk_gamma_2)), "vk_gamme_g2 differs from zkey — VERIFIER DRIFT");
    assert(bytesEq(rs.delta, g2Bytes(vk.vk_delta_2)), "vk_delta_g2 differs from zkey — VERIFIER DRIFT");
    for (let i = 0; i < vk.IC.length; i++) {
      assert(bytesEq(rs.ic[i], g1Bytes(vk.IC[i])), `vk_ic[${i}] differs from zkey — VERIFIER DRIFT`);
    }
  });

  return vk;
}

// verify() that tolerates snarkjs throwing on malformed inputs: any throw is a rejection.
async function verifies(vk, publicSignals, proof) {
  try { return await snarkjs.groth16.verify(vk, publicSignals, proof); } catch { return false; }
}

console.log("=== F43 — ZK end-to-end proof tests (offline, no validator) ===");
console.log("(note: 'ERROR: ... in template ...' lines are the wasm witness calculator");
console.log(" rejecting deliberately-invalid inputs in the negative tests — expected)\n");

// ===========================================================================
// 1. member_vote — Semaphore-style anonymous ballot
//    publicSignals = [nullifier, root, proposalId, choice]
// ===========================================================================
{
  const name = "member_vote";
  const c = CIRCUITS[name];
  const vk = await vkConsistency(name);

  await test(`${name}: browser artifacts (frontend/public/zk) byte-identical to build/`, async () => {
    const feWasm = path.join(repoRoot, "frontend", "public", "zk", "member_vote.wasm");
    const feZkey = path.join(repoRoot, "frontend", "public", "zk", "member_vote_final.zkey");
    assert(existsSync(feWasm) && existsSync(feZkey), "frontend/public/zk artifacts missing");
    assert(readFileSync(feWasm).equals(readFileSync(c.wasm)), "member_vote.wasm drifted from build/ — browser prover != tested prover");
    assert(readFileSync(feZkey).equals(readFileSync(c.zkey)), "member_vote_final.zkey drifted from build/ — browser prover != tested prover");
  });

  if (!existsSync(c.wasm)) {
    skip(`${name}: prove/verify roundtrip`, `wasm missing at ${c.wasm}${haveCircom ? " (circom present — rebuild circuits)" : " and no circom binary to rebuild it"}`);
  } else {
    // Two identities in one depth-20 tree.
    const secretA = 12345678901234567890123456789n % FR;
    const secretB = 98765432109876543210987654321n % FR;
    const strangerSecret = 55555555555555555555555555n % FR; // never inserted
    const tree = new PoseidonTree(20);
    const idxA = tree.insert(h1(secretA));
    const idxB = tree.insert(h1(secretB));
    const proposalId = 424242n;

    const mkInput = (secret, idx, choice) => {
      const { pathElements, pathIndices } = tree.proof(idx);
      return {
        root: tree.root.toString(),
        proposalId: proposalId.toString(),
        choice: choice ? "1" : "0",
        secret: secret.toString(),
        pathElements: pathElements.map(String),
        pathIndices: pathIndices.map(String),
      };
    };

    let proofA = null, signalsA = null;
    await test(`${name}: valid proof (identity A, choice=1) verifies against the zkey VK`, async () => {
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(mkInput(secretA, idxA, true), c.wasm, c.zkey);
      proofA = proof; signalsA = publicSignals;
      assert(publicSignals.length === c.nPublic, `expected ${c.nPublic} public signals, got ${publicSignals.length}`);
      // signal order sanity: [nullifier, root, proposalId, choice]
      assert(BigInt(publicSignals[0]) === h2(secretA, proposalId), "nullifier != Poseidon(secret, proposalId)");
      assert(BigInt(publicSignals[1]) === tree.root, "public root != tree root");
      assert(BigInt(publicSignals[2]) === proposalId, "public proposalId mismatch");
      assert(BigInt(publicSignals[3]) === 1n, "public choice mismatch");
      assert(await verifies(vk, publicSignals, proof), "valid proof did not verify");
    });

    await test(`${name}: tampered public signal (choice flipped 1→0) fails verification`, async () => {
      const t = [...signalsA]; t[3] = "0";
      assert(!(await verifies(vk, t, proofA)), "flipped ballot still verified — CRITICAL");
    });

    await test(`${name}: identity A's proof does not verify against identity B's public inputs`, async () => {
      const t = [...signalsA]; t[0] = h2(secretB, proposalId).toString(); // B's nullifier
      assert(!(await verifies(vk, t, proofA)), "A's proof verified with B's nullifier — CRITICAL identity confusion");
    });

    await test(`${name}: wrong Merkle root in public inputs fails verification`, async () => {
      const t = [...signalsA]; t[1] = new PoseidonTree(20).root.toString(); // empty-tree root
      assert(!(await verifies(vk, t, proofA)), "proof verified against a root the member is not in — CRITICAL");
    });

    await test(`${name}: non-member secret cannot even generate a witness (root constraint)`, async () => {
      const bad = mkInput(secretA, idxA, true);
      bad.secret = strangerSecret.toString(); // path is A's; commitment won't fold to root
      let threw = false;
      try { await snarkjs.groth16.fullProve(bad, c.wasm, c.zkey); } catch { threw = true; }
      assert(threw, "witness generation succeeded for a non-member — root constraint missing");
    });

    await test(`${name}: identity B proves independently with a distinct nullifier`, async () => {
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(mkInput(secretB, idxB, false), c.wasm, c.zkey);
      assert(await verifies(vk, publicSignals, proof), "B's valid proof did not verify");
      assert(publicSignals[0] !== signalsA[0], "A and B produced the same nullifier");
    });
  }
}

// ===========================================================================
// 2. lineage_grant — anonymous level grant
//    publicSignals = [nullifier, root, grantedLevel, granteeCommitment]
// ===========================================================================
{
  const name = "lineage_grant";
  const c = CIRCUITS[name];
  const vk = await vkConsistency(name);

  if (!existsSync(c.wasm)) {
    skip(`${name}: prove/verify roundtrip`, `wasm missing at ${c.wasm}${haveCircom ? " (circom present — rebuild circuits)" : " and no circom binary to rebuild it"}`);
  } else {
    const issuerSecret = 777000111222333444555666n % FR;
    const otherIssuerSecret = 888000111222333444555666n % FR;
    const issuerLevel = 3n;
    const granteeCommitment = h1(31415926535897932384626n % FR);

    // leaf = Poseidon(Poseidon(issuerSecret), issuerLevel)
    const tree = new PoseidonTree(20);
    tree.insert(h2(h1(otherIssuerSecret), 2n)); // someone else's credential
    const idx = tree.insert(h2(h1(issuerSecret), issuerLevel));
    const { pathElements, pathIndices } = tree.proof(idx);

    const input = (grantedLevel) => ({
      root: tree.root.toString(),
      grantedLevel: grantedLevel.toString(),
      granteeCommitment: granteeCommitment.toString(),
      issuerSecret: issuerSecret.toString(),
      issuerLevel: issuerLevel.toString(),
      pathElements: pathElements.map(String),
      pathIndices: pathIndices.map(String),
    });

    let proofOk = null, signalsOk = null;
    await test(`${name}: valid proof (level-3 issuer grants level 2) verifies`, async () => {
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(input(2n), c.wasm, c.zkey);
      proofOk = proof; signalsOk = publicSignals;
      assert(publicSignals.length === c.nPublic, `expected ${c.nPublic} public signals, got ${publicSignals.length}`);
      assert(BigInt(publicSignals[0]) === h2(issuerSecret, granteeCommitment), "nullifier != Poseidon(issuerSecret, granteeCommitment)");
      assert(BigInt(publicSignals[1]) === tree.root, "public root != tree root");
      assert(BigInt(publicSignals[2]) === 2n, "public grantedLevel mismatch");
      assert(BigInt(publicSignals[3]) === granteeCommitment, "public granteeCommitment mismatch");
      assert(await verifies(vk, publicSignals, proof), "valid proof did not verify");
    });

    await test(`${name}: tampered public signal (grantedLevel 2→5) fails verification`, async () => {
      const t = [...signalsOk]; t[2] = "5";
      assert(!(await verifies(vk, t, proofOk)), "level escalation verified — CRITICAL");
    });

    await test(`${name}: issuer A's proof does not verify with issuer B's nullifier`, async () => {
      const t = [...signalsOk]; t[0] = h2(otherIssuerSecret, granteeCommitment).toString();
      assert(!(await verifies(vk, t, proofOk)), "A's proof verified with B's nullifier — CRITICAL identity confusion");
    });

    await test(`${name}: wrong Merkle root in public inputs fails verification`, async () => {
      const t = [...signalsOk]; t[1] = new PoseidonTree(20).root.toString();
      assert(!(await verifies(vk, t, proofOk)), "proof verified against a foreign lineage root — CRITICAL");
    });

    await test(`${name}: granting above own level cannot even generate a witness`, async () => {
      let threw = false;
      try { await snarkjs.groth16.fullProve(input(4n), c.wasm, c.zkey); } catch { threw = true; }
      assert(threw, "level-3 issuer produced a witness granting level 4 — LessEqThan constraint missing");
    });
  }
}

// ===========================================================================
// 3. ack_disclose — selective disclosure with predicates
//    publicSignals = [dateOk, courseAccredited, teacherRecognized,
//                     root, revealP, revealC, revealX, revealD,
//                     valueP, valueC, valueX, valueD, dateLowerBound,
//                     catalogRoot, enableCatalog, teacherSetRoot, enableTeacherSet]
// ===========================================================================
{
  const name = "ack_disclose";
  const c = CIRCUITS[name];
  const vk = await vkConsistency(name);

  if (!existsSync(c.wasm)) {
    skip(`${name}: prove/verify roundtrip`, `wasm missing at ${c.wasm}${haveCircom ? " (circom present — rebuild circuits)" : " and no circom binary to rebuild it"}`);
  } else {
    // Credential fields + salts.
    const ppp = 111111n, ccc = 222222n, xxx = 333333n, ddd = 1700000000n; // ddd = unix seconds, fits 32 bits
    const saltP = 91n, saltC = 92n, saltX = 93n, saltD = 94n;
    const root = h4(h2(ppp, saltP), h2(ccc, saltC), h2(xxx, saltX), h2(ddd, saltD));

    // Accredited-course and recognized-teacher sets (depth 16), leaf = Poseidon(field).
    const catalog = new PoseidonTree(16);
    catalog.insert(h1(999999n)); // some other course
    const cIdx = catalog.insert(h1(ccc));
    const cPath = catalog.proof(cIdx);
    const teachers = new PoseidonTree(16);
    const xIdx = teachers.insert(h1(xxx));
    const xPath = teachers.proof(xIdx);

    // Reveal portrait + date, hide course + teacher, prove all three predicates.
    const input = {
      root: root.toString(),
      revealP: "1", revealC: "0", revealX: "0", revealD: "1",
      valueP: ppp.toString(), valueC: "0", valueX: "0", valueD: ddd.toString(),
      dateLowerBound: (ddd - 86400n).toString(),
      catalogRoot: catalog.root.toString(), enableCatalog: "1",
      teacherSetRoot: teachers.root.toString(), enableTeacherSet: "1",
      ppp: ppp.toString(), ccc: ccc.toString(), xxx: xxx.toString(), ddd: ddd.toString(),
      saltP: saltP.toString(), saltC: saltC.toString(), saltX: saltX.toString(), saltD: saltD.toString(),
      catalogPathElements: cPath.pathElements.map(String), catalogPathIndices: cPath.pathIndices.map(String),
      teacherPathElements: xPath.pathElements.map(String), teacherPathIndices: xPath.pathIndices.map(String),
    };

    let proofOk = null, signalsOk = null;
    await test(`${name}: valid selective disclosure (reveal P,D; predicates on C,X,date) verifies`, async () => {
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, c.wasm, c.zkey);
      proofOk = proof; signalsOk = publicSignals;
      assert(publicSignals.length === c.nPublic, `expected ${c.nPublic} public signals, got ${publicSignals.length}`);
      assert(BigInt(publicSignals[0]) === 1n, "dateOk should be 1");
      assert(BigInt(publicSignals[1]) === 1n, "courseAccredited should be 1");
      assert(BigInt(publicSignals[2]) === 1n, "teacherRecognized should be 1");
      assert(BigInt(publicSignals[3]) === root, "public credential root mismatch");
      assert(BigInt(publicSignals[8]) === ppp, "revealed valueP mismatch");
      assert(BigInt(publicSignals[9]) === 0n, "hidden valueC leaked");
      assert(BigInt(publicSignals[10]) === 0n, "hidden valueX leaked");
      assert(BigInt(publicSignals[11]) === ddd, "revealed valueD mismatch");
      assert(await verifies(vk, publicSignals, proof), "valid proof did not verify");
    });

    await test(`${name}: tampered public signal (revealed date changed) fails verification`, async () => {
      const t = [...signalsOk]; t[11] = (ddd + 1n).toString();
      assert(!(await verifies(vk, t, proofOk)), "forged disclosed date verified — CRITICAL");
    });

    await test(`${name}: proof for credential A does not verify against credential B's root`, async () => {
      // Credential B: same fields, different salts — a different holder's credential.
      const rootB = h4(h2(ppp, 191n), h2(ccc, 192n), h2(xxx, 193n), h2(ddd, 194n));
      const t = [...signalsOk]; t[3] = rootB.toString();
      assert(!(await verifies(vk, t, proofOk)), "A's proof verified against B's credential root — CRITICAL");
    });

    await test(`${name}: wrong catalog Merkle root in public inputs fails verification`, async () => {
      const t = [...signalsOk]; t[13] = new PoseidonTree(16).root.toString();
      assert(!(await verifies(vk, t, proofOk)), "accreditation verified against a foreign catalog root — CRITICAL");
    });

    await test(`${name}: revealing a wrong field value cannot even generate a witness`, async () => {
      const bad = { ...input, valueP: (ppp + 1n).toString() };
      let threw = false;
      try { await snarkjs.groth16.fullProve(bad, c.wasm, c.zkey); } catch { threw = true; }
      assert(threw, "witness generated with valueP != ppp — reveal constraint missing");
    });
  }
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped.`);
console.log(failed === 0 ? "All F43 ZK e2e tests passed." : `${failed} test(s) FAILED.`);
// snarkjs/ffjavascript keep curve worker threads alive; terminate before exit.
try { if (globalThis.curve_bn128) await globalThis.curve_bn128.terminate(); } catch {}
process.exit(failed === 0 ? 0 : 1);
