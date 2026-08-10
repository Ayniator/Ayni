# Non-Regression Report — 2026-08-10 — Round 1

**Verdict: FAIL**

Scope: **F-series features actually shipped** (F1–F34 per `BACKLOG.md`, verified against code — see `docs/shipped.md`), plus the **uncommitted Epic 0 gas-faucet code that landed mid-round**.
Commit: `aea1438fa8bca238246d1956b423338b8725839e` (branch `solana`), **working tree dirty** — see Regression R0.
Previous baseline: **none — this is the first Sentinel round ever run on this repository.**

> **Read this first.** FAIL here does **not** mean "something broke." Nothing broke — there was nothing to break against, because no baseline existed. Every build that could be run, ran clean, and every proof check passed. The FAIL is triggered by the spec's own rule that a privacy-invariant violation is automatically CRITICAL, and Round 1 found three of them. All three are **structural properties of the shipped design**, not new bugs, and two of them are already acknowledged in the source code's own comments as known limitations. The plain-language explanation is at the end.

---

## Scope correction — the spec's assumed layout does not exist

The Sentinel spec was written against a project layout this repository does not have. Verified absent at `aea1438`:

| Spec expects | Reality |
|---|---|
| `docs/shipped.md` | **absent** → created this round (spec §1 authorises this) |
| `tests/sentinel/checklist.yaml` | **absent** |
| `tests/sentinel/baselines/` | **absent** |
| `tests/sentinel/fixtures/` | **absent** |
| `packages/proofs` | **absent** (circuits live in `circuits/`, artefacts in `build/`) |
| `npm run test:e2e` | **absent** — no Playwright suite exists |
| `npm run test:api` | **absent** |
| `npm run test:adversarial` | **absent** |
| `reports/sentinel/` | **absent** → created this round |
| `.github/workflows/sentinel.yml` | **absent** (`.github/workflows/ci.yml` exists) |

Epics **E0–E9** come from `backlog/AHA_Trust_Platform_Backlog.md` (untracked in git). Apart from E0's faucet code, which appeared mid-round, **they are not built**. Layers A/B/C of the spec's checklist are therefore largely *forward-looking*, and Round 1 maps them onto the F-series that actually shipped.

**Host toolchain:** no `cargo`, `rustc`, `anchor`, `solana`, `node`, `npm`, or `circom` on `PATH`, and none under `~/.cargo`, `~/.rustup`, `~/.nvm`, `~/.local/share/solana`. Only Docker. **Every result below was produced by running official `rust:1-slim` / `node:20-alpine` containers against an isolated copy of the repo** — the working tree was never mutated. This is a finding (E1), not a hidden limitation.

---

## Summary table

| Layer | Tests | Pass | Fail | New since last round |
|-------|------:|-----:|-----:|---------------------|
| A — UX / end-to-end | 8 | 8 | 0 | all 8 (baseline round) — but see gap: **no e2e suite exists**, these 8 are the `tests/jazzicon.ts` unit cases |
| B — API contract & security | 0 | 0 | 0 | none — **no API suite exists**; 1 endpoint (`/api/circle-email`) wholly uncovered |
| C — Proof layer / contracts | 11 | 11 | 0 | all 11 (baseline round); **15 further Anchor cases exist but could not run** (no validator) |
| D — Privacy invariants | 13 | 8 | 5 | all 13 (baseline round) — 7 assertions + 6 forbidden-pattern sweeps |
| E — Build health | 10 | 5 | 3 | all 10 (baseline round); 2 not runnable |
| **Total** | **42** | **32** | **8** | — |

Layer E "not runnable": `anchor build` (BPF/SBF target) and `anchor test` — both need Solana platform-tools / `solana-test-validator`, unavailable this round.

---

## Regressions

Round 1 has no prior baseline, so nothing is a *regression* in the strict sense. Everything below is a **first-round finding**, listed with the severity it will carry into Round 2.

### R0 — CRITICAL (process) — the working tree changed mid-round; uncommitted program code is live

**Epic:** E0 (faucet) · **Severity:** CRITICAL (process/traceability), not a privacy finding in itself

At Round 1 start the tree was dirty in `CLAUDE.md` + `frontend/` only. By mid-round, four **new untracked instruction files** and edits to four tracked program files had appeared:

```
?? programs/ayni/src/instructions/activate_faucet.rs
?? programs/ayni/src/instructions/init_faucet.rs
?? programs/ayni/src/instructions/refill_faucet.rs
?? programs/ayni/src/instructions/set_faucet_amount.rs
 M programs/ayni/src/{state.rs,errors.rs,lib.rs,instructions/mod.rs}
```

