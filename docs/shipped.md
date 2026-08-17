# Shipped — what actually exists in the code

> Created by **Sentinel** (non-regression agent), Round 1, 2026-08-10, at commit
> `aea1438`. Spec §1 authorises Sentinel to create this file when absent.
>
> `BACKLOG.md` remains the team's **single source of truth for feature intent**.
> This file is narrower and different in kind: it records only what Sentinel
> **verified present in the code** this round, and — importantly — where
> BACKLOG.md's claims and the code disagree. It is a checklist input for the
> sentinel rounds, not a replacement for the backlog.
>
> **Verification legend**
> - `code` — the instruction / module / component exists and was read.
> - `built` — compiled this round (`cargo check --workspace --all-targets`).
> - `exec` — behaviour actually executed and asserted this round.
> - `claimed-only` — BACKLOG.md asserts a devnet deployment or verification that
>   Sentinel could not reproduce (no cluster access / no secrets this round).

---

## F103 — hybrid post-quantum mailbox sealing, ADR 0002 Stage 1 (2026-08-17)

The one quantum threat that acts backward in time is harvest-now-decrypt-later:
ciphertext recorded today is decrypted the day a CRQC exists. ADR 0002 ranks it
first, and the F63 mailbox — live since v1 — was sealing every envelope to a
single x25519 prekey. This round makes the sealing layer **hybrid**:

- **v2 prekey bundles** carry an ML-KEM-768 (FIPS 203) encapsulation key beside
  the x25519 SPK, wallet-signed **together** (`spkSignedBytesV2`) — stripping or
  swapping the KEM key to force a downgrade breaks the signature. v1 bundles
  carrying a smuggled `pqk` are refused outright.
- **v2 envelopes** seal under SHA-512(domain ‖ x25519-ECDH ‖ ML-KEM shared
  secret ‖ full public transcript), truncated to a `nacl.secretbox` key: the
  plaintext stays confidential if EITHER assumption survives, and mixing parts
  of two envelopes never yields a valid key. Same `MBX_CT_LEN` ciphertext as v1
  — no size signal.
- **ML-KEM from the audited `@noble/post-quantum`** (0.4.1), never hand-rolled —
  the ADR's own rule. Sizes (1184/2400/1088) are pinned as constants so a
  drifting dependency fails loudly, and a test asserts them.
- **Rollout without breakage:** a sender seals v2 exactly when the recipient's
  bundle advertises the KEM key; v1 bundles keep receiving v1 envelopes, and a
  device's mixed secret list opens both. An SPK stored without KEM halves forces
  a rotation at the next enrollment touch instead of waiting out the 7-day
  clock, so the fleet converges fast.
- **The mixing layer keeps its guarantee:** dummies mirror the target bundle's
  version (`buildCoverEnvelope(pqk?)`) — otherwise the relay could split cover
  from real mail by the version field. All request/reply pads grew uniformly
  (2 KiB → 4 KiB blocks; bundle replies 1 KiB → 4 KiB; get-rows bound 3400 B)
  so every op is still exactly one size on the wire.
- **Forward secrecy unchanged in shape:** deleting an old epoch deletes both
  its secrets; the KEM key rotates with the SPK under the same epoch counter
  and the same monotonic-epoch rule at the relay.

Deliberately NOT a ratchet: per-message forward secrecy and post-compromise
healing still land with the v2 libsignal adapter (full PQXDH); this puts that
work on an already-hybrid base. Frontend-only — no program change, no devnet
upgrade. `exec`: 16/16 `tests/mailbox.ts` (7 new hybrid properties: both-keys-
required, downgrade refusal, tamper/mix-and-match nulls, rollout compat, size
invariance), 27/27 `tests/mailbox-mixing.test.mjs` unchanged, `tsc --noEmit`
clean, checklist gates 7/7 (`F103` entry).

## F97 — Sponsors & Sponsees on /me, the invitation page, the messages badge (2026-08-15)

Verification: `code` + `built` (tsc clean, container rebuilt and serving) +
`exec` — Playwright 69/69, `tests/badge-count.test.mjs` 5/5,
`tests/sentinel/sponsor-wording-check.sh` 18/18. Covered by
`reports/sentinel/NRR-2026-08-15-f97-sponsorship.md` (PASS WITH WARNINGS), which
ran its own mutations rather than replaying mine.

**`/me` is reordered** to My memberships → Join a Circle → Sponsors → Sponsees:
the first two are one thought, so the join box no longer sits below votes and
recovery.

**Compassionate wording**, as the request specified: "Release this Link",
"Accept this Link", "Not at this time" — never "reject" or "delete". The user
renamed *bond* → **Link**. Both release paths confirm first and say plainly that
the other person keeps full use of the platform and can still create Circles.

**A real Sponsees list.** It previously rendered only the subset of mentees still
eligible for the one-time first-gas grant, so most sponsees were invisible; it
now lists every active link with its since-date, and the faucet button appears
only where it applies.

**`/sponsor-request`** is the landing page for a scanned or shared invitation,
with the QR drawn locally from the `qrcode` dependency already vendored for
`/wallet`. The link carries only the Circle address and the inviter's *already
public* membership commitment — nothing secret, and no third-party request.

**Messages badge** — top-right red circle, hidden at zero, `99+` cap,
`aria-label="My Messages, 3 unread"`; the nav label became "My Messages".

