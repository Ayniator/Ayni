#!/usr/bin/env bash
# Sentinel regression gate — F82 (/reflections default mode + browse-by-day
# calendar) and F83 (home slogan + invisible Core-Shamanism link).
#
# Not a full Layer A/Playwright suite (none exists in this repo — documented
# gap). This is the mechanical half: dataset integrity, resolution-function
# robustness, Circle-precedence wiring, and slogan/link invariants that are
# cheap to assert without a browser.
#
# Do not weaken this script to make a round pass (Sentinel spec §4).

set -uo pipefail
cd "$(dirname "$0")/../.."
FRONTEND="frontend"
fail=0

echo "=== F82/F83 regression gate ==="

# ---- F82: dataset + resolution function ------------------------------------
node -e '
const fs = require("fs");
const path = require("path");
const root = process.argv[1];

// Load DEFAULT_REFLECTIONS / REFLECTION_KEYS by isolating the object/array
// literals out of the generated TS module (no runtime xlsx parse, no ts-node
// dependency for this gate).
const ds = fs.readFileSync(path.join(root, "lib/daily-reflections-default.ts"), "utf8");

function extractBalanced(src, startIdx, openCh, closeCh) {
  const braceStart = src.indexOf(openCh, startIdx);
  let depth = 0, i = braceStart, end = -1;
  for (; i < src.length; i++) {
    if (src[i] === openCh) depth++;
    else if (src[i] === closeCh) { depth--; if (depth === 0) { end = i; break; } }
  }
  return src.slice(braceStart, end + 1);
}

const objStart = ds.indexOf("export const DEFAULT_REFLECTIONS");
const objText = extractBalanced(ds, objStart, "{", "}");
const DEFAULT_REFLECTIONS = eval("(" + objText + ")");

const arrDeclStart = ds.indexOf("export const REFLECTION_KEYS");
// Skip past the "REFLECTION_KEYS: string[] = " type annotation, which itself
// contains a "[]" pair that would confuse a naive bracket search.
const arrAssignStart = ds.indexOf("=", arrDeclStart);
const arrText = extractBalanced(ds, arrAssignStart, "[", "]");
const REFLECTION_KEYS = eval(arrText);

let bad = [];

// 1. Set equality: every DEFAULT_REFLECTIONS key is in REFLECTION_KEYS and vice
//    versa (the calendar dots and the nearest-day search both depend on this).
const objKeys = new Set(Object.keys(DEFAULT_REFLECTIONS));
const arrKeys = new Set(REFLECTION_KEYS);
if (objKeys.size !== arrKeys.size || [...objKeys].some((k) => !arrKeys.has(k))) {
  bad.push("DEFAULT_REFLECTIONS keys != REFLECTION_KEYS (calendar dots would drift from resolvable entries)");
}

// 2. Every key is a well-formed MM-DD in range (garbage keys silently break
//    keyToOrdinal in lib/reflections.ts, which clamps rather than throws — so
//    a malformed key would resolve to the wrong day without any visible error).
const badKeys = [...objKeys].filter((k) => {
  const m = /^(\d\d)-(\d\d)$/.exec(k);
  if (!m) return true;
  const mm = +m[1], dd = +m[2];
  return mm < 1 || mm > 12 || dd < 1 || dd > 31;
});
if (badKeys.length) bad.push("malformed MM-DD key(s): " + badKeys.join(", "));

// 3. title/quote/author render UNCONDITIONALLY in the hero (reflections/page.tsx
//    does not guard them with && before rendering) — an empty one is a visible
//    blank hero / bare quote-marks bug. source/denomination/step ARE guarded
//    (`{display.x && <.../>}`) so an empty value there is a content-completeness
//    note, not a functional break — reported separately, not gated here.
const softEmpty = [];
for (const k of objKeys) {
  const e = DEFAULT_REFLECTIONS[k];
  for (const f of ["title", "quote", "author"]) {
    if (!e[f] || !String(e[f]).trim()) bad.push(k + "." + f + " is empty (renders unconditionally in the hero)");
  }
  for (const f of ["source", "denomination"]) {
    if (!e[f] || !String(e[f]).trim()) softEmpty.push(k + "." + f);
  }
}
if (softEmpty.length) {
  console.log("NOTE (non-gating, render-guarded fields empty): " + softEmpty.join(", "));
}

// 4. Reimplement the circular-nearest-day resolution from lib/reflections.ts
//    (kept in sync manually — if the algorithm changes, update this copy) and
//    check it never throws on garbage input and resolves known wrap cases.
const CUM = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
function keyToOrdinal(key) {
  const [m, d] = key.split("-").map((n) => parseInt(n, 10));
  const mm = Math.min(Math.max(m || 1, 1), 12);
  return CUM[mm - 1] + (d || 1);
}
function ringDistance(a, b) {
  const raw = Math.abs(a - b);
  return Math.min(raw, 365 - raw);
}
function nearestKey(key) {
  if (DEFAULT_REFLECTIONS[key]) return { key, exact: true };
  const want = keyToOrdinal(key);
  let best = REFLECTION_KEYS[0], bestDist = Infinity;
  for (const k of REFLECTION_KEYS) {
    const dist = ringDistance(want, keyToOrdinal(k));
    if (dist < bestDist) { bestDist = dist; best = k; }
  }
  return { key: best, exact: false };
}

