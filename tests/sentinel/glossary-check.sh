#!/usr/bin/env bash
# Sentinel regression gate — Glossary (/glossary) + Resources menu rename
# (commit 7ac23f7). Not a full Layer A/Playwright suite (none exists in this
# repo — documented gap; playwright.config.ts targets a deployed URL and this
# repo's node cannot run a local Next 16 dev server). This is the mechanical
# half: extractor-vs-source fidelity (verified with an INDEPENDENT XML reader,
# not scripts/build-glossary.mjs's own code path), determinism, no member-
# linkable data in the generated JSON, no chain/wallet reachability from the
# page, and nav reachability of /glossary, /twelve, and /onboarding.
#
# Do not weaken this script to make a round pass (Sentinel spec §4).

set -uo pipefail
cd "$(dirname "$0")/../.."
fail=0

echo "=== Glossary regression gate ==="

check() { # name, exit-code
  if [ "$2" -eq 0 ]; then echo "✔ pass — $1"; else echo "✘ FAIL — $1"; fail=1; fi
}

# ---- 1. Extractor fidelity: independent Python XML reader, not the JS build
#         script's own code, re-derives the entry count from the raw xlsx and
#         checks it against frontend/public/glossary.json's own count field.
python3 - <<'PY'
import zipfile, sys
from xml.etree import ElementTree as ET
import json

z = zipfile.ZipFile('glossary/glossary_v1.xlsx')
ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
ss = ET.fromstring(z.read('xl/sharedStrings.xml'))
strings = [''.join((t.text or '') for t in si.findall('.//m:t', ns)) for si in ss.findall('m:si', ns)]
root = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))  # Glossary sheet
rows = []
for row in root.findall('.//m:row', ns):
    cells = []
    for c in row.findall('m:c', ns):
        t, v, isr = c.get('t'), c.find('m:v', ns), c.find('m:is', ns)
        if t == 's' and v is not None:
            val = strings[int(v.text)]
        elif t == 'inlineStr' and isr is not None:
            val = ''.join((tt.text or '') for tt in isr.findall('.//m:t', ns))
        elif v is not None:
            val = v.text
        else:
            val = ''
        cells.append(val)
    rows.append(cells)
header = [h.lower().strip() for h in rows[0]]
iw, ie = header.index('words'), header.index('explanation')
n_word = sum(1 for r in rows[1:] if (r[iw] if len(r) > iw else '').strip())
n_blank = sum(1 for r in rows[1:] if not (r[iw] if len(r) > iw else '').strip() and not (r[ie] if len(r) > ie else '').strip())
n_expl_no_word = sum(1 for r in rows[1:] if not (r[iw] if len(r) > iw else '').strip() and (r[ie] if len(r) > ie else '').strip())
built = json.load(open('frontend/public/glossary.json'))
sys.exit(0 if (n_word == built['count'] == len(built['entries']) and n_expl_no_word == 0) else 1)
PY
check "independent xlsx re-derivation matches glossary.json count (342, 0 explanation-with-no-term rows lost)" $?

# ---- 2. Determinism: regenerating from the committed xlsx must reproduce the
#         committed JSON byte-for-byte (no silent drift between source and
#         generated artifact).
node scripts/build-glossary.mjs >/dev/null 2>&1
git diff --quiet -- frontend/public/glossary.json
check "regenerating glossary.json from the xlsx is byte-identical to the committed file" $?

# ---- 3. No duplicate terms (React key `key={e.word}` / anchor id collision
#         guard, and a signal the extractor did not merge/mangle rows).
node -e '
const d = require("./frontend/public/glossary.json");
const words = d.entries.map((e) => e.word);
process.exit(new Set(words).size === words.length ? 0 : 1);
'
check "no duplicate glossary terms" $?

# ---- 4. No member-linkable / scoring field ever enters glossary.json (only
#         the documented content shape: word, explanation, tags, related).
node -e '
const d = require("./frontend/public/glossary.json");
const allowedTop = new Set(["_comment", "source", "count", "legend", "entries"]);
const allowedEntry = new Set(["word", "explanation", "tags", "related"]);
const bad = /wallet|address|pubkey|commitment|nullifier|sponsor|member_id|score|rank|karma|tier|badge/i;
let ok = true;
for (const k of Object.keys(d)) if (!allowedTop.has(k)) ok = false;
for (const e of d.entries) for (const k of Object.keys(e)) if (!allowedEntry.has(k)) ok = false;
for (const k of Object.keys(d)) if (bad.test(k)) ok = false;
for (const e of d.entries) for (const k of Object.keys(e)) if (bad.test(k)) ok = false;
process.exit(ok ? 0 : 1);
'
check "glossary.json has only the documented content shape, no member-linkable/scoring field name" $?