**Direction correction, stated because the first version had it backwards.**
Only the mentee may write a WingPeer link (`establish_wing_peer.rs`: "a member
sets their own wing — never imposed"), so a one-tap invitation can only complete
in the direction where the **scanner becomes the sponsee**. The copy now reads
"take someone under your wing". The reverse handshake was unbuilt at the time of
this round; it shipped later the same week — see *F97b* below.

**Two pieces of coverage that could not fail, caught in the same commit.** Both
new surfaces render only for a connected wallet, which no test here can be. An
e2e assertion that "the page never says reject" passed with **"Reject" live in
the dictionary**; and the badge had no coverage at all. Replaced by
`sponsor-wording-check.sh` (a static gate over the shipped string table) and
`badge-count.test.mjs` (pure functions), each verified red by mutation before
being trusted.

**Karma is now built — see F98 below.** At the time of this round it was not,
and this paragraph used to say it awaited a waiver. The waiver was given on
2026-08-15 and the feature shipped; nothing in *this* round introduced a counter.

---

## F97b — "I am looking for a sponsor", the reverse direction (2026-08-16)

The missing half of F97, built out of the existing on-chain call and nothing
else. Because only the mentee may write a WingPeer, a member reaching **up** for
a sponsor cannot be served by one tap; it takes a **two-hop handshake**:

1. `/me` gains **"Ask for a sponsor"** beside the existing share actions. It
   opens the same modal with `/sponsor-request?circle=…&from=<my commitment>&mode=ask`
   — QR drawn locally, link copyable.
2. `/sponsor-request?mode=ask` treats the **opener as the prospective sponsor**
   and says plainly that this member is looking for one. A connected member of
   that Circle gets **"I am willing"**, which reveals the *ordinary* invitation
   `?circle=…&to=<their own commitment>` as QR + copyable text, to send back.
   The seeker accepts that, signs with their own key, and becomes the sponsee.

**The ask page writes nothing on chain** — it reads (to decide whether the
opener is a member) and draws a QR; there is no transaction on the path at all.
Deliberate: an unanswered request must leave no trace, and consent is signed by
the person it binds. Someone who is not a member, or not connected, is told so
plainly instead of being shown a dead button; "Not at this time" stays the
decline, and declining a request records nothing.

**i18n**: the 18 new `me.spon.ask*` / `sponreq.ask*` keys are translated in
**all 19 locales**, which the wording gate now enforces by count — the earlier
English-only keys inherited via fallback, and a fallback reads as coverage it is
not. `sponsor-wording-check.sh` grew three checks (all-locale presence, no blunt
or judging vocabulary in the new strings, and "nothing was recorded" on the
ask-decline path); `e2e/sponsor-request.spec.ts` gained two logged-out tests,
including one pinning that a `mode=ask` link with `to=` instead of `from=` fails
closed rather than silently rendering the forward direction.

---

## Devnet upgrade + the vendored-IDL gate (2026-08-15)

The program was upgraded on devnet to slot `484069558`, carrying F59 presence
and F98 karma. The `idl-sync` round proved the deployed binary is **MD5-identical
to a fresh local build** from the committed source, so the vendored IDL, the
local build and the live program are demonstrably the same program.

**What the upgrade nearly broke.** The frontend carries its own copy of the
Anchor IDL at `frontend/lib/ayni.json`, and it had fallen three instructions and
four accounts behind. `establish_wing_peer` gained the karma accounts on chain,
so against the upgraded program every "set my sponsor" from `/me` would have
failed with `AccountNotEnoughKeys` — and the Sponsors & Sponsees UI had shipped
one commit earlier, so it would have been immediate and user-visible. Nothing
caught it: not the build, not `tsc`, not the e2e suite, not any gate.

`tests/sentinel/idl-sync-check.sh` is that gate now. It checks every handler in
the `#[program]` module appears in the vendored IDL (source-based, so it works
with no build artifacts), byte-identity against `target/idl/ayni.json` when one
is present — naming exactly which instruction or account list moved — and that
both hand-written derivations of the karma award pair still sort.

`tests/pda-sort-check.mjs` closes the other half: `karmaAward`'s seed is a sorted
pair Anchor cannot auto-resolve, so `peers.ts` and `tests/karma.ts` each
implement the ordering by hand. Two hand-written copies of one
consensus-critical comparison is the shape that drifts, and the round flagged
that nothing would notice. The test cross-checks them over 2,000 random pairs
plus first-byte, last-byte and high-byte (signed-comparison) cases.

**Two false passes in my own checks, found by mutating them.** The gate first
grepped for `[lo, hi]`, which an *unsorted* `const [lo, hi] = [a, b]` also
matches — it passed on an implementation that sorted nothing. And the sort test
threw at module scope, producing a stack trace instead of a named red test. Both
fixed, then re-mutated to confirm they now fail properly.

---

## F99 — "You are here" is a pin, not an identicon (2026-08-15)

Verification: `code` + `built` (tsc clean, container rebuilt and serving) +
`exec` — `tests/sentinel/map-marker-check.sh` 15/15, Playwright 69/69, and a
live check with geolocation granted. Covered by
`reports/sentinel/NRR-2026-08-15-f99-map-marker.md` (PASS WITH WARNINGS).

The visitor's own marker on Find your Circle rendered a jazzicon seeded with the
literal `"__you__"`. Wrong twice over: an identicon stands in for an *identity*,
and "where I am standing" is not one; and because the seed was its own literal
rather than anything derived from the member, the pattern never matched the
wallet avatar on `/me`, so it read as a bug even to someone who accepted the
idea. It is now a static bookmark pin, `frontend/public/img/you-are-here.svg`,
served from our own origin — a marker fetched from a third party would hand that
host the visitor's IP and a `Referer` naming the page, on the one page that has
just read their location.

**The label was hardcoded English** (`<Popup>You are here</Popup>`) — one
untranslated word on an otherwise fully localised page. `home.youAreHere` is a
NEW key, added to all 19 locales with real translations, sitting beside
`home.km` and `home.circleFallback` where the map's other strings live. The
popup and the marker's `alt` share the one resolved string, so an `alt` cannot
drift back to English where no sighted reviewer would notice.

`generateJazziconSvg` is **kept** — Circle markers still use it; only the
own-position path changed. The wallet avatar on `/me` is untouched.

**Coverage is a static gate, not an e2e test**, because the marker renders only
after a real geolocation grant and a browser test that quietly never reached it
would pass whether or not any of this held — the failure mode that has bitten
this repo twice. Fifteen checks: the asset is referenced and first-party, the
SVG carries no script or external reference, no identicon on the own-position
path, the label resolves through i18n with no hardcoded literal, the key exists
in all 19 locales with none left in English, and no coordinate reaches storage,
a network call, a log, or an IP-geolocation service. Mutation-tested six ways;
the round then ran six of its own and independently verified the geolocation
privacy property with its own Playwright script.

⚠ The 18 non-English strings are machine translations, not checked by a native
speaker. ⚠ `docs/credits.md` records the SVG's attribution *provisionally*: SVG
Repo spans CC0, MIT and Creative Commons, and the asset arrived as bare path
data, so the collection could not be identified. Credit is given anyway; supply
the source URL to make it exact.

---

## F98 — sponsorship karma, under an explicit Tradition 2 waiver (2026-08-15)

Verification: `code` + `built` (`cargo build-sbf` clean) + `exec` — 42/42 Rust
unit tests, 7/7 `tests/karma.ts` on a local validator.

**This ships a per-person reputation score**, which this project forbade
mechanically until the user waived the rule in their own words (recorded in
CLAUDE.md and in the commit note). The waiver was applied narrowly: `karma` was
removed from `privacy-sweep.sh`'s forbidden identifiers and nothing else was;
Tradition 2's own text is untouched, because it never contained a no-ranking
clause — that was an engineering invariant *derived* from it.

**What it costs, stated rather than implied:** a `Karma` PDA derives from a
membership commitment and commitments are already enumerable, so anyone can
build a complete ranked table of a Circle. That is not a leak in this design; it
is what "accept that it ranks members" means. Onboarding copy saying so is not
yet written.

**Accounts:** `Karma` (one saturating u64), `KarmaParams` (gain, sponsor share in
basis points, advisory `min_sponsors`), `KarmaAward` (the once-per-pair guard).
Governed by an executed 4-of-7 `SetKarmaParams`, exactly like the treasury
setters, one-shot via `drained`.

**A CRITICAL, found and fixed in the same session.** The `f98-karma` round
reproduced an abuse the shipped test missed: `KarmaAward` was seeded in *role*
order, so the same two members could swap roles, derive a second award account
and collect again — 220 between them instead of 110, with two individually
legitimate transactions. The seed is now the canonicalised (sorted) pair, and
the regression test asserts the pair's **combined** total after a swap, which is
the thing the original test never looked at. Verified by reverting the seed and
watching the test fail with "a role swap paid the pair a second time".

---

## F96 — the connect button, the cluster box, and the three-tone mobile banner (2026-08-15)

Verification: `code` + `built` (tsc clean, container rebuilt and serving) +
`exec` (Playwright 66/66 across two projects). Covered by
`reports/sentinel/NRR-2026-08-15-connect-and-cluster.md` (PASS WITH WARNINGS),
which mutation-tested the new assertions with its own choice of breaks.

**The button says "Connect."** `WalletButton.tsx` uses
`BaseWalletMultiButton` with an explicit label set, because upstream's
`WalletMultiButton` hardcodes its own LABELS and exposes no prop. Only
`no-wallet` is re-worded ("Select Wallet" → "Connect"); every other label is
left at the upstream wording on purpose. The pre-hydration placeholder says
"Connect" too, so the word does not change under the reader.

**The Solana mark moved into the button**, as a CSS `::before` rather than a
React child — `BaseWalletConnectionButton` overwrites `startIcon`
unconditionally with the selected wallet's icon and exposes no other slot. A
`:not(:has(...))` guard makes our mark step aside once the library renders a
real wallet icon, instead of stacking two. `SolanaBadge`/`SolanaMark` and the
`.sol-badge` rule are deleted rather than left orphaned.

**Testnet is gone from the cluster box** — AHA is not deployed there, and
listing it even greyed out implies a cluster you could switch to. Removed
*conditionally*, not deleted: a `<select>` whose `value` matches no rendered
option renders BLANK, so a straight delete would make a testnet-pointed
deployment stop naming its cluster entirely. In normal operation that branch is
dead.

**The mobile banner has three tones, not two** (`noticeTone()` in
`lib/mobileWallet.ts`): `broken` (Android Firefox — MWA is offered and will
hang), `only-route` (iOS — the adapter injects MWA only on Android, so no iOS
browser can reach an external wallet at all), `alternative` (Android Chrome and
friends, where Connect works and should not be talked out of). The first
version told iPhone users the in-app browser was "the most reliable way", which
is wrong by understatement on a device where it is the only way.

**Coverage:** `e2e/wallet-button.spec.ts` (label, mark, two-icon guard, no stray
badge), `e2e/network-selector.spec.ts` (options, mainnet disabled, and the
load-bearing one — the box is never blank), `e2e/wallet-notice-tone.spec.ts`
(one describe per user agent, each asserting the wrong wording is *absent*, not
just the right wording present).

**Known limit, recorded not fixed:** `isIOS()`'s touch-Mac heuristic
misclassifies a desktop Mac driving a touchscreen display. iPadOS impersonates
macOS deliberately and no feature separates them; any tightening also excludes
real iPads, which is the worse error. See the comment in `lib/mobileWallet.ts`.

---

## F59 — ZK presence attestation, on chain (2026-08-15)

Verification: `code` + `built` (`cargo build-sbf`, clean) + `exec` — 36/36
in-crate Rust tests and 12/12 real Groth16 proof tests
(`node tests/presence-zk.test.mjs`, offline, no validator).

Design of record: `docs/presence.md`, written before the code because F59
required an explicit amendment to an Epic 4 rule. The amendment and its cost
(ledger archaeology — `getSignaturesForAddress` on a derivable PDA yields a
per-person count no on-chain design can retract) are recorded there as accepted
risk by user decision, and Sentinel should not re-raise them as CRITICAL each
round.

**Two instructions, both wired into `lib.rs` this round.**

- `attest_presence_zk` — two anonymous Groth16 proofs under the **same**
  external nullifier `E = SHA-256("AHA-presence-month" ‖ circle ‖ commitment ‖
  month_le32)`, masked into the BN254 field. The subject consents by proving
  against `merkle::single_leaf_root(commitment)`, computed **in the program** so
  the caller cannot substitute a tree they control; a fellow member vouches by
  proving against `member_tree.root` or an F54 `RecentRoots` entry. Requiring the
  two nullifiers to differ is what proves two different people acted — strictly
  stronger than `confirm_admission`, which concedes the distinct-persons rule
  downgrades to circle-visible for anonymous attestations.
- `clear_presence` — the subject erases their own record under
  `"AHA-presence-clear"`, closing the account so that erased and never-claimed
  are identical **in live state**. One proof, not two: requiring a witness to
  erase would let a member be held to a record because no fellow member would sit
  with them. The month erased is read from the account, never from an argument,
  so a proof cannot be aimed at a record it did not authorise.

**State.** `Presence { last_month: u32, bump: u8 }`, `SPACE = 13`, PDA
`["presence", circle, subject_commitment]`, `init_if_needed` so a first
attestation and a later one are indistinguishable in cost and shape. No
timestamp, no count, no `first_month`, no `Vec`, no witness identity — each
absence justified in `docs/presence.md` §3.

**Months.** `programs/ayni/src/month.rs` coarsens `Clock` to a month index on
chain (Howard Hinnant's `civil_from_days`, UTC, no per-Circle timezone because a
timezone is a coarse location). Only a **closed** month may be attested and each
write must strictly advance. Six unit tests including a day-by-day walk over 40
years asserting the index never goes backwards or jumps.

**What the tests establish, beyond "it compiles".** `tests/presence-zk.test.mjs`
generates real proofs and demonstrates the attack each rule prevents rather than
asserting the rule holds: self-attestation collapses to one nullifier under the
shared `E`; two proofs under *different* `E`s would let one member fake two,
which is why `E` is computed once and shared; a March proof does not verify as
April; an attestation proof does not verify as an erasure; a fellow member who
knows the subject's commitment still cannot forge consent. Both the Rust and the
JS implementations of the external nullifier are pinned to the same frozen
vectors, so they cannot drift apart silently. Mutation-tested by collapsing the
two domain tags: two Rust tests and two JS tests went red, then green on revert.

**Not yet built:** the browser prover, the QR handoff, and the `/member` presence
line. Nothing in the UI reads a `Presence` account yet.

### ⚠️ F34 — CRITICAL fund-safety hole found while writing the F59 test plan

Not a regression and not fixed — recorded here so the canonical tables carry it.
`execute_child_close` closes a child Circle account but never checks or sweeps
its separate `["treasury", circle]` PDA. The lamports survive but go unreachable
(every spend path needs the closed Circle to deserialise), and since a Circle is
a PDA of `(parent, name)` and `initialize_circle` is permissionless with
caller-chosen seats, a stranger can re-register the name, seat themselves 4-of-7
and drain it. Proven in `tests/treasury-orphan.ts` (6/6, **local validator
only**) and reproduced independently by the `f59-presence` round. Three devnet
treasuries (0.1/0.205/0.08 SOL) are reachable today. Fix options in
`docs/testing-foundation.md` §0; the cheapest — require `treasury.lamports == 0`
in `execute_child_close` — is a governance decision left to the user.

---

## F67 / F68 / Glossary — Resources menu, wallet chooser, glossary page (2026-08-14)

Verification: `code` + `built` (frontend `tsc --noEmit`, `next build`), `exec`
for the i18n gate and the glossary extractor; no e2e (structural gap, see below).

**F67 — shuffled WalletChooser.** `frontend/components/WalletChooser.tsx` reads
the five vetted self-custodial wallets from `docs/wallets.json` (mirrored to
`frontend/public/wallets.json`, verified byte-identical) and orders them with a
uniform Fisher–Yates drawing only on `Math.random()`. Round `f67` stress-tested
the shuffle at 200,000 iterations: max deviation from a flat 20% was 1.00%, so
no wallet is statistically favoured. The registry had this as not-built; the
component existed but its stated defect did not: `/create` still named Solflare
then Phantom as two hardcoded anchors in fixed order, and
`/settings-security` said "alongside Phantom and Solflare" in body copy. Both
removed (`b217a62`, `0717f6e`). The T6 sweep across `frontend/app` and
`frontend/components` is now clean — every surviving wallet brand mention is a
code comment, none is text a member reads.

**F68 — `/onboarding`.** `frontend/app/onboarding/page.tsx` is the real
three-step stepper (Wallet → Vouch → Face) and is reachable from the nav.
Registry said not-built; it was built and wired. Round `nav-menu` verified this
independently before the registry was reconciled to it.

**Nav.** "Get AHA for Android/iOS" → **Mobile App** (one neutral label; the old
platform detection could name a store the visitor cannot reach and shifted after
hydration). My Circle / Documents / Board hide when no wallet is connected;
Start Here hides once one is. `connected` is false on the server and on the
first client render alike — verified by reading
`@solana/wallet-adapter-react@0.15.39`'s `StandardWalletAdapter`, which zeroes
its account in the constructor regardless of prior authorization — so the gating
introduces no hydration mismatch.

**Resources menu + Glossary.** "The 12" → **Resources**, holding Twelve Steps,
Twelve Traditions, Glossary, and Start Here. `/glossary` renders the 342 terms of
`glossary/glossary_v1.xlsx`: search over term/explanation/tags with in-place
highlighting, facets by Step 1–12 and by tradition, an A–Z index, and the
spreadsheet's "related to" column as live cross-references. `?q=` deep links.

`scripts/build-glossary.mjs` extracts the workbook to
`frontend/public/glossary.json` by parsing the OOXML zip by hand — no new
dependency — and matches columns BY HEADER NAME so a column reorder cannot
silently shift data. Round `glossary` verified this by writing an independent
XML reader from scratch and confirming byte-identical regeneration, 342 entries,
none dropped. The xlsx stays the source of record.

Privacy: the page makes no chain call, touches no wallet or member data, and its
only network request is one static fetch of `/glossary.json` — so which terms a
member reads is not observable. 167 KB fetched at runtime, never bundled.

**Known and NOT fixed here:** two content-quality defects in the spreadsheet,
faithfully reproduced rather than silently corrected — the tags `Budhism` and
`Buddhism` both exist (splitting those terms across two filter chips), and
`Freemassonery` is misspelled. Fix at source and re-run the extractor.

**Coverage:** `tests/sentinel/glossary-check.sh` (new, round `glossary`).
Still no Playwright e2e for any of this — a repo-wide structural gap, not
specific to these features.

---

## F61 / F60 Phase-2 — shielded ownership + the encrypted read path (2026-08-12)

The roster leak Sentinel flagged repeatedly: `Membership.owner` held a raw wallet
at offset 89, so one `getProgramAccounts` memcmp listed every Circle a wallet
belonged to — the membership graph Epic 2/5 forbid publishing, readable by
anyone with an RPC endpoint. It was there because `owner` did two jobs at once:
authorising the member's writes, and indexing the member's own memberships for
`findMyMemberships`.

**Shipped:** the two jobs are split. Indexing moves to `OwnerTag`, a PDA whose
*address* is `SHA-256("aha-owner-tag-v1" ‖ viewing_secret ‖ circle ‖ index)` —
no field to filter on, and the address is uncomputable without the member's
secret. Authorisation stays on `owner`, rebound in the same instruction to a key
derived from the master secret. Served bio/avatar become ciphertext under
per-element keys, distributed by drops addressed by an X25519 shared secret so no
audience graph materialises.

| Piece | Where | Verified |
|---|---|---|
| `shield_membership(tag, shielded_owner)` — mints the private index and rebinds `owner` atomically | `instructions/shield_membership.rs` | code, built (`cargo check --workspace` clean; accounts Boxed for SBF stack) |
| `OwnerTag` (membership + bump only — no authority, no wallet) | `state.rs` | code, built, unit test `state::visibility_phase2_tests` |
| `upsert_member_profile(enc_pub, epoch, bio_ct, avatar_ref)` — fixed-length ciphertext | `instructions/upsert_member_profile.rs` | code, built |
| `grant_visibility_key(drop_id, sealed, epoch)` — names neither party, no member signature by design | `instructions/grant_visibility_key.rs` | code, built |
| `MemberProfile` (200-byte `bio_ct`, always written), `VisibilityKeyDrop` (104-byte `sealed`) | `state.rs` | code, built, unit tests |
| Derivation contract (viewing secret, tag, shielded key, element keys, drop id) | `frontend/lib/visibilityCrypto.ts` | code, `tsc --noEmit` clean, pinned by `tests/epic5.ts` |
| `shieldMembership` / `publishProfile` / `grantElementKeys` / `openMemberProfile` | `frontend/lib/visibility.ts` | code, `tsc --noEmit` clean |
| Two-path discovery (derived addresses + legacy memcmp fallback) | `frontend/lib/member.ts` `findMyMemberships` | code, `tsc --noEmit` clean |
| Read path: bio/avatar rendered only when they decrypt, no lock, no placeholder | `lib/trustpage.ts`, `app/member/[commitment]/page.tsx` | code |
| `/board` renders nothing to an unconnected visitor and issues no post query | `app/board/page.tsx` | code |
| Enumeration regression tests (before/after memcmp, index holds no wallet, drop names nobody, hidden ≡ absent, epoch revocation) | `tests/epic5.ts` | code |
| Design, before/after enumerability table, migration, stated limits | `docs/visibility.md` | code |

**Stated honestly, not closed (as of this first round):** transaction history
still links a wallet to a membership it signs for; shielded-ness and its count
are public; **unshielded memberships remain exactly as enumerable as before**;
`recovery_keys` are still memcmp-enumerable by the same attack; granting is
O(audience). See `docs/visibility.md` §1 and §4.

## F61-R2 — shielding becomes a feature a member can actually use (2026-08-12)

The round above shipped the *mechanism* and no member could use it.
`shieldedSigner` appeared in exactly one file and no call site; there was no UI;
`create_post`, `tie_quipu_cord`, `set_visibility`, wing-peer and attestation
paths all still assumed `owner == connected wallet`. So a member who shielded
lost those actions, and because nothing shielded, the roster leak stayed open in
practice. Honest status then: "mechanism built, feature not delivered."

**Shipped:**

| Piece | Where | Verified |
|---|---|---|
| Separate rent `payer` on the five member-signed instructions that lacked one, so the authority account never needs lamports | `instructions/{create_post,tie_quipu_cord,set_visibility,establish_wing_peer,attest_admission}.rs` | `cargo check --workspace` clean, `anchor build` clean (no SBF stack-frame warning), `cargo test -p ayni --lib` 22/22 |
| `memberAuthority()` — resolves owner / shielded derived key / guardian, per membership; `sendMemberTx()` — routes relayer-paid vs wallet-paid | `frontend/lib/shielded.ts` | `tsc --noEmit` clean |
| Every member-signed write path threaded: `createPost`, `setVisibility`, `establishWingPeer`, `endWingPeer`, `tieQuipuCord`, `attestAdmission`, `publishProfile`, `grantElementKeys` | `lib/{posts,peers,visibility,admission}.ts` | `tsc --noEmit` clean, on-chain tests in `tests/epic5.ts` |
| Relay policy: one pinned co-signer (`authorityIndex`), fee-payer-only relays (`payerIndex: null`), bounded variable-length data; 9 new allowlist entries | `frontend/lib/relayPolicy.ts` | discriminators verified two ways (computed + IDL) and asserted in `tests/relayer.ts`, incl. that each `authorityIndex` is a signer in the IDL and never the payer |
| Relay route: accepts a client-signed authority signature, rebuilds the identical message, adds only the fee-payer signature | `frontend/app/api/relay/route.ts` | `tsc --noEmit` clean |
| Shield UI with the full cost stated before the member commits | `frontend/app/me/page.tsx` (`ShieldCard`) | `tsc --noEmit` clean |
| Master secret at rest, keystore-sealed, one exact blob name, no enumeration | `frontend/lib/masterSecret.ts` | `tsc --noEmit` clean |
| `/recovery/setup` shards the SAME master; `/recovery` adopts the reconstructed one, so a shielded membership survives recovery | `app/recovery/setup/page.tsx`, `app/recovery/page.tsx` | `tsc --noEmit` clean |
| On-chain proof a shielded member keeps every action, and the derived key's balance is still 0 after all of them | `tests/epic5.ts` | code |

**The funding answer:** the **relayer**, not self-pay and not a transfer. Funding
the derived key from the member's wallet is refused outright — it is the
funding-source heuristic and a stronger link than the one shielding removes.
With a relayer configured, a shielded member's write contains the relayer
(fee-payer) and the derived key (authority) and no wallet of theirs at all.
Without one, the client falls back to wallet-paid and **says so in the UI before
the member shields**. See `docs/visibility.md` §3b.

**Still true after a member shields, stated plainly:** an observer can see that
*some* membership was shielded and count how many; the shield transaction itself
is signed by the wallet being unbound, so transaction history links that wallet
to that membership permanently (only shield-at-issuance fixes that); a shielded
member's posts are groupable with each other and with their membership via the
derived key, which names nobody; `recovery_keys` remain enumerable. **And one
pre-existing defect found while auditing this round, not introduced by it:**
`MemberProfile.enc_pub` was derived without the Circle, so a member who
published a profile in two Circles published identical bytes in both — a memcmp
handle that regroups what shielding un-grouped. **Fixed in F61-R3 below.**

## F61-R3 — `enc_pub` bound to the Circle (2026-08-12)

Closes the defect above. `profileEncKey` now derives under a new frozen domain,
`SHA-256("aha-vis-enc-v2" ‖ viewing_secret ‖ circle)`, so a member shows an
unrelated profile key in each Circle and `enc_pub` stops being a cross-Circle
memcmp handle. Sibling derivations (`ownerTag`, `shieldedOwnerKey`,
`elementKey`) already folded the Circle in; this one had been missed, silently,
because nothing about a correct-looking public key says which inputs produced
it.

Nothing is stranded: `legacyProfileEncKey` still derives the v1 key for
**reading**, so profiles and key drops published before this round still open
(the reader tries v2, then v1). Element keys were already Circle-bound, so a
member's own bio and avatar were never at risk.

**Not automatic, and worth stating plainly:** the fix is in the write path. An
existing profile keeps its old global `enc_pub` on chain until the member next
publishes, so members who published before this round are not protected until
they re-publish — and when they do, their `enc_pub` changes, which moves every
drop address derived from it, so grants issued earlier must be re-issued. Same
mechanic as an epoch bump, but a real cost.

Covered by `tests/epic5.ts` — `F61-R3: a member's profile key differs per Circle`,
which pins all three properties: two Circles give different keys, v2 never
collapses onto v1, and two members in one Circle do not collide.

## F35 (Traditions fix) — anonymous faucet activation (2026-08-12f)

The faucet's activation transaction publicly linked **parrain ↔ neophyte**: the
parrain signed, paid, and passed their own membership PDA, so the chain recorded
their wallet, their commitment, the neophyte's commitment and wallet, and a
lamport transfer between the two — the named sponsor edge Epic 2 exists to
abolish (Sentinel **R2**, the sharpest Traditions tension in shipped code).

**Shipped:** `activate_faucet_zk` (`programs/ayni/src/instructions/activate_faucet_zk.rs`),
an anonymous activation path where the endorsement is a Groth16 proof instead of
a signature — "some member of this Circle's member tree endorses first gas for
this neophyte". No parrain account, commitment or wallet appears.

| Piece | Where | Verified |
|---|---|---|
| `activate_faucet_zk(root, nullifier, proof_a/b/c)` | `instructions/activate_faucet_zk.rs` | code, built (`anchor build` clean; SBF stack checked — the account set is Boxed) |
| `faucet_external_nullifier` = `SHA-256("AHA-faucet-grant" ‖ circle ‖ neophyte)`, masked into BN254 | same file | code, built, **proptest** (`crate::proptests::faucet_external_nullifier_binds_and_separates`) |
| `pay_uniform_grant` — the shared economics both paths call | `instructions/activate_faucet.rs` | code, built; lifted statement-for-statement out of the old inline body |
| Client: `activateFaucetAnonymously` + `faucetExternalNullifier` | `frontend/lib/faucet.ts` | code, `tsc --noEmit` clean |
| Client: `proveMemberEndorsement` (the shared Epic-2 endorsement primitive; `attestAdmissionAnonymously` now calls it) | `frontend/lib/zk-vote.ts` | code, `tsc --noEmit` clean |
| UI prefers the anonymous path, names the fallback when it can't | `frontend/app/me/page.tsx`, key `me.mentor.firstGasNamed` | code; `i18n-key-check.sh` PASS |
| Relay allowlist entry (`297c242a39a3760e`, payerIndex 8, 10 accounts, 328 bytes) | `frontend/lib/relayPolicy.ts` | code; discriminator/account-count re-derived from the rebuilt IDL |

**No new circuit, no new ceremony:** `member_vote.circom` and the shipped
`VERIFYING_KEY_VOTE`, reused exactly as `prove_personhood` and
`attest_admission_zk` do. Public signals `[nullifier, root, proposalId, choice=1]`.

**Economics untouched:** cooldown, uniform `grant_lamports`, rent floor,
recipient-must-equal-`owner`, and the *same* `["faucetnull", circle, commitment]`
one-shot PDA — shared with the named path, so the two cannot be stacked.

**The named path stays, deprecated.** `activate_faucet` is unchanged in behaviour
and marked deprecated in `lib.rs`, the instruction file, `frontend/lib/faucet.ts`
and `docs/faucet.md`. It cannot be deleted this round: a parrain whose device
holds no ZK voting key cannot produce a proof, and their neophyte would be left
without gas. The client takes it only when `haveVotingKey(parrain)` is false.

**Coverage:** 6 new cases in `tests/faucet.ts` (including a structural assertion
that the built instruction contains no parrain membership PDA and no parrain
wallet, and exactly one signer), 1 new proptest (13 lib tests pass), 7 new static
gates on the F35 checklist entry. **Uncovered:** real-proof e2e — same gap and
same reason as F53 (`attest_admission_zk`), needs the browser/devnet proving flow.

**Residual, honestly:** the `WingPeer` PDA still publishes the sponsor edge at
*commitment* level independently of the faucet (that is F27 / R2), so an observer
can still *guess* the wing endorsed — a guess against the whole member set, not a
record. One capability genuinely changed hands: a neophyte already in the tree
can endorse their **own** grant (the named path could not be self-served), since
an anonymous proof cannot be compared against the neophyte's commitment without a
new circuit (F44) — the ceremony is lost, not the money (one grant per
commitment, uniform amount, own wallet, own jar; the faucet's real bound is the
membership door). Relayer IP/timing, self-pay fallback, and proof-replay timing
are enumerated in `docs/faucet.md` § "What an observer can and cannot infer".

> **Superseded in part by F35-R2 (below).** The self-endorsement capability
> described in the paragraph above is closed, and the claim that restoring the
> ceremony needs a new ceremony (F44) is refuted. The residual `WingPeer` /
> commitment-level sponsor edge stands, and is now a *record* rather than a
> guess.

## F35-R2 (Traditions fix, round 2) — mandatory sponsorship, still anonymous

F35 bought the right thing and dropped one property on the way. Replacing the
parrain's **signature** with a proof of "SOME member of the tree endorses"
removed the sponsor's wallet from the transaction — the whole point — but the
named path had a structural guarantee the anonymous one did not: `establish_wing_peer`
refuses `mentee == wing`, so a member could never serve themselves. An anonymous
"some member" proof let an admitted neophyte endorse their **own** first gas.

**Shipped:** the proof's `root` is no longer the Circle's member tree. It must
equal `single_leaf_root(wing_peer.wing)` — a depth-20 Merkle root the **program**
computes from the bond's own `wing` commitment (single leaf at index 0, zero
siblings) — so the only witness that satisfies it is a secret `s` with
`Poseidon(s) == wing`. Mandatory sponsorship restored, still with **no sponsor
account, no sponsor wallet, no sponsor signature and no transfer** in the
transaction.

