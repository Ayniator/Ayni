# Non-Regression Report — 2026-08-14 — Round glossary

**Verdict: PASS WITH WARNINGS**

**Scope:** two commits, named per the round brief so the push gate clears:

1. `7ac23f7` "feat(glossary): searchable/browsable Glossary page under a
   renamed Resources menu" — the real subject of this round. Touches
   `frontend/app/glossary/page.tsx` (new), `scripts/build-glossary.mjs`
   (new), `frontend/public/glossary.json` (new, generated), plus
   `frontend/components/Nav.tsx`, `frontend/app/globals.css`,
   `frontend/lib/i18n.ts`, `frontend/lib/i18n.generated.ts`.
2. `98e26c9` "chore: add empty glossary/ directory" — a **local duplicate**
   of `ba9b088` (already on `origin/solana`). Same single file
   `glossary/.gitkeep`, same blob (`5af0946`), same two comment lines, same
   author/timestamp. Exists because the branch was merged rather than
   rebased, deliberately, to avoid rewriting `5386650` while a prior round
   was reviewing that SHA. **Confirmed inert** (see below); named here only
   so the push gate clears, no further effort spent on it.

At round start, HEAD was `bfe8348` (6 commits ahead of `origin/solana` at
`9c4c724`). `programs/ayni/src/*` carried **9 files of uncommitted governance
work-in-progress**, disclosed up front, out of scope, and confirmed untouched
by `7ac23f7` (`git show --stat 7ac23f7` touches none of those paths). **`anchor
test` was deliberately not run** — it would exercise that unreviewed WIP, not
the committed state under review, so no anchor pass/fail count appears in this
report; that is a scoping decision, not an omission. Previous baseline:
`reports/sentinel/NRR-2026-08-14-nav-menu.md` (PASS WITH WARNINGS, commit
`5386650`, same day).

## Summary table

| Layer | Tests | Pass | Fail | New since last round |
|-------|------:|-----:|-----:|---------------------|
| E — Build health | tsc, next build (Node 20), i18n-key-check, privacy-sweep | 4 | 0 | next build re-run with Node 20 this round |
| B — API contract | n/a (no API/endpoint touched by this commit) | — | — | — |
| C — Proof layer / contracts | anchor test deliberately not run (scope note above) | — | — | — |
| A — UX / e2e | glossary-check.sh (source/data-level substitute, 10 sub-checks) | 10 | 0 | glossary-check.sh (new) |
| D — Privacy invariants | privacy-sweep.sh + manual glossary.json/network review | 5 + manual | 0 | manual glossary-specific privacy review (new) |
| i18n | 17 new/changed keys × 19 locales via real translate() chain | 323 | 0 | new key set (new) |

## Commit 2 (`98e26c9`) — confirmed inert

```
git diff --exit-code 98e26c9 ba9b088 -- glossary/.gitkeep   # exit 0, no output
```

Both commits add the identical blob to the identical path with identical
content. The merged tree contains exactly one `glossary/.gitkeep`. Nothing
further reviewed, as instructed.

## The extractor — verified against the spreadsheet, not against its own output

This is the load-bearing part of the round, so it was checked with a
from-scratch, independent tool, not by re-reading `scripts/build-glossary.mjs`
and trusting it.

- **Entry count.** Wrote a second, independent XML reader in Python
  (`zipfile` + `xml.etree`, no relation to the Node script's hand-rolled
  zip/inflate/regex approach) directly against `glossary/glossary_v1.xlsx`.
  Result: **342** rows with a non-blank `words` cell, **0** blank spacer
  rows, **0** "explanation with no term" rows (the case the script's own
  comment says it drops "loudly" — there were none to drop this round).
  `frontend/public/glossary.json`'s own `count` field and `entries.length`
  both equal 342, exactly matching. **Nothing was silently dropped.**
- **Determinism.** Ran `node scripts/build-glossary.mjs` against the
  committed `glossary/glossary_v1.xlsx` and diffed the result against the
  committed `frontend/public/glossary.json`: **byte-identical**
  (`git diff --quiet`, no output). No drift between source and generated
  artifact.
