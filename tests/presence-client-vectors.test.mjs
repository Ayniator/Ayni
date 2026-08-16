// F59 — the BROWSER's external-nullifier derivation, pinned to the program's
// frozen vectors.
// Run: node tests/presence-client-vectors.test.mjs   (plain node, no framework)
//
// WHY THIS FILE EXISTS. frontend/lib/presence.ts reimplements the external
// nullifier (SHA-256 over tag ‖ circle ‖ commitment ‖ month_le32, top three
// bits cleared) because the browser cannot call into the program. If the two
// drift — tag, field order, endianness, mask — every proof the browser
// generates verifies against NOTHING: the program computes a different E, the
// public inputs mismatch, and the failure surfaces as an opaque
// "proof invalid" three layers from the cause. The program side is pinned by
// clear_presence.rs's `the_preimages_are_frozen` test; this is the same pin on
// the client side, against the same vectors, computed with node's OWN sha256
// rather than the code under test.
//
// The file cannot import lib/presence.ts (its import chain pulls web3.js in a
// way node 18 CJS interop rejects), so — same discipline as
// tests/pda-sort-check.mjs — the derivation constants are verified against the
// SOURCE TEXT, and the arithmetic is re-run independently.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

let failed = 0, passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e) { failed++; console.log("FAIL  " + name + " — " + (e && e.message ? e.message : e)); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

console.log("=== F59 — client external-nullifier vectors ===\n");

const src = readFileSync(path.join(repoRoot, "frontend", "lib", "presence.ts"), "utf8");

// The frozen vectors from clear_presence.rs (circle=[7;32], commitment=[9;32],
// month=674), computed there with an independent Python sha256 before being
// trusted. Three independent implementations now agree or fail loudly.
const VECTORS = {
  "AHA-presence-month": "0f00da98fa1aa249ffb34bc7887c2cd7e3642943e7cb3cc8cc3acf6238edd6f4",
  "AHA-presence-clear": "1c0ec11835ea7861f11c80408e97a034885aa9f5aafa63027b6f1478e6e19270",
};

function derive(tag, month) {
  const le = Buffer.alloc(4);
  le.writeUInt32LE(month >>> 0, 0);
  const pre = Buffer.concat([
    Buffer.from(tag, "utf8"),
    Buffer.alloc(32, 7),   // circle
    Buffer.alloc(32, 9),   // commitment
    le,
  ]);
  const d = createHash("sha256").update(pre).digest();
  d[0] &= 0x1f;
  return d.toString("hex");
}

test("both tags reproduce the program's frozen vectors", () => {
  for (const [tag, want] of Object.entries(VECTORS)) {
    const got = derive(tag, 674);
    assert(got === want, `${tag}: derived ${got}, program pins ${want}`);
  }
});

test("presence.ts carries exactly the two program tags", () => {
  for (const tag of Object.keys(VECTORS)) {
    assert(src.includes(`"${tag}"`), `tag "${tag}" not found in lib/presence.ts — a rename breaks every proof`);
  }
});

test("presence.ts masks the top three bits, and little-endians the month", () => {
  // The two lines that, changed, would silently desynchronise the client from
  // the program. Asserted as source fragments so a refactor that keeps the
  // behaviour must keep (or knowingly update) the test too.
  assert(src.includes("d[0] &= 0x1f"), "the BN254 mask (d[0] &= 0x1f) is gone from presence.ts");
  assert(/setUint32\(0, month >>> 0, true\)/.test(src), "the month is no longer written little-endian");
});

test("the preimage order in source is tag, circle, commitment, month", () => {
  const m = src.match(/\[\.\.\.seed\(tag\), \.\.\.circle\.toBytes\(\), \.\.\.subjectCommitment, \.\.\.le\]/);
  assert(m, "the preimage concatenation order changed — it must be tag ‖ circle ‖ commitment ‖ month_le32");
});

test("month arithmetic matches month.rs for the known dates", () => {
  // month.rs pins 2026-03 as index 674 ((2026-1970)*12 + 2). The client's
  // currentMonthIndex is (UTCFullYear-1970)*12 + UTCMonth — same formula;
  // re-run it here for the same fixtures month.rs tests.
  const idx = (d) => (d.getUTCFullYear() - 1970) * 12 + d.getUTCMonth();
  assert(idx(new Date(Date.UTC(2026, 2, 1))) === 674, "2026-03 must be index 674");
  assert(idx(new Date(Date.UTC(1970, 0, 1))) === 0, "1970-01 must be index 0");
  assert(idx(new Date(Date.UTC(2024, 1, 29))) === 649, "2024-02 (leap day) must be index 649");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