| Piece | Where | Verified |
|---|---|---|
| `merkle::single_leaf_root` + `static WING_ZEROS` (`.rodata`, 0 stack) | `programs/ayni/src/merkle.rs` | `cargo test -p ayni --lib` 20/20; `anchor build` clean, **no SBF stack-frame warning** |
| The gate: `require!(root == single_leaf_root(wing_peer.wing), EndorsementNotByWing)` — a **replacement** of the member-tree/F54-ring check, never an extra `\|\|` arm | `instructions/activate_faucet_zk.rs` | code, built; `tests/sentinel/f35r2-wing-gate.sh` 9/9 |
| Table integrity `WING_ZEROS[i] == zeros(20)[i]`, fold == a fresh tree with one leaf, injectivity, and "a wing root is never a real member-tree root" | `programs/ayni/src/proptests.rs` | 4 new host tests, all pass |
| Client `proveWingEndorsement` (no roster rebuild, no `note_root` crank — a tree of one never goes stale) | `frontend/lib/zk-vote.ts` | `tsc --noEmit` clean |
| `activateFaucetAnonymously` refetches the bond and passes `recentRoots: null` | `frontend/lib/faucet.ts` | `tsc --noEmit` clean |
| Rejection cases: member-tree root, an unrelated member's tree-of-one, the neophyte's own tree-of-one, a second self-endorsement shape — all `EndorsementNotByWing`; only the wing's root reaches the pairing | `tests/faucet.ts` §7a | written; **not executed** (needs a local validator) |

