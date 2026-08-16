#!/usr/bin/env bash
# Sentinel regression gate — F92 (/create eligibility gate: sponsor validation
# + rent) and F93 (/get-app install page + platform-aware nav entry).
#
# Closes the coverage gap raised as a WARNING in
# reports/sentinel/NRR-2026-08-12-f60-f61-verify.md ("F92/F93 shipped in
# dbd1719 with no dedicated Sentinel test entry ... becomes a FAIL next round").
#
# Mechanical half only — there is no Playwright suite in this repo (documented
# gap). What is asserted here is what can go silently wrong without a browser:
# the two gates' fail-closed/fail-open directions inverting, the wizard being
# rendered to an ineligible member anyway, and /get-app growing a store-
# availability claim that is not true.
#
# Do not weaken this script to make a round pass (Sentinel spec §4).

set -uo pipefail
cd "$(dirname "$0")/../.."
FRONTEND="frontend"
fail=0

echo "=== F92/F93 regression gate ==="

# ---- F92: the sponsor gate must fail CLOSED --------------------------------
# The governance consequence is the point: founding a Circle seats the creator
# on a 7-seat Council, so "we could not establish that this member is confirmed"
# must deny, never allow.
node -e '
const fs = require("fs");
const src = fs.readFileSync(process.argv[1] + "/lib/createGate.ts", "utf8");
let bad = [];

// The provisional-marker lookup: absent marker ⇒ confirmed member.
if (!/getMultipleAccountsInfo/.test(src)) bad.push("no getMultipleAccountsInfo lookup of provisional markers");
if (!/provisionalPda/.test(src)) bad.push("does not derive the ProvisionalMember marker PDA");

