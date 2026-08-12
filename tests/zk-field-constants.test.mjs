// Step 1 + Step 2 guardrails — BN254 field constants, the canonical scalar
// reduction, and the FROZEN v2 master-rooted derivation contract.
// Run: node tests/zk-field-constants.test.mjs   (plain node, no framework)
//
// Why this file exists
// -------------------
// 1. `frontend/lib/zk-vote.ts` holds two BN254 primes: the SCALAR field r (every
//    secret / commitment / nullifier lives there) and the BASE field q (only for
//    G1 negation). They used to be byte-identical — `R` held q's value. Nothing
//    observable broke, because every minted secret was masked to < 2^253 < r, so
//    `mod` was the identity either way. But the moment a secret comes from a full
//    32-byte SHA-256 output (Step 2's master-rooted derivation), a wrong modulus
//    silently mints a NON-CANONICAL, out-of-field scalar: it still proves (the
//    witness calculator reduces mod the true r internally) but the stored secret
//    is not the one the circuit used, so re-derivation-and-compare — which is how
//    a recovered master reattaches to an on-chain leaf — quietly fails. This test
//    pins both constants literally AND cross-checks them against the libraries
//    that do the real reduction (circomlibjs, and snarkjs's ffjavascript).
// 2. `zkSecretForCircle` in `frontend/lib/sharding.ts` is a ONE-WAY DOOR: any
//    change to the tag, field order, lengths or endianness orphans every
//    master-rooted identity ever minted. The frozen vectors below are the
//    guardrail, not documentation.
//
// Dependency resolution + the node-18 webcrypto polyfill follow the pattern in
// tests/recovery-keys.test.mjs. Set PRINT_VECTORS=1 to recompute the vectors.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const frontendRequire = createRequire(path.join(repoRoot, "frontend", "package.json"));
const rootRequire = createRequire(path.join(repoRoot, "package.json"));
const requireDep = (id) => {
  try { return frontendRequire(id); } catch { return rootRequire(id); }
};

const ts = frontendRequire("typescript");
const { buildPoseidon } = requireDep("circomlibjs");

// Node 18 has no WebCrypto global (unflagged only from node 19); both modules
// use the browser convention (`crypto.subtle`, `crypto.getRandomValues`).
if (!globalThis.crypto?.subtle) {
  globalThis.crypto = (await import("node:crypto")).webcrypto;
}

// zk-vote.ts persists the minted secret to localStorage; give it a real one.
const lsStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
  setItem: (k, v) => { lsStore.set(k, String(v)); },
  removeItem: (k) => { lsStore.delete(k); },
  clear: () => lsStore.clear(),
};