**No new circuit, no new ceremony, no IDL shape change.** `member_vote.circom`
constrains only `root === cur[depth]` and never learns which set `root` denotes,
so 100% of that meaning lives in the program's root check — repointing it is a
program-side change and nothing else. `VERIFYING_KEY_VOTE` unchanged; **F44 stays
out of scope**. Instruction args, account count (10) and `payerIndex` (8) are
unchanged, so `frontend/lib/relayPolicy.ts` needs **no** edit — deliberately, since
a policy/program skew would make the relayer refuse and the UI fall back to the
named path, republishing the sponsor wallet.

**Privacy baseline change — deliberate, and documented in the same change.** The
`root` argument is now a deterministic public function of the wing's commitment,
so the endorsement's commitment-level anonymity set is **1**: what used to be a
*guess* (via the world-readable `WingPeer`) is now a *record* of the wing acting
at that slot. You cannot have the program enforce that the wing endorsed without
the chain recording it. The **wallet** layer — the F35 win — is untouched.
`docs/faucet.md` § "What an observer can and cannot infer" is rewritten
accordingly, and its old claim that restoring the ceremony needed **F44** is
explicitly refuted there.

**Accepted costs, all written into the code's doc comments:** the wing is no
longer proved to be in the member tree, so an expired / revoked / not-reinserted
— and now also a **provisional** — commitment can endorse (parity with the named
path; descoped for this round, not overlooked); the wing becomes a single point of
failure for a one-shot grant, with the deprecated named path as the only fallback;
and after **F27** retires the public bond, this `root` would still arithmetically
name the wing, so F27 must replace the check with an in-circuit bond proof or it
silently regresses.

## F62 / F69 — a mark instead of a face (2026-08-12g)

An anonymity-first fellowship was asking members to upload a photograph of their
face. These two features fix that from both ends.

**F62 — the stone-mark canvas.** Draw a personal sigil inside the equilateral
triangle instead of uploading a photo. The canvas existed but was incomplete and
carried three real defects, all found and fixed this round: an **unbalanced
canvas state stack** (`save()` on stroke start, `restore()` on end — a gesture
ending in pointercancel or a lost capture leaked a frame permanently, and
`clear()` never restored at all); ink chosen from `prefers-color-scheme` when
this app's theme lives on `data-theme`, so it never followed the app and **baked
pale ink into any export made in dark mode** — invisible on another member's
light-themed trust page; and an export that resampled the *screen* canvas, so
output depended on device pixel ratio. All three dissolve by rendering from
normalised geometry. The triangle is a **bound on recorded geometry**, not just a
clip mask: a stroke is cut at the edge and restarts on re-entry.

Privacy: stroke *dynamics* — timing, velocity, pressure, tilt — are never
recorded, and even the bare geometry is discarded at save, so a mark cannot be
replayed as a handwriting biometric. `setStoneMark` refuses SVG outright, since
the avatar slot renders into an `<img src>` on other members' pages.

**F69 — on-device cartoonisation, and the finding behind it.** The photo path
persisted a real, unmodified photograph merely resized to 128 px. A 128 px face
crop is ample for off-the-shelf face recognition, so **downscaling was never a
privacy transform** — the stored avatar was simply a small photo of a face. It
also materialised the full-resolution image twice in memory (`FileReader` →
base64 → `img.src` → decoder cache) and released neither.

Now the photo is decoded straight from the Blob via `createImageBitmap` — no
FileReader, no base64, no data URL — drawn once into a detached canvas that is
then cleared and sized to 0×0 with the bitmap closed, and every intermediate
buffer (each still resembling the face) is **zero-filled** before the promise
resolves, on the success path and again in `finally`. The transform is classical
and dependency-free: cover-crop → saturation lift → edge-preserving smoothing
with rational weights `1/(1+d²/σ²)` (no `Math.exp`, so only `+ - * /` and
therefore bit-identical across engines) → Sobel ink mask → median-cut palette,
splitting at the **midpoint of the axis range** rather than the population median
because splitting at the median lost the eyes. Deterministic; 1.3–2.3 KB output.

**Stated honestly in `docs/avatars.md`:** this destroys fine texture and landmark
precision and defeats naive matching, but is **not** a proof against a determined
adversary holding the original photograph; and the guarantee covers this
application only — not the member's own disk, the OS picker, or device backups.

62 tests across the two (17 + 45), including a 4000-point fuzz proving every
clamped point lands inside the triangle, dark-outlier survival (the eyes), buffer
zeroing, and source-level invariants that fail the suite if `fetch`, storage,
`FileReader` or `toDataURL` reappear in either module.

## F63 v2 — mailbox metadata mixing (2026-08-12f)

The inbox copy used to promise mixing as "the documented next step". It ships
now, and the copy was rewritten to match reality in all 19 locales.

Four measures, no new infrastructure and no server-side secret store, with the
pure logic in one module (`frontend/lib/mailboxMixing.ts`) imported by **both**
the relay route and the client so the cover budget and the rate limits it must
fit inside can never drift apart:

- **Bucketed release** — the client holds a real `put` for up to 2.5 s of
  jitter; the relay stores on arrival but releases only on a fixed grid.
  `releaseAt` is a monotone ceiling, so ordering can never invert. This also
  *strengthened* v1's FIFO: `get` now sorts on full-precision arrival time and
  sorts **before** capping the page at 100 (v1 sorted on whole seconds and left
  same-second order to `readdir`).