- **Header-name matching, not position.** Read `col()`'s implementation:
  it looks up `header.indexOf(name)`, never a fixed column index. Confirmed
  against the real workbook, which has **three** sheets (`Glossary`,
  `Index`, `Tag legend`) — the script selects `Glossary` by name via
  `workbook.xml` + `.rels`, not by sheet order, so a column reorder or an
  extra sheet cannot silently shift the data.

## JSON/spreadsheet fidelity — unescape order

The comment in `unescapeXml` claims `&amp;` is undone **last**, so a
doubly-escaped `&amp;lt;` cannot wrongly become `<`. Verified two ways:

1. Read the code: five entity replacements (`&lt;`, `&gt;`, `&quot;`,
   `&apos;`, numeric/hex entities) happen before the final `.replace(/&amp;/g,
   "&")`.
2. Isolated Node repro of the exact function:
   `unescapeXml("&amp;lt;script&amp;gt;")` → `"&lt;script&gt;"` (**not**
   `"<script>"`); `unescapeXml("R&amp;D — café ’twas")` →
   `"R&D — café ’twas"`. **The claim holds.**

Spot-checked real entries against the raw sheet XML for curly
quotes/apostrophes/em-dashes/accents: "Assumption" (curly apostrophe in
"the other's personality"), "Contact Treatments" (nested curly double-quotes
around "Rosicrucian contact treatment"), "The Morrígan" (accented í), and the
Sacred-Number entries ("1 — One (the Monad)" etc., em-dashes) — all render
correctly in `frontend/public/glossary.json`. **No literal `&` character
exists anywhere in the source xlsx's shared strings** (grep count 0), so the
ordering fix is currently dead in practice on this dataset, but is correct
and load-bearing for future spreadsheet edits.

No duplicate `word` values (342 unique of 342) — rules out a
React-key/anchor-id collision from `key={e.word}` /
`id="t-${encodeURIComponent(e.word)}"` in `page.tsx`.

## Privacy — the important one

- **The page's only network call, in code, is one static fetch.**
  `frontend/app/glossary/page.tsx` calls `fetch("/glossary.json")` exactly
  once, on mount. Grepping the file's **code** (its own explanatory comment
  line — "no chain call, no wallet, no member data" — is prose, and grepping
  it naively produced a false-positive "wallet" hit on first pass, corrected
  by excluding comment lines) for `wallet|anchor|web3|@solana|useConnection|
  publicKey|keypair` returns nothing. `scripts/build-glossary.mjs` (a
  build-time-only tool, not runtime code) has no network import either.
- **No per-term request.** The entire 342-entry payload is fetched once and
  filtered/searched **client-side**. There is no per-term endpoint, so no
  server can observe which term a visitor looked up. This was the round
  brief's specific worry ("could the fetched file itself become a side
  channel, e.g. per-term requests") — judged and confirmed not the case: it
  is one bulk static file, always fetched in full regardless of what a
  visitor searches for.
- **Nothing about a visit is recorded.** No `localStorage`/`sessionStorage`
  write, no analytics, no `console.*` of anything read. `?q=` deep links are
  read **from the URL the visitor already has** (their own bookmark/share),
  not sent anywhere.
- **No member data in `glossary.json`.** Its shape is exactly
  `{_comment, source, count, legend, entries[{word, explanation, tags,
  related}]}` — verified programmatically that no other top-level or
  per-entry key exists, and no key name matches
  `wallet|address|pubkey|commitment|nullifier|sponsor|member_id|score|rank|
  karma|tier|badge`. Grepped the JSON body itself for base58-looking wallet
  addresses: none found (two "address" prose hits are the word "addressed"
  in unrelated deity-invocation explanations, not a field).
- `tests/sentinel/privacy-sweep.sh`: **5/5 pass** (analytics/telemetry,
  tracking pixels, program log macros, `console.*` of identity material,
  score/rank/karma field names) — unaffected by this commit, reproduced.