# ---- 5. Privacy: the glossary page makes no chain/wallet call and fetches
#         exactly one static file (no per-term network request that would let
#         a server infer which term a visitor looked up).
! grep -v '^\s*//' frontend/app/glossary/page.tsx | grep -qiE 'wallet|anchor|web3|@solana|useConnection|publickey|keypair'
check "no wallet/chain import or call in frontend/app/glossary/page.tsx (code only, not the file's own privacy-comment prose)" $?
[ "$(grep -c 'fetch(' frontend/app/glossary/page.tsx)" = "1" ] && grep -q 'fetch("/glossary.json")' frontend/app/glossary/page.tsx
check "glossary page issues exactly one fetch, of the static bulk /glossary.json (no per-term requests)" $?

# ---- 6. Reachability: /glossary, /twelve (menu-label link), /onboarding all
#         reachable from Nav.tsx regardless of connect state (the two gaps a
#         prior round explicitly closed).
grep -q 'href="/glossary"' frontend/components/Nav.tsx
check "/glossary linked from Nav.tsx" $?
grep -q 'href="/twelve"' frontend/components/Nav.tsx
check "/twelve still reachable via the Resources menu label link" $?
grep -q 'href="/onboarding"' frontend/components/Nav.tsx
check "/onboarding reachable from Nav.tsx (closes the nav-menu round's warning)" $?

# ---- 7. i18n: the 17 new/changed keys (nav.resources, nav.glossary, 14
#         glossary.* keys, and the tl nav.mobileApp fix) resolve in all 19
#         locales via the real translate() resolution chain, and none of the
#         NEW keys is byte-identical to English outside of "en" itself.
node -e '
const fs = require("fs");
const src = fs.readFileSync("frontend/lib/i18n.ts", "utf8");
const locales = ["en","fr","es","se","th","hi","zh","de","sv","nb","da","ar","lo","dz","bo","my","vi","tl","qu"];
const DICT = {};
for (const loc of locales) {
  const m = src.match(new RegExp("const " + loc + ":[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};"));
  if (!m) { console.error("no curated block for", loc); process.exit(1); }
  fs.writeFileSync("/tmp/.sentinel-glossary-cur-" + loc + ".js", "module.exports = {" + m[1] + "};");
  DICT[loc] = require("/tmp/.sentinel-glossary-cur-" + loc + ".js");
}
const gsrc = fs.readFileSync("frontend/lib/i18n.generated.ts", "utf8");
const gi = gsrc.indexOf("export const PAGE_STRINGS");
fs.writeFileSync("/tmp/.sentinel-glossary-ps.js", gsrc.slice(gi).replace(/^export const PAGE_STRINGS[^=]*=\s*/, "module.exports = "));
const PS = require("/tmp/.sentinel-glossary-ps.js");
const translate = (lang, key) => DICT[lang]?.[key] ?? PS[lang]?.[key] ?? DICT.en[key] ?? PS.en?.[key] ?? key;
const newKeys = ["nav.resources","nav.glossary","glossary.title","glossary.lede","glossary.loading","glossary.failed","glossary.searchLabel","glossary.searchPlaceholder","glossary.byStep","glossary.byTradition","glossary.byLetter","glossary.terms","glossary.clear","glossary.noResults","glossary.noResultsHint","glossary.relatedTo","glossary.sourceNote"];
let ok = true;
for (const loc of locales) for (const k of newKeys) {
  const v = translate(loc, k);
  if (v === k) { console.error("UNRESOLVED", loc, k); ok = false; }
  if (loc !== "en" && v === translate("en", k)) { console.error("EN-IDENTICAL", loc, k); ok = false; }
}
if (translate("tl", "nav.mobileApp") === translate("en", "nav.mobileApp")) { console.error("tl nav.mobileApp still English-identical"); ok = false; }
process.exit(ok ? 0 : 1);
'
check "17 new/changed keys resolve in all 19 locales, none an English copy (incl. the tl nav.mobileApp fix)" $?

echo
if [ "$fail" -eq 0 ]; then
  echo "RESULT: all glossary regression-gate checks pass."
else
  echo "RESULT: FAIL — see ✘ lines above."
fi
exit $fail