This means **the audited artefact is not a commit**. Sentinel re-ran the program build against the current tree so the result below is current, but Round 2 cannot diff against "commit `aea1438`" and get the same code. The faucet work is also **absent from `BACKLOG.md`**, which the repo declares the single source of truth.

**Reproduction:** `git -C /home/alkia/Ayni status --short`

---

### R1 — CRITICAL — a Circle's full roster, and the wallet behind each member, are publicly enumerable

**Epic:** F1/F2/F22 · **Layer D assertions violated: #5 (circle roster), #1 (sponsor→member edge, in combination)**

`Membership` stores the anonymity commitment **and** the wallet in the same public account:

- `programs/ayni/src/state.rs:57-80` — `pub commitment: [u8; 32]` and `pub owner: Pubkey` on one `#[account]`.
- `programs/ayni/src/instructions/issue_membership.rs:51-58` — both written at issuance.

Anyone with an RPC endpoint can therefore fetch every membership of a Circle and read the wallet attached to each. The client code does exactly this, three times over:

- `frontend/lib/member.ts:189-208` — `membership.all([{ memcmp: { offset: OWNER_OFFSET /* 89 */, bytes: owner } }])`
- `frontend/lib/zk-vote.ts:122` — `membership.all([{ memcmp: { offset: 8, bytes: circle } }])` — **fetches the entire roster of a Circle** to rebuild the Merkle tree
- `frontend/lib/admin.ts:504` — same pattern in the admin console

The design *intends* anonymity (`owner` may be `Pubkey::default()`, per F2, and the comments at `state.rs:65-67` say so). But the **shipped join flow always binds the wallet** — `frontend/lib/member.ts:250` passes `owner` into `issueMembership`, and `member.ts:6-7` documents the memcmp-on-owner lookup as *the* way to find "my" memberships. So for every member who joined through the UI, `wallet ↔ commitment ↔ circle` is a public, permanent, three-way join. The commitment is also the ZK voting leaf, so it links a wallet to that member's ballots' eligibility set.

**Reproduction (no secrets needed):**
```bash
# The roster call the app itself makes; <CIRCLE> = any Circle pubkey
curl -s https://api.devnet.solana.com -X POST -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getProgramAccounts","params":[
       "3ogteUFYhbHaV7UEWuGCqGVm1X4HDgAswvSePvDspHCw",
       {"encoding":"base64","filters":[{"memcmp":{"offset":8,"bytes":"<CIRCLE>"}}]}]}'
```
Each returned account: bytes 8..40 = circle, 40..72 = commitment, 89..121 = owner wallet.

---

### R2 — CRITICAL — the sponsor (parrain / WingPeer) → member edge is public on-chain

**Epic:** WingPeer + E0 faucet · **Layer D assertions violated: #1 (sponsor edge), #7 (parrain→neophyte link)**

- `programs/ayni/src/state.rs:396-406` — `WingPeer { mentee: [u8;32], wing: [u8;32], … }`, **PDA `["wingpeer", circle, mentee]`**. The mentor bond is a public account naming both sides by commitment.
- `programs/ayni/src/instructions/establish_wing_peer.rs:18-27` — writes both commitments.

Joined with R1, `wing_commitment → Membership.owner` and `mentee_commitment → Membership.owner` resolve both parties to **wallets**. That is precisely "name a sponsor" and "leak a relationship" from the prime directive.

The new faucet makes it worse in a single transaction. `programs/ayni/src/instructions/activate_faucet.rs`:

- the **parrain is a `Signer`** (`parrain: Signer<'info>`, and pays the nullifier rent),
- the **neophyte's wallet is the `recipient`** (`require!(ctx.accounts.recipient.key() == owner, …)`),

so one public transaction contains both wallets, side by side, with a lamport transfer between them. Its own doc-comment (`activate_faucet.rs:23-26`) states this plainly:

> *"Documented pilot limitation (Epic 0 → Epic 2): the transaction publicly links the parrain's wallet to the neophyte's — as does the WingPeer record it rests on. The fully anonymous form (ZK vouch-proof + relayer) lands with Epic 2."*

Sentinel records it as CRITICAL regardless, because the spec's assertion #7 is unconditional. Additionally, **none** of assertion #7's other machinery exists: there is no encrypted treasurer ledger, no one-time codes, and no timing jitter.

Also note `LevelGrant.issuer_commitment` (`state.rs:100-112`) publishes the granting teacher's commitment — the same joinable lineage edge.

**Reproduction:** `getProgramAccounts` filtered to the `WingPeer` discriminator, then join `mentee`/`wing` against the R1 roster dump.

