PASS WITH WARNINGS

# Non-Regression Report — 2026-08-15 — Round f99-map-marker

Verdict: **PASS WITH WARNINGS**

Scope: commits `5229e23cc4afee4e9658366bd6de8ab38b67309a` (fix(F98): the karma
pair-guard was directional; a role swap paid twice) and
`758c7836b17c40f15fc573445991958c4cf82c57` (feat(F99): a bookmark pin for "You
are here", not an identicon). HEAD at round start = round end = `758c783` (4
commits ahead of `origin/solana`, unpushed). Previous baseline:
`9825320` (round `f98-karma`, PASS WITH WARNINGS — the round that found the
CRITICAL `5229e23` fixes).

No CRITICAL finding this round. The F98 fix genuinely closes the prior round's
CRITICAL (verified by independent adversarial probing and by mutation-reverting
the fix itself), and F99 held under six independent mutations plus a live,
faked-geolocation Playwright privacy probe. Two WARNINGs carry forward
(recurring docs drift; a minor missing unit test), consistent with prior
rounds' pattern.

## Summary table

| Layer | Tests | Pass | Fail | New since last round |
|---|---:|---:|---:|---|
| Build health (Rust) | `cargo test` (programs/ayni) | 42 | 0 | unchanged (0 new tests — the fix touched no new `#[test]`) |
| Karma integration (local validator) | `tests/karma.ts` | 7 | 0 | +1 (`a ROLE SWAP ... does not pay twice`) |
| Adversarial mutation (b): restore directional seed, program + client | 7 cases | 6 pass / 1 red-as-expected | — | reproduced independently, reverted, 7/7 confirmed after |
| Adversarial probe (a): PDA derivation, 3-member ring, different payer, cross-circle | 4 | 4 | 0 | new this round, scratch file, not committed |
| KarmaAward::lo/hi ordering sanity (c) | reviewed by inspection + probe (a)#1 | pass | 0 | new this round |
| Map-marker gate | `bash tests/sentinel/map-marker-check.sh` | 15 | 0 | new suite (F99) |
| Map-marker mutation (d), 6 independent mutations | 6 | 6 red-as-expected | — | reproduced independently, all reverted, `git status` clean throughout |
| i18n key-check | `bash tests/sentinel/i18n-key-check.sh` | 1081 keys | 0 | unchanged |
| Geolocation privacy probe (e) | standalone Playwright script vs deployed site | pass | 0 | new this round, not committed |
| Third-party host check (f) | curl + Playwright request log vs deployed site | pass | 0 | new this round |
| Privacy sweep (Layer D mechanical) | `bash tests/sentinel/privacy-sweep.sh` | 5 checks | 0 | unchanged |
| No-third-party-assets (CSS) | `bash tests/sentinel/no-third-party-assets-check.sh` | 4 checks | 0 | unchanged |
| Wing-gate (F35-R2) | `bash tests/sentinel/f35r2-wing-gate.sh` | 9 | 0 | unchanged (confirms F98's seed change didn't disturb it) |
| Push-gate self-test | `bash tests/sentinel/push-gate-selftest.sh` | 6 | 0 | unchanged |
| Presence ZK proofs | `node tests/presence-zk.test.mjs` | 12 | 0 | unchanged |
| Badge count | `node tests/badge-count.test.mjs` | 5 | 0 | unchanged |
| Frontend typecheck | `cd frontend && npx tsc --noEmit` | clean | — | unchanged |
| Playwright e2e (deployed container, already serving F99) | `npx playwright test` | 69 | 0 | unchanged count, all still pass |
| `npm audit` | frontend | 0 critical (12 low / 6 moderate / 10 high, pre-existing) | — | unchanged |

