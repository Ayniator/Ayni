#!/usr/bin/env bash
# Sentinel Layer A/E (F81 full-page localisation) — the mechanical half: every
# literal t("...") call site in the frontend must resolve to SOME string via
# the translate() resolution chain (curated en -> PAGE_STRINGS.en), for at
# least the English fallback. A key present in source but absent from BOTH
# dictionaries renders as the raw key string on screen — this is a REGRESSION
# GATE for exactly that failure mode (found: Round F81, the entire admin.*
# namespace, 244 keys, generated without their "admin." prefix).
#
# This is a REGRESSION GATE, not a full i18n audit: it only checks presence of
# the KEY (English fallback resolvability), not translation quality or
# non-English completeness. Exit 1 on any literal key that resolves nowhere.
#
# Do not weaken this script to make a round pass (Sentinel spec §4).

set -uo pipefail
cd "$(dirname "$0")/../.."
FRONTEND="frontend"

node -e '
const fs = require("fs");
const path = require("path");
const root = process.argv[1];

// 1. Load PAGE_STRINGS.en from the generated file (strip the TS export/type
//    annotation so it becomes a plain JS object literal we can eval).
let genSrc = fs.readFileSync(path.join(root, "lib/i18n.generated.ts"), "utf8");
const idx = genSrc.indexOf("export const PAGE_STRINGS");
genSrc = genSrc.slice(idx).replace(/^export const PAGE_STRINGS[^=]*=\s*/, "module.exports = ");
fs.writeFileSync("/tmp/.sentinel-i18n-pagestrings.js", genSrc);
delete require.cache[require.resolve("/tmp/.sentinel-i18n-pagestrings.js")];
const PAGE_STRINGS = require("/tmp/.sentinel-i18n-pagestrings.js");
const pageEnKeys = new Set(Object.keys(PAGE_STRINGS.en || {}));

// 2. Load the curated chrome `en` dict from i18n.ts.
const i18nSrc = fs.readFileSync(path.join(root, "lib/i18n.ts"), "utf8");
const enBlockMatch = i18nSrc.match(/const en: Record<string, string> = \{([\s\S]*?)\n\};/);
const curatedKeys = new Set(
  enBlockMatch ? [...enBlockMatch[1].matchAll(/"([a-zA-Z0-9_.]+)":/g)].map((m) => m[1]) : []
);
const allKeys = new Set([...pageEnKeys, ...curatedKeys]);

// 3. Known dynamic (template-literal / variable) t() call sites: enumerate the
//    concrete key values they can take. Keep this list in sync with the app —
//    a new dynamic call site must add its enumeration here or this script
//    cannot check it (documented gap, not silently skipped).
const dynamicKeys = [
  "documents.doc.twelveSteps", "documents.doc.preamble", "documents.doc.dailyReflections",
  "onboarding.hint.wallet", "onboarding.hint.vouch", "onboarding.hint.face",
  "onboarding.step.wallet", "onboarding.step.vouch", "onboarding.step.face",
  "inbox.expiry.never", "inbox.expiry.oneDay", "inbox.expiry.oneWeek", "inbox.expiry.thirtyDays",
];

// 4. Grep every literal t("...") call site across app/components/lib.
const { execSync } = require("child_process");
const grepOut = execSync(
  `grep -rohE "\\\\bt\\\\(\\\\s*\\"[a-zA-Z0-9_.]+\\\\s*\\"\\\\s*\\\\)" --include=*.tsx --include=*.ts app components lib`,
  { cwd: root, encoding: "utf8" }
);
const literalKeys = new Set(
  grepOut.split("\n").filter(Boolean).map((l) => l.replace(/^t\(\s*"/, "").replace(/"\s*\)$/, ""))
);

const allUsed = new Set([...literalKeys, ...dynamicKeys]);
const missing = [...allUsed].filter((k) => !allKeys.has(k)).sort();

if (missing.length) {
  console.error("FAIL — " + missing.length + " t() key(s) resolve to NEITHER the curated en dict NOR PAGE_STRINGS.en.");
  console.error("Each of these renders as a raw key string on screen in every locale, including English:");
  for (const k of missing) console.error("  - " + k);
  process.exit(1);
} else {
  console.log("PASS — all " + allUsed.size + " known t() key(s) (literal + enumerated dynamic) resolve to an English fallback.");
  process.exit(0);
}
' "$FRONTEND"