---

### R3 — CRITICAL — the member's wallet is emailed off-chain through an unauthenticated endpoint

**Epic:** F25 · **Layer D assertions violated: #5, #1**

`frontend/app/api/circle-email/route.ts`:

- Line 3 (comment): *"join — a member registered → notify the Circle with the member's wallet."*
- Lines 62-64 build the body: `` `Member wallet: ${memberAddress || "(fully anonymous — no wallet bound)"}\n` + `Circle account: ${circlePubkey}` ``
- The handler performs **no authentication, no signature check, no origin check, and no rate limiting** whatsoever. The only `auth` in the file is the SMTP credential at line 48.

`indexer/email-indexer.js:110-120` feeds it `memberAddress = m.account.owner`.

Two distinct problems:

1. **Privacy** — the wallet↔Circle pair leaves the chain and is retained in an external mail system (Mailgun per `BACKLOG.md` F25), in SMTP logs, and in a mailbox. On-chain exposure is at least symmetric and inspectable; this is silent third-party retention.
2. **Abuse** — because the endpoint is unauthenticated, *anyone* can POST arbitrary `{kind, circleName, circlePubkey, memberAddress}` and make the deployed host send mail to any address derivable by `emailFor()`. That is an open relay and a spoofing vector for fake "new member registered" notices.

**Reproduction:**
```bash
curl -X POST https://<host>/api/circle-email -H 'content-type: application/json' \
  -d '{"kind":"join","circleName":"AHA Test","circlePubkey":"11111111111111111111111111111111","memberAddress":"ATTACKER"}'
```

---

### R4 — HIGH — message metadata is public (content is not)

**Epic:** F32 · **Layer D assertion #3 partially violated**

`programs/ayni/src/state.rs:530-559` and `instructions/send_message.rs` do the hard parts **well**: sealed sender (`eph_pubkey` single-use, sender named+signed *inside* the ciphertext, sender not in the PDA seed), and a **fixed** `CT_LEN = 1040` so no length side-channel. Content confidentiality is sound.

But the PDA is `["msg", recipient, id]` and `Message.recipient` is a plain public field, so **who received mail, and when, is public**; and the transaction fee-payer still identifies the sender. The code documents this at `state.rs:539-543`:

> *"the recipient and timing are unavoidably public … the transaction fee-payer still links a message to whoever paid for it. True sender anonymity would need a relayer/mixnet — out of scope here."*

---

### R5 — HIGH — publishing a Post publicly proves "this wallet is a member of this Circle"

**Epic:** F30 · **Layer D assertion #5**

`programs/ayni/src/instructions/create_post.rs:27` — `require!(membership.owner == ctx.accounts.author.key(), …)`; `state.rs:609-619` — `Post.author: Pubkey`, PDA `["post", circle, author, nonce]`. A post is therefore an on-chain, permanent membership attestation for a named wallet. Fully anonymous (owner-less) memberships cannot post at all — the feature is only available at the cost of anonymity. `BACKLOG.md` F30 notes the second half of this ("owner-less memberships can't post") but not the first.

---

### R6 — HIGH — the client sends the member's IP (and coordinates) to third-party services

**Epic:** F18 · **Layer D forbidden-pattern sweep S6**

- `frontend/app/page.tsx:74` — `for (const url of ["https://ipwho.is/", "https://ipapi.co/json/"])`. On the "find a Circle near me" path, when browser geolocation is denied or unavailable, the app calls two third-party IP-geolocation APIs. Those services learn the **IP address and access time of a visitor to an anonymous fellowship's site**.
- `frontend/lib/geo.ts:18` — `https://nominatim.openstreetmap.org/reverse?…&lat=${lat}&lon=${lon}` sends precise coordinates to OpenStreetMap during Circle creation.

Mitigating: both are **user-initiated**, not automatic on page load, and no identifier is attached. The Nominatim coordinates are for a Circle's meeting place, which is published on-chain anyway. Not mitigating: an IP is a strong deanonymiser for exactly this population, and there is no proxying, no consent copy, and no mention in any doc.

Per spec these must be "justified in the report or fail the round" — Sentinel does not consider them justified as shipped, and records them at HIGH rather than CRITICAL because no membership identifier is transmitted alongside.

---

### R7 — MEDIUM — public, comparable per-member achievement and rank records

**Epic:** WingPeer/ProgressToken + F12 · **Traditions**