- **Cover traffic** — decoys are genuine sealed envelopes: same op, same field
  set, same 1040-byte ciphertext, same padded body, and `expiresAt` drawn from
  exactly the compose form's menu (a fixed value would have been a tell for
  anyone who sets an expiry). The `cover: 1` marker lives **inside** the
  ciphertext as its own field — not a body prefix — so no real message can be
  suppressed by what its author happened to type. Capped at 16 outstanding
  against `MAX_PER_BOX` 500, so cover can never FIFO-evict real mail; decoy ids
  ride along on the member's next ack, so the box self-cleans with no extra
  wallet prompt.
- **Size padding** — requests padded to a 2 KiB block (all ops one size);
  replies padded so enrolled and unenrolled `bundle` lookups match.
- **Constant-rate polling** — the scheduler takes only (state, config, clock),
  so mailbox contents cannot influence when the app checks.

**What this changes:** "this mailbox received something at T" no longer implies
anyone wrote to it, and "this member fetched at T" no longer implies they had
mail or even opened the app.

**What still leaks — stated plainly to members, not buried:** the relay sees the
**source IP alongside the mailbox id**, so an operator correlating addresses
over time can still infer who talks to whom — mixing does not close this; a
**first message to a new contact has no decoys around it**; the prekey directory
remains an enrollment oracle. A real mixnet/Tor transport and PIR contact
discovery are documented as deliberately **not** built (`docs/messaging.md` §6)
rather than half-shipped, because a half-mixnet looks like anonymity without
providing it.

27/27 mixing tests including an end-to-end run against the real relay route and
proof that v1 envelopes already on disk still deliver; existing `tests/mailbox.ts`
9 passing unchanged; gate `tests/sentinel/f63-mixing-check.sh` 15/15.

## F91 (Steps 1–2) — master-secret rooting groundwork (2026-08-12e)

Epic 11 shipped a recovery UX that is honest about being local — but the
identity layer never actually used the master secret it shards. `newMemberIdentity()`
draws its own random Semaphore secret, so reconstructing the master restores a
*wallet* and nothing else. These two steps lay the contract to close that,
without changing a single byte of today's behaviour.

**Step 1 — the scalar-field bug.** `frontend/lib/zk-vote.ts` declared `R` as the
BN254 **scalar** field but held the **base** field value q — byte-identical to
`Q`. It is inert today only by luck: `rnd[0] &= 0x1f` caps every generated secret
at 2^253−1, comfortably below both r and q, so `x % q === x % r === x`. Proven a
no-op over 2000 random masked draws plus the mask maximum and boundary set; old
and new code write the identical decimal to the identical storage slot, so the
commitment and on-chain leaf are unchanged. `R` is now the true r, and
`secretScalarFromBytes()` reduces through it. **Found before rooting shipped, not
after** — a derived secret ≥ r reduced by the wrong modulus would have minted an
identity that could never be recovered.

**Step 2 — the v2 derivation contract, shipped dark.**
`zkSecretForCircle(master, circle, index)` = SHA-256(`aha-zk-secret-v2` ‖ master
‖ circle32 ‖ u32le(index)). Per-circle domain separation preserves cross-circle
commitment unlinkability; `index` leaves room to rejoin a Circle with a fresh
votable identity without breaking determinism. `walletSeed` stays global and
frozen; `aha-zk-secret-v1` is retired unconsumed. `newMemberIdentity(opts?)`
derives from the master when handed options and is otherwise byte-identical to
the current CSPRNG path — and **no call site passes options**, enforced by a test
that greps the whole frontend. Frozen vectors (master → circle → index → secret
→ commitment) are pinned in `tests/zk-field-constants.test.mjs` because this
contract is a one-way door; the modulus itself is pinned three ways, including
cross-checks against circomlibjs and snarkjs.

22/22 new tests; `zk-e2e` still 23/23 across all three circuits (the real proof
the constant change broke nothing); `zk-integrity.sh` holds.

**Remaining (Steps 3–5):** the master keystore, rooted joins, and the ceremony's
load-or-create must land together — shipping them apart would open a window
where joins root on a master the ceremony does not shard — plus stale-shard
detection and the re-attach UI.

## E12 (F86–F89) — the AHA app: embedded wallet + native mobile shells (2026-08-12d)

A new epic: AHA becomes an app you install, with its own wallet — while every
existing web feature comes along unchanged.

**F86 — embedded wallet core.** A self-custodial wallet registered through the
**wallet-standard** runtime as "AHA Wallet" (`registerWallet` from
`@wallet-standard/wallet`, already present transitively — no new dependency).
Because the whole app talks to wallets through `useWallet()`, **no existing page
changed**: the embedded wallet simply appears in the wallet modal beside Phantom
and Solflare. Chains cover devnet/testnet/mainnet (matching what `lib/solana.ts`
can resolve to). The secret key is sealed **only** through the F65 keystore, raw
bytes wiped after the `Keypair` is built, and just the *public* key is cached so
the wallet can appear before unlock. Explicit connect **never silently creates a
key** — it refuses and points at Settings → Security; auto-connect restores from
the cached public key with no biometric prompt and defers unlock to the first
signature. `solana:signAndSendTransaction` is deliberately not implemented: it
would need an RPC connection inside the wallet module, and wallet-adapter already
falls back to sign-then-send app-side, which keeps the no-network boundary.

**F87 — `/wallet`.** Wallet-agnostic, so it serves the embedded wallet and any
external one identically: SOL balance and send (with fee headroom), QR receive
rendered locally, SPL token list and transfer across **both** Token and
Token-2022 with hand-encoded instructions and idempotent recipient-ATA creation
(no `@solana/spl-token` dependency added), and an NFT gallery that parses
Metaplex metadata PDAs defensively, resolves IPFS images, and isolates failures
per item.

**F88/F89 — native shells + pipeline.** `mobile/` is a Capacitor project
(appId `org.a13z.aha`) with android/ and ios/ scaffolds. **v1 deliberately loads
the deployed web app in the native WebView**, so every feature — reflections,
board, inbox, recovery, the embedded wallet — ships on mobile from day one; the
v2 path (bundled static export, deep links, push) is documented rather than
half-built. `.github/workflows/mobile.yml` is **workflow_dispatch only** (never
on push/PR, since this repo removed a failing required check): the Android job
produces debug + unsigned release APKs, the macOS job an unsigned `.xcarchive`,
both as artifacts. Store signing credentials stay with the user and never enter
the repo (`docs/mobile.md`).

## F42 / F43 / F65 / F64 — test hardening + passkey keystore (2026-08-12c)

**F42 — property/fuzz tests** (`programs/ayni/src/proptests.rs`, `proptest` 1.5
dev-dep): 12 properties, `cargo test -p ayni` 12/12 in 7.3s. Council vote
accounting over arbitrary approve/cancel/execute sequences (approved-count ≤ 7,
no double-count, `eligible_at` arms once at threshold then freezes, cancel always
wins before execution); full-range `i64` timelock arithmetic never panics;
quorum/pass math over the entire `u16` config space (no div-by-zero, rounding can
never pass a vote below the configured percentage, default = ceil(eligible/3),
default majority strict); Merkle insert/prove roundtrip, cross-leaf proof
rejection, capacity, `RecentRoots(16)` ring semantics; nullifier PDA determinism
and domain separation across all 7 seed families. Three behaviour-preserving
extractions (`Proposal::require_executable`, `quorum_threshold`, `vote_passes`,
`member_vote_outcome`) so the logic is testable; original call sites now call
them. `cargo check --workspace` clean.

**F43 — ZK end-to-end tests** (`tests/zk-e2e.test.mjs`, 23 tests, ~8s): real
Groth16 prove→verify roundtrips for **all three** circuits plus negative cases
(tampered signals, nullifier substitution, wrong/empty roots, refused witnesses
for non-members and over-level grants, forged disclosure values). Verifying-key
integrity checked byte-for-byte from zkey → in-tree Rust for all three keys, and
the browser artifacts under `frontend/public/zk/` proven byte-identical to
`build/` — the prover users run is the prover we test. **No drift found
anywhere.** Noted for cleanup: `frontend/lib/zk-vote.ts:17` labels the BN254
*base* field value as the scalar field (harmless today; secrets are masked
< 2^253 < r).

**F65 — passkey-unlocked local keystore** (`frontend/lib/keystore.ts`): three
modes, chosen honestly and reported to the member — **prf** (key derived from the
WebAuthn PRF output at each unlock, never stored), **largeBlob** (secret lives
inside the credential), **local** (non-extractable AES-GCM key in IndexedDB,
documented as weaker). AES-GCM-256 with the blob name bound as `additionalData`;
no enumeration API, mirroring `shardCustody`; serverless (local challenge,
attestation discarded, zero network calls). `/settings-security` surfaces the
mode. **The locked position holds:** the passkey is a device-local *unlock*,
never the credential of record, and never gates recovery — losing it is
survivable, and Epic 11 shard recovery remains the identity safety net.

**F64 (seeded)** — `frontend/lib/trustlist.ts` gains trust/block/mute per member
commitment, stored only as a keystore-sealed blob; writes refuse rather than
silently downgrade to plaintext when no keystore exists. UI consumers remain.

## F44 (partial) — Phase-2 ceremony tooling + runbook (2026-08-12c)

**Tooling and documentation only — no live zkey/VK was swapped; `programs/`
and `frontend/` untouched.** The ceremony itself (real contributors, published
transcript, key swap) remains open; the swap is specified as its own
Sentinel-gated, program-redeploy round (`docs/ceremony.md` §7).

- `scripts/ceremony/{init,contribute,verify,finalize,transcript,common}.mjs` —
  plain node 18, snarkjs 0.7.6 from `frontend/node_modules`; all output confined
  to the gitignored `ceremony/` dir (`.gitignore` entry added). `verify.mjs` is
  tiered (full r1cs+ptau → init+ptau → init-only partial → unverified listing)
  and states exactly what a verifier machine still needs. `finalize.mjs` applies
  the beacon, exports the vkey JSON, and **prints** the `verifying_key*.rs` diff
  (candidate written under `ceremony/`, never to `programs/`). `exec`: dry-run
  on `member_vote` with 2 simulated contributors + simulated beacon — chain
  verified (tier 3 partial pass: everything except the ptau-dependent H-section
  check), tampered-zkey negative test correctly INVALID, VK diff showed only
  `vk_delta_g2` changing.
- `docs/ceremony.md` — threat model (1-of-N honest participant; beacon closes
  last-contributor bias), Mode A (extend current chain) vs Mode B (fresh setup
  from a public ptau — recommended for mainnet), Solana-blockhash beacon rule,
  independent verification tiers, and the exact swap-round procedure
  (`scripts/vk_to_rust.js` + const renames + `tests/sentinel/zk-integrity.sh`).
- Known gaps for the real ceremony (documented in §8): the original
  `pot16_final.ptau` and `*.r1cs` are not in git, and the circom version used
  for the shipped build was never recorded.

## F85 / F66 — Epic 11 recovery UX + blinded guardian keys (2026-08-12b)