**Conclusion: no chain call, no wallet access, no network request beyond the
one static `/glossary.json` fetch, and nothing about a visit is recorded.**
This holds even though the glossary's own content is public — a page that
phoned home about which terms a member reads would have been a real
member-behaviour privacy regression, and this one does not.

## i18n — 16/17 new or changed keys, all 19 locales

The commit message says "16 new keys"; the actual diff introduces **17**
distinct key names (`nav.resources`, `nav.glossary`, and 15 `glossary.*`
keys — the count discrepancy is off by one from the commit's own tally, not
a functional problem, noted for accuracy) plus the previously-flagged fix to
`nav.mobileApp` for `tl`.

Wrote an independent checker against the **actual `translate()` resolution
chain** read from `frontend/lib/i18n.ts` (`DICT[lang] ?? PAGE_STRINGS[lang]
?? DICT.en ?? PAGE_STRINGS.en ?? key`), not a naive per-file key scan:

- All 17 keys resolve in all 19 locales (en fr es se th hi zh de sv nb da ar
  lo dz bo my vi tl qu). **0 unresolved.**
- **0** non-English locale is byte-identical to English for any of the 17
  new keys.
- `tl` `nav.mobileApp` confirmed now `"App sa Mobile"` (was `"Mobile App"`,
  byte-identical to English, flagged by the nav-menu round). `de`
  `nav.mobileApp` is **unchanged**, still `"Mobile App"` — that round's
  judgment (plausibly correct native German, "App" being a standard
  loanword) stands untouched by this commit.
- `tests/sentinel/i18n-key-check.sh`: **PASS, 1051 keys**, matching the
  commit's own claim, reproduced independently.

**Judgment calls on the author's four lowest-confidence locales:**

- **se (Northern Sámi):** all 17 strings are genuinely distinct, script-
  appropriate Latin-with-diacritics Sámi text (á/š/đ), no leakage from
  Norwegian/Swedish/English. No red flag.
- **dz (Dzongkha) / bo (Tibetan):** 16 of the 17 checked strings are
  genuinely distinct between the two Tibetan-script locales (not a
  copy-paste — a real risk class since they share a script). **One
  exception:** `nav.resources` is byte-identical between dz and bo
  (`ཐོན་ཁུངས།`). Checked whether this is a tell: compared the **full**
  pre-existing curated dz/bo overlap and found dz and bo already share 6 of
  14 pre-existing short common-noun keys byte-for-byte (`nav.documents`,
  `nav.board`, `footer.line`, `ctl.language`, both theme-toggle words) —
  closely related Tibetic languages sharing a short common noun is the
  **existing norm** in this dictionary, not a new anomaly. `nav.resources`
  fits that established pattern rather than standing out from it. Not
  scored as a defect at the confidence a non-native mechanical review can
  reach.
- **qu (Quechua):** `"Yanapaqkuna"` / `"Simi qullqa"` etc. — grammatically
  parseable, stylistically consistent with the rest of the qu dictionary's
  Spanish-loanword code-switching. No red flag.
- Sentinel is **not** a certified fluent speaker of Dzongkha, Tibetan,
  Quechua, or Northern Sámi. No structural defect found in any of the four;
  a native-speaker pass is still recommended before closing this fully
  (carried-forward posture, unchanged from the nav-menu round).

**tl "App sa Mobile" idiom check (specifically requested):** grammatically
"App for/on Mobile" using the Tagalog locative particle "sa" — a genuine
Tagalog construction, not a straight copy, and consistent with this dict's
pattern of code-switched but grammatically-Filipino tech phrasing elsewhere
in the tl block. Reasonable fix.

## Reachability

- `/glossary`: `Nav.tsx` has `href="/glossary"` inside the (always rendered,
  not connect-gated) Resources dropdown. Reachable.
- `/twelve`: the Resources menu **label itself** is `<Link href="/twelve"
  className="nav-menu-btn" ...>` — clicking the label (not just opening the
  dropdown) lands on `/twelve` directly, exactly as before the rename.
  Reachable.