- `ProgressToken` (`state.rs:411-422`) — `member` commitment, `milestone: u32` (days), `issuer: Pubkey` (the seat that awarded it), PDA `["progress", circle, member, milestone]`. Public and enumerable, so any observer can compute *who has how many chips* and *who awarded them*, and rank members by milestone. Surfaced in UI at `frontend/app/me/page.tsx:358` and `frontend/app/admin/CircleAdmin.tsx:1055`.
- `Membership.level: u8` (`state.rs:63-64`) — "Highest shamanic level attained". A public integer rank per member, rendered next to a member's identity in a roster: `CircleAdmin.tsx:1047` → `` `${short(m.commitment)}${m.level > 0 ? ` · L${m.level}` : ""}` `` and `me/page.tsx:221` → `` ` · level ${m.level}` ``.

**Judgement:** milestone chips have direct AA-tradition precedent and `level` is a lineage credential, not a social score — so neither is *prima facie* a Traditions violation, and Sentinel is not calling them CRITICAL. But both are member-attached, publicly comparable, orderable quantities displayed in a member list, which is exactly the shape the prime directive warns about. **They require an explicit written justification from the team**; absent one, Round 2 should escalate.

---

### R8 — MEDIUM — MACI advertises coercion resistance it cannot yet deliver

**Epic:** MACI · `programs/ayni/src/state.rs:450-480`, `docs/maci.md`

`open_maci_round` + `publish_maci_message` ship and work; the coordinator service, the process/tally circuits, and `submit_maci_tally` do **not**. A round therefore collects sealed ballots and produces **no verified result**. `BACKLOG.md:134-144` is honest about this, but `MaciRound` carries a `tally_hash` field and the state doc-comment describes the full receipt-free flow in the present tense. Risk: a Circle believes it is running a coercion-resistant vote when no tally can be produced.

---

### R9 — WARNING — root TypeScript project does not typecheck

**Layer E** · Reproduction:
```bash
docker run --rm -v /home/alkia/Ayni:/w:ro -w /w node:20-alpine sh -c 'npx tsc --noEmit -p tsconfig.json'
```
Two independent causes: (a) `tsconfig.json` targets below ES2020 while `app/**` uses BigInt literals — `TS2737` across `app/acknowledgment/prove.ts`, `app/lineage/prove.ts`, `app/lineage/poseidonTree.ts`, `app/voting/prove.ts`; (b) `tests/*.ts` import `../target/types/ayni`, which only exists after `anchor build` — `TS2307`/`TS2339` across `tests/ayni.ts`, `tests/cosign.ts` and others. Cause (b) is expected without a build; cause (a) is a real config defect. Note `frontend/` typechecks **clean**.

### R10 — WARNING — root formatting check fails

`npm run lint` (prettier `--check`) reports 12 files needing formatting: all of `app/*.ts` and all of `tests/*.ts`. Non-blocking, but it means `lint` is currently red in CI terms.

### R11 — WARNING — documentation drift in `BACKLOG.md`, the declared source of truth

1. **`BACKLOG.md:18-19`** — *"Caveat (whole repo): nothing is compiled yet — no Solana/Anchor/circom toolchain present."* **Disproved this round**: `cargo check --workspace --all-targets` finishes with **0 errors** (71 warnings). The circuits are likewise compiled, with artefacts committed under `build/`. The caveat is true only of *this host's* toolchain and should be split accordingly.
2. **`BACKLOG.md:185`** — headed *"Instruction index (25)"*. The program actually exposes **54** instructions (54 `.rs` files, 54 `pub fn` in the `#[program]` module). **29 shipped instructions are missing from the index**: `approve_child_close`, `approve_child_rotation`, `close_circle_profile`, `create_post`, `delete_message`, `delete_post`, `donate_token`, `end_wing_peer`, `establish_wing_peer`, `execute_child_close`, `execute_child_rotation`, `install_elected_seat`, `issue_progress_token`, `link_seat_election`, `open_maci_round`, `propose_child_close`, `propose_child_rotation`, `publish_maci_message`, `register_messaging_key`, `revoke_membership`, `send_message`, `set_circle_config`, `set_circle_country`, `set_meetings`, `set_open_membership`, `set_treasury_allow`, `set_treasury_wallet`, `update_circle_location`, `upsert_circle_profile` — plus the four new faucet instructions.
3. The E0 faucet work is **entirely absent** from `BACKLOG.md`.

### R12 — WARNING — no toolchain on the host; BPF build and validator tests unverifiable

No `cargo`/`anchor`/`solana`/`node` on `PATH` or in the usual per-user locations. Consequences: `anchor build` (the **BPF/SBF** target, which is what actually enforces the 4KB stack limit that `BACKLOG.md:118` says previously caused two stack-overflow bugs) was **not** verified; `anchor test` was **not** run; `tests/f28-election.ts` needs devnet plus `~/.config/solana/aha-deployer.json`, which Sentinel does not have. **Host-target `cargo check` passing is necessary but not sufficient** — it does not prove the program fits BPF constraints.

