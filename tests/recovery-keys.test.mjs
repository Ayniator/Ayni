// F66 — blinded one-time recovery keys: plain-node property tests.
// Run: node tests/recovery-keys.test.mjs   (no framework, exits non-zero on failure)
//
// The module under test is TypeScript (frontend/lib/recoveryKeys.ts), and this
// repo's plain-node runtime is node 18, so we transpile it on the fly with the
// frontend's own `typescript` and evaluate it as CJS. Dependencies resolve
// from frontend/node_modules first; @solana/web3.js falls back to the root
// node_modules because the frontend copy's CJS entry hits an ESM-only nested
// `uuid` under node 18 (root's copy loads cleanly — same 1.98.x web3.js).

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

const web3 = requireDep("@solana/web3.js");
const nacl = requireDep("tweetnacl");
const ts = frontendRequire("typescript");

// Node 18 has no WebCrypto global (unflagged only from node 19); the module
// uses the browser convention `crypto.subtle`, so polyfill it here.
if (!globalThis.crypto?.subtle) {
  globalThis.crypto = (await import("node:crypto")).webcrypto;
}

// --- load frontend/lib/recoveryKeys.ts as CJS ------------------------------
const srcPath = path.join(repoRoot, "frontend", "lib", "recoveryKeys.ts");
const js = ts.transpileModule(readFileSync(srcPath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
const mod = { exports: {} };
new Function("require", "module", "exports", js)(
  (id) => (id === "@solana/web3.js" ? web3 : id === "tweetnacl" ? nacl : requireDep(id)),
  mod,
  mod.exports
);
const { deriveBlindedRecoveryKey, blindedKeysForMember, proveRecoveryControl, RECOVERY_KEY_DOMAIN } = mod.exports;

// --- tiny harness ----------------------------------------------------------
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log("PASS  " + name);
  } catch (e) {
    failed++;
    console.log("FAIL  " + name + " — " + (e && e.message ? e.message : e));
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const bytesEq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// --- fixtures --------------------------------------------------------------
const fill = (n, v) => new Uint8Array(n).fill(v);
const sponsorA = fill(32, 0xa1);
const sponsorB = fill(32, 0xb2);
const member1 = fill(32, 0x11);
const member2 = fill(32, 0x22);

// --- tests -----------------------------------------------------------------
await test("determinism: same (sponsor, member, epoch) → same pubkey", async () => {
  const x = await deriveBlindedRecoveryKey(sponsorA, member1, 0);
  const y = await deriveBlindedRecoveryKey(sponsorA, member1, 0);
  assert(x.blindedPubkey.equals(y.blindedPubkey), "pubkeys differ across identical derivations");
  assert(bytesEq(x.keypair.secretKey, y.keypair.secretKey), "secret keys differ across identical derivations");
});

await test("distinct across members: same sponsor+epoch, different member", async () => {
  const x = await deriveBlindedRecoveryKey(sponsorA, member1, 0);
  const y = await deriveBlindedRecoveryKey(sponsorA, member2, 0);
  assert(!x.blindedPubkey.equals(y.blindedPubkey), "different members produced the same blinded key");
});

await test("distinct across epochs: rotating epoch rotates the key (single-use)", async () => {
  const seen = new Set();
  for (const epoch of [0, 1, 2, 3, 2 ** 40]) {
    const { blindedPubkey } = await deriveBlindedRecoveryKey(sponsorA, member1, epoch);
    seen.add(blindedPubkey.toBase58());
  }
  assert(seen.size === 5, "epoch rotation produced a collision");
});

await test("distinct across sponsors: two sponsors' keys for one member don't collide", async () => {
  const x = await deriveBlindedRecoveryKey(sponsorA, member1, 7);
  const y = await deriveBlindedRecoveryKey(sponsorB, member1, 7);
  assert(!x.blindedPubkey.equals(y.blindedPubkey), "two sponsors derived the same blinded key");
});

await test("seed never equals sponsorSecret (or the commitment)", async () => {
  const { keypair } = await deriveBlindedRecoveryKey(sponsorA, member1, 0);
  const seed = keypair.secretKey.subarray(0, 32); // ed25519 secretKey = seed ‖ pubkey
  assert(!bytesEq(seed, sponsorA), "derived seed leaked the sponsorSecret verbatim");
  assert(!bytesEq(seed, member1), "derived seed equals the member commitment");
});

await test("key material shapes: 32-byte seed/pubkey, 64-byte secretKey", async () => {
  const { keypair, blindedPubkey } = await deriveBlindedRecoveryKey(sponsorA, member1, 0);
  assert(keypair.secretKey.length === 64, "secretKey is not 64 bytes");
  assert(keypair.secretKey.subarray(0, 32).length === 32, "seed is not 32 bytes");
  assert(blindedPubkey.toBytes().length === 32, "pubkey is not 32 bytes");
  assert(bytesEq(keypair.publicKey.toBytes(), blindedPubkey.toBytes()), "keypair/blindedPubkey mismatch");
});

await test("blindedKeysForMember: matches individual derivations, in order, distinct", async () => {
  const [ka, kb] = await blindedKeysForMember([sponsorA, sponsorB], member1, 3);
  const a = await deriveBlindedRecoveryKey(sponsorA, member1, 3);
  const b = await deriveBlindedRecoveryKey(sponsorB, member1, 3);
  assert(ka.equals(a.blindedPubkey), "first recovery key doesn't match sponsor A's derivation");
  assert(kb.equals(b.blindedPubkey), "second recovery key doesn't match sponsor B's derivation");
  assert(!ka.equals(kb), "the two recovery keys collide");
});

await test("blindedKeysForMember: refuses two identical sponsor secrets", async () => {
  let threw = false;
  try { await blindedKeysForMember([sponsorA, sponsorA], member1, 0); } catch { threw = true; }
  assert(threw, "degenerate duplicate-sponsor split was accepted");
});

await test("proveRecoveryControl: signature verifies against the blinded pubkey", async () => {
  const message = new TextEncoder().encode("member_migrate tx message bytes");
  const { blindedPubkey, signature } = await proveRecoveryControl(sponsorA, member1, 5, message);
  const expected = await deriveBlindedRecoveryKey(sponsorA, member1, 5);
  assert(blindedPubkey.equals(expected.blindedPubkey), "prove re-derived a different key");
  assert(signature.length === 64, "signature is not 64 bytes");
  assert(
    nacl.sign.detached.verify(message, signature, blindedPubkey.toBytes()),
    "signature does not verify against the blinded pubkey"
  );
  assert(
    !nacl.sign.detached.verify(new TextEncoder().encode("other message"), signature, blindedPubkey.toBytes()),
    "signature verified against a different message"
  );
});

await test("input validation: bad commitment length / negative epoch / short secret throw", async () => {
  const rejects = async (fn) => { try { await fn(); return false; } catch { return true; } };
  assert(await rejects(() => deriveBlindedRecoveryKey(sponsorA, fill(31, 1), 0)), "31-byte commitment accepted");
  assert(await rejects(() => deriveBlindedRecoveryKey(sponsorA, member1, -1)), "negative epoch accepted");
  assert(await rejects(() => deriveBlindedRecoveryKey(sponsorA, member1, 1.5)), "fractional epoch accepted");
  assert(await rejects(() => deriveBlindedRecoveryKey(fill(16, 9), member1, 0)), "16-byte sponsorSecret accepted");
});

await test("domain tag is the frozen v1 value", async () => {
  assert(RECOVERY_KEY_DOMAIN === "AHA-F66-recovery-v1", "domain-separation tag changed — that rotates every key");
});

// ---------------------------------------------------------------------------
console.log(failed === 0 ? "\nAll F66 recovery-key tests passed." : `\n${failed} test(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