- `/onboarding`: `href="/onboarding"` now present in the Resources dropdown,
  unconditionally (not gated on connect state) — closes the nav-menu round's
  WARNING that connected members had no in-app path back to it.
- None of the three new links are wrapped in the `{connected && ...}` /
  `{!connected && ...}` gates that already exist for My Circle/Documents/
  Board/Start Here elsewhere in `Nav.tsx` — confirmed by reading the diff;
  this commit does not touch that existing gating logic at all.

## Build health

- `cd frontend && npx tsc --noEmit` — clean, reproduced.
- `PATH=/home/alkia/.local/node-v20.18.1-linux-x64/bin:$PATH npm run build`
  (Node 20, as instructed) — **succeeds**, reproduced. Route table shows
  `○ /glossary` prerendered as static content, matching the commit's claim.
  Confirmed the 167 KB glossary payload does **not** enter the JS bundle:
  grepping a known glossary string (`"1 — One (the Monad)"`) across the
  entire `.next` build output returns nothing; the `/glossary` page's own
  chunk is ~6 KB. The `web-worker`/`circomlibjs` webpack warning present in
  the build output is **pre-existing** (unrelated dependency chain via
  `lib/zk-vote.ts` → `app/me/page.tsx`), not introduced by this commit.
- `bash tests/sentinel/i18n-key-check.sh` — **PASS, 1051/1051**, reproduced.
- `bash tests/sentinel/privacy-sweep.sh` — **5/5 pass**, reproduced.
- `bash tests/sentinel/glossary-check.sh` (**new this round**) — **10/10
  pass**, see Coverage section below.
- No new dependency: `git show --stat 7ac23f7` touches no `package.json` or
  lockfile in the repo root or `frontend/`. `npm audit` not re-run (nothing
  changed to re-run against).

## Layer A (Playwright) — could not validate the actual reviewed commit

Same structural blocker as every round since nav-menu: `playwright.config.ts`
targets a deployed URL by design, and this repo's Node (`v18.20.5` as the
ambient interpreter) cannot run `next dev`/`next build` under Next 16 without
the pinned Node 20 install. This round *did* run a real Node-20 `next build`
(see Build health above), which is new positive evidence the app compiles and
prerenders correctly, but that is not a substitute for a real browser session
exercising search/facets/A-Z index/deep-links/related-to chips against a
running instance. Source-level and data-level verification (above) substitutes
for this round; the gap is disclosed below, not silently passed off as e2e
coverage.

## Layer C (anchor/contracts) — deliberately not run

`7ac23f7` touches zero program/circuit/IDL files. Running `anchor test`
against the current working tree would only exercise the **9 uncommitted,
disclosed governance WIP files** in `programs/ayni/src/*`, not reviewed code
— reporting a pass/fail count from that run would silently describe
unreviewed code. Skipped deliberately, per the round's own instruction.

## Privacy-invariant status (Layer D)

Full adversarial database-dump suite was not re-run (out of proportion — no
data model, storage, chain, or crypto path changed; the feature is a static
public reference page). Checked what applies to this diff, plus the specific
faucet-adjacent seventh assertion:

1. Sponsor identity / sponsor→member edge — n/a, not touched. ✔
2. Trust list / chosen-ones list — n/a, not touched. ✔
3. Message content/metadata — n/a, not touched. ✔
4. Biometric material — n/a, not touched. ✔
5. Circle roster — n/a, not touched. ✔
6. Hidden-content detectability — n/a, not touched. ✔
7. Faucet parrain→neophyte link — n/a, not touched. ✔

Additionally, and specifically for this round's own brief: **no member-
behaviour side channel** — no chain call, no wallet access, no per-term
network request, nothing about a visit recorded. Verified above, not merely
asserted. ✔

`privacy-sweep.sh`: **5/5 pass** (reproduced).

## Traditions check (rank/compare/aggregate/name-a-sponsor/leak-a-relationship)