`npm run build` still cannot run (Node 18 vs Next's ≥20 requirement) —
pre-existing, unrelated to this round's commits, per the round brief, not
re-litigated.

## Regressions

None found. Both commits behave as described and hold under adversarial
re-testing beyond what each commit's own author performed.

## Part-by-part findings (per the round brief)

### (a) Does the F98 fix genuinely close the CRITICAL? Any remaining double-credit path?

**Yes, it closes it, and no remaining path was found.** `KarmaAward`'s seed is
now `["karmaaward", circle, KarmaAward::lo(mentee, wing), KarmaAward::hi(mentee, wing)]`
— the two membership commitments sorted before either is used as a seed, so
both call orders derive the identical PDA. This was confirmed directly (no
chain call needed): `award(a,b)` and `award(b,a)` produce byte-identical
`PublicKey`s via `findProgramAddressSync`.

Four adversarial scenarios were run live on a local validator, all on the
fixed build, in a standalone scratch test file (written, run, then deleted —
not committed):

1. **PDA derivation** — confirmed both directions collide, as above.
2. **Three-member ring** (A wings B, B wings C, C wings A, one Circle) — three
   genuinely distinct pairs, each credited exactly once (110 each, 330
   total). Re-running the same three links, and then the *reverse* direction
   of each of the three edges, both paid nothing further. A ring is not a
   bypass — it is three ordinary pairs, and the guard held on each.
3. **Different payer** — a role-swapped second call, funded by a completely
   unrelated rent-payer key, still landed on the same PDA and paid nothing;
   the guard is keyed only on the two commitments, never on `payer`.
4. **Cross-circle** — the same two commitments, linked in two *different*
   Circles, were credited independently in each. This is the documented,
   accepted scope (karma is explicitly per-Circle, per `state.rs`'s own doc
   comment — "a complete ranked table of *a* Circle") and was judged, again,
   not a bypass of the once-per-pair guard *within* one Circle.

### (b) Does `tests/karma.ts`'s new role-swap test actually fail when reverted?

**Yes.** Restored the directional seed in *both*
`establish_wing_peer.rs` (`mentee_membership.commitment.as_ref(),
wing_membership.commitment.as_ref()`) *and* the matching client derivation in
`tests/karma.ts` (both must move together or every call fails on a PDA
mismatch rather than exercising the abuse). Ran `anchor build` (not
`cargo build-sbf`, which does not regenerate the IDL — confirmed this
matters), redeployed to a fresh local validator, and re-ran: **6 passing / 1
failing**, with the exact predicted assertion message — *"a role swap paid
the pair a second time — the award seed is directional again"* (expected
1200, actual 600). Reverted both files with `git checkout --` on exactly
those two paths (`git diff --stat` on them was empty before the mutation and
empty again after the revert), rebuilt, redeployed, and reconfirmed **7/7
green**.

### (c) Is `KarmaAward::lo/hi`'s ordering total and stable? Any collision risk?

**Total and stable, no collision risk.** `[u8; 32]`'s derived `PartialOrd`
is lexicographic and total (byte comparison, no gaps); `mentee != wing` is
enforced by `require!` in `establish_wing_peer` before either PDA account is
touched, so the two commitments compared are *never* equal — the ordering
used is genuinely total, not "usually distinguishes." `lo()`/`hi()` are pure
selection (return `a` or `b` unchanged, no re-encoding), so the pair
`(lo, hi)` uniquely recovers the *set* `{a, b}` — two distinct unordered
pairs cannot land on the same seed. This was checked by inspection and by
adversarial probe (1) above, which would have surfaced a collision as two
different pairs deriving the same `PublicKey` and did not.

One minor gap: **`KarmaAward::lo`/`hi` have no dedicated Rust `#[test]`.**
The six `karma_tests` cover defaults/truncation/extremes/wrap/saturation/
SPACE, none of them lo/hi commutativity or injectivity directly — that
property is currently proven only at the integration level (this round's
probe, and the new `tests/karma.ts` case). Recommend a small, cheap unit
test. WARNING, not a blocker.

### (d) Map-marker gate mutation testing

Six mutations, chosen independently rather than replaying the author's own
six, each applied, gate re-run, confirmed red, reverted, gate re-run confirmed
green, `git status` confirmed clean after every single one:

1. `iconUrl` pointed at `https://cdn.example.com/...` — 2 checks failed.
2. Identicon restored on the own-position marker (`icon("__you__")`) — 2
   checks failed.
3. Popup hardcoded back to `<Popup>You are here</Popup>` — 2 checks failed
   (including the shared-label check, since `alt` still used `hereLabel`).
4. `home.youAreHere` deleted from the `fr` locale block — caught: "defined
   in 18 of 19 locales."
5. `es`'s `home.youAreHere` overwritten with the literal English string —
   caught: "2 locales carry the English string verbatim."
6. An external `<image href="https://evil.example.com/track.png" .../>`
   planted inside the vendored SVG — caught: "the asset contains a script or
   an external reference."

All six caught; `git status` clean at the end of every mutation and at round
end.

### (e) Geolocation stays local-only — independent verification

A standalone Playwright script (chromium, `permissions: ["geolocation"]`, a
faked Paris coordinate `48.85837, 2.294481`, `locale: "fr-FR"`) was run
against the **deployed** container at `https://aha.a13z.org:8443`, recording
every outbound request (URL + POST body), every `console` message, and a
full `localStorage`/`sessionStorage` dump taken after the location flow ran.

Result: the fake coordinate appeared in **zero** outbound requests, **zero**
storage keys, and **zero** console messages, across 115 total requests. The
own-position marker's actual rendered DOM
(`<img class="leaflet-marker-icon aha-here-marker ..." src="/img/you-are-here.svg" alt="You are here">`)
was inspected directly — confirming the asset is first-party and the label
resolves through i18n on a real render, not merely in source. This is
independent of and stronger than the static gate, because it drives an
actual browser through the actual permission grant.

### (f) No third-party network request