// Fail CLOSED: when the RPC gives no answer, validated must become false.
const m = src.match(/validated\s*=\s*infos\s*\?([^;]*):([^;]*);/s);
if (!m) {
  bad.push("the fail-closed ternary on `validated` is gone or was rewritten");
} else {
  const whenNoAnswer = m[2].trim();
  if (!/^false$/.test(whenNoAnswer)) bad.push("sponsor check no longer fails CLOSED on RPC error (got: " + whenNoAnswer + ")");
  if (!/some\(/.test(m[1])) bad.push("confirmed-member test is no longer `some(info === null)`");
}

// ok must require BOTH gates.
if (!/ok:\s*validated\s*&&\s*funded/.test(src)) bad.push("`ok` no longer requires validated && funded");

if (bad.length) { console.error("FAIL — F92 sponsor gate:"); for (const b of bad) console.error("  - " + b); process.exit(1); }
console.log("PASS — F92 sponsor gate fails closed and gates on a confirmed (non-provisional) membership.");
' "$FRONTEND" || fail=1

# ---- F92: the funding gate must fail OPEN and use real rent ----------------
node -e '
const fs = require("fs");
const src = fs.readFileSync(process.argv[1] + "/lib/createGate.ts", "utf8");
let bad = [];

if (!/getMinimumBalanceForRentExemption/.test(src)) bad.push("rent is not read from the cluster");
if (!/CIRCLE_SPACE/.test(src) || !/MEMBER_TREE_SPACE/.test(src)) bad.push("both PDA sizes are no longer accounted for");
// Fail OPEN: an unreachable RPC must not lock a funded member out.
if (!/catch\s*\{[^}]*funded\s*=\s*true/s.test(src)) bad.push("funding check no longer fails OPEN on RPC error");

// The mirrored space constants must still match programs/ayni/src/state.rs.
const COUNCIL_SEATS = 7, MAX_DEPTH = 20;
const expectCircle = 8 + 32 + (32 * COUNCIL_SEATS + 1 + 8) + 8 + 8 + 1 + 32 + 32 + (4 + 32) + 1;
const expectTree = 8 + 32 + 1 + 8 + 32 + 32 * MAX_DEPTH + 1;
const evalConst = (name) => {
  const m = src.match(new RegExp("export const " + name + "\\s*=\\s*([^;]+);", "s"));
  if (!m) return null;
  return Function("COUNCIL_SEATS", "MERKLE_MAX_DEPTH", "return (" + m[1] + ");")(COUNCIL_SEATS, MAX_DEPTH);
};
const gotCircle = evalConst("CIRCLE_SPACE"), gotTree = evalConst("MEMBER_TREE_SPACE");
if (gotCircle !== expectCircle) bad.push("CIRCLE_SPACE drifted from state.rs (" + gotCircle + " vs " + expectCircle + ")");
if (gotTree !== expectTree) bad.push("MEMBER_TREE_SPACE drifted from state.rs (" + gotTree + " vs " + expectTree + ")");

if (bad.length) { console.error("FAIL — F92 funding gate:"); for (const b of bad) console.error("  - " + b); process.exit(1); }
console.log("PASS — F92 funding gate fails open, reads real rent, and its space constants match state.rs.");
' "$FRONTEND" || fail=1

# ---- F92: the wizard must not render behind the block ----------------------
node -e '
const fs = require("fs");
const src = fs.readFileSync(process.argv[1] + "/app/create/page.tsx", "utf8");
let bad = [];
if (!/checkCreateEligibility/.test(src)) bad.push("the create page no longer calls the gate");
// The block must RETURN, not merely overlay — otherwise a half-fillable form
// sits behind the popup.
if (!/if\s*\(blocked\)\s*\{\s*[\s\S]{0,400}?return\s*\(/.test(src)) bad.push("blocked state no longer returns early (form may render behind the popup)");
// The two reasons must stay distinct.
if (!/create\.gate\.sponsorTitle/.test(src) || !/create\.gate\.fundsTitle/.test(src)) bad.push("the two block reasons are no longer distinguished");
if (bad.length) { console.error("FAIL — F92 create page:"); for (const b of bad) console.error("  - " + b); process.exit(1); }
console.log("PASS — F92 blocks by replacing the wizard, and names which gate closed.");
' "$FRONTEND" || fail=1

# ---- F93: /get-app must not overclaim availability -------------------------
# The one way this page goes bad is by growing a store badge or a "download on
# the App Store" link when neither listing exists and the iOS archive is
# unsigned. Assert the disclosure survives and no store URL appears.
node -e '
const fs = require("fs");
const raw = fs.readFileSync(process.argv[1] + "/app/get-app/page.tsx", "utf8");
// The page BODY was i18n-extracted (F93 debt closed): the disclosures now live
// in the ENGLISH block of the generated dictionary, not in the JSX. So the
// prose assertions read the dictionary; the store-URL check still reads the
// page (a link would be added there). Only the en block is sliced — a
// translated disclosure drifting is a translation-review problem, but the
// ENGLISH one disappearing means the disclosure itself was dropped.
const dict = fs.readFileSync(process.argv[1] + "/lib/i18n.generated.ts", "utf8");
const enStart = dict.indexOf("  en: {");
const enEnd = dict.indexOf("  fr: {", enStart);
const enBlock = dict.slice(enStart, enEnd);
const getapp = enBlock.split("\n").filter((l) => l.includes("\"getapp.")).join(" ");
const src = (raw + " " + getapp).replace(/<\/?strong>/g, "").replace(/[*]/g, "").replace(/\s+/g, " ");
let bad = [];

const storeLink = /https?:\/\/(play\.google\.com|apps\.apple\.com|itunes\.apple\.com|testflight\.apple\.com)/i;
if (storeLink.test(raw)) bad.push("a store/TestFlight URL appeared — no listing exists; remove it or update this gate WITH the listing");

if (!/not yet on Google Play or the App Store/i.test(src))
  bad.push("the no-store-listing disclosure is gone");
if (!/no installable build/i.test(src)) bad.push("the iOS no-installable-build disclosure is gone");
if (!/unsigned/i.test(src)) bad.push("the unsigned-archive explanation is gone");

if (bad.length) { console.error("FAIL — F93 /get-app:"); for (const b of bad) console.error("  - " + b); process.exit(1); }
console.log("PASS — F93 /get-app states the real availability and links no store listing.");
' "$FRONTEND" || fail=1

# ---- F93: platform detection is shared, cosmetic, and non-identifying ------
node -e '
const fs = require("fs");
const root = process.argv[1];
const plat = fs.readFileSync(root + "/lib/platform.ts", "utf8");
let bad = [];

// iPadOS reports a desktop Mac UA — the touch-points fallback must stay.
if (!/maxTouchPoints/.test(plat)) bad.push("iPadOS detection (maxTouchPoints) removed — iPad would be labelled Android");
// It must stay a pure read: nothing stored, nothing sent.
if (/localStorage|sessionStorage|fetch\(|navigator\.sendBeacon/.test(plat)) bad.push("platform detection now stores or transmits something");

// The wallet chooser must reorder links identically for every wallet (T6: the
// per-wallet shuffle must not be influenced by platform).
const wc = fs.readFileSync(root + "/components/WalletChooser.tsx", "utf8");
if (!/LINK_ORDER\[platform\]/.test(wc)) bad.push("wallet link ordering no longer driven by the shared LINK_ORDER table");
if (/shuffle\([^)]*platform/.test(wc)) bad.push("platform now feeds the wallet shuffle — T6 (no endorsements) violation");
if (!/Math\.random\(\)/.test(wc)) bad.push("uniform shuffle source changed");

if (bad.length) { console.error("FAIL — F93 platform detection:"); for (const b of bad) console.error("  - " + b); process.exit(1); }
console.log("PASS — F93 detection is shared, non-identifying, and does not touch the wallet shuffle.");
' "$FRONTEND" || fail=1

if [ "$fail" -ne 0 ]; then
  echo "RESULT: F92/F93 regression gate FAILED."
  exit 1
else
  echo "RESULT: F92/F93 regression gate holds."
  exit 0
fi