**None found ✔.** This commit is a public reference-material browser (a
glossary of terms) and a nav-label rename. It ranks, names, or compares
nothing about a member, sponsor, or relationship. `glossary.json`'s per-entry
fields (`word`, `explanation`, `tags`, `related`) describe vocabulary, not
people.

## Baseline changes this round

None. No file under `tests/sentinel/baselines/` was touched.

## New feature coverage (added this round, per spec §4)

`tests/sentinel/checklist.yaml` gained a `round: glossary` feature entry with
a `checks:` block, every line of which was executed and confirmed to return
its intended exit status **before** being committed to the file:

```
bash tests/sentinel/glossary-check.sh        # exit 0 (10/10 sub-checks pass)
bash tests/sentinel/i18n-key-check.sh        # exit 0 (PASS 1051)
bash tests/sentinel/privacy-sweep.sh         # exit 0 (5/5)
cd frontend && npx tsc --noEmit              # exit 0
git diff --exit-code 98e26c9 ba9b088 -- glossary/.gitkeep   # exit 0 (inert)
```

`tests/sentinel/glossary-check.sh` is new this round. It independently
re-derives the entry count from the raw xlsx (a second XML reader, not
`build-glossary.mjs`'s own code), checks byte-identical regeneration
(determinism), checks for duplicate terms, checks `glossary.json`'s shape
against an explicit allow-list of top-level/per-entry keys plus a
member-linkable/scoring-field-name deny-list, checks the glossary page's
code (not its comments) for wallet/chain imports and confirms exactly one
`fetch()` call targeting the static bulk file, checks `Nav.tsx` for the
three reachability links, and checks all 17 new/changed i18n keys resolve
correctly in all 19 locales via the real resolution chain.

## Regressions

**None found.** No previously-working behavior was broken by this commit
(`/twelve`, `/twelve-steps`, `/twelve-traditions` unchanged and reachable;
the connect-state gating on My Circle/Documents/Board/Start Here from the
prior round is untouched; `nav.mobileApp` for every locale except `tl`, which
was an intentional, requested fix, is unchanged).

## Findings (non-blocking)

- **INFORMATIONAL — spreadsheet content quality, not a build defect.** The
  extractor faithfully reproduces two pre-existing inconsistencies in
  `glossary_v1.xlsx`: the tag `"Budhism"` (used once, on the "Karma" entry)
  is a misspelling distinct from `"Buddhism"` (used on six other entries),
  and `"Freemassonery"` misspells "Freemasonry". Because `/glossary`'s
  tradition facets are exact-string matches, this currently renders as two
  separate, near-duplicate tradition chips (`Buddhism` and `Budhism`) rather
  than one merged tradition. **Not a script bug** — a column-reorder-proof,
  byte-faithful extractor should not silently "fix" spreadsheet typos on its
  own authority; this is the spreadsheet author's fix to make (correct the
  two tags in `glossary_v1.xlsx`, re-run `build-glossary.mjs`), not
  Sentinel's or the extractor's. Reproduction:
  `node -e 'const d=require("./frontend/public/glossary.json");
  console.log(d.entries.filter(e => e.tags.includes("Budhism")).map(e =>
  e.word))'` → `["Karma"]`.
- **INFORMATIONAL — content note, not a defect.** The spreadsheet's `Index`
  sheet (27 rows, intentionally not loaded by the build script — it is a
  maintainer's note, not glossary data) lists terms defined **inside**
  another term's entry rather than as their own row (e.g. "Nucleus" is
  explained inside "Cell"). 26 of the Glossary sheet's own `related to`
  values point at a word with no entry of its own for the same reason. The
  page's "related to" chips do not break on this: clicking one re-runs the
  existing substring search across word/explanation/tags, which in every
  case checked still surfaces the parent entry, because the sub-term is
  mentioned inside its explanation text (e.g. searching "Nucleus" finds
  "Cell", whose explanation literally contains the word "nucleus") —
  graceful degradation, not a dead link.
- **Off-by-one in the commit's own key count claim.** The commit message
  says "16 new keys"; the actual diff introduces 17 distinct key names
  (`nav.resources`, `nav.glossary`, 15 `glossary.*` keys). Cosmetic, does
  not affect correctness — every one of the 17 was individually verified.