`curl -sk https://aha.a13z.org:8443/img/you-are-here.svg` returns the exact
vendored SVG (525 bytes — matches `docs/credits.md`'s own stated byte count),
served from our own origin over the same TLS as the app. In the Playwright
probe above, every one of 115 outbound requests resolved to `aha.a13z.org`
or `*.tile.openstreetmap.org` (tile requests are in `z/x/y.png` index form,
never raw lat/lon — e.g. `https://c.tile.openstreetmap.org/6/31/28.png`); no
`solana.com` traffic occurred on this page (an allowed, not required, host)
and no other host was contacted at any point.

### (g) i18n integrity

`bash tests/sentinel/i18n-key-check.sh` passes (1081 known `t()` keys all
resolve). `home.youAreHere` is present in all 19 locale blocks
(en/fr/es/se/th/hi/zh/de/sv/nb/da/ar/lo/dz/bo/my/vi/tl/qu), with exactly one
(`en`) holding the literal English string. All 18 non-English values were
read directly and are structurally plausible translations of "You are
here" (correct grammatical person against basic reference knowledge of each
language — fr "Vous êtes ici", de "Sie sind hier", ar "أنت هنا", vi "Bạn
đang ở đây", qu "Kaypim kachkanki", etc.).

**Stated honestly, per the brief: these are machine translations.** This
round verified structural integrity only (key present in every locale, not
left as English, plausible on inspection) — **not** fidelity, and no native
speaker reviewed any of the 18. One value, `dz` (Dzongkha) —
`"ཁྱོད་ འ་ནི་ནང་ ཡོད།"` — has slightly irregular internal spacing compared to
the closely-related `bo` (Tibetan) string for the same source phrase
(`"ཁྱེད་རང་འདིར་ཡོད།"`). This is flagged as a minor quality note, not a
correctness finding — this round cannot actually read Dzongkha.

### (h) Wallet avatar / `generateJazziconSvg` untouched

Confirmed. `generateJazziconSvg` is still imported in `CircleMap.tsx` and is
still legitimately called for Circle markers (`icon(\`AHA${c.circle}\`)`) —
only the own-position marker changed. `git show 758c783 --stat --name-only`
touches exactly `docs/credits.md`, `frontend/components/CircleMap.tsx`,
`frontend/lib/i18n.generated.ts`, `frontend/public/img/you-are-here.svg`, and
`tests/sentinel/map-marker-check.sh` — no wallet-avatar file
(`frontend/components/Identicon.tsx`, used on My Circle) appears anywhere in
the diff.

### (i) `docs/credits.md` disposition

Judged **honest and reasonable, not a blocker.** It states plainly that the
specific SVG Repo licence could not be identified from bare path data,
credits the source conservatively anyway (crediting something that turns out
not to need it costs one line; omitting credit from a CC-BY asset is a
breach), and names exactly what would close it properly (the source URL).
This is the right disposition for a real uncertainty rather than papering
over it. Tracked as an open item, not re-raised as a finding beyond that.

## Privacy-invariant status (relevant subset this round)

- Sponsor identity / sponsor↔member edge: unaffected by either commit (F98's
  fix only changed a seed derivation; F99 touches only the map's own-position
  marker). ✔
- Faucet/parrain↔neophyte linkage: unaffected. ✔
- Location data: browser-only, never transmitted, never persisted, never
  logged — independently confirmed live this round (§e). ✔
- No third-party asset/network contact introduced — independently confirmed
  live this round (§f). ✔
- Karma ranking (Tradition 2, waived): the pair-guard now actually delivers
  "once per pair, forever" as claimed — confirmed by adversarial probing
  beyond the shipped test. ✔ (waiver itself not re-litigated, per standing
  instruction from the prior round.)

## Traditions check

No new rank/compare/aggregate/name-a-sponsor/leak-a-relationship construct
introduced by either commit. Karma's Tradition 2 status is unchanged from
last round (explicit waiver on file, not re-litigated here) — this round's
concern was solely whether the anti-farming guarantee is real, and it now is.

## Baseline changes this round

None. No baseline file under `tests/sentinel/baselines/` was touched.

## Coverage gaps

1. **`KarmaAward::lo`/`hi` has no dedicated Rust unit test** for
   commutativity/injectivity — currently proven only at the integration
   level. WARNING this round; recommend closing before it becomes a FAIL.
2. **Docs drift, recurring pattern**: neither commit has a `docs/shipped.md`
   or `BACKLOG.md` entry. Grepped both files for "F99", "map marker", "You
   are here", "you-are-here", "bookmark pin" — zero hits. `5229e23` (the F98
   fix) *did* update both docs correctly for F98 itself; F99 (`758c783`) did
   not add its own entry. This is the same recurring gap flagged in the
   `f98-karma` round for F98 and the Traditions commit, and in earlier
   rounds before that — no automated docs-drift check exists yet to catch it
   mechanically.
3. **`docs/credits.md`'s licence line is provisional** pending the SVG Repo
   source URL — open, not blocking (see §i).
4. **No native-speaker review** of any of the 19 locales' `home.youAreHere`
   string (18 non-English) — same untracked gap pattern as Tradition 11 in
   the prior round; should be logged as one BACKLOG.md follow-up covering
   all machine-translated strings project-wide rather than re-raised per
   key each round.

## Verdict rationale

Both changes do what they say. The karma fix genuinely closes last round's
CRITICAL — a real double-credit that let any two members quietly double their
combined score — and this round could not find any other way around the new
guard after trying several: swapping roles again, working through a third
person, using a different circle, and using a different payer to fund the
transaction. The map-marker change replaces an identity-style icon with a
plain "you are here" pin, keeps that pin and its label entirely local to the
visitor's own browser (checked live, not just by reading the code), serves
the pin from our own site instead of someone else's, and now shows its label
in the visitor's own language in all 19 supported languages. Nothing that
worked before broke, and no privacy rule was crossed. The round is not a
clean pass only because two bookkeeping habits — updating the shipped-features
list and adding one small extra test — were skipped again, the same small
slip as previous rounds; neither one is dangerous on its own, but the pattern
of skipping them is worth the team's attention.