**F85 — the recovery UX** over F72–F78's tested cores. Everything below is
**purely local**: no recovery file imports web3/anchor/wallet or makes any
network call (grep-gated by Sentinel), and nothing about local recovery ever
emits on chain — per the locked positions.

- **Shard ceremony** (`/recovery/setup`): 2-of-3 split of the master secret;
  member shard sealed into local custody under a **one-time code shown once**
  (16-char, no-lookalike alphabet, write-it-down gate); two sequential
  **in-person** sponsor handovers with confirm-received checkpoints; a member
  with one sponsor gets the honest F78 dead-end (no fake ceremony).
- **Handover** (`ShardSend` / `ShardReceive`): QR rendered locally (`qrcode`),
  Web NFC (mime `application/vnd.aha.shard`) where available, native
  `BarcodeDetector` camera scan where available, and a typed-code fallback
  everywhere — no JS QR-decode dependency, no network path, shards never touch
  storage in the I/O layer.
- **Recovery wizard** (`/recovery`): member-present (own shard + one sponsor →
  immediate, bit-identical restore; a sponsor blob cannot open under the
  `member` seal key, so two sponsor shards cannot masquerade), sponsor-only
  (7-day window, display-only countdown, gate is `windowElapsed` re-checked at
  click, stored window clamps UP if tampered, "your existing device can cancel"
  note), cancel-from-existing-device (burns collected blobs + clears the local
  intent), and a **mandatory burn-and-reissue** epilogue after any recovery that
  consumed a sponsor shard.
- **Shared sealing** (`lib/shardSeal.ts`): key = SHA-256("aha-shard-seal-v1:
  <role>:" + code), `nacl.secretbox`, blob = nonce(24)‖box; `openSponsorShard`
  tries both sponsor role keys (payloads carry no role marker by design).
- **Hygiene**: 21 `fill(0)` wipe sites; master only ever in a ref; secrets never
  in React state, logs, or storage. F78 disclosure also added to `/onboarding`'s
  finishing step; `/me` gained a Recovery entry card.

**F66 — blinded one-time guardian keys** (`lib/recoveryKeys.ts`): the on-chain
`recovery_keys[2]` must never hold raw sponsor pubkeys (public member↔sponsor
link). Derivation: HKDF-SHA-512 (WebCrypto), salt/tag `AHA-F66-recovery-v1`,
info = memberCommitment ‖ u64le(epoch) → `Keypair.fromSeed`; unlinkable without
the sponsor secret, epoch rotation = single-use; sponsor-side
`proveRecoveryControl` re-derives to sign an actual guardian rebind. **This is
the F9/F10/F11 on-chain migration mechanism — distinct from local recovery.**
11/11 node tests pass. Deliberately NOT yet wired into `issueMembership`
(`lib/member.ts:251` still passes `PublicKey.default`) — that change affects
what lands on chain at issue time and ships as its own follow-up.

Frontend-only. `tsc --noEmit` clean.

---

## F82 / F83 / F84 — Reflections default mode, home slogan, /me ZK note (2026-08-12)

**F82 — /reflections default mode + browse-by-day calendar.** Previously the page
only rendered a reflection when a Circle had published one for *today*; otherwise
it showed a "no entry" status. Now, when no Circle entry exists for the chosen
day, the page falls back to a **built-in Daily Reflection** shipped with the app.

- Source data: `daily_reflexions/daily_reflexions.xlsx` (161 dated entries,
  denominations across Christian / Buddhist / Taoist / Greek / Hermetic /
  Rosicrucian / Shamanic / Analytical-Psychology) → extracted **once** to a typed
  TS module `frontend/lib/daily-reflections-default.ts` (keyed `MM-DD`), so there
  is no runtime xlsx parsing.
- `frontend/lib/reflections.ts` resolves a day to its exact entry or the **nearest
  available day** by circular calendar distance (today 08-12 → 08-13; 12-31 →
  01-01 wraps; 02-29 → 03-01).
- Layout is aa.org-inspired: **title in XL bold**, the localised current date
  under it, the **quote in bold** with an accent rule, attribution, then the
  reflection body, then source / 12-step tag. Badge distinguishes a built-in
  reflection from a Circle-published one.
- A **calendar** (Monday-first, localised month + weekday names via
  `toLocaleDateString(lang)`, a dot on days that have an entry, today + selected
  highlighted) lets any day be browsed; a selected Circle's own entry for that
  day still takes precedence over the built-in.
- **Reflection content stays in its source language** — the quotes are sourced
  material (scripture, philosophy, literature); only the surrounding chrome is
  localised (18 locales) plus the date. This is a deliberate honesty/quality call,
  not an omission.

**F83 — home slogan + invisible Core-Shamanism link.** Under the "Ancestral
Humanity Anonymous" title: *"AHA is a 12 step Core Shamanism recovery and
spiritual development program for human beings, built on trust, lineage, and
proven ancestral wisdom."* The phrase **"Core Shamanism"** is an **unobtrusive
link** — visually identical to the surrounding text (no underline, colour, weight,
or cursor change) — opening `https://www.shamanism.org/core-shamanism/` in a new
tab. Localised across 18 locales; "AHA" and the verbatim phrase "Core Shamanism"
are preserved in every translation so the split-and-link stays reliable.

**F84 — /me anonymity note + ZK explainer link; Ayni tooltip order.** The /me
getting-started note now reads *"Everything here is truly anonymous by default —
a membership is a ZK commitment (using zero-knowledge proofs technology), not
your name."*, with the italic phrase **"zero-knowledge proofs technology"**
linking to the Wikipedia zero-knowledge-proof article in a new tab. Implemented
via a `{zk}` placeholder kept verbatim in all 18 non-English translations
(verified exactly once per locale); a translation that lost the placeholder
would degrade to plain text, never break. The Ayni brand tooltip in the top nav
now lists **GitHub ↗ before Wikipedia ↗**.

Frontend-only; no program / circuit / on-chain surface touched. `tsc --noEmit`
clean. (`next build` still needs Node ≥20; sandbox has 18 — environment
limitation.)

---

## 0b. Round update — 2026-08-11b (72 instructions) — the anonymity layer

Verified natively: `anchor build` clean, **72** instruction files; bare
`anchor test` = **102 passing / 0 failing** (+`epic2`, +`relayer`, +`mailbox`);
frontend `tsc --noEmit` clean; privacy-sweep green. An **ultracode adversarial
review** followed the first commit; its confirmed findings were fixed in the
same round (see below).

New this round:
- **F55 relayer** (`code`, `exec`) — `app/api/relay/route.ts`, `lib/relayer.ts`,
  pure `lib/relayPolicy.ts`. `tests/relayer.ts` exercises the refusal matrix and
  proves an allowlisted instruction accepts a third-party fee-payer with the
  member's wallet nowhere in the tx. Wired into cast_vote / attest_admission_zk /
  send_message / publish_maci_message and the F54/F56 cranks.
- **F54** (`code`, `exec`) — `note_root`, `begin_member_epoch`, `reinsert_member`;
  `RecentRoots`(16)/`EpochLeaf` state; `tests/epic2.ts` proves the ring buffer
  keeps a superseded root provable, the epoch rebuild drops an expired member,
  and double-reinsertion is refused.
- **F56** (`code`, `exec`) — `publish_member_root`, `verify_fellow_member`;
  `CircleRootAnchor`/`VisitPass`; parentage + garbage-proof rejection asserted.
- **F63 v1** (`code`, `exec`) — off-chain mailbox: `app/api/mailbox/route.ts`,
  `lib/mailbox.ts`, pure `lib/mailboxCrypto.ts`; `tests/mailbox.ts` (seal/open,
  tamper→null, forward-secrecy, no-network-sink).
- **F80 UI**, **F71** geolocation removal, **Message::CT_LEN 1040→528** (a latent
  unsendable-tx bug the F55 test surfaced, not just a rent optimization).
- **Ultracode fixes (post-first-commit, same round):** F56 `approve_federation_child`
  — a foundation Council seat must vouch a child before its root can be anchored,
  closing a CRITICAL federation-infiltration hole (self-claimed `parent` was not
  consent; `tests/epic2.ts` "federation-infiltration fix"); mailbox reads/deletes
  now authenticated with a **wallet-derived** id (the IK-derived id was
  attacker-spoofable); relayer gained a **daily-lamports** money cap; and three
  LOWs (orderedCommitments undefined-guard, MAX_PLAINTEXT, stale 1040 doc refs).
- Decisions: ADR **0002** (quantum-resistance architecture), **0007**
  (open-membership→bootstrap), **0008** (public rank accepted, user waiver);
  `docs/sybil.md` rewritten; `docs/emerald-table.md` (E3 hexes).
- **F50/F51/F52** flipped to ✅ (suites green). **F46** checklist now covers 51
  rows (F54/F55/F56/F63/F71 entries added this round); `tests/sentinel/baselines/`
  created.

**Devnet deploy — LIVE (2026-08-11).** Program `AHAHnRiJEANtYJpWZxGZZa63ZTFzMa5e5Q8DszCgavSG`
deployed to devnet at slot 482959561; ProgramData `3insiXJ8bGaeLjkGFNYdM6AmdP4DQsd1ejkSrFCMcp3p`;
upgrade authority `AHAimdiM1YwRDzbY9htW8WcDmz831C6Va6QXNQHs1nYk`; 1,309,528 bytes;
9.11520576 SOL rent-exempt; deploy tx
`2Zwwp4YAp9QjDYzwfvi6v3giroQw7F2HDWPxze2kCz1R2gVtFgyJUfzmevVWfuoC3RrDqtqEqurXvu2mbXbMpZAY`.
The prior funding blocker (deployer < program rent) is cleared. `claimed-only` rows
above remain claimed-only until an on-cluster e2e run against this program confirms them.

**Security hardening round (2026-08-11c).** An adversarial find→verify sweep
(13 agents) surfaced 8 confirmed findings across the anonymity layer; all fixed:

- **HIGH — `reinsert_member` double-insert** (found independently by two lenses):
  a member added during a live epoch could be re-inserted, inflating
  `next_index`/`member_count` (quorum-inflation governance DoS) and corrupting the
  append-only tree. Fixed two ways: `reinsert_member` now requires
  `membership.issued_at < recent_roots.epoch_started_at` (blocks direct issuance),
  and `confirm_admission` mints the `["epochleaf", circle, epoch, commitment]`
  marker whose `init` collides with `reinsert_member`'s (blocks the
  provisional-confirmed-during-epoch path). `confirm_admission` now REQUIRES
  `recent_roots` (was optional — a seat could omit it to skip the marker), so
  circles must crank `note_root` once before the first two-sponsor confirmation;
  the client does this automatically. **Program logic changed → devnet redeploy
  pending funding** (deployer 3.38 SOL < ~9 SOL upgrade buffer; airdrops
  rate-limited). The live devnet program is the pre-hardening build until then.
- **MED — relayer daily budget** burned by invalid/`X-Forwarded-For`-spoofed
  requests, and **money caps TOCTOU-racy** under concurrency: the daily tx count
  now increments only for validated requests, a global (unspoofable) rate limit
  backstops per-IP, and lamports/balance caps reserve a conservative cost before
  signing and reconcile after.