### R13 — INFO — dependency audit: high-severity findings, no criticals

| Workspace | total | low | moderate | high | **critical** |
|---|---:|---:|---:|---:|---:|
| root | 31 | 14 | 7 | 10 | **0** |
| `frontend/` | 28 | 12 | 6 | 10 | **0** |

Spec rule is "new criticals fail" → **not a fail**. Notable highs: `ws` (uninitialised memory disclosure, GHSA-58qx-3vcg-4xpx), `sharp`/libvips CVEs, `underscore` DoS, `elliptic` (transitively via `@solana/web3.js` → `@coral-xyz/anchor`, which has **no fix available**). Recorded as the Round 2 comparison baseline.

---

## Privacy-invariant status — the seven Layer D assertions

Assessed by reading the on-chain state layout, the instruction handlers, the indexer and the client, and by running the forbidden-pattern sweeps. **No adversarial suite exists**, so where an assertion needs a simulated full-compromise dump it is marked *untestable* rather than passing — per spec §4, trust is never cached.

**1. No sponsor identity or sponsor→member edge recoverable — ✘ VIOLATED**
`WingPeer` (`state.rs:396-406`) publishes both sides of the mentor bond by commitment, PDA-seeded on the mentee. `activate_faucet.rs` puts the parrain's signing wallet and the neophyte's receiving wallet in one transaction. `LevelGrant.issuer_commitment` (`state.rs:109`) publishes the granting teacher. Joined with R1, all resolve to wallets. See R2.

**2. No trust list or chosen-ones list recoverable — ✔ (vacuous)**
Verified by sweep: no such feature exists in the codebase (`grep -riE 'chosen_?one|trust_?list|close_?friend'` over `*.ts|*.tsx|*.rs` → 0 hits). Nothing to leak. This becomes a real assertion only when E5 visibility ships.

**3. No message content, and no who-messaged-whom metadata — ✘ VIOLATED (content ✔ / metadata ✘)**
Content is genuinely protected: NaCl box, sealed sender, sender not in the PDA seed, fixed `CT_LEN = 1040` defeating length analysis. Metadata is not: `Message.recipient` is public and is the PDA seed, and the fee-payer identifies the sender. Acknowledged at `state.rs:539-543`. See R4.