// --- load the two TS modules as CJS ----------------------------------------
// zk-vote.ts's chain imports are stubbed: PROGRAM_ID / programWith / relayer are
// only touched inside the voting functions, which this file never calls.
const loadTs = (rel, shim) => {
  const js = ts.transpileModule(readFileSync(path.join(repoRoot, "frontend", "lib", rel), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", js)(shim, mod, mod.exports);
  return mod.exports;
};

const sharding = loadTs("sharding.ts", (id) => {
  // The Shamir split/combine are exercised by tests/sharding.ts; this file only
  // touches the derivation functions, so the (ESM-only) package is stubbed out.
  if (id === "shamir-secret-sharing") {
    const nope = () => { throw new Error("shamir not used in this test"); };
    return { split: nope, combine: nope };
  }
  return requireDep(id);
});

const zkVoteSrc = readFileSync(path.join(repoRoot, "frontend", "lib", "zk-vote.ts"), "utf8");
const zkVote = loadTs("zk-vote.ts", (id) => {
  if (id === "./sharding") return sharding;
  if (id === "@coral-xyz/anchor" || id === "@solana/web3.js" || id === "./member" || id === "./relayer") return {};
  return requireDep(id);
});

const { secretScalarFromBytes, newMemberIdentity } = zkVote;
const { zkSecretForCircle, deriveFromMaster, ZK_SECRET_DOMAIN_V2 } = sharding;

// --- tiny harness ----------------------------------------------------------
let failed = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("PASS  " + name); }
  catch (e) { failed++; console.log("FAIL  " + name + " — " + (e && e.message ? e.message : e)); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const toHex = (b) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const beToBig = (b) => { let v = 0n; for (const x of b) v = (v << 8n) | BigInt(x); return v; };
const to32BE = (x) => { const o = new Array(32).fill(0); let v = x; for (let i = 31; i >= 0; i--) { o[i] = Number(v & 0xffn); v >>= 8n; } return Uint8Array.from(o); };

const poseidon = await buildPoseidon();
const h1 = (x) => poseidon.F.toObject(poseidon([x]));

// --- the pinned constants --------------------------------------------------
// BN254 scalar field r — the circuit field. Ends ...495617.
const FR = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
// BN254 base field q — G1/G2 coordinates only. Ends ...208583.
const FQ = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
// The value `R` wrongly held before the Step 1 fix (it was q). Kept so the
// "no behaviour change for existing members" claim is PROVEN, not asserted.
const OLD_WRONG_R = FQ;

// ===========================================================================
// STEP 1 — field constants
// ===========================================================================
console.log("=== Step 1 — BN254 field constants + canonical reduction ===");

await test("zk-vote.ts pins R = the BN254 SCALAR field r, literally", async () => {
  assert(new RegExp(String.raw`const R = ${FR}n;`).test(zkVoteSrc), "R is not the literal BN254 scalar field r");
});

await test("zk-vote.ts pins Q = the BN254 BASE field q, literally (unchanged)", async () => {
  assert(new RegExp(String.raw`const Q = ${FQ}n;`).test(zkVoteSrc), "Q is not the literal BN254 base field q");
});

await test("R and Q are DIFFERENT primes, with r < q", async () => {
  assert(FR !== FQ, "scalar and base field constants are identical — the Step 1 bug is back");
  assert(FR < FQ, "r must be smaller than q on BN254");
});

await test("the reduction modulus IS r exactly (r ≡ 0, r+1 ≡ 1)", async () => {
  // Discriminating: with the old (q) modulus these would be r and r+1.
  assert(secretScalarFromBytes(to32BE(FR)) === 0n, "reducing r did not yield 0 — wrong modulus");
  assert(secretScalarFromBytes(to32BE(FR + 1n)) === 1n, "reducing r+1 did not yield 1 — wrong modulus");
  assert(secretScalarFromBytes(to32BE(FQ)) === FQ - FR, "reducing q did not yield q-r — wrong modulus");
});

await test("cross-check: R equals circomlibjs's Poseidon field prime", async () => {
  const p = BigInt(poseidon.F.p.toString());
  assert(p === FR, `circomlibjs field prime ${p} != pinned R ${FR}`);
});

await test("cross-check: R equals snarkjs/ffjavascript's bn128 scalar field r", async () => {
  const ff = requireDep("ffjavascript");
  const curve = await ff.getCurveFromName("bn128");
  try {
    const r = BigInt(curve.r.toString());
    assert(r === FR, `ffjavascript bn128 r ${r} != pinned R ${FR}`);
    assert(BigInt(curve.q.toString()) === FQ, "ffjavascript bn128 q != pinned Q");
  } finally {
    try { await curve.terminate(); } catch {}
  }
});

await test("every full-range 32-byte input reduces INTO the field", async () => {
  for (let i = 0; i < 500; i++) {
    const b = new Uint8Array(32);
    crypto.getRandomValues(b);
    const s = secretScalarFromBytes(b);
    assert(s >= 0n && s < FR, "reduced scalar is out of the field");
  }
  assert(secretScalarFromBytes(new Uint8Array(32).fill(0xff)) < FR, "all-ones input is not in the field");
});

// --- the no-op proof -------------------------------------------------------
await test("NO-OP PROOF: masked draws (rnd[0] &= 0x1f) are < 2^253 < r, so mod is the identity", async () => {
  assert((1n << 253n) - 1n < FR, "the 253-bit mask bound is not below r — the no-op argument fails");
  for (let i = 0; i < 2000; i++) {
    const rnd = new Uint8Array(32);
    crypto.getRandomValues(rnd);
    rnd[0] &= 0x1f; // exactly what newMemberIdentity's CSPRNG path does
    const raw = beToBig(rnd);
    assert(secretScalarFromBytes(rnd) === raw, "mod R altered a masked draw — behaviour changed");
    // and the OLD (wrong, = q) modulus produced the very same value:
    assert(raw % OLD_WRONG_R === raw % FR, "old and new constants disagree on a masked draw");
  }
  // boundary: the largest value the mask can produce
  const max = new Uint8Array(32).fill(0xff); max[0] = 0x1f;
  assert(beToBig(max) % OLD_WRONG_R === beToBig(max) % FR, "old/new disagree at the mask's maximum");
  assert(beToBig(max) === beToBig(max) % FR, "the mask's maximum is not already reduced");
});

await test("NO-OP PROOF: stored legacy secrets (< 2^253) round-trip unchanged", async () => {
  // A secret already in localStorage was written as `beToBig(masked) % q`; the
  // new code would write `beToBig(masked) % r`. Same string ⇒ same commitment
  // ⇒ same on-chain leaf ⇒ getSecretFor/haveVotingKey see no difference.
  for (const v of [0n, 1n, 12345n, (1n << 252n), (1n << 253n) - 1n]) {
    assert(v % OLD_WRONG_R === v % FR, `legacy secret ${v} would change value`);
  }
});

await test("CSPRNG path (no opts) is unchanged: commitment = Poseidon(secret), secret in the slot", async () => {
  const c = await newMemberIdentity();
  assert(c instanceof Uint8Array && c.length === 32, "commitment is not 32 bytes");
  const stored = localStorage.getItem(`aha:zk-secret:${toHex(c)}`);
  assert(stored !== null, "the secret was not written to aha:zk-secret:<commitHex>");
  const secret = BigInt(stored);
  assert(secret < (1n << 253n), "CSPRNG secret is not masked to < 2^253 — the mask was dropped");
  assert(beToBig(to32BE(h1(secret))) === beToBig(c), "commitment != Poseidon(secret)");
  const c2 = await newMemberIdentity();
  assert(toHex(c2) !== toHex(c), "two CSPRNG mints collided — randomness is gone");
});

// ===========================================================================
// STEP 2 — the FROZEN v2 derivation contract
// ===========================================================================
console.log("\n=== Step 2 — frozen master-rooted derivation contract (v2) ===");

const fill = (n, f) => Uint8Array.from({ length: n }, (_, i) => f(i) & 0xff);
const MASTER = fill(32, (i) => i);                 // 000102…1f
const CIRCLE_A = fill(32, (i) => i * 7 + 1);
const CIRCLE_B = fill(32, (i) => i * 11 + 3);

// --- FROZEN VECTORS --------------------------------------------------------
// Regenerate ONLY if the contract is deliberately re-cut (PRINT_VECTORS=1).
// A diff here means every master-rooted identity ever minted is orphaned.
const VECTORS = [
  {
    label: "master=00..1f, circleA, index=0",
    master: MASTER, circle: CIRCLE_A, index: 0,
    zkSecretHex: "d77886088ffebfa14c877f1188b227757f3975bfbadfa340815fb2f383a3588f",
    secret: "9907237670673077189231601471235434031383079849806766209806462706694756718731",
    commitmentHex: "1045fc37f5707b6b4c3bffacdc5d4d1168eedb40ae4dff07242633b134907e37",
  },
  {
    label: "master=00..1f, circleA, index=1 (rejoin)",
    master: MASTER, circle: CIRCLE_A, index: 1,
    zkSecretHex: "53047c5f405d3d34fb8530ae7bb7f52301a53d0398603c479d8d65e5d255d096",
    secret: "15661649333351226962820882346526219441855568952910769079873726360527054426261",
    commitmentHex: "303845d03134dd971a8e6fced62e84381f4f683441321d30e7297ebcc844ed36",
  },
  {
    label: "master=00..1f, circleB, index=0 (different Circle)",
    master: MASTER, circle: CIRCLE_B, index: 0,
    zkSecretHex: "10bcc3830710935abe8da9b5a318759dc6a56a3836471446ec16d2092a036c34",
    secret: "7570522198545240874020411816436530400910153376054308921256420632317411945524",
    commitmentHex: "002e7bf929293e18f743e11e31a888cae81835117153704dfe387ae9acb43514",
  },
];
// The global wallet seed is a separate, unchanged v1 contract — pinned so a
// future edit to sharding.ts cannot silently rotate anyone's Solana key.
const WALLET_SEED_HEX = "e9e70fd439c879bc71b3361b579982e9ad2508b7403242bad060776299a2ba15";
const ZK_SECRET_V1_HEX = "8e12ca9df0633df3e054dfef589ca28a93258693f4490b04d69b0ef17d69b4aa";

if (process.env.PRINT_VECTORS) {
  for (const v of VECTORS) {
    const zk = await zkSecretForCircle(v.master, v.circle, v.index);
    const s = secretScalarFromBytes(zk);
    console.log(JSON.stringify({ label: v.label, zkSecretHex: toHex(zk), secret: s.toString(), commitmentHex: toHex(to32BE(h1(s))) }, null, 2));
  }
  const d = await deriveFromMaster(MASTER);
  console.log(JSON.stringify({ walletSeedHex: toHex(d.walletSeed), zkSecretV1Hex: toHex(d.zkSecret) }, null, 2));
  process.exit(0);
}

await test("the v2 domain tag is the frozen string", async () => {
  assert(ZK_SECRET_DOMAIN_V2 === "aha-zk-secret-v2", "domain tag changed — that rotates every rooted identity");
});

await test("the wire format is exactly tag ‖ master ‖ circle ‖ u32le(index)", async () => {
  // Independent reimplementation — catches a reordering the vectors alone
  // would only flag as "changed".
  const nodeCrypto = await import("node:crypto");
  for (const v of VECTORS) {
    const idx = Buffer.alloc(4); idx.writeUInt32LE(v.index, 0);
    const expect = new Uint8Array(nodeCrypto.createHash("sha256")
      .update(Buffer.from("aha-zk-secret-v2", "utf8"))
      .update(Buffer.from(v.master))
      .update(Buffer.from(v.circle))
      .update(idx)
      .digest());
    const got = await zkSecretForCircle(v.master, v.circle, v.index);
    assert(toHex(got) === toHex(expect), `wire format mismatch for ${v.label}`);
  }
});

await test("FROZEN VECTORS: master → circle → index → secret → commitment", async () => {
  for (const v of VECTORS) {
    const zk = await zkSecretForCircle(v.master, v.circle, v.index);
    assert(toHex(zk) === v.zkSecretHex, `zkSecret drifted for ${v.label}`);
    const s = secretScalarFromBytes(zk);
    assert(s.toString() === v.secret, `secret scalar drifted for ${v.label}`);
    assert(toHex(to32BE(h1(s))) === v.commitmentHex, `COMMITMENT DRIFTED for ${v.label} — every rooted identity is orphaned`);
  }
});

await test("FROZEN VECTOR: the global wallet seed (v1) is untouched", async () => {
  const { walletSeed, zkSecret } = await deriveFromMaster(MASTER);
  assert(toHex(walletSeed) === WALLET_SEED_HEX, "aha-wallet-seed-v1 drifted — that rotates the Solana key");
  assert(toHex(zkSecret) === ZK_SECRET_V1_HEX, "aha-zk-secret-v1 drifted (retired, but the recovery shape check reads it)");
  assert(toHex(walletSeed) !== toHex(zkSecret), "wallet seed and v1 zk secret are not domain-separated");
});

await test("determinism: same (master, circle, index) → same secret, always", async () => {
  const a = await zkSecretForCircle(MASTER, CIRCLE_A, 0);
  const b = await zkSecretForCircle(MASTER, CIRCLE_A, 0);
  assert(toHex(a) === toHex(b), "derivation is not deterministic");
});

await test("unlinkability: a different Circle gives a different commitment", async () => {
  const [a0, , b0] = VECTORS;
  assert(a0.commitmentHex !== b0.commitmentHex, "two Circles produced the same commitment — cross-Circle linkable");
});

await test("rejoin: a different index gives a different commitment", async () => {
  const [a0, a1] = VECTORS;
  assert(a0.commitmentHex !== a1.commitmentHex, "index does not change the identity — rejoin would remint the same leaf");
});

await test("a different master gives a different secret (no cross-member collision)", async () => {
  const other = fill(32, (i) => i + 1);
  const x = await zkSecretForCircle(MASTER, CIRCLE_A, 0);
  const y = await zkSecretForCircle(other, CIRCLE_A, 0);
  assert(toHex(x) !== toHex(y), "two masters derived the same voting secret");
});

await test("the derived secret is a canonical field element (this is why Step 1 had to land first)", async () => {
  for (const v of VECTORS) {
    const s = secretScalarFromBytes(await zkSecretForCircle(v.master, v.circle, v.index));
    assert(s >= 0n && s < FR, "a rooted secret is outside the scalar field");
  }
});

await test("input validation: wrong lengths / bad index are refused, not coerced", async () => {
  const rejects = async (fn) => { try { await fn(); return false; } catch { return true; } };
  assert(await rejects(() => zkSecretForCircle(fill(31, (i) => i), CIRCLE_A, 0)), "31-byte master accepted");
  assert(await rejects(() => zkSecretForCircle(MASTER, fill(33, (i) => i), 0)), "33-byte circle accepted");
  assert(await rejects(() => zkSecretForCircle(MASTER, CIRCLE_A, -1)), "negative index accepted");
  assert(await rejects(() => zkSecretForCircle(MASTER, CIRCLE_A, 1.5)), "fractional index accepted");
  assert(await rejects(() => zkSecretForCircle(MASTER, CIRCLE_A, 2 ** 32)), "index beyond u32 accepted");
});

await test("newMemberIdentity({master, circle}) matches the vectors and uses the SAME storage slot", async () => {
  for (const v of VECTORS) {
    const c = await newMemberIdentity({ master: v.master, circle: v.circle, index: v.index });
    assert(toHex(c) === v.commitmentHex, `rooted mint drifted from the frozen vector for ${v.label}`);
    const stored = localStorage.getItem(`aha:zk-secret:${v.commitmentHex}`);
    assert(stored === v.secret, "the rooted secret is not in aha:zk-secret:<commitHex> — getSecretFor would miss it");
  }
  // index defaults to 0
  const c = await newMemberIdentity({ master: MASTER, circle: CIRCLE_A });
  assert(toHex(c) === VECTORS[0].commitmentHex, "the default index is not 0");
});

await test("no call site passes opts in this round (rooting stays dark)", async () => {
  // Step 3 is the round that wires this up; until then the only production
  // caller must still be the argument-free CSPRNG mint.
  const { execSync } = await import("node:child_process");
  const hits = execSync(
    `grep -rn "newMemberIdentity(" --include=*.ts --include=*.tsx "${path.join(repoRoot, "frontend")}" | grep -v node_modules || true`,
    { encoding: "utf8" }
  ).split("\n").filter(Boolean).filter((l) => !l.includes("/lib/zk-vote.ts:"));
  for (const line of hits) {
    assert(/newMemberIdentity\(\)/.test(line), `a call site already passes opts — Step 2 must stay dark: ${line}`);
  }
});

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed.`);
console.log(failed === 0 ? "All ZK field-constant + derivation-contract tests passed." : `${failed} test(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