- **MED — mailbox prekey `bundle` op is an enrollment oracle**: inherent to any
  prekey directory (the true fix is PIR/OPRF contact discovery = F63 v2);
  throttled by the new global limiter and documented as a bounded residual.
- **MED — fresh-device SPK epoch reset**: a reset device restarted at epoch 1 and
  the server's monotonic rule rejected it, killing inbound mail. The client now
  advances past `max(local, directory)` so delivery self-heals.
- **LOW — mailbox `put` flood** could pin a victim's box full and hard-block
  delivery: switched from 507-reject to FIFO eviction, so new mail always lands.

Two adversarial finders converging on the same HIGH raised confidence it was
real, not speculative.

**Follow-up re-check (2026-08-11d).** A second adversarial find→verify sweep
(17 agents) over the hardening diff confirmed the 8 fixes and every CRITICAL
privacy / double-insert invariant held; 12 candidates yielded 2 availability-only
survivors, both fixed:

- **MED — mailbox global rate-limiter coupled all ops** (a regression from the
  new global limiter): keyed by nothing (one module-wide bucket), it gated
  `get`/`ack`/`publish` as well as the abuse-prone `bundle`/`put`, so a cheap
  bundle-probe or put-flood (~4 req/s, no header to rotate) could 429 message
  reads and deletes for every member service-wide. The global cap is now scoped
  to only `bundle`+`put`; reads/deletes stay on the per-IP gate. Added
  `Retry-After: 60`.
- **LOW — relayer `dayCount` inflated on rejected requests**: `overDailyTxBudget`
  incremented as a side effect *before* the balance/lamports checks and the send,
  so ~500 policy-valid-but-failing requests could exhaust the daily budget and
  503 every honest caller until UTC midnight. Split into a pure
  `wouldExceedDailyTxBudget()` check + `recordTx()` committed only after a relay
  lands. (Lamports remain the money backstop; this was availability-only.)

Both are frontend relay/mailbox route changes only — no program logic touched, so
no redeploy implication.

---

## F81 — Full-page localisation, 19 locales (2026-08-12)

Before this round only the app **chrome** (~13 keys: nav, tagline, hero, footer,
control labels) was localised; every page **body** rendered hardcoded English no
matter the chosen locale (the reported symptom: picking ไทย/Thai translated only
the top menu). This round extends `t()` to the bodies of every page —
`me`, `foundation`, `admin`, `board`, `create`, `onboarding`, `inbox`,
`reflections`, `documents`, `notifications`, `member` — under per-page key
namespaces (749 page keys), and **fills all non-English dictionaries**.

- **Quechua (`qu`, "Runa Simi") added** as the 19th language; the switcher now
  carries en, fr, es, se, th, hi, zh, de, sv, nb, da, ar, lo, dz, bo, my, vi, tl, qu.
- Page-body strings live in a generated registry (`frontend/lib/i18n.generated.ts`,
  `PAGE_STRINGS`): `en` (749 keys) + 18 non-English locales, each with the 749 page
  keys plus the 8 curated `msg.*` keys, all translated. Resolution chain:
  `DICT[lang] ?? PAGE_STRINGS[lang] ?? en ?? PAGE_STRINGS.en ?? key`, so a missing
  translation degrades to English, never to a raw key.
- `Key` loosened from a closed union to `string`; the hand-written `en` dict stays
  the canonical registry and fallback.
- Localised the shared messaging-enable UI and added a **Devnet network-mismatch
  caveat** (`DevnetSignNote`, shown only when `CLUSTER === "devnet"`): tells the
  member to switch their wallet to Devnet when it warns of a network mismatch.
- **Honest inbox metadata explainer** — deliberately does **not** claim the
  contact graph is hidden. The sealed-sender design hides *who wrote* to you, but
  the v1 relay still sees recipient-side metadata (which mailbox, when); mixing/PIR
  is the un-shipped v2 step. The copy says exactly that (same discipline as not
  advertising un-shipped coercion-resistance).
- Board Circle-picker now lists only Circles the connected wallet **belongs to**
  (active membership), falling back to the full public list for non-members so the
  board stays browsable — no cross-member membership leak.
- Proper nouns (AHA, Ayni, Solana, SOL, Devnet) and dynamic values stay unwrapped.

Frontend/UI only — no program, circuit, or on-chain surface touched; the locked
recovery/shard positions are untouched. `tsc --noEmit` clean. (`next build` needs
Node ≥20; sandbox has 18 — environment limitation, not a code issue.)

---

## 0. Round update — 2026-08-11 (66 instructions)

Verified natively this round (host now has cargo/anchor/solana + portable node 18):
`anchor build` clean, **66** instruction files, `.so` = **1,189,664 bytes**; bare
`anchor test` = **83 passing / 0 failing**; frontend `tsc --noEmit` clean; Sentinel
Layer D privacy-sweep + Layer F (Epic 11) green (NRR-2026-08-11-5, **PASS**).

New / changed since the 58-instruction snapshot below:
- **E1 two-sponsor admission** instructions (attest_admission, attest_admission_zk,
  issue_provisional_membership, confirm_admission, set_two_sponsor_admission).
- **F80 `withdraw_treasury_token`** + `ProposalAction::WithdrawTreasuryToken` —
  closes a confirmed permanent SPL/Token-2022 fund-lock in `donate_token`
  (`docs/security-review-2026-08-11.md`). Tested e2e in `tests/audit-fixes.ts`.
- **Security fixes** (same review): federation parentage binding (2 CRITICAL,
  `tests/federation.ts`), member_migrate owner-only (HIGH, `tests/cosign.ts`),
  MigrateWallet seat-dedup + negative-timelock reject (`tests/audit-fixes.ts`).
- **Epic 11 handover** (F74/F79): `frontend/lib/shardHandover.ts` (pure, no network
  sink) + `frontend/components/ShardHandover.tsx` (NDEFReader + honest disclosure);
  `tests/sharding.ts` now 13 cases.
- **Deploy cost**: `opt-level = "z"` + strip + `anchor-spl` default-features off.

Sections 1–7 below are the Round-1 (2026-08-10) snapshot at `aea1438`; treat this
section as the current head. `BACKLOG.md`'s 2026-08-11 round note is authoritative.

## 1. Ground truth: the toolchain

Sentinel Round 1 found **no native toolchain** on this host — no `cargo`,
`rustc`, `anchor`, `solana`, `node`, `npm`, or `circom` on `PATH`, and none under
`~/.cargo`, `~/.rustup`, `~/.nvm`, or `~/.local/share/solana`. Only Docker is
available. Every build/test result below was obtained by running official
`rust:1-slim` and `node:20-alpine` containers against an **isolated copy** of the
repository, so the working tree was never mutated.

Consequences:

- `anchor build` / `cargo-build-sbf` (the **BPF/SBF** target) could **not** be
  run — the Solana platform-tools are not installable in this round's budget.
  What was verified is the **host-target** `cargo check`, which type-checks and
  borrow-checks all program code but does not prove the BPF stack/heap limits or
  produce a `.so`.
- `anchor test` could not be run — it requires `solana-test-validator`.
- Anything marked `claimed-only` below stays claimed-only until a round has
  cluster access.

**BACKLOG.md drift:** the whole-repo caveat at `BACKLOG.md:18` — *"nothing is
compiled yet — no Solana/Anchor/circom toolchain present"* — is **false for the
Rust code** as of this round: `cargo check --workspace --all-targets` completes
with **0 errors** (67 warnings). It is **true for this host's toolchain**. The
caveat conflates two different things and should be split. **Resolved
2026-08-10:** the BACKLOG.md header now states the split truthfully (host-target
`cargo check` clean; `anchor build` containerized; no native host toolchain).

---

## 2. On-chain program — `programs/ayni/`

**54 instructions** at Sentinel's Round 1 snapshot (`aea1438`); **58** as of the
Epic 0 faucet landing (`programs/ayni/src/instructions/*.rs`, excluding
`mod.rs`), matching **58** `pub fn` entry points in the `#[program]` module of
`lib.rs`.

> **BACKLOG.md drift (documentation):** `BACKLOG.md:185` is headed
> *"Instruction index (25)"* and lists 25 names. **29 shipped instructions are
> absent from that index:** `approve_child_close`, `approve_child_rotation`,
> `close_circle_profile`, `create_post`, `delete_message`, `delete_post`,
> `donate_token`, `end_wing_peer`, `establish_wing_peer`, `execute_child_close`,
> `execute_child_rotation`, `install_elected_seat`, `issue_progress_token`,
> `link_seat_election`, `open_maci_round`, `propose_child_close`,
> `propose_child_rotation`, `publish_maci_message`, `register_messaging_key`,
> `revoke_membership`, `send_message`, `set_circle_config`, `set_circle_country`,
> `set_meetings`, `set_open_membership`, `set_treasury_allow`,
> `set_treasury_wallet`, `update_circle_location`, `upsert_circle_profile`.
> **Resolved 2026-08-10:** BACKLOG.md's index now lists all 58 entry points
> (and drops `appoint_seat`, which was never one).

### Membership & identity
| Feature | State accounts | Verified |
|---|---|---|
| F1 Soulbound yearly membership, ZK-commitment keyed (`issue_membership`, `renew_membership`) | `Membership` | code, built |
| F2 Optional `owner` wallet for selective disclosure | `Membership.owner` | code, built |
| F3 Token-2022 NonTransferable mint (`create_membership_mint`, `set_membership_mint`, `mint_membership_token`) | `Circle.membership_mint` | code, built; devnet = claimed-only |
| F31 Open vs Secretary-gated admission (`set_open_membership`) | `OpenMembership` | code, built |
| F4 Social vouching (authority-gated `issue_membership`) | — | code, built |
| F5 Anonymous proof-of-personhood (`set_personhood`, `prove_personhood`) | `PersonhoodCredential` | code, built |

### Governance & voting
| Feature | State accounts | Verified |
|---|---|---|
| F6 Anonymous member voting (`initialize_member_tree`, `create_member_proposal`, `cast_vote`, `finalize_member_proposal`) | `MemberTree`, `MemberProposal`, `Nullifier` | code, built; **circuit exec** (see §4) |
| F7 7-seat Council 4-of-7 (`propose`, `approve`, `execute_proposal`, `cancel_proposal`) | `Council` (`council.rs`) | code, built |
| F8 Forkable federated Circles (`initialize_circle`) | `Circle` | code, built |
| F28 Member election of Council seats (`link_seat_election`, `install_elected_seat`) | `SeatElection` | code, built; devnet e2e = claimed-only |
| F34 Foundation-led federation governance (child rotation / close) | `ChildSeatVote`, `ChildCloseVote` | code, built |
| F39 MACI submission + processing (`open_maci_round`, `maci_signup_commit`, `maci_signup`, `publish_maci_message`, `close_maci_round`, `process_maci_messages`) | `MaciRound`, `MaciMessage`, `MaciState`, `MaciSignup`, `MaciSignupCommit` | code, built, localnet e2e (`tests/maci.ts`, real ZK proofs). Enforced by the program: one-member-one-voice ZK sign-up (commit–reveal, domain-separated nullifier), permissionless freeze at the deadline, and a `chain_digest` folded in strict index order — no replay, no reorder, no censoring. |
| F39 MACI tally (`commit_maci_tally`, `finalize_maci_round`) | `MaciState.tally_*` | **DISABLED ON CHAIN** — both return `MaciTallyUnverified`, and `finalize_maci_round` never writes `MemberProposal.passed`. The chain cannot verify a MACI tally without the process/tally circuits (F44), and an unverified result must not reach `install_elected_seat` or `refill_faucet` (Sentinel NRR-2026-08-12-f60-f61-maci, CRITICAL). Results are computed and audited off chain via `coordinatorTally`; see docs/maci.md §4.1. |