**4. No biometric material recoverable — ✔ PASS**
Executed sweep for `biometric|fingerprint|faceid|touchid|webauthn|passkey|navigator.credentials|getUserMedia|MediaDevices` across `*.ts|*.tsx|*.js|*.rs|*.circom` (excluding `node_modules`/`build`/`target`): **no biometric capture anywhere**. The only two hits are the word "fingerprint" inside privacy comments in `state.rs:614` and `activate_faucet.rs:19`. No WebAuthn/passkey code exists (spec's E8 is not built).

**5. No circle roster recoverable — ✘ VIOLATED**
One `getProgramAccounts` filtered on `Membership.circle` returns the complete roster, each entry carrying the member's wallet at offset 89 whenever `owner` is set — which the shipped join flow always does. The app performs this exact call at `frontend/lib/zk-vote.ts:122`. `Post.author` gives a second, independent public membership attestation. See R1, R5.

**6. Whether a member has hidden content is not recoverable — UNTESTABLE**
Not assessable: there is no hidden-content / per-field visibility feature in the codebase (sweep for `visibility|hidden_?content|is_?private` over `*.ts|*.tsx|*.rs` returned only an unrelated comment in `mint_membership_token.rs:9`). The spec's E5 is not built. Becomes testable when it ships — and will need the byte-shape-identical response check the spec describes, which no current test can perform.

**7. No parrain→neophyte link from the faucet — ✘ VIOLATED**
The faucet landed this round and fails this assertion on every limb: the activation transaction contains both wallets (`activate_faucet.rs` — `parrain: Signer`, `recipient == neophyte_membership.owner`); there is **no treasurer ledger at all**, hence no role-key encryption and no one-time codes; and there is **no timing jitter**. Grant *amounts* are uniform (`jar.grant_lamports` always, `state.rs` `FAUCET_MAX_GRANT_LAMPORTS = 2_000_000`), which defeats amount-fingerprinting — the one part of assertion #7 that does hold. The source acknowledges the linkage as a pilot limitation deferred to Epic 2.

**Score: 1 pass, 1 vacuous pass, 3 violated, 1 untestable, 1 (#7) violated.**

### Forbidden-pattern sweeps (all executed this round)

| Sweep | Result |
|---|---|
| Analytics / telemetry SDKs | **✔ clean.** Verified in source *and* in the **built client bundle**. The only source hit is `@opentelemetry/api` as an **optional peerDependency of Next.js** in `frontend/package-lock.json:5228` — not installed, not imported. The three bundle "hits" were false positives: `onDoubleClick` matching `doubleclick`. |
| Tracking pixels / beacons | **✔ clean.** No `sendBeacon`, no 1×1 images, no external `<img src>`. The single `new Image()` (`frontend/lib/profile.ts:61`) is a local FileReader→canvas avatar resize with **no network involvement**. |
| `console.*` of identity material | **✔ clean in app surfaces** — **0** `console.*` calls in all of `frontend/`. 41 exist in dev tooling only (`scripts/*.js`, `indexer/email-indexer.js`, `tests/f28-election.ts`), several printing wallet addresses (e.g. `scripts/create-multisig.js:84-85`, `scripts/seed-devnet.js:45`). Acceptable for operator CLIs; **`indexer/email-indexer.js` is a long-running service and its logs should be reviewed for retention.** |
| Rust `msg!` / `println!` / `dbg!` / `sol_log` | **✔ clean — 0 occurrences** in the entire program. The on-chain code logs nothing at all, so no identity material can leak through transaction logs. Genuinely good. |
| `/(score\|rating\|rank\|karma\|tier\|badge\|count)/i` in member-facing models | **⚠ hits, judged.** *Legitimate:* `Circle.member_count`, `MemberProposal.eligible_count` (quorum), `MaciRound.message_count` — all tallies, none member-attached; `inbox-badge`/`sol-badge`/`badge-alt` — CSS classes for unread counts and role labels, not member scores. *Flagged for justification:* `ProgressToken` and `Membership.level` — see R7. **No `score`, `rating`, `rank`, or `karma` field exists anywhere.** |
| Outbound third-party calls | **✘ finding.** `ipwho.is` + `ipapi.co` (`frontend/app/page.tsx:74`) and `nominatim.openstreetmap.org` (`frontend/lib/geo.ts:18`). See R6. All other hosts in the bundle are benign: Solana RPCs, `explorer.solana.com`, `w3s.link` (IPFS gateway), wallet vendor sites, docs links. No Google Fonts link is emitted at runtime (the string appears only in Next's `next/font` server chunk). |

---

## Traditions check

**Findings — not clean.**

| Tradition-shaped risk | Status |
|---|---|
| Ranking members | ⚠ `Membership.level` is a public per-member integer rank shown in member lists (`CircleAdmin.tsx:1047`, `me/page.tsx:221`). Defensible as a lineage credential; **needs written justification**. See R7. |
| Comparing / aggregating members | ⚠ `ProgressToken` milestone chips are public and enumerable, so members are orderable by chip count. AA-precedented; **needs written justification**. See R7. |
| Naming a sponsor | ✘ **VIOLATED.** `WingPeer` publishes the bond; `activate_faucet` puts parrain and neophyte wallets in one transaction. See R2. |
| Leaking a relationship | ✘ **VIOLATED.** Roster + `owner` + `WingPeer` + `Post.author` compose into a public social graph of a Circle. See R1, R2, R5. |
| Retaining message metadata | ✘ **VIOLATED.** Recipient and timing public; fee-payer identifies sender. See R4. |
| Revealing hidden content | n/a — feature not built. |

Against this, the design gets several things genuinely right and they deserve recording: the program emits **no logs whatsoever**; ballots are unlinkable across proposals (verified by execution, below); messages are sealed-sender and fixed-length; faucet grants are amount-uniform; and there is **no analytics of any kind** in the shipped bundle.

---

## Baseline changes this round

**None — no baseline existed.** Nothing was updated, and nothing is fabricated. Round 1 is baseline-*establishing*.

The following were **measured by execution this round** and are proposed as the Round 2 comparison baseline. They should be committed to `tests/sentinel/baselines/` (which must be created):

| Baseline | Value @ `aea1438` + dirty tree | Proposed file |
|---|---|---|
| Program typecheck | `cargo check --workspace --all-targets` → **0 errors, 71 warnings**, 2m38s | `baselines/cargo-check.txt` |
| Instruction count | **54** instructions / 54 `pub fn` | `baselines/instruction-index.txt` |
| Verifying-key integrity | `member_vote` nPublic=4 · `lineage_grant` nPublic=4 · `ack_disclose` nPublic=17; zkey→vkey→`.rs` all **exact matches**; non-zero constants 1543 / 1540 / 3201 | `baselines/vk-digest.json` |
| Circuit behaviour | 8/8 assertions (below) | `baselines/circuit-assertions.txt` |
| Frontend typecheck | `tsc --noEmit` → **0 errors** | `baselines/frontend-tsc.txt` |
| Frontend build | `next build --webpack` → success, **13 routes** | `baselines/routes.txt` |
| Bundle size | `.next/static` = **5,224,986 B (4.98 MB)**; largest chunk **1,652,474 B** | `baselines/bundle-size.json` |
| Dependency audit | root 31 (0 crit) / frontend 28 (0 crit) | `baselines/npm-audit.json` |
| Unit tests | `tests/jazzicon.ts` **8/8 pass** | `baselines/unit.txt` |
| `console.*` census | frontend **0**; programs **0** log macros; tooling 41 | `baselines/log-census.txt` |

**Layer C detail — actually executed this round**, offline, against the *committed* proving keys (`build/member_vote_final.zkey`, `member_vote_js/member_vote.wasm`) with a 3-member depth-20 fixture tree:

| # | Assertion | Result |
|---|---|---|
| C1 | A valid member ballot verifies against the committed VK | **PASS** |
| C2 | Flipping the public `choice` signal is rejected | **PASS** |
| C3 | Tampering the public `root` is rejected | **PASS** |
| C4 | A non-member (secret not in the tree) cannot even produce a witness | **PASS** (constraint failure at `member_vote.circom:42`) |
| C5 | Same member + same proposal ⇒ identical nullifier (double-vote detectable regardless of choice) | **PASS** |
| C6 | Same member + different proposal ⇒ different nullifier (**no cross-proposal linkage**) | **PASS** |
| C7 | Different members ⇒ different nullifiers | **PASS** |
| C8 | `publicSignals` carries no member index or commitment (exactly 4 signals) | **PASS** |

Plus 3 key-integrity checks (zkey→vkey re-export, vkey→`verifying_key*.rs` regeneration, placeholder detection) across all three circuits — **all pass**. This independently confirms the `BACKLOG.md` 2026-06 claim that the embedded VKs are real. The **single-contributor ceremony remains a mainnet trust weakness**, exactly as `BACKLOG.md:23-24` states.

**Reproduction of the whole Layer C block** (no toolchain needed, Docker only): scripts are preserved at `/tmp/claude-1000/-home-alkia-Ayni/272775e9-bdea-477f-9b39-576a03386e2e/scratchpad/{layerC.sh,layerC-inner.sh,zk.js,zk-inner.sh}` — these should be moved into `tests/sentinel/` so Round 2 can re-run them.

---

## Coverage gaps

Shipped behaviour with **no** Sentinel coverage. Per spec §4 these are WARNINGs in Round 1 and become **FAILs in Round 2**.

**Infrastructure that must be created before Round 2**
1. `tests/sentinel/checklist.yaml` — does not exist. Round 2 has no master checklist to execute.
2. `tests/sentinel/baselines/` — does not exist. Populate from the table above.
3. `tests/sentinel/fixtures/` — no standard fixture set. Every check above built its own fixtures inline.
4. `.github/workflows/sentinel.yml` — absent; `ci.yml` pins **Anchor 0.30.1 / Solana 1.18.26** while `Anchor.toml` and `BACKLOG.md:117` say **Anchor 0.31.1 / Agave 2.3.13**. **CI is configured for the wrong toolchain and would not reproduce the shipped build.**

**Whole layers absent**
5. **Layer A (e2e): nothing exists.** No Playwright suite, no fixture members, no DOM-level assertions. The spec's per-page regex assertion (no fraction/percentage/progress-bar/score) is **never run** — and given R7, that is exactly the assertion most needed.
6. **Layer B (API): nothing exists.** `frontend/app/api/circle-email/route.ts` — the one endpoint, and the subject of CRITICAL R3 — has **zero** tests: no schema snapshot, no auth-boundary fuzz, no rate-limit check.
7. **Layer D (adversarial): nothing exists.** No full-compromise dump simulation. Assertions #2 and #6 are marked vacuous/untestable purely because the features are unbuilt; assertions #1/#3/#5/#7 were judged by code reading, not by dumping and attempting recovery. **This is the single highest-value thing to build**, because it is the only mechanism that can *prove* the invariants rather than argue them.

**Shipped features with no executable test at all**
8. **The E0 faucet** (`init_faucet`, `set_faucet_amount`, `activate_faucet`, `refill_faucet`) — brand new, zero tests. Untested: the one-shot-per-identity nullifier, the `FAUCET_MAX_GRANT_LAMPORTS` cap, non-Treasurer rejection, refill-without-a-passed-vote rejection, refill replay, and jar isolation. Every one of these is a spec Layer-C requirement.
9. **All 15 Anchor integration cases** (`tests/ayni.ts`, `cosign.ts`, `resilience.ts`, `profile.ts`, `vote.ts`) could not run — no `solana-test-validator`. They exist and are well-written; they are simply unverified this round.
10. **`tests/f28-election.ts` is a script, not a suite** — no `describe`/`it`, requires devnet and `~/.config/solana/aha-deployer.json`. It cannot participate in an automated round.
11. **No test for `grant_level`, `issue_acknowledgment`, `verify_disclosure`, `prove_personhood`** — four ZK instructions with no end-to-end proof test, as `BACKLOG.md:119` concedes. `ack_disclose` (nPublic=17) is the most complex circuit and the least exercised.
12. **MACI** (`open_maci_round`, `publish_maci_message`) — no tests, and no tally to test against (R8).
13. **Council/treasury property tests** — `BACKLOG.md:113` itself lists fuzz/property tests of vote accounting and cross-namespace nullifier isolation as outstanding. Still outstanding.
14. **`frontend/` has `playwright` in devDependencies but not a single test file**, and no `test` script in `frontend/package.json`.

---

## Verdict rationale

**Plain language, for a trusted servant who does not read code.**

I checked this round for two different things: does the software still work, and does it keep its promises about privacy. On the first question the news is genuinely good. Everything I could build, built cleanly — the on-chain program passed a full type and safety check with no errors, the website compiled and produced all thirteen of its pages, and the small set of existing tests all passed. I also tested the anonymous voting mathematics directly, and it is sound: a real ballot verifies, a tampered ballot is rejected, someone who is not a member cannot forge one, the same person cannot vote twice on the same question, and — importantly — nobody can tell that the same person voted on two *different* questions. The secret keys the program uses to check these ballots are real, not placeholders, and I confirmed they match end to end. That is a solid foundation, and it disproves a warning still sitting at the top of our own backlog saying none of this had ever been compiled.

The second question is where I have to report a failure, and I want to be precise about what kind of failure it is. **Nothing broke.** This is the first time this check has ever been run, so there was no earlier state to fall short of. What I found instead is that three of the seven privacy promises we have written down are not kept by the system as it is built today. First, anyone in the world with a free internet connection can download the complete membership list of any Circle, and for every member who joined through our website, that list includes their wallet address — because the anonymous identifier and the wallet are stored side by side in the same public record. Second, the mentor relationship — who sponsors whom — is published openly, and the new "first gas" faucet that arrived while I was working puts the sponsor and the newcomer into a single public transaction together, which is as close to naming a sponsor as it is possible to get. Third, when a new member joins, our own server emails their wallet address to the Circle's mailbox through a web address that has no password, no signature check, and no rate limit on it at all — meaning both that this information leaves the safety of the blockchain into an ordinary email system, and that a stranger could use that same address to send fake "new member" notices.

I want to be fair to the people who built this. Two of these three are already written down as known limitations in the code's own comments, with a plan to fix them later; they are honest shortcuts, not concealment. The design also does several difficult things very well — the program writes no logs at all, private messages are properly sealed so that even their length reveals nothing, faucet payments are all identical so amounts cannot identify anyone, and there is not a single piece of tracking or analytics software anywhere in the site. But our own rulebook says that a broken privacy promise counts as the most serious kind of finding, above any ordinary bug, and that finding even one means the round fails. I found three, so the verdict is FAIL, and I am not going to soften it.

The other thing worth flagging to the fellowship is what I could *not* check. There is no automated testing of the website's screens, none of its one web address, and — most importantly — no "break-in drill" that dumps everything the servers know and tries to reconstruct who is who. That drill is the only way to *prove* these promises rather than argue about them, and building it should come before any new features. Two smaller matters: the faucet code that appeared during this round is not saved into version control and is not written down in our backlog, so it currently exists nowhere but one person's working copy; and our automatic build system is configured for an older version of the toolchain than the one we actually use, so it is not really checking what we ship. None of this is cause for alarm about the fellowship's safety today — the system is early and mostly running on a test network — but every one of these items should be closed before real people's anonymity depends on it.

---

*Report produced by Sentinel, Round 1. No application code, circuit, contract, or test was modified. Files created this round: `reports/sentinel/NRR-2026-08-10-1.md`, `reports/sentinel/latest.md`, `docs/shipped.md`.*