## Coverage gaps

- **NEW (this feature):** no Playwright/e2e test exercises `/glossary`
  (search, facets, A-Z index, `?q=` deep link, related-to chips) or the
  renamed Resources menu in a real browser — same structural blocker as
  every round this month. `tests/sentinel/glossary-check.sh` (added this
  round) substitutes source/data-level verification; tracked to close once
  the commit is deployed and a real e2e run is possible.
- **STILL OPEN, now spanning two rounds unresolved** (first flagged in the
  nav-menu round, same day): no `BACKLOG.md`/`docs/shipped.md` F-number
  entry exists for **either** the nav-menu commit (`5386650`) or this
  round's glossary commit (`7ac23f7`). `git log -1 --format=%cd -- docs/
  shipped.md BACKLOG.md` shows both files last touched **2026-08-13**,
  predating both features. Read narrowly, spec §4's "WARNING in round n,
  FAIL in round n+1" rule concerns **Sentinel test coverage** (which this
  round does add, via `glossary-check.sh` and the new `checklist.yaml`
  entry), not docs/BACKLOG bookkeeping specifically — CLAUDE.md separately
  requires `docs/shipped.md`/`BACKLOG.md` be reconciled "in the same commit
  as the change," which neither commit did. Scored as a **WARNING again this
  round** on that narrower reading, but flagged explicitly: **this is now at
  the edge of either reading of the rule** — if `docs/shipped.md` and
  `BACKLOG.md` still lack entries for both features next round, that becomes
  FAIL-eligible regardless of which reading is used.
- **STILL OPEN:** no automated (repo-resident, executable) T6
  endorsement-check script exists (carried forward, first flagged f67 round,
  2026-08-14).
- **STILL OPEN:** wallet-list shuffle fairness has no persisted automated
  test (carried forward unchanged from 2026-08-12).
- **STILL OPEN:** `/settings-security` page-body localisation gap (carried
  forward unchanged from f67-r2 round).

## Verdict rationale

This round reviewed a new public reference page — a searchable glossary of
342 terms — and confirmed the part most likely to hide a real bug: the tool
that turns a spreadsheet into the data the page reads. I built a second,
completely independent reader of the spreadsheet from scratch (not by
re-reading the project's own extraction script) and it agrees exactly: 342
terms, nothing dropped, nothing miscounted, and a specific trap about how
special characters like "&" get decoded (getting the order wrong can turn
harmless text into something that looks like computer code) is handled
correctly, verified by direct experiment rather than by reading the comment
that claims it. The privacy question mattered most here: a "reference page"
sounds harmless, but if it quietly reported back which words a visitor
looked up, that would itself be a real privacy problem even though the words
themselves are public. I checked and confirmed the page fetches one file,
once, and nothing about what a visitor reads or searches ever leaves their
own browser. All sixteen — actually seventeen, the commit undercounted by
one — new translated phrases were checked in all nineteen languages the app
supports, including the four the author was least sure about; all read as
plausible, and the one previously-flagged English-leftover in Tagalog is now
genuinely translated. Two small, honest imperfections exist in the underlying
spreadsheet itself (a duplicated tag with a typo, and 26 cross-references that
point at sub-terms folded into a parent entry rather than their own row) —
neither is a bug in the code, both are cosmetic, and I said so rather than
either hiding them or overstating them as regressions. The one commit that
existed only to satisfy the push gate (an empty placeholder folder, submitted
twice due to a deliberate merge) was checked and is exactly as harmless as it
looks. Nothing here rises to a privacy leak, a broken feature, or a Tradition
violation, so this passes. It carries warnings forward rather than a clean
pass because a real browser test still cannot be run against this exact code
in this environment (same structural limitation as recent rounds, not new to
this one), and because the project's own paperwork — the list of shipped
features — has now gone two rounds without being updated for either this
change or the one before it, which is worth the team's attention before it
tips into a hard failure next time.
