// F98 — the karma award PDA's pair ordering, cross-checked between the two
// places that implement it.
// Run: node tests/pda-sort-check.mjs   (plain node, no framework)
//
// WHY THIS FILE EXISTS. `karmaAward`'s seed is a SORTED pair of commitments,
// which Anchor cannot auto-resolve from the IDL, so the client derives it by
// hand — and `tests/karma.ts` keeps its own parallel copy of the same logic.
// Two hand-written implementations of one consensus-critical ordering is
// precisely the shape that drifts, and the idl-sync Sentinel round flagged it:
// nothing today would catch them diverging.
//
// If they disagree for even one pair, that pair's sponsorship either fails on a
// seeds constraint or — worse — lands on a DIFFERENT award account and gets
// credited twice, which is the exact CRITICAL this whole mechanism exists to
// prevent.
//
// Both implementations are extracted from source rather than imported:
// frontend/lib/peers.ts cannot be require()d here (its import chain pulls in
// rpc-websockets, which breaks under this repo's node 18 + CJS interop). So the
// comparison text is lifted verbatim and evaluated — which also means this test
// fails loudly if either function is renamed or restructured, rather than
// quietly testing nothing.

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

console.log("=== F98 — karma award pair ordering, cross-implementation ===\n");

// --- the client's ordering, lifted out of peers.ts -------------------------
const peersSrc = readFileSync(path.join(repoRoot, "frontend", "lib", "peers.ts"), "utf8");
const peersBody = peersSrc.match(
  /export const karmaAwardPda[\s\S]*?const \[lo, hi\] = cmp <= 0 \? \[a, b\] : \[b, a\];/
);
// Reported as a normal failing test, not thrown at module scope: a stack trace
// at import time is a worse signal than a named red test, and the first version
// of this file did exactly that when the client stopped sorting.
test("peers.ts still contains the expected sorted-pair ordering", () => {
  assert(peersBody, "could not find karmaAwardPda's sorted ordering in peers.ts — it was renamed, restructured, or stopped sorting");
});

// Rebuild just the ordering as a callable, from the extracted text.
const peersOrder = new Function(
  "a", "b",
  `
  let cmp = 0;
  for (let i = 0; i < a.length && i < b.length && cmp === 0; i++) cmp = a[i] - b[i];
  if (cmp === 0) cmp = a.length - b.length;
  const [lo, hi] = cmp <= 0 ? [a, b] : [b, a];
  return [lo, hi];
  `
);

// Sanity: the text we rebuilt must actually be what peers.ts contains.
test("the rebuilt ordering matches peers.ts fragment for fragment", () => {
  assert(peersBody, "peers.ts ordering not found (see the failure above)");
  for (const fragment of [
    "let cmp = 0;",
    "for (let i = 0; i < a.length && i < b.length && cmp === 0; i++) cmp = a[i] - b[i];",
    "if (cmp === 0) cmp = a.length - b.length;",
    "const [lo, hi] = cmp <= 0 ? [a, b] : [b, a];",
  ]) {
    assert(peersBody[0].includes(fragment), `peers.ts's ordering changed — this test would otherwise be checking a stale copy:\n  missing: ${fragment}`);
  }
});

// --- the test suite's ordering, lifted out of karma.ts ---------------------
const karmaSrc = readFileSync(path.join(repoRoot, "tests", "karma.ts"), "utf8");
test("karma.ts still contains the expected sorted-pair ordering", () => {
  assert(
    /const \[lo, hi\] = Buffer\.compare\(a, b\) <= 0 \? \[a, b\] : \[b, a\];/.test(karmaSrc),
    "could not find karma.ts's sorted ordering — it was renamed, restructured, or stopped sorting"
  );
});
const karmaOrder = (a, b) =>
  Buffer.compare(Buffer.from(a), Buffer.from(b)) <= 0 ? [a, b] : [b, a];

const same = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
const agree = (a, b) => {
  const [pl, ph] = peersOrder(a, b);
  const [kl, kh] = karmaOrder(a, b);
  return same(pl, kl) && same(ph, kh);
};

test("the two implementations agree on 2000 random pairs", () => {
  for (let n = 0; n < 2000; n++) {
    const a = new Uint8Array(32), b = new Uint8Array(32);
    for (let i = 0; i < 32; i++) { a[i] = (Math.random() * 256) | 0; b[i] = (Math.random() * 256) | 0; }
    assert(agree(a, b), `disagreement at iteration ${n}`);
  }
});

test("they agree when the pair differs only in the FIRST byte", () => {
  const a = new Uint8Array(32).fill(9); const b = new Uint8Array(32).fill(9);
  a[0] = 1; b[0] = 2;
  assert(agree(a, b) && agree(b, a), "first-byte-only difference disagrees");
});

test("they agree when the pair differs only in the LAST byte", () => {
  const a = new Uint8Array(32).fill(9); const b = new Uint8Array(32).fill(9);
  a[31] = 1; b[31] = 2;
  assert(agree(a, b) && agree(b, a), "last-byte-only difference disagrees");
});

test("they agree on high bytes, where a signed-byte bug would show", () => {
  // 0xFF vs 0x01: a comparison that treated bytes as signed would order these
  // backwards. Uint8Array elements are plain 0–255 JS numbers, so subtraction
  // is safe — this pins that.
  const a = new Uint8Array(32).fill(0); const b = new Uint8Array(32).fill(0);
  a[0] = 0xff; b[0] = 0x01;
  const [lo] = peersOrder(a, b);
  assert(same(lo, b), "0x01 must sort below 0xff — the comparison is treating bytes as signed");
  assert(agree(a, b) && agree(b, a), "high-byte pair disagrees between implementations");
});

test("the ordering is stable: swapping the arguments does not swap the result", () => {
  for (let n = 0; n < 200; n++) {
    const a = new Uint8Array(32), b = new Uint8Array(32);
    for (let i = 0; i < 32; i++) { a[i] = (Math.random() * 256) | 0; b[i] = (Math.random() * 256) | 0; }
    const [l1, h1] = peersOrder(a, b);
    const [l2, h2] = peersOrder(b, a);
    assert(same(l1, l2) && same(h1, h2), `order flipped when arguments were swapped at iteration ${n}`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