const cases = [
  ["08-12", "08-13"], // no exact entry -> next nearest day forward
  ["12-31", "01-01"], // year-boundary wrap
  ["02-29", "03-01"], // leap day, not in the 12 fixed months
  ["01-01", "01-01"], // exact hit
];
for (const [input, expected] of cases) {
  const r = nearestKey(input);
  if (r.key !== expected) bad.push(`nearestKey(${input}) = ${r.key}, expected ${expected}`);
}
// Garbage input must not throw and must resolve to *some* valid key.
for (const garbage of ["", "not-a-key", "13-99", "00-00"]) {
  try {
    const r = nearestKey(garbage);
    if (!objKeys.has(r.key)) bad.push(`nearestKey(${JSON.stringify(garbage)}) resolved to non-existent key ${r.key}`);
  } catch (e) {
    bad.push(`nearestKey(${JSON.stringify(garbage)}) threw: ${e.message}`);
  }
}

if (bad.length) {
  console.error("FAIL (F82 dataset/resolution):");
  for (const b of bad) console.error("  - " + b);
  process.exit(1);
} else {
  console.log("PASS — F82 dataset integrity (" + objKeys.size + " entries) + nearest-day resolution (incl. year-wrap, leap-day, garbage input).");
}
' "$FRONTEND" || fail=1

# Circle-precedence wiring: the page must still prefer a Circle's own local
# entry, then its remote (IPFS) entry, over the built-in — this is the F82
# no-regression requirement on the pre-existing Circle-published flow.
grep -q "localReflectionFor(circle.circle, key)" "$FRONTEND/app/reflections/page.tsx" \
  && grep -q "setDisplay(asCircle(local))" "$FRONTEND/app/reflections/page.tsx" \
  && grep -q "if (r) setDisplay(asCircle(r))" "$FRONTEND/app/reflections/page.tsx" \
  || { echo "FAIL — Circle-precedence wiring (local + remote Circle entry beating the built-in) not found in reflections/page.tsx"; fail=1; }
# The built-in fallback must still be called with the resolved day key. Since the
# reflections-localisation round the call also threads the active locale, so this
# asserts BOTH (strictly stronger than the original key-only check): drop the
# locale argument and this fails, which is the point — a non-English member would
# silently get English text back.
grep -q "defaultReflectionFor(key, lang)" "$FRONTEND/app/reflections/page.tsx" \
  || { echo "FAIL — built-in fallback call (with locale) not found in reflections/page.tsx"; fail=1; }
# English stays the source of record: a missing/partial translation must fall back
# to the English entry rather than render blank.
grep -q "translated: false" "$FRONTEND/lib/reflections.ts" \
  || { echo "FAIL — English fallback path missing from lib/reflections.ts"; fail=1; }

# ---- F83: slogan + stealth link ---------------------------------------------
grep -q "https://www.shamanism.org/core-shamanism/" "$FRONTEND/app/page.tsx" \
  && grep -q 'target="_blank"' "$FRONTEND/app/page.tsx" \
  && grep -q 'rel="noreferrer"' "$FRONTEND/app/page.tsx" \
  && grep -q "stealth-link" "$FRONTEND/app/page.tsx" \
  || { echo "FAIL — stealth Core-Shamanism link (URL / target=_blank / rel=noreferrer / stealth-link class) not found in app/page.tsx"; fail=1; }

# The href must be the single hardcoded literal — no template interpolation
# (that would open an injection surface via a translated/user string).
if grep -qE 'href=\{`|href=\{[a-zA-Z_]+\}' "$FRONTEND/app/page.tsx"; then
  echo "FAIL — a dynamic/interpolated href was found in app/page.tsx (the stealth link's href must stay a hardcoded literal)"
  fail=1
fi

# "AHA" and the verbatim phrase "Core Shamanism" must appear in home.slogan for
# every one of the 19 locales (en curated in i18n.ts, 18 others generated) —
# required for both readability (AHA branding) and the split-and-link logic
# (SloganWithLink splits on the literal English phrase regardless of locale).
node -e '
const fs = require("fs");
const path = require("path");
const root = process.argv[1];

const i18nSrc = fs.readFileSync(path.join(root, "lib/i18n.ts"), "utf8");
const enMatch = i18nSrc.match(/"home\.slogan":\s*\n?\s*"([^"]*(?:\\.[^"]*)*)"/);
if (!enMatch) { console.error("FAIL — home.slogan not found in curated en dict (lib/i18n.ts)"); process.exit(1); }
const enSlogan = enMatch[1];
if (!enSlogan.includes("AHA") || !enSlogan.includes("Core Shamanism")) {
  console.error("FAIL — en home.slogan missing AHA or verbatim Core Shamanism: " + enSlogan);
  process.exit(1);
}

const genSrc = fs.readFileSync(path.join(root, "lib/i18n.generated.ts"), "utf8");
const lines = [...genSrc.matchAll(/"home\.slogan":\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
if (lines.length !== 18) {
  console.error(`FAIL — expected 18 non-English home.slogan entries in i18n.generated.ts, found ${lines.length}`);
  process.exit(1);
}
const bad = lines.filter((l) => !l.includes("AHA") || !l.includes("Core Shamanism"));
if (bad.length) {
  console.error("FAIL — " + bad.length + " translated home.slogan value(s) missing AHA or verbatim Core Shamanism:");
  for (const b of bad) console.error("  - " + b);
  process.exit(1);
}
console.log("PASS — home.slogan carries AHA + verbatim \"Core Shamanism\" in all 19 locales (1 curated en + 18 generated).");
' "$FRONTEND" || fail=1

if [ "$fail" -ne 0 ]; then
  echo "RESULT: F82/F83 regression gate FAILED."
  exit 1
else
  echo "RESULT: F82/F83 regression gate holds."
  exit 0
fi