### Resilience & recovery
| Feature | Verified |
|---|---|
| F9 Key recovery / MigrateWallet / SetAuthority, `recover_membership` | code, built |
| F10 Migration time-lock + any-seat contest | code, built |
| F11 Member co-signature & self-recovery, ≤2 guardians (`set_recovery`, `member_migrate`) | code, built |

### Lineage & credentials
| Feature | State accounts | Verified |
|---|---|---|
| F12 ZK lineage level grants (`initialize_lineage`, `grant_level`) | `Lineage`, `LevelGrant` | code, built; **no e2e proof test** |
| F13 Acknowledgment credentials (`issue_acknowledgment`) | `Acknowledgment` | code, built; **no e2e proof test** |
| F14/F15 ZK selective disclosure + predicates (`ack_disclose.circom`) | — | circuit compiled + VK verified (§4); **no e2e proof test** |
| F16 On-chain predicate-gated access (`verify_disclosure`) | `AccessPass` | code, built; **no e2e proof test** |

### Treasury
| Feature | State accounts | Verified |
|---|---|---|
| F17 Donation treasury (`donate`, `donate_token`, `withdraw_treasury`) | treasury PDA | code, built |
| F29 Treasury steward wallet must be a multisig (`set_treasury_wallet`) | `TreasuryConfig` | code, built; devnet = claimed-only |
| Treasury spend allowlist (`set_treasury_allow`) | `TreasuryAllow` | code, built |
| Per-Circle policy (`set_circle_config`) | `CircleConfig` | code, built |

### Community & content
| Feature | State accounts | Verified |
|---|---|---|
| F30 Member posts / bulletins (`create_post`, `delete_post`) | `Post` | code, built |
| F32 Encrypted 1:1 messaging (`register_messaging_key`, `send_message`, `delete_message`) | `MessagingKey`, `Message` | code, built |
| F18/F19/F21 Circle directory (`upsert_circle_profile`, `update_circle_location`, `close_circle_profile`) | `CircleProfile` | code, built |
| F18b Meeting schedule (`set_meetings`) | `CircleMeetings` | code, built |
| Circle country (`set_circle_country`) | `CircleCountry` | code, built |
| WingPeer mentor bond (`establish_wing_peer`, `end_wing_peer`) | `WingPeer` | code, built |
| Progress-token milestone chips (`issue_progress_token`) | `ProgressToken` | code, built |

### F35 — Epic 0, the gas faucet (**shipped this round**)
Landed mid-Round-1; now registered as **F35** in BACKLOG.md and documented in
`docs/faucet.md`. Four instruction files plus edits to `state.rs`, `errors.rs`,
`lib.rs`, `instructions/mod.rs`:

| Instruction | File | Verified |
|---|---|---|
| `init_faucet` (any seat) | `instructions/init_faucet.rs` | code, built |
| `set_faucet_amount` (Treasurer, capped on-chain) | `instructions/set_faucet_amount.rs` | code, built |
| `activate_faucet` (parrain via WingPeer bond, one-shot per membership commitment — nullifier `["faucetnull", circle, commitment]`) | `instructions/activate_faucet.rs` | code, built |
| `refill_faucet` (passed member vote committing `sha256("AHA-faucet-refill" ‖ circle ‖ amount_le)`, one-shot marker, permissionless) | `instructions/refill_faucet.rs` | code, built |

New state: `FaucetJar` (`["faucet", circle]`, lamports on the account), consts
`FAUCET_MAX_GRANT_LAMPORTS = 2_000_000`, `FAUCET_DEFAULT_GRANT_LAMPORTS =
1_500_000`. New errors: `FaucetCapExceeded`, `FaucetInsufficient`, `NotParrain`,
`NeophyteWalletUnset` (plus `WalletMismatch` reuse).

**Tests/coverage:** program code complete and type-checked (`cargo check` clean
2026-08; containerized `anchor build` in use). **No dedicated test suite or UI
yet** — frontend and tests are in flight this round; nothing faucet-related is
`exec`-verified. Privacy assessment (Round 1 report + `docs/faucet.md` "Pilot
limitations"): strong on the one-shot / cap / vote-gated-refill rules; weak on
parrain↔neophyte unlinkability, acknowledged as a pilot limitation pending
Epic 2 ZK vouch-proofs and the Epic 10 relayer decision.

---

## 3. Circuits — `circuits/`

Three circom circuits, all **compiled**, with committed proving keys and witness
wasm under `build/` (tracked in git):

| Circuit | nPublic | Artefacts | Embedded VK |
|---|---|---|---|
| `member_vote.circom` (depth 20) | 4 | `member_vote_final.zkey`, `member_vote_js/member_vote.wasm`, `member_vote_vkey.json` | `verifying_key_vote.rs` |
| `lineage_grant.circom` | 4 | `lineage_grant_final.zkey`, `lineage_grant_js/…`, `lineage_grant_vkey.json` | `verifying_key.rs` |
| `ack_disclose.circom` | 17 | `ack_disclose_final.zkey`, `ack_disclose_js/…`, `ack_disclose_vkey.json` | `verifying_key_ack.rs` |

**Verified this round (`exec`)** — see report §Layer C:
- Re-exporting the verification key from each committed `*_final.zkey` reproduces
  the committed `*_vkey.json` **exactly** for all three circuits.
- Re-running `scripts/vk_to_rust.js` on each committed vkey reproduces the
  constants in the corresponding `verifying_key*.rs` **exactly**.
- All three embedded VKs are **real**, not placeholders (1540 / 1543 / 3201
  non-zero constants). This confirms the BACKLOG.md 2026-06 update.

**Trust caveat (unchanged, and important):** the phase-2 ceremony was
**single-contributor**. That is adequate for devnet and a trust weakness for
mainnet, exactly as BACKLOG.md states.

`frontend/public/zk/` ships `member_vote.wasm` + `member_vote_final.zkey` to the
browser for in-browser proving. Only `member_vote` is shipped to the client.

---

## 4. Frontend — `frontend/` (Next.js 16.2.9, React 19)

Builds clean this round: `tsc --noEmit` exit 0, `next build --webpack` exit 0,
13 routes.

| Route | Feature |
|---|---|
| `/` | landing |
| `/me` | F22 My Circle console, F6 in-browser ZK voting, F33 profile, mentorship + chips, embedded F24 admin |
| `/admin` (component `CircleAdmin.tsx`) | F24 seat-gated administration |
| `/create` | F23 Create-a-Circle wizard |
| `/board` | F30 posts |
| `/inbox` | F32 encrypted messaging |
| `/notifications` | in-app notifications centre |
| `/foundation` | F34 federation governance |
| `/documents`, `/reflections` | IPFS-backed shared material |
| `/api/circle-email` | F25 mail send route (**Node runtime, server-side**) |

Client libraries: `lib/zk-vote.ts` (browser prover), `lib/messaging.ts`,
`lib/maci.ts`, `lib/member.ts`, `lib/admin.ts`, `lib/multisig.ts`,
`lib/notifications.ts`, `lib/posts.ts`, `lib/meetings.ts`, `lib/profile.ts`,
`lib/jazzicon.ts`, `lib/solana.ts`, `lib/ipfs.ts`, `lib/foundation.ts`,
`lib/country.ts`, `lib/circleEmail.ts`., `lib/mobileWallet.ts`.

**F95 — mobile wallet connect (2026-08-14).** `@solana/wallet-adapter-react`
injects a `SolanaMobileWalletAdapter` by itself on any Android UA that is not a
WebView, including browsers that cannot complete the association. On Firefox for
Android the wallet opens cold and the tab spins forever — reproduced with both
Solflare and Phantom, which is what identifies it as a browser problem rather
than a wallet one. `components/MobileWalletNotice.tsx` says so before the tap and
offers to reopen the site inside the wallet's own in-app browser, where Wallet
Standard registration works normally. The offered wallets come from
`wallets.json` and are shuffled (T6); a wallet qualifies only by publishing a
documented `browse` universal link. Covered by the `mobile-firefox-android`
Playwright project (`e2e/mobile-wallet.spec.ts`) — added because the existing
"no third-party requests" test ran desktop-only and never mounted this component
— and by `tests/sentinel/e12-wallet-check.sh` §8c.

**Known gap in this section:** F93 and F94 shipped without rows here. The table
above lists 13 routes and has not been reconciled since; `/get-app`, `/glossary`,
`/onboarding`, `/twelve*`, `/settings-security` and `/wallet` are all live and
absent from it. Recorded rather than quietly patched, because reconciling it
properly means walking the whole route tree, not appending three lines.

---

## 5. Off-chain — `indexer/`

`indexer/email-indexer.js` — F25 send-worker. Polls `Circle` and `Membership`
accounts and POSTs `{kind, circleName, circlePubkey, memberAddress}` to
`/api/circle-email`. Baseline-safe on first run. **Status 🟡 in BACKLOG.md and
here**: mailbox *receive* (MX + inbound route) is a DNS task, not code.

**Privacy note carried into the report:** the `join` payload contains the new
member's **wallet address**, and `/api/circle-email` has **no authentication or
rate limiting** of any kind.

---

## 6. Tests that exist — `tests/`

| File | Kind | Runs without a validator? |
|---|---|---|
| `tests/jazzicon.ts` | pure unit (8 cases) | **yes** — 8/8 pass this round |
| `tests/ayni.ts` | Anchor integration (3 cases) | no — needs `solana-test-validator` |
| `tests/cosign.ts` | Anchor integration (2 cases) | no |
| `tests/resilience.ts` | Anchor integration (3 cases) | no |
| `tests/profile.ts` | Anchor integration (4 cases) | no |
| `tests/vote.ts` | Anchor + real ZK proof (3 cases) | no |
| `tests/f28-election.ts` | **script, not a suite** — devnet, needs `~/.config/solana/aha-deployer.json` | no |

There is **no** Playwright/e2e suite, **no** API-contract suite, **no**
adversarial suite, and **no** `tests/sentinel/` directory. See the report's
Coverage gaps.

---

## 7. Spec infrastructure that does not exist

Verified absent at `aea1438`: `tests/sentinel/` (and `checklist.yaml`,
`baselines/`, `fixtures/`), `packages/proofs`, `reports/sentinel/` (created by
this round), and the npm scripts `test:e2e`, `test:api`, `test:adversarial`.
`.github/workflows/` exists but contains only `ci.yml` — there is no
`sentinel.yml`.

The epics **E0–E9** named in the Sentinel spec come from
`backlog/AHA_Trust_Platform_Backlog.md` (a newer product backlog, untracked in
git as of this round). Apart from the E0 faucet code that landed mid-round, they
are **not built**; the shipped surface is the F-series above.
