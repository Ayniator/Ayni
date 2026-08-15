// F97 — the "My Messages" unread badge display rules.
// Run: node tests/badge-count.test.mjs   (plain node, no framework)
//
// WHY THIS FILE EXISTS. The badge renders only when a wallet is connected, and
// nothing in the Playwright suite can connect one. So a browser assertion on it
// passes whether or not the rules hold — the same class of defect a Sentinel
// round already found once in this repo (a privacy assertion that ran only on a
// desktop project where the component never mounted). The display rules are
// pure functions, so they are tested here, where they can actually fail.
//
// What is NOT claimed: that the count itself is right. That comes from
// unreadCount() over a fetched inbox and is a different concern.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const frontendRequire = createRequire(path.join(repoRoot, "frontend", "package.json"));
const ts = frontendRequire("typescript");

// Load the component module as CJS, stripping the React/Next imports it does
// not need for the two pure functions under test.
const file = path.join(repoRoot, "frontend", "components", "InboxNavLink.tsx");
const src = readFileSync(file, "utf8")
  .split("\n")
  .filter((l) => !/^import\s/.test(l))
  .join("\n")
  // The default component references hooks/JSX we are not exercising; drop it.
  .replace(/export default function InboxNavLink\(\)[\s\S]*$/, "");

const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.None },
}).outputText;

const mod = { exports: {} };
new Function("exports", "module", js)(mod.exports, mod);
const { badgeText, messagesLabel, BADGE_MAX } = mod.exports;

let failed = 0, passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e) { failed++; console.log("FAIL  " + name + " — " + (e && e.message ? e.message : e)); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const eq = (a, b, msg) => assert(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

console.log("=== F97 — unread badge display rules ===\n");

test("zero hides the badge entirely", () => {
  eq(badgeText(0), null, "a zero count must render no badge");
});

test("a negative or non-finite count hides it too, rather than rendering junk", () => {
  eq(badgeText(-1), null, "negative");
  eq(badgeText(NaN), null, "NaN");
  // Infinity is not a real unread count — it can only come from a broken
  // caller. Hiding is right: showing "99+" would dress a bug as a plausible
  // number and hide it from whoever has to debug it.
  eq(badgeText(Infinity), null, "Infinity is not finite, so it is treated as no count");
});

test("a normal count shows the number", () => {
  eq(badgeText(1), "1", "one");
  eq(badgeText(3), "3", "three");
  eq(badgeText(99), "99", "exactly the cap still shows the number");
});

test("past the cap it shows 99+, so a big number cannot widen the nav", () => {
  eq(badgeText(100), "99+", "one past the cap");
  eq(badgeText(4321), "99+", "far past the cap");
  eq(BADGE_MAX, 99, "the cap is the documented 99");
});

test("the accessible name carries the count, because the badge is aria-hidden", () => {
  eq(messagesLabel(0), "My Messages", "no count when there is nothing unread");
  eq(messagesLabel(3), "My Messages, 3 unread", "the spec's example");
  // Past the cap the LABEL keeps the true number — "99+ unread" would be a
  // worse thing to hear than the real figure.
  eq(messagesLabel(150), "My Messages, 150 unread", "the label is not capped");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
