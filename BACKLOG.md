# AHA / Ayni — unified feature backlog & status

Living tracker of what's implemented and what's planned. **AHA** (*Ancestral
Humanity Anonymous*) is a worldwide, chain-agnostic decentralized fellowship for
shamanic practice, modeled on AA's structure and traditions. **Ayni** is its
Solana implementation.

- Model (chain-agnostic): `PROJECT.md` — lives on `main`.
- Implementation: `IMPLEMENTATION.md` + `programs/ayni/` — per-chain branches
  (`solana` = Ayni, plus `ethereum`, `avalanche` scaffolds).
- Discipline: model changes land on `main`, then merge into the chain branch;
  implementation lands on the chain branch.

> `BACKLOG.md` is the **single source of truth for feature status**, and as of
> **2026-08-10 it unifies the two backlogs that used to run in parallel**:
>
> 1. the **implementation registry** (F-numbers, formerly this file alone), and
> 2. the **product backlog** — `backlog/AHA_Trust_Platform_Backlog.docx` and its
>    text extraction `backlog/AHA_Trust_Platform_Backlog.md` (Epics **E0–E11**,
>    the Sequencing table and the Traditions Audit), which remains the
>    **authoritative source of product intent**. Nothing here overrides it; this
>    file records what has actually been built against it.
>
> `backlog/AHA_Trust_Platform_GapAnalysis.md` is the **working paper** of that
> mapping (epic-by-epic COVERED/PARTIAL/MISSING/CONFLICTS). It is evidence, not
> authority: where it and the code disagree, the code wins and this file says so.
>
> Update this file in the same commit whenever a feature is added, finished, or
> descoped — and keep `docs/shipped.md` reconciled with it in that same commit.

**Status legend**
`✅` implemented (code-complete) · `🟡` partial / stubbed · `⬜` planned ·
`⚠` **architectural conflict** — shipped and working against its own spec, but
contradicts the product backlog's Traditions Audit or an epic's stated property;
resolving it needs a redesign, not a patch (see *Known issues*) ·
`Fn b` = a rider / policy addendum to `Fn`, never an independent feature.

**Epic column** — `E0`–`E10` tie a row to the product backlog; `—` means
infrastructure that serves no single epic.

### Round update (2026-08-11b) — E2/E7 anonymity layer + open-decision closeouts

The keystone round: the fee-payer-anonymity gap that silently defeated every
"anonymous" action is closed, and the E7 messaging re-architecture ships its
first off-chain stage. **101 program tests + property suites green** (`anchor
test`, +`epic2`, +`relayer`, +`mailbox`); frontend `tsc` clean; privacy sweep
green; **72 instruction files** (was 66).

- **F55 relayer SHIPPED.** `frontend/app/api/relay/route.ts` +
  `frontend/lib/relayer.ts` + a pure allowlist policy `frontend/lib/relayPolicy.ts`
  (discriminators pinned against the IDL, "relayer is the only signer" enforced,
  spend floor + daily cap + no logging). `cast_vote`, `attest_admission_zk`,
  `send_message`, `publish_maci_message` (and the F54/F56 cranks) now relay by
  default; self-pay is the honestly-labeled fallback. Closes the
  `zk-vote.ts:158`/`messaging.ts:191` `payer: wallet.publicKey` deanonymization.
  Tests: `tests/relayer.ts` (policy refusal matrix + on-chain third-party-payer).
- **F54 SHIPPED** — `RecentRoots` ring buffer (16 roots) via the permissionless
  `note_root` crank, so a ZK proof survives concurrent admissions; and the epoch
  rebuild (`begin_member_epoch` + `reinsert_member`) that turns the append-only
  votable set into a **good-standing set** (expired/revoked commitments do not
  re-enter). `attest_admission_zk` now accepts any recent root. `tests/epic2.ts`.
- **F56 SHIPPED** — fellowship-wide verification anchor: `publish_member_root`
  (parentage-constrained, same rule as the federation-governance fix) +
  `verify_fellow_member` (anonymous `VisitPass`, host-circle external nullifier).
- **F63 v1 SHIPPED** — off-chain mailbox (`frontend/app/api/mailbox/route.ts` +
  `lib/mailbox.ts` + pure `lib/mailboxCrypto.ts`): sealed sender, signed
  rotating prekeys (coarse forward secrecy), no enumeration, no logging,
  recipient-signed deletion. The Inbox sends here first and falls back to the
  on-chain F32 legacy path only when the recipient has no bundle. `tests/mailbox.ts`.
  The libsignal/PQXDH ratchet is v2 (`docs/messaging-migration.md`).
- **Message::CT_LEN 1040 → 528** — not a deferred optimization but a **latent
  bug the F55 test surfaced**: a 1040-byte ciphertext made `send_message`
  1156 bytes, unsendable within Solana's 1232-byte tx limit. 528 fits, halves
  the message account rent, and long-form mail belongs to F63 anyway.
- **F80 admin UI wired** (`admin.ts` + `CircleAdmin.tsx`) — token withdrawal
  propose→execute now has a button.
- **F71 CLOSED** — third-party IP-geolocation removed (ipwho.is/ipapi.co and the
  Nominatim reverse-geocode gone); only the OSM map-tile URL remains (the map
  itself), documented as a separate exposure.
- **Open decisions closed:** ADR **0002** rewritten into a real staged
  quantum-resistance architecture (hybrid KEM → ProofAnchor seam → shard/key
  derivation → chain-inherited signatures); ADR **0007** (open-membership demoted
  to bootstrap mode under two-sponsor admission); ADR **0008** (public
  `level`/chips **accepted by written user waiver** — R7 closed, not a
  contradiction). `docs/sybil.md` rewritten to the shipped stack.
- **E3 unblocked editorially** — `docs/emerald-table.md` (12 sourced hexes),
  `quipu.ts` values updated; dye-sampling remains the one physical task.
- **F46 debt paid** — `tests/sentinel/checklist.yaml` now covers 46 shipped rows
  (was 2); `tests/sentinel/baselines/` created (npm-audit, program-size).
- **Ultracode adversarial review** (4 finders → skeptical verify) surfaced and
  **fixed before commit**: a mailbox read/delete authorization gap (reads were
  unauthenticated; the IK-derived mailbox id was attacker-spoofable) — closed by
  deriving the mailbox id from the **wallet** and requiring a recipient
  signature on `get` and `ack`. Two residuals documented as accepted-and-bounded
  (relayer pays for allowlisted-but-arbitrary content, bounded by rate/daily
  caps; F56 "federation = shared parent" is not foundation-vetting).
- Program `.so` = **1,291,232 bytes** (was 1,189,664; +8 instructions this
  round). Rent ≈ **8.99 SOL**. Still funding-blocked: the deployer holds 5 SOL <
  program rent; no devnet deploy this round either.

### Round update (2026-08-11) — test-all, security audit, deploy-cost

- **Tests run NATIVELY and green:** `anchor test` against a local validator +
  the pure/property suites, **80 passing / 0 failing** across `ayni`, `resilience`,
  `cosign`, `faucet`, `epic1`, `epic3`, `epic5`, `profile`, `federation` (new),
  `jazzicon`, `sharding` (+handover), `quipu`. Browser-ZK `vote.ts` and the devnet
  `f28-election.ts` script remain excluded by design. Frontend `tsc --noEmit`
  clean (TS 5.9).
- **Test harness fixed for reproducibility** (was blocked on the host): portable
  `node 18` installed; the `Anchor.toml` `[scripts] test` now invokes the local
  `ts-mocha` with `--experimental-global-webcrypto` (not `npx`, which took an ESM
  path); root `package.json` `overrides: { rpc-websockets: { uuid: 8.3.2 } }`
  pins the CJS `uuid` so `@coral-xyz/anchor`'s CJS build is `require`-able (a
  nested ESM `uuid@14` broke `anchor test`). CI (`npm ci`) now reproduces this.
- **Security audit (multi-agent adversarial):** 2 CRITICAL + 1 HIGH + 3 lower
  findings fixed; see `docs/security-review-2026-08-11.md`. New instruction
  **`withdraw_treasury_token`** (F80) closes a confirmed permanent token-fund-lock.
  Regression tests: `tests/federation.ts`, guardian-seize case in `tests/cosign.ts`.
- **Deploy-cost:** `opt-level = "z"` (from `"s"`) + `strip` + `anchor-spl`
  default-features off ⇒ `target/deploy/ayni.so` **1,189,664 bytes** (down from the
  `opt-s` 1,276,080; the new security instruction added ~24 KB, `opt-z` saved
  ~110 KB). Program-account rent ≈ **8.28 SOL** (was ≈ 8.88). *(The
  `Message::CT_LEN 1040→528` account-rent win was **done** in round 2026-08-11b —
  see that round's note above — because the F55 test proved 1040 was unsendable,
  not merely suboptimal.)*
  **66 instruction files** now (was 58; +E1 two-sponsor set, +`withdraw_treasury_token`).
- Program ID is the vanity **`AHAHnRiJEANtYJpWZxGZZa63ZTFzMa5e5Q8DszCgavSG`** (pre-deploy
  rename from `3ogteUFY…`), consistent across `lib.rs`/`Anchor.toml`/IDL. The
  deployer key `~/.config/solana/aha-deployer.json` holds **5 SOL on devnet** — still
  below the ~8.28 SOL program rent, so a devnet deploy remains funding-blocked.

### Toolchain & baseline (as of 2026-08-10)

- **Host `PATH`:** `cargo` 1.97.1, `anchor-cli` 0.31.1, `solana-cli` 2.1.21
  (Agave) are installed and on `PATH`. `node`, `npm` and `circom` are **not** —
  circuit compilation and npm tasks still need a container.
  (The earlier "no native Solana/Anchor toolchain on the host" claim was stale.)
- **CI pins** `ANCHOR_VERSION 0.31.1` / `SOLANA_VERSION 2.1.21`
  (`.github/workflows/ci.yml`) and matches the installed toolchain. The former
  "Agave 2.3.13" claim in this file was wrong — 2.3 is the `solana-poseidon`
  *crate* version in `programs/ayni/Cargo.toml`, not the validator.
- **Compile:** host-target `cargo check --workspace --all-targets` clean
  (0 errors, 67 warnings) at commit **`aea1438`** (Sentinel R1). Not
  re-established for the current tree; `anchor build` / `cargo-build-sbf` (BPF
  stack + size limits) **not verified** this round. *Every future toolchain claim
  must carry the commit it was measured at.*
- **Tests** (suite list, not a count — counts drift every round):
  `tests/ayni.ts` (3, F1/F7/F24) · `tests/cosign.ts` (2, F11) ·
  `tests/resilience.ts` (3, F9–F11) · `tests/profile.ts` (4, F18) ·
  `tests/vote.ts` (3, F6 real-proof e2e) · `tests/faucet.ts` (15, F35) —
  30 Anchor cases — plus `tests/jazzicon.ts` (8 unit, F20) and the
  `tests/f28-election.ts` devnet script (F28), which `Anchor.toml` currently
  `--ignore`s (uncommitted change).
- **Circuits / keys:** `member_vote`, `lineage_grant` and `ack_disclose` are
  compiled and `verifying_key*.rs` hold **real** Groth16 keys (not placeholders),
  verified byte-exact against the `.zkey`s by Sentinel Layer C. The phase-2
  ceremony was **single-contributor** — functional for devnet, **not acceptable
  for mainnet** (see **F44**). `docs/zk-lineage.md` §6 still calls the VK a
  placeholder and is stale.

---

## Feature registry (Ayni / `solana`)

One registry, two axes: the **F-number** is the implementation identity (never
renumbered once correct); the **Epic** column is the product identity.

### Membership & identity
| # | Epic | Feature | Status | Instructions / files | Notes |
|---|------|---------|--------|----------------------|-------|
| F1 | E1 | Soulbound yearly membership (ZK-commitment keyed) | ✅ | `issue_membership`, `renew_membership`; `Membership` (`state.rs:58-84`) | anonymous; renews term. Leaf inserted into the MemberTree in the *same* instruction (`issue_membership.rs:71`) — which is why provisional membership is not representable today (see **F51**). |
| F2 | E5 | Selective-disclosure identity (optional `owner` wallet) | ✅ | `Membership.owner` (`state.rs:65-68`) | `default()` = fully anonymous. ⚠ In practice the shipped join flow always binds the wallet, so rosters are enumerable (Sentinel R1 → E2/E5). |
| F3 | — | Soulbound Token-2022 membership token | ✅ | `create_membership_mint` (NonTransferable ext + `non_transferable_mint_initialize` before `initialize_mint2`), `set_membership_mint`, `mint_membership_token`; `frontend/lib/admin.ts`; `scripts/test-membership-mint.js` | Mint authority = Circle PDA, 0 decimals, no freeze; registered in one Treasurer-gated instruction. *Environment claim (not checkable from the repo):* devnet upgrade `fCbGbo33…` and the end-to-end devnet verification. |

### Sybil resistance
| # | Epic | Feature | Status | Instructions / files | Notes |
|---|------|---------|--------|----------------------|-------|
| F4 | E1 | Social vouching (always-on) | ✅ | `issue_membership` — **Scribe-Secretary-seat-gated** (`issue_membership.rs:18-34`, `council.require_seat(SEAT_SECRETARY)`) unless an `OpenMembership` marker is present | a human admits a human. **Corrected:** this row used to say "authority-gated". There is no authority — `Circle` has no authority field (`state.rs:10-35`) and `council.rs:17` states "The Council IS the authority". ⚠ The Secretary's wallet signs every gated admission, producing a public named-admitter edge (E1/E2). |
| F31 | E1 | Per-Circle membership policy: **permissionless vs Scribe-Secretary-gated** | ✅ ⚠ | `set_open_membership`, `OpenMembership` marker PDA `["openjoin", circle]`; `issue_membership` (optional marker); `lib/member.ts`, `/me`, `/admin`, `/create` | Migration-safe marker PDA — no `Circle` layout change. ⚠ **Open membership is zero-vouch self-admission — the direct opposite of E1's "every member enters through two existing members".** Both cannot be the shipped admission model; reconciliation is an ADR (see *Open decisions*). *Environment claim:* the devnet gated→open→re-gate verification. |
| F5 | E1 | Anonymous proof-of-personhood (one human → one membership/Circle) | ✅ | `set_personhood` (Secretary-gated), `prove_personhood` (verifies against `VERIFYING_KEY_VOTE`), `PersonhoodCredential` (`state.rs:244-252`), consumed at `issue_membership.rs:37-46`; `docs/sybil.md` | reuses the `member_vote` circuit/VK; World ID-style root. F35's "one grant ever" guarantee leans on this being switched on. |

### Governance & voting
| # | Epic | Feature | Status | Instructions / files | Notes |
|---|------|---------|--------|----------------------|-------|
| F6 | E2 | Anonymous member voting (one member, one vote) | ✅ | `initialize_member_tree`, `create_member_proposal`, `cast_vote` (+ `vote_nullifier` PDA), `finalize_member_proposal`; `circuits/member_vote.circom`; **browser prover `frontend/lib/zk-vote.ts`** (+ `frontend/public/zk/member_vote.wasm`/`.zkey`); Node prover `app/voting/prove.ts` | Semaphore-style, per-proposal nullifier. **Corrected:** quorum/pass are **configurable** (`CircleConfig.vote_quorum_*`/`vote_pass_*`, see **F37**) and only *default* to ⅓ + simple majority. Identity is `commitment = Poseidon(secret)`, secret kept on-device; memberships minted before this change can't prove — rejoin. ⚠ `zk-vote.ts:158` sets `payer: wallet.publicKey`, so the prover is named on chain — the "via relayer" anonymity in `docs/member-voting.md` is **not** implemented (see **F55**). |
| F7 | — | 7-seat Council (4-of-7) | ✅ | `propose`, `approve`, `execute_proposal`, `cancel_proposal`; `council.rs:28-45` (`Council`), `:111-137` (`Proposal`, approvals bitmask) | 3 servants + 4 elders. **Corrected:** `appoint_seat` **does not exist** — seats are set at `initialize_circle` and changed via `ProposalAction::RotateSeat` or `install_elected_seat`. |
| F8 | — | Forkable federated Circles | ✅ | `initialize_circle`; `Circle.parent` (`state.rs:11-16`) | World Service authority over local Circles; federation ops in `propose_child_*`. |
| F28 | — | **Member election of the 7 Council seats** | ✅ | `link_seat_election` (`election_hash` = H("AHA-elect"‖seat_index‖candidate) bound to the member proposal's `description_hash`; `SeatElection` PDA `["election", proposal]`), `install_elected_seat` (requires finalized+passed, one-shot, seat-uniqueness); ballots reuse `create_member_proposal`/`cast_vote`/`finalize_member_proposal`; browser prover `frontend/lib/zk-vote.ts`; `tests/f28-election.ts` | Group-conscience election of each seat holder. **Corrected:** the earlier row named `ElectionProposal`, `cast_election_ballot` and `finalize_election` — **none exist**; and it credited `app/voting/prove.ts` (the Node/CLI prover) as the browser prover. **Open:** term length / recall; interaction with `RotateSeat`; mainnet multi-party ceremony (**F44**). |
| F37 | — | Per-Circle **quorum / pass-threshold config** for member voting | ✅ | `set_circle_config`; `finalize_member_proposal` reads `CircleConfig.vote_quorum_*` / `vote_pass_*` (num/den) | Defaults ⅓ quorum + simple majority when unset. Config is seed-bound to the proposal's Circle (`init_if_needed`) so it can't be swapped or omitted. Admin "Circle policy". Rider on **F36**. *Environment claim:* devnet upgrade `5jvJ9EEX…`. |
| F39 | E2 | **MACI / coercion-resistant member voting** | 🟡 | `open_maci_round` (any seat, registers the coordinator key), `publish_maci_message` (append-only sealed commands, NaCl-boxed, fixed 176 B, ephemeral key); `MaciRound` `["maci", proposal]`, `MaciMessage` `["macimsg", round, index]`; `frontend/lib/maci.ts`, `docs/maci.md` | **Submission layer only.** There is no coordinator service, no `process_messages`/`tally` circuits and no `submit_maci_tally` — *a round collects sealed commands and produces no verified result*, while `MaciRound.tally_hash` (`state.rs:457`) sits unused and the doc-comment describes the full receipt-free flow in the present tense (Sentinel R8). Largest open engineering item in the registry. *Environment claim:* devnet upgrade `5q361Qy2…`. |

### Resilience & recovery
| # | Epic | Feature | Status | Instructions / files | Notes |
|---|------|---------|--------|----------------------|-------|
| F9 | E8 | Key recovery — migrate all artifacts (4-of-7) | ✅ | `propose`/`execute_proposal` (`ProposalAction::MigrateWallet`, `council.rs:96`), `recover_membership` (rebinds `Membership.owner`, refuses `old_wallet == default`) | seats rebound atomically; memberships per-account. **Corrected:** `ProposalAction::SetAuthority` **does not exist** — the enum is exactly {RotateSeat, MigrateWallet, WithdrawTreasury, SetTreasuryWallet} (`council.rs:92-104`) — and "authority rotatable" was false by construction. **No admin key exists by design:** MigrateWallet rebinds wallets, RotateSeat / `install_elected_seat` rebind seats. |
| F10 | E8 | Migration time-lock + any-seat contest | ✅ | `Council.recovery_timelock`, `Proposal.eligible_at`, `execute_proposal` (armed/eligible check), `cancel_proposal`; `tests/resilience.ts` | anti-collusion. `arm_if_ready` (`council.rs:148-162`) now applies the uniform contest window to **every** action including RotateSeat — this is what closed the old "purge before migration" item. |
| F11 | E8 | Member co-signature & self-recovery (≤2 guardians, 1-of-2) | ✅ | `set_recovery`, `member_migrate`, `recover_membership` (`require_cosign` → `is_member_key`); `Membership.recovery_keys` (`state.rs:69-88`); `docs/resilience.md`; `tests/cosign.ts` | Guardians are arbitrary member-chosen wallets and act **1-of-2**. E8 wants recovery through the member's *two sponsors* — that needs E1 to exist first and blinded keys, not raw pubkeys (see **F66**). |

### Shamanic lineage & credentials
| # | Epic | Feature | Status | Instructions / files | Notes |
|---|------|---------|--------|----------------------|-------|
| F12 | E2 | ZK lineage level grants (issuer-anonymous) | ✅ ⚠ | `initialize_lineage`, `grant_level` (`VERIFYING_KEY`); `circuits/lineage_grant.circom`; `merkle.rs`; `app/lineage/prove.ts`, `poseidonTree.ts`; `docs/zk-lineage.md` | append-only Poseidon tree. ⚠ It feeds `Membership.level` (`state.rs:64`), a **public ordinal rank** rendered beside member identities — the strongest contradiction of E4's "no ratings, no verification tiers, nothing comparative" (Sentinel R7). |
| F13 | E2 | Acknowledgment credentials (PPP·CCC·XXX·DDD) | ✅ | `issue_acknowledgment` (reuses the lineage `VERIFYING_KEY`; public inputs [nullifier, lineage.root, attest_level, ack_root]); `Acknowledgment` (`state.rs:162-174`) | stores only the root R. |
| F14 | E5 | ZK selective field disclosure | ✅ | `circuits/ack_disclose.circom`; `app/acknowledgment/prove.ts` (reveal/hide flags); `verify_disclosure` | reveal/hide each field. The read-path analogue E5 needs must verify **off-chain** — see **F60**. |
| F15 | E5 | ZK predicate proofs (date / course-in-catalog / teacher-in-set) | ✅ | `ack_disclose.circom`; `app/acknowledgment/prove.ts` (`buildSet`, catalog-membership and teacher-set paths); `docs/acknowledgments.md` | — |
| F16 | E5 | On-chain predicate-gated access | ✅ | `verify_disclosure` (recomputed `requirements_hash` == stored, `VERIFYING_KEY_ACK`), `AccessPass` PDA `["access", gate, requirements_hash, ack]`; `verifying_key_ack.rs` | mints an AccessPass. ⚠ Reusing this pattern for *profile* visibility would publish "viewer V unlocked member M's element" — the interest graph E5 forbids. |

### Treasury
| # | Epic | Feature | Status | Instructions / files | Notes |
|---|------|---------|--------|----------------------|-------|
| F17 | E0 | Self-supporting donation treasury | ✅ | `donate`, `donate_token` (any SPL/Token-2022), `withdraw_treasury` (treasury PDA `["treasury", circle]` signs); `app/treasury/fund.ts`; `docs/treasury.md` | `withdraw_treasury` also enforces the **F38** recipient allowlist and a `drained` replay guard (`council.rs:121-123`). ⬜ It has **no rent-exempt floor** — no `rent`/`minimum_balance` check anywhere in the file, so a 4-of-7 vote can drain the PDA to 0 (tracked under *Open decisions* → mainnet gates). |
| F36 | — | **`CircleConfig` policy PDA + donation-on-renew** (Tradition 7) | ✅ | `set_circle_config` (any seat); `CircleConfig` PDA `["config", circle]`; `renew_membership` CPI-transfers `renew_donation_lamports` into the treasury as the act of renewal (0 = free) | Was shipped-but-unnumbered free text. Parent row for **F37** (vote thresholds) and **F38** (treasury allowlist); read by `withdraw_treasury.rs:73-80` and `finalize_member_proposal`. Admin console → "Self-support (Tradition 7)". *Environment claim:* devnet upgrade `2sZmGW35…`. |
| F38 | — | Treasury **mission/spend allowlist** (Traditions 5/6) | ✅ | `set_treasury_allow` (any seat); `TreasuryAllow` entry required by `withdraw_treasury.rs:36-48` when `CircleConfig.treasury_allowlist` is on; admin "Circle policy" allowlist manager | Was shipped-but-unnumbered free text. Config is seed-bound + `init_if_needed` in the withdraw path so it cannot be omitted to bypass. *Environment claim:* devnet upgrade `5Q6yfmMv…`, allowlist off/on-unlisted/on-listed verified. |
| F29 | E10 | **Change the Circle treasury wallet (4-of-7) — must be a multisig** | ✅ | `ProposalAction::SetTreasuryWallet`, `propose`/`execute_proposal`/`set_treasury_wallet` (unpacks SPL/Token-2022 `Multisig`, requires `is_initialized && m ≥ 2 && n ≥ m`, else `TreasuryNotMultisig`), `TreasuryConfig` PDA `["treasurycfg", circle]`; `frontend/lib/multisig.ts`, `scripts/create-multisig.js`, `docs/multisig.md` | Tradition 7 — money held in common, never by one key. Same time-locked, contestable machinery as `WithdrawTreasury`. *Environment claims:* devnet upgrade `cDX8sWiJ…`, 2-of-3 multisig `AHvaueFp…`. |
| F80 | E0 · E10 | **Withdraw SPL/Token-2022 from the treasury (4-of-7)** — the token counterpart of `withdraw_treasury` | ✅ | `ProposalAction::WithdrawTreasuryToken { mint, amount, recipient }`, `withdraw_treasury_token` (signs `transfer_checked` with the `["treasury", circle]` PDA), gated on an executed 4-of-7 proposal + one-shot `drained` guard + the `treasury_allowlist` check; `propose`/`execute_proposal` arms | **Security fix (2026-08-11 audit, `docs/security-review-2026-08-11.md`).** Before this, tokens sent via `donate_token` were **permanently locked** — the treasury token account is owned by the treasury PDA but nothing signed a token CPI with those seeds. Now the Council can move them, same contestable machinery as the SOL path. Enum `MAX_SIZE` bumped `1+32+32` → `1+32+8+32` (largest variant). ⬜ frontend admin UI wiring is a small follow-up (the SOL `withdrawTreasury` already exists in `admin.ts`). |
| F81 | E9 | **Full-page localisation (19 languages)** | 🟢 | `frontend/lib/i18n.ts` (per-page key namespaces + per-locale dictionaries), `frontend/lib/i18n.generated.ts` (generated page-body strings), `frontend/components/SettingsProvider.tsx` (`useT`), page bodies wired to `t()` | **Done 2026-08-12** (started 2026-08-11). Before this round only the app **chrome** (nav, brand tagline, hero, footer, control labels — ~13 keys) was localised; every page **body** rendered hardcoded English regardless of the chosen locale (reported: selecting ไทย/Thai translated only the top menu). This round extends `t()` coverage to the bodies of `me`, `foundation`, `admin`, `board`, `create`, `onboarding`, `inbox`, `reflections`, `documents`, `notifications`, `member`, namespacing keys per page (**749 page keys**), and **fills every non-English dictionary** — `PAGE_STRINGS` now carries `en` + **18 non-English locales**, each with all 749 page keys plus the 8 `msg.*` keys translated. **Quechua (`qu`, "Runa Simi") added** this round, bringing the switcher to **19 locales** (en, fr, es, se, th, hi, zh, de, sv, nb, da, ar, lo, dz, bo, my, vi, tl, qu). `Key` loosened from a closed union to `string` (the `en` dict stays the canonical registry + fallback; resolution degrades to English, never a raw key). Also localised the shared messaging-enable UI + a Devnet network-mismatch caveat (`DevnetSignNote`) and an honest inbox metadata explainer (no over-claim of contact-graph privacy — the relay still sees recipient-side metadata; mixing is the un-shipped v2 step). Board Circle-picker now lists only Circles the connected wallet belongs to (full-list fallback for non-members). Proper nouns (AHA, Ayni, Solana, SOL, Devnet) and dynamic values stay unwrapped. `tsc --noEmit` clean. |
| F82 | E9 | **/reflections default mode — built-in Daily Reflection + browse-by-day calendar** | 🟢 | `daily_reflexions/daily_reflexions.xlsx` (source), `frontend/lib/daily-reflections-default.ts` (GENERATED, 161 dated entries keyed `MM-DD`), `frontend/lib/reflections.ts` (nearest-date resolution), `frontend/app/reflections/page.tsx` (rewritten — hero + `Calendar`), `frontend/app/globals.css` (`.refl-*`), new `reflections.*` i18n keys | **Done 2026-08-12.** When no Circle has published a Daily Reflection for the chosen day, the page now falls back to a built-in reflection from the shipped dataset (exact day, or the **nearest** available day by circular calendar distance — e.g. today 08-12 → 08-13). aa.org-inspired layout: **Title (XL bold)** → localised current date → **quote (bold)** with accent rule → attribution → reflection body → source/step. A **browse-by-day calendar** (Monday-first, localised month/weekday names, dot on days that have an entry, today + selected highlighted) lets any date be opened; a selected Circle's own entry for that date still wins over the built-in. **Content stays in its source language** (scripture, philosophy, literature — translating sourced quotes would be wrong); only the chrome is localised (18 locales) and the date via `toLocaleDateString(lang)`. Data extracted from the xlsx once → TS module (no runtime xlsx parse). `tsc --noEmit` clean. |
| F83 | E9 | **Home slogan + invisible Core-Shamanism link** | 🟢 | `frontend/app/page.tsx` (`SloganWithLink`), `frontend/lib/i18n.ts` (`home.slogan`), `frontend/app/globals.css` (`.home-slogan`, `.stealth-link`) | **Done 2026-08-12.** Under the "Ancestral Humanity Anonymous" title: *"AHA is a 12 step Core Shamanism recovery and spiritual development program for human beings, built on trust, lineage, and proven ancestral wisdom."* The phrase **"Core Shamanism"** is an **unobtrusive link** — visually identical to surrounding text (no underline, colour, weight, or cursor change) — opening `https://www.shamanism.org/core-shamanism/` in a new tab (`target=_blank`, `rel=noreferrer`). Localised across 18 locales; "AHA" and the verbatim phrase "Core Shamanism" are preserved in every translation so the split-and-link is reliable. |
| F84 | E9 | **/me anonymity note + ZK explainer link; Ayni tooltip link order** | 🟢 | `frontend/app/me/page.tsx` (`AnonymousNote`), `frontend/components/BrandAyni.tsx`, `me.gs.anonymousNote` + `me.gs.zkLink` in `frontend/lib/i18n.generated.ts` (19 locales) | **Done 2026-08-12.** The /me getting-started note now reads *"Everything here is truly anonymous by default — a membership is a ZK commitment (using zero-knowledge proofs technology), not your name."* with the italic phrase **"zero-knowledge proofs technology"** linking to the Wikipedia article on zero-knowledge proofs (`target=_blank`, `rel=noreferrer`). Implemented via a `{zk}` placeholder kept verbatim in all 18 non-English translations (verified exactly-once per locale), so word order localises and a translation that dropped the placeholder would degrade to plain text, never break. Also: the **Ayni brand tooltip** (top nav) now lists **GitHub ↗ before Wikipedia ↗**. Sentinel coverage: `UNTRACKED-me-zk-link` resolved into this row; the i18n gate covers both keys (772/772). |
| F35 | E0 | **Gas faucet — first gas for the neophyte** | ✅ ⚠ | `init_faucet` (any seat), `set_faucet_amount` (Treasurer, ≤ on-chain cap), **`activate_faucet_zk` (anonymous, preferred)**, `activate_faucet` (named, **deprecated**), `refill_faucet` (passed member vote, one-shot); `FaucetJar` (`state.rs:623-639`); `docs/faucet.md`; `tests/faucet.ts` (21 cases); `frontend/lib/faucet.ts`, `frontend/lib/zk-vote.ts` (`proveMemberEndorsement`) | Per-Circle jar PDA `["faucet", circle]`. Parrain attestation = the **F27** WingPeer bond; **one grant per membership commitment per Circle** via nullifier `["faucetnull", circle, commitment]` (E0's story says "one grant, one time, ever" — fellowship-wide dedup would need a linkable commitment, so it is delegated to **F5**). Uniform grant `jar.grant_lamports`, cap `FAUCET_MAX_GRANT_LAMPORTS = 2_000_000` (`state.rs:643`); a retune pauses grants for `FAUCET_AMOUNT_COOLDOWN` 24h so an amount cannot be aimed at one neophyte; refill capped at `FAUCET_MAX_REFILL_GRANTS = 100` grants' worth. Refill binds to an F6 vote whose `description_hash = hashv("AHA-faucet-refill" ‖ circle ‖ amount_le)` (solana `hashv` — sha256). **Sponsor edge removed (2026-08-12f).** `activate_faucet_zk` proves "SOME member of the tree endorses this grant" with the shipped `member_vote` VK — external nullifier `SHA-256("AHA-faucet-grant" ‖ circle ‖ neophyte)` masked into BN254 (domain-separated from `attest_admission_zk`'s, so one member's two anonymous acts never share a nullifier), `choice = 1`, root current-or-F54-recent, relayed via F55. **No parrain account of any kind is in the transaction**; both paths share `pay_uniform_grant` and the same `["faucetnull", circle, commitment]` one-shot, so the economics are byte-identical and the forms cannot be stacked. The named path is kept, deprecated in code + docs, ONLY as the fallback for a parrain whose device holds no ZK voting key; the client prefers the anonymous path (`haveVotingKey`). ⚠ **Residual limits:** the proof says *a member*, not *the designated wing* — `member_vote` cannot prove a WingPeer bond without a new ceremony (**F44**); the public `WingPeer` PDA still publishes the commitment-level sponsor edge independently of the faucet, so an observer can still *guess* the wing (that is **F27** / Sentinel R2, unchanged); a neophyte already in the member tree can endorse their OWN grant (the named path could not be self-served — `establish_wing_peer` refuses `mentee == wing` — but an anonymous proof cannot be compared against the neophyte's commitment without a new circuit, **F44**): the ceremony is lost, not the money, since the bound is one grant per commitment and the membership door; both paths still reject `owner == default`, so first gas needs a bound wallet; an open+no-personhood Circle can still farm its own jar (bounded by the membership door, not the endorsement). Remaining E0 work: **F49** (F47/F48 shipped same day, pilot form); real-proof e2e for the anonymous path is uncovered, same gap as **F53**. ⬜ *No devnet upgrade signature recorded — every other shipped row cites one.* |

### Directory & frontend
| # | Epic | Feature | Status | Instructions / files | Notes |
|---|------|---------|--------|----------------------|-------|
| F18 | — | Public Circle directory (geo + IPFS doc CIDs) | ✅ | `upsert_circle_profile`, `CircleProfile` (`state.rs:263-293`); `frontend/app/page.tsx`, `/documents`, `/reflections`, `components/CircleMap.tsx`; `tests/profile.ts` | "Find a Circle Near You" map; one `getProgramAccounts` read. See **F71** for the third-party geolocation calls on this page. |
| F19 | — | Update circle locations (in-place, no history) | ✅ | `update_circle_location` (any seat; validates coordinate ranges + field lengths) | writes only lat/lon/city/address — name & doc CIDs untouched; **overwrite only, no location history kept**. |
| F26 | E4 | Structured **meeting schedule** + calendar on a Circle *(formerly F18b)* | ✅ | `set_meetings`, `CircleMeetings` (`state.rs:487-496`, JSON blob, `MAX_DATA` 900); `frontend/lib/meetings.ts`, `/create`, home Circle detail | recurring patterns ("2nd Wednesday monthly 18:00") + one-off sessions, expanded into an upcoming-meetings calendar visible to everyone. **Renumbered `F18b` → `F26`** and moved here beside F18/F19 — it is Circle metadata, not a rider on the directory (see the numbering footnote). |
| F41 | — | Circle country / continent grouping | ✅ | `set_circle_country` (seat-gated), `CircleCountry` PDA `["country", circle]`; `frontend/lib/country.ts` | Was a shipped instruction with **no feature row anywhere** — the only IDL entry point that mapped to nothing. Powers continent→country grouping in the foundation directory. |
| F20 | E6 | Deterministic Jazzicon identicons | ✅ ⚠ | `frontend/lib/jazzicon.ts`, `components/Identicon.tsx`; `tests/jazzicon.ts` | self-contained SVG + SHA-256. **Brand rule (regression-guarded):** addresses starting with `AHA` render entirely in the purple/violet family — background *and* every shape (hue 255–305), never orange; `tests/jazzicon.ts:48-74` asserts all stops are purple for `AHA*` and that non-AHA keeps the full hue wheel — **do not remove that test.** ⚠ Currently "the avatar everywhere", including to unauthenticated visitors — E5/E6 demote it to a key-visualisation fallback kept **off** member-facing pages. |
| F21 | — | Delist a Circle from the directory | ✅ | `close_circle_profile` (`require_any_seat`, rent → seat); `scripts/close-circle.js` | Circle/Council/members untouched. |
| F22 | E9 | Wallet connect + "My Circle" member console | ✅ | `frontend/app/me/`, `lib/member.ts` (memcmp on `OWNER_OFFSET`), `components/WalletProviders.tsx`, `WalletButton.tsx` | connect a Wallet-Standard wallet → see your memberships, join a home circle, 7th-Tradition `donate`. |
| F23 | E9 | "Create a Circle" self-serve UI | ✅ | `initialize_circle`, `initialize_member_tree`; `frontend/app/create/`, `lib/createCircle.ts` | guided wizard: name (≤32 B), parent (foundation default), 7 distinct seats (creator auto-seated so they can sign the member-tree init, depth pinned to the circuit), advanced term/time-lock; shows the assigned `@aha` address on success. Its two hardcoded wallet links are what **F67** replaces. |
| F24 | — | Circle administration console (seat-gated) | ✅ | `propose`/`approve`/`execute_proposal`/`cancel_proposal`, `create_member_proposal`/`finalize_member_proposal`, `issue_membership`/`renew_membership`/`revoke_membership`, `set_open_membership`, `set_treasury_wallet`; `frontend/app/admin/CircleAdmin.tsx` embedded in `/me` | the standalone menu was removed — `/admin/page.tsx` is now only a redirect. Role, Council + group-conscience votes (CRUD), membership add/renew/**delete**, membership & treasury-wallet policy. Casting member ballots is the ZK flow (F6). *Housekeeping:* `frontend/components/AdminNavLink.tsx` is now orphaned (imported by neither `Nav.tsx` nor `layout.tsx`) — dead code, delete it. |
| F34 | E10 | **Foundation-led federation governance** (rotate seats / delete a Circle, 4-of-7) | ✅ | `propose/approve/execute_child_rotation`, `propose/approve/execute_child_close` (`validity_secs`, 1–90-day window), `ChildSeatVote`/`ChildCloseVote`; `frontend/app/foundation/`, `lib/foundation.ts` | the foundation Council can rotate any federation Circle's 7 seats or delete a Circle (closes it + delists its profile). Federation = Circles sharing the foundation's root `parent`. This already makes some cross-Circle votes **binding** — see the sovereignty ADR under *Open decisions*. |
| F71 | E5 | Remove third-party IP-geolocation from the public site | ✅ | `frontend/app/page.tsx` (browser Geolocation only, button-gated, local-only copy), `frontend/lib/geo.ts` (Nominatim removed; `validCoord` only), `/create` manual lat/lon | **Shipped 2026-08-11b.** The ipwho.is/ipapi.co IP fallback and the Nominatim reverse-geocode are gone; the visitor's IP is no longer handed to any third party. Residual, documented: the Leaflet **map tiles** still load from `tile.openstreetmap.org` (`CircleMap.tsx`) — that is the map itself (same class as any remote image), not an IP-geolocation lookup, and exports no user-entered data. |

### Community & content
| # | Epic | Feature | Status | Instructions / files | Notes |
|---|------|---------|--------|----------------------|-------|
| F30 | E5 | **Member posts / bulletins** (text + picture, time-boxed, seat-removable) | ✅ ⚠ | `create_post` / `delete_post`, `Post`; `frontend/app/board/`, `lib/posts.ts` | Any member publishes text and/or an IPFS image, valid `start_date`→`end_date`. Any of the 7 seats deletes any post anytime (rent → acting seat). ⚠ `create_post.rs:27` requires `membership.owner == author`, so **publishing is a permanent public proof that a named wallet is a member** (Sentinel R5) and owner-less anonymous memberships cannot post at all — a rank-by-disclosure asymmetry. ⚠ `/board` renders posts and author identicons to **unconnected visitors** — posting is gated, reading is not (E5). |
| F32 | E7 | **Encrypted 1:1 private messaging** | ✅ ⚠ | `register_messaging_key`/`send_message`/`delete_message`, `MessagingKey`/`Message` (`state.rs:545-559`; recipient, `eph_pubkey`, nonce, fixed 528-byte ciphertext (was 1040 until 2026-08-11b)); `frontend/app/inbox/`, `lib/messaging.ts` | Inbox with unread badge. End-to-end encrypted (tweetnacl box; x25519 keypair from a deterministic wallet signature, public half on-chain); decrypt-on-select; optional expiry. **Content confidentiality is sound.** ⚠ Against **E7** this is the architecture the epic rules out, not a partial version of it: messages live **on chain** with a cleartext `recipient`, a public timestamp and a public fee-payer (`messaging.ts:191` `payer: wallet.publicKey`); `delete_message` closes the account but ciphertext + metadata persist in ledger history; the static key gives **no forward secrecy**; and the `MessagingKey` PDA publicly marks every messaging-enabled wallet as fellowship-adjacent (Sentinel R4). Sunset plan = **F63**. |
| F32b | E7 | **Seat-holders must have messaging enabled** *(rider on F32)* | ✅ (UX-enforced) | `frontend/components/SeatMessagingGate.tsx`, mounted in `frontend/app/layout.tsx` | Policy: any wallet holding one of the 7 seats in **any** Circle must have messaging enabled, so servants are always reachable. **Cannot be force-enabled cryptographically** — the key derives from the holder's *own* signature — so enforcement is a persistent, non-dismissable banner with a one-click enable. ⬜ optional on-chain hardening: require a `MessagingKey` PDA before a holder is installed — **corrected target**: `execute_proposal`'s RotateSeat branch (`execute_proposal.rs:31-40`) and `install_elected_seat` (the old note named `appoint_seat`, which does not exist), with a chicken-and-egg caveat. ⚠ The policy pushes every seat-holder to publish a fellowship-adjacent marker. |
| F27 | E1 · E3 | **WingPeer (mentor) bond + ProgressToken milestone chips** | ✅ ⚠ | `establish_wing_peer` (set by the mentee) / `end_wing_peer` (either party), `WingPeer` PDA `["wingpeer", circle, mentee]`; `issue_progress_token` (any seat, one per member+milestone), `ProgressToken` PDA `["progress", circle, member, milestone]`; admin "🏅 Award chip", `/me` "Mentorship & progress" | Was shipped-but-unnumbered and is **load-bearing**: F35's parrain attestation is this bond, and three epics map onto it. Both keyed by membership commitment. ⚠ **Two recorded Traditions conflicts:** the WingPeer PDA publishes a commitment→commitment **sponsor edge** (Sentinel R2 — exactly what E2 exists to remove) and `ProgressToken.issuer` (`state.rs:417`) permanently records the **named awarding seat**. ⚠ `ProgressToken.milestone` is **elapsed days** (`state.rs:415`), not the twelve steps — chips are enumerable and members are orderable by chip count (Sentinel R7, escalating). E3's step model is **F57**, not this. *Environment claim:* devnet upgrade `2o8PdaZL…`. |
| F33 | E6 | **User profile: avatar + timezone** | ✅ | `frontend/lib/profile.ts` (localStorage `aha:profile`), `/me` ProfileCard | per-device avatar (overrides the Jazzicon on My Circle) + IANA timezone (localises Inbox timestamps). Nothing is written on-chain — so "never public by default" holds only **vacuously**: there is no disclosure path at all. E4/E6 need the encrypted profile object of **F60**. The stored avatar is the **resized raw photograph** (see **F69**). |
| F40 | — | Notifications centre (chain-derived) | ✅ | `frontend/lib/notifications.ts`, `frontend/app/notifications/`, nav 🔔 bell with unread badge | Was shipped-but-unnumbered free text. Derived entirely from chain: Council votes you must cast/execute, open member votes, memberships expiring < 30 days, milestone chips earned. Viewing marks read (per-device). No external dependency; Dialect Cloud / Blinks push remains a future option on the same content model. **F63** must rework it — it is built on the on-chain F32 design. |

### Off-chain infrastructure
| # | Epic | Feature | Status | Instructions / files | Notes |
|---|------|---------|--------|----------------------|-------|
| F25 | E9 | Mandatory per-Circle email on the AHA domain (auto-provisioned at registration) | 🟡 ⚠ | `frontend/lib/circleEmail.ts` (deterministic `slug-<pda6>@DOMAIN`), `frontend/app/api/circle-email/route.ts`; wired into `/create`, `/me`, `/admin`; `indexer/email-indexer.js` | Every Circle gets a derived `@aha` address at creation — mandatory, no opt-out. A route sends a *provision* mail on creation and a *registration* mail on each `issue_membership`; `indexer/email-indexer.js` polls for new `Circle`/`Membership` accounts and covers registrations outside this UI (baseline-safe). **Remaining for ✅:** mailbox **receive** — MX + Mailgun inbound Route (DNS task, `indexer/README.md`). *Environment claims (not checkable from the repo):* SMTP live on the deployed host; devnet end-to-end verification. ⚠ **Sentinel R3, half-closed:** abuse limb fixed (10 req/60 s per-IP, on-chain Circle-name match, on-chain membership proof for join) — but the mail body still exports `Member wallet: …` to Mailgun/SMTP logs at the most identity-linking moment in onboarding, `indexer/email-indexer.js:110-115` still feeds it `m.account.owner`, a `kind:"join"` POST with **no** `memberAddress` skips verification entirely, and the rate limit is an in-process Map (per-instance only). |

### Assurance & operations
| # | Epic | Feature | Status | Instructions / files | Notes |
|---|------|---------|--------|----------------------|-------|
| F42 | — | Fuzz / property tests of Council vote accounting and nullifier logic | 🟢 | target: `programs/ayni/src/council.rs:141-146` (approvals bitmask), `:157-162` (`arm_if_ready`); nullifier namespaces `nullifier` / `ack_nullifier` / `vote_nullifier` / `personhood` / `faucetnull` | **Not started, and the program has no Rust-level tests at all** — `#[cfg(test)]`, `proptest`, `quickcheck` return zero hits under `programs/ayni/src`, and there is no fuzz target. Every current test is an integration `.ts`. Numbered so Sentinel can hold coverage against it. **Done 2026-08-12:** `proptest` 1.5 dev-dep; `programs/ayni/src/proptests.rs` — 12 property tests, 256 cases each where applicable. Council vote accounting over arbitrary approve/cancel/execute sequences (count ≤ 7, no double-count, `eligible_at` arms once at threshold and freezes, cancel always wins before execution), full-range `i64` timelock arithmetic (no panic/overflow), quorum/pass math over the whole `u16` config space (no div-by-zero; rounding can never pass below the configured %; exact-boundary cases; default = ceil(eligible/3), strict majority), Merkle insert/prove roundtrip + cross-leaf proof rejection + capacity + `RecentRoots(16)` ring semantics, nullifier PDA determinism and domain separation across all 7 seed families. Behaviour-preserving extractions: `Proposal::require_executable` (`council.rs:171`), `quorum_threshold`/`vote_passes`/`member_vote_outcome` (`finalize_member_proposal.rs:6-40`) — original call sites now call them. `cargo test -p ayni` 12/12 in 7.3s; `cargo check --workspace` clean. |
| F43 | E2 | ZK end-to-end proof tests for the remaining circuits | 🟢 | target: `grant_level`, `issue_acknowledgment`, `verify_disclosure`, `prove_personhood` | Only `member_vote` has a real-proof e2e path (`tests/vote.ts`, `tests/f28-election.ts`), which validates the Poseidon/circom ↔ `solana-poseidon` match and the snarkjs→groth16-solana byte encodings. The other four circuits have no equivalent — grep across `tests/*.ts` returns nothing. E2 cannot ride on an unverified ZK stack. **Done 2026-08-12:** `tests/zk-e2e.test.mjs` — 23 tests, ~8s, plain node. Full Groth16 prove→verify roundtrips for **all three** circuits (`member_vote`, `lineage_grant`, `ack_disclose`) against the in-process zkey-exported VK, plus negative cases (tampered public signal, nullifier substitution across identities, wrong/empty Merkle root, non-member witness refusal, over-level grant refusal, forged disclosure value, foreign catalog root). VK-consistency: every embedded point in `verifying_key{,_ack,_vote}.rs` verified byte-equal to the zkey export under the `scripts/vk_to_rust.js` encoding, `IC.len == nPublic+1` per circuit; `frontend/public/zk/` browser artifacts asserted byte-identical to `build/` (browser prover = tested prover). **No drift found.** Complements `tests/sentinel/zk-integrity.sh` (which diffs via committed vkey JSONs) with the actual roundtrip. ⬜ noted for cleanup: `frontend/lib/zk-vote.ts:17` labels the BN254 **base** field value as the scalar field `R` (harmless today — secrets are masked < 2^253 < r — fixed in the master-rooting round's Step 1). |
| F44 | E2 · E10 | Multi-party (phase-2) trusted-setup ceremony | 🟡 | **Tooling + runbook shipped (2026-08-12c):** `scripts/ceremony/{init,contribute,verify,finalize,transcript}.mjs` (node 18 + snarkjs 0.7.6, output confined to gitignored `ceremony/`), `docs/ceremony.md`; dry-run proven on `member_vote` (2 contributors + beacon, tiered verification, tamper test). Remaining for ✅: the actual ceremony (real contributors, published transcript + package, beacon slot) and the **separate Sentinel-gated swap round** — regenerated `verifying_key.rs` / `verifying_key_vote.rs` / `verifying_key_ack.rs`, `build/` + `frontend/public/zk/` zkeys, redeploy; fix `docs/zk-lineage.md` §6 | All three shipped VKs come from a **single-contributor** ceremony — a trust weakness, not a functional one, and a **mainnet blocker** (`circuits/README.md`). Phase 1 (`pot16`) was also single-party and its ptau + the r1cs are not in git — `docs/ceremony.md` §3 recommends Mode B (fresh setup from a public ptau) for mainnet. |
| F45 | E10 | Program upgrade authority → multisig / MPC | ⬜ | machinery exists: `frontend/lib/multisig.ts`, `scripts/create-multisig.js` | The program's upgrade authority is still **one person's keypair**. This cannot be enforced on-chain by the program (it is a loader setting), so it is a migration with artifacts, not a code change. Pairs with the stewardship ADR (*Open decisions*). |
| F46 | — | Sentinel per-feature checklist coverage for the whole registry | ⬜ | `tests/sentinel/checklist.yaml` has `features:` entries for **2 of 41** shipped rows (F35 and F25); everything else is covered only implicitly by layer-level commands. CLAUDE.md requires every shipped feature to gain coverage in the round it ships (WARNING in round *n*, FAIL in *n+1*), so the whole back-catalogue is now overdue — in particular F20's "do not remove that test" brand rule and F32b's seat-messaging policy, which have no entry at all. Also create `tests/sentinel/baselines/` (R12) and commit `baselines/npm-audit.json` (R13) so rounds have a comparison point. |

---

### Numbering footnote (2026-08-10)

Three defects were resolved without renumbering anything that was already
correct. F-numbers are referenced from commit messages, docs and code comments.

- **`F18b` → `F26`.** The number 18 was claimed by two *unrelated* features:
  the public Circle directory (`upsert_circle_profile`/`CircleProfile`) and the
  meeting schedule (`set_meetings`/`CircleMeetings`), in two different sections —
  so the `b` was not a rider marker, it was a second feature squatting on 18.
  **F18 keeps the number** (original, matches its section); the meeting schedule
  takes **F26**, a free number, and moves into *Directory & frontend*. Safe:
  `git log --all | grep F18b` returns nothing and no code references it; the only
  two references were `docs/shipped.md:121` and
  `backlog/AHA_Trust_Platform_GapAnalysis.md:100`, updated in the same commit.
  The alias *"formerly F18b"* stays on the row for one release.
- **`F32b` stays `F32b`.** Unlike F18b it is a genuine policy rider on F32 — it
  exists only because messaging exists — **and it is referenced from commit
  `a46f0ef`** ("…require seat-holders to enable messaging (F32b)"), so
  renumbering would break a permanent reference. Legitimised instead by the
  legend entry `Fn b` = rider/addendum, never an independent feature. F32 and
  F32b are distinct identifiers and both are correct.
- **`F26` / `F27` were never issued before 2026-08-10** — verified genuinely
  unused (zero hits across `*.md`, `*.rs`, `*.ts`, `*.tsx`, and no commit
  reference); no descoped feature, no orphaned code. Assigned on that date:
  **F26** = meeting schedule (promoted out of F18b), **F27** = WingPeer bond +
  ProgressToken chips (shipped since 2026-06 with no number at all). History was
  not rewritten; a hole was filled.
- **Registry↔code corrections** made in place, with no number changes: F4
  ("authority-gated" → Secretary-seat-gated), F7 (dropped the non-existent
  `appoint_seat`), F9 (dropped the non-existent `ProposalAction::SetAuthority`
  and the false "authority rotatable" note), F28 (dropped the non-existent
  `ElectionProposal` / `cast_election_ballot` / `finalize_election`, and
  re-credited the browser prover to `frontend/lib/zk-vote.ts`), F32b (retargeted
  the hardening note off `appoint_seat`), F6 (quorum is configurable, not fixed).

---

## Epic roadmap (product backlog E0–E12)

Coverage verdicts are from the verified gap analysis, re-checked against the
code. Every F-number here exists in the registry above.

| Epic | Title | Coverage | Implemented by | Remaining work | Phase |
|------|-------|----------|----------------|----------------|-------|
| **E0** | The Faucet — first gas for the neophyte | 🟡 **mostly** (anonymous activation shipped 2026-08-12f) | **F35**; rests on F17, F27, F5, F6, F29 | ~~F47 ledger~~ ✅ · ~~F48 jitter~~ ✅ (both pilot-form, same day) · ~~anonymous relayer-gated activation path~~ ✅ **`activate_faucet_zk`, 2026-08-12f** (member_vote VK reused, F55-relayed, no parrain account in the tx; named path deprecated-but-kept for parrains with no device key) · **F49** governed cap account · devnet deploy + recorded upgrade signature for F35 · reach fully-anonymous members (both paths still reject `owner == default`) · Layer-D assertion 7 is now half-mechanical (`tests/faucet.ts` asserts the anonymous tx names no parrain); the adversarial half — relayer timing/IP + the WingPeer lookup an observer can do unaided — is still ungated | 2 (anonymous form shipped) |
| **E1** | Two-sponsor admission *(amended v0.2: parrain = any member; second attestation = one of the 7 trusted servants)* | ⬜ **greenfield** ⚠ | related: F4, F31 ⚠, F5, F1, F27 ⚠, F28 (seat legitimacy) | **F50** `attest_admission` (asymmetric pair) + two-attestation gate on `issue_membership` · **F51** split issuance from member-tree insertion (provisional membership) · **F52** sponsor UI · ADR reconciling F31 open membership with two-sponsor admission · rewrite `docs/sybil.md` (its doctrine equates "authority-gated issuance" with "social vouching") · attestor good-standing checks everywhere sponsors are consumed | 1 (named pilot); anonymous form → 2 |
| **E2** | Zero-knowledge vouch-proofs *(anonymous attestation `attest_admission_zk` built this round; still needs F54 good-standing tree, F55 relayer, F56 cross-Circle anchor)* | ⬜ **greenfield** | ZK base: F6, F12, F13, F14, F15, F16, F5, F28 | **F53** `vouch_member` circuit + VouchTally · **F54** recent-roots ring buffer + good-standing member set · **F55** relayer service · **F56** fellowship-wide verification anchor · **F43** e2e circuit tests · **F44** multi-party ceremony · ship the vouch wasm+zkey to `frontend/public/zk/` | 2 |
| **E3** | The Quipu — physical necklace | 🟡 **mostly** (step model + codec + guide + **five-stage boundaries (final)** incl. iridescent cauda pavonis) | **F57**; distinct from F27 day-chips | remaining: **hex values only** — sample from dyed yarn per `docs/quipu.md` protocol (a dyeing task, not a lookup — the Emerald table never had a colour column); render shipped in **E4** | 1 (shipped; hexes provisional) |
| **E4** | The Quipu page (trust page) | 🟡 **mostly** (page + necklace render + vouch-proof shipped this round; bio/service/presence pending E5/F59) | **F58** (page + `QuipuNecklace` + `trustpage.ts`); F3/F26 region | remaining: served bio + service history (E5/F60), ZK presence (**F59**), and stop rendering `level` on member surfaces (E5) | 3 (mostly shipped) |
| **E5** | Per-element visibility settings | 🟡 **partial** (policy engine + read-path decision + bare-page + level retrofit shipped; encrypted per-tier keys and ZK read-path enforcement are Phase 2) | **F60** (VisibilityPolicy + `mayView`), **F61** (hidden≡absent + level drop) | remaining: encrypted profile key distribution, ZK circle-membership proof on the read path (inherits E2), `/board` public-read retrofit, roster unlinkability | 3 (partial) |
| **E6** | Avatar / stone-mark | 🟡 **mostly** (canvas + neutral silhouette + `/me` wiring shipped; served-avatar gating waits on E5/F60) | **F62** (`StoneMark`, `stonemark.ts`) | remaining: avatar into the E5 encrypted object so a permitted viewer sees it on the trust page (F60) | 3 |
| **E7** | Encrypted messaging | 🟡 **partial** ⚠ **wrong architecture** | F32 ⚠, F32b, F40 | **F64** client-side encrypted trust list **shipped** (`trustlist.ts`, never on chain); **F63** off-chain transport is a written design (`docs/messaging-migration.md`) — the large remaining migration (X3DH + double ratchet + sealed sender + F32 sunset) · relayer (**F55**) | 2 (a migration, not a greenfield build) |
| **E8** | Authentication — passkeys | 🟡 **mostly** (passkey unlock + device-local keystore shipped) | **F65** (`passkey.ts`, WebAuthn + PRF-derived keystore); F11/F9/F10 recovery | remaining: **F66** sponsor-bound recovery via **blinded** keys — deferred to **E11**'s shard model (raw sponsor pubkeys would publish the sponsor edge E2 forbids) | 1 (shipped); sponsor-binding → E11 |
| **E9** | Graphical onboarding | 🟡 **mostly** (F67 wallets.json + shuffled chooser + `/onboarding` 3-step stepper shipped) | **F67**, **F68** (`/onboarding`, `WalletChooser`); F51 provisional; F35 faucet | remaining: **F69** on-device cartoonisation (needs a model — documented, deferred), the F25 wallet-in-email leak, <10-min timing | 1 (F67+stepper shipped) |
| **E10** | Open decisions | 🟡 **mostly** — the six ADRs are now written in `docs/decisions/` (F70 shipped); the open sub-items they name remain | evidence: F35, F29, F34, F17, F55-gap | ~~F70 six ADRs~~ ✅ (`docs/decisions/0001–0006`) · remaining sub-items: **F45** upgrade authority → multisig/MPC · **F55** relayer · **F45** upgrade authority → multisig/MPC · **F55** relayer (the honest resolution is *hybrid*: faucet for first gas, relayer for proof submission) · genuinely open: **quantum resistance** — nothing decided, nothing written; Ed25519 + BN254 Groth16 throughout with no migration path and no `ProofAnchor` seam | 0 |
| **E11** | Sponsor Recovery — two-of-three key shards *(added v0.2)* | 🟡 **core built** (sharding + custody + both flows + lifecycle + guard, property-tested; prerequisites CLAUDE.md locked positions + Sentinel Layer F authored) ⚠ | related: F1, F11 ⚠ (existing on-chain recovery is a **different** model), F50-F52 (two sponsors), F65-F66 (passkey unlock) | **F72** Shamir 2-of-3 core · **F73** blinding + `ShardCustody` (no enumeration) · **F74** in-person handover (no network path) · **F75** member-present recovery · **F76** sponsor-only recovery (challenge window + burn) · **F77** shard lifecycle (burn/re-issue/holder-replace) · **F78** provisional-member guard + onboarding disclosure · **F79** honest handover UI + Sentinel **Layer F** · ⚠ **recovery emits NOTHING on chain** — the whole point; assert in a test · prerequisites: a **unified master-secret derivation** (wallet ⊕ commitment from one secret — today they are independent), the `ShardCustody` interface, and CLAUDE.md locked positions — **all must be authored first** | 2 (after E1 + E8) |
| **E12** | AHA mobile app — native shells + embedded wallet *(added v0.5)* | 🟡 **started 2026-08-12** | E8 (F65 keystore seals the key), E11 (the wallet keypair derives from the master secret — the locked credential-of-record model), F67 (external-wallet chooser remains the alternative) | **F86** embedded wallet core (master-secret / BIP39 derivation, wallet-standard adapter so every existing page works unchanged, key sealed via F65 keystore, no server) · **F87** /wallet UI — balances, send/receive SOL + SPL tokens + NFT gallery, QR receive · **F88** Capacitor native shells (Android + iOS) wrapping the app · **F89** store packaging + CI (APK/IPA builds, signing docs) | 3 |

### Phased sequence, reconciled with reality

The product document's Sequencing table, adjusted by the gap analysis. Struck
items are already built.

**Phase 0 — decisions & mappings (days; blocks everything)**
- ⬜ **F70** — six ADRs in `docs/decisions/`. Four are *ratification of what the
  code already did*: chain = Solana (+ the real question the epic asks:
  **scope-of-chain** — the epic wants only proofs and quipu milestones on chain;
  today it also holds posts, messages, meetings, profiles, WingPeer edges and
  `member_count`); phone-number registration = dropped; interim-vs-final
  admission = pilot first, ZK in parallel; faucet-vs-relayer = hybrid. Two are
  genuinely open: **quantum resistance** and **software stewardship**.
- ⬜ **F45** — move the program upgrade authority to a multisig/MPC (one M-sized
  move; this is the only non-writing item in Phase 0).
- ⬜ **E3 colour mapping + reading guide** — blocked on fellowship input; the
  Emerald correspondence table is not in this repo (part of **F57**).

**Phase 1 — build (weeks)**
- ~~E0 faucet core~~ — **shipped as F35** (pilot form). Resized remainder:
  ~~F47~~, ~~F48~~ (shipped same day, pilot form), **F49** + a recorded devnet deploy.
- ⬜ **E1 named pilot** — **F50**, **F51**, **F52** + the F31 reconciliation ADR.
- ⬜ **E3 quipu build** — **F57** (after the Phase 0 mapping).
- ⬜ **E8 passkeys** — **F65** (the keystore half only; **F66** slips to Phase 2
  behind E1).
- ⬜ *pulled forward from Phase 3:* **F67** (wallet chooser) and the **F68**
  stepper skeleton — no dependencies.
- ⬜ *assurance, newly numbered:* **F42**, **F43**, **F71**.

**Phase 2 — the anonymity layer (months)**
- ⬜ **E2** — **F53**, **F54**, **F55**, **F56**, gated by **F44**.
- ⬜ **E7** in parallel — **F63**, **F64**. Note this is now a **migration** off
  F32, not a greenfield build.
- ⬜ *pulled forward from Phase 3:* **F60**, the per-tier key architecture — E4,
  E6 and E9's one-way glass all depend on it.
- ⬜ **F66** (sponsor-bound recovery), behind E1.
- ⬜ E0's anonymous form: relayer-paid, vouch-gated `activate_faucet`.

**Phase 3 — the member surface (weeks)**
- ⬜ **E5** — **F61** (after F60).
- ⬜ **E6** — **F62**.
- ⬜ **E4** — **F58**, **F59** + the `Membership.level` demotion.
- ⬜ **E9** — **F68** (full), **F69**, and the one-way glass. Last by design: it
  stitches the others together.

---

## Epic work backlog (planned)

New rows, continuing after F35, so planned epic work lives in the same registry
as shipped work. All ⬜ unless noted.

### E0 — faucet remainder
| # | Epic | Item | Status | Notes |
|---|------|------|--------|-------|
| F47 | E0 | Treasurer's encrypted off-chain faucet ledger | ✅ (pilot) | Shipped 2026-08-10 (same day, after this file's audit snapshot): `frontend/lib/faucetLedger.ts` + `/api/faucet-ledger` drop-box + treasurer view in `CircleAdmin.tsx`. One-time codes generated parrain-side, entry (codes, amount, day — nothing else) padded to a fixed size and sealed to the Treasurer's published F32 messaging key with the same `nacl.box` sealed-sender construction; delivered after an independent 1–7 min jitter (localStorage queue if the tab closes). Never an on-chain account, never keyed by WingPeer; treasurer reconciles **by count** against `jar.granted`. Honest limit in `docs/faucet.md`: the drop-box observes arrival order/time — jitter blurs, the E10 relayer erases. Untested yet (see `tests/sentinel/checklist.yaml`). |
| F48 | E0 | Randomized disbursement timing (jitter queue) | ✅ (pilot) 🟡 | Shipped 2026-08-10: the grant tx waits a random 15–120 s parrain-side (`me/page.tsx firstGas`), and the F47 ledger entry travels on its own independent 1–7 min delay, so tx, ceremony clock, and drop-box cannot be lined up. 🟡 tab-bound and therefore weak — real timing privacy is the E10 relayer; labeled as such in `docs/faucet.md`. |
| F49 | E0 | Governed faucet cap account (revised by equinox vote) | ⬜ | `FAUCET_MAX_GRANT_LAMPORTS` is a `const` (`state.rs:643`), so the epic's "revised at each equinox by top-circle vote" is currently a **program upgrade, not a vote**. Move the cap into a top-circle-governed account. |

### E1 — two-sponsor admission
| # | Epic | Item | Status | Notes |
|---|------|------|--------|-------|
| F50 | E1 | `attest_admission` + two-attestation gate on `issue_membership` | ✅ (suite green — `tests/epic1.ts`, `tests/epic2.ts`; see ADR 0007) | **Amended v0.2 (2026-08-10, ElectaZ): the pair is asymmetric.** Attestation A — the **parrain**: any member in good standing; signer holds a key of the attestor's membership, `expires_at > now` (the pattern in `activate_faucet.rs`); PDA `["attest", circle, newcomer_commitment, parrain_commitment]`. Attestation B — a **trusted servant**: signer holds any of the 7 Council seats (`council.require_any_seat`); PDA `["attest2", circle, newcomer_commitment]` (one servant co-attestation per newcomer). **Distinct-persons rule enforced in the program**: the seat signer must not be a key of the parrain's membership. Issuance refused unless both PDAs exist. Continuity: F4's Secretary-gated issuance is already a seat attestation — this generalizes it to any-of-7 and adds the parrain beside it. **No parrain-attestation primitive exists today.** |
| F51 | E1 · E9 | Split issuance from votable-set insertion (provisional membership) | ✅ (suite green — `issue_provisional_membership` never touches the tree; `confirm_admission` is the only inserter, now also pins the F54 epoch/leaf index) | `issue_membership.rs:71` calls `merkle::insert_leaf` in the same atomic instruction, so a one-attestation newcomer would get immediate full voting power. Provisional must mean *"commitment not yet inserted into the MemberTree"* so every members-only proof fails by construction — never insert-then-remove; the tree is append-only. |
| F52 | E1 | Sponsor UI — one-tap "attest for this newcomer" in `/me` | ✅ (parrain attest input in the mentorship card, provisional join path in JoinCard, AdmissionsSection in admin with policy toggle + "Co-attest & confirm" for servants) | For members who met them in circle. |

### E2 — zero-knowledge vouch-proofs
| # | Epic | Item | Status | Notes |
|---|------|------|--------|-------|
| F53 | E2 | Anonymous vouch-proof (`attest_admission_zk`) | 🟡 (built this round: `attest_admission_zk` verifies a member_vote Groth16 proof, `externalNullifier` = newcomer commitment, `nullifier = Poseidon(secret, newcomer)`; `vouchnull` PDA replay guard; `AdmissionAttestation` carries `nullifier`, `parrain = 0` when anonymous; `confirm_admission` downgrades the distinct-persons rule to circle-visible for anonymous attestations; client `attestAdmissionAnonymously` in `zk-vote.ts`, auto-selected in the `/me` parrain UI. Reuses the shipped `member_vote` VK + browser artifacts — no new ceremony. **2026-08-11b:** F55 relayer now exists and `attestAdmissionAnonymously` submits through it by default; F54 recent-roots means the proof survives concurrent admissions. Remaining: a real end-to-end ballot test on devnet) | Reuses `circuits/member_vote.circom` with `externalNullifier` = the newcomer's commitment — near-free, and it mirrors `lineage_grant.circom`'s `nullifier = Poseidon(secret, granteeCommitment)`, which already makes "the same sponsor vouching the same newcomer twice" collide, giving two-distinct-sponsors for free. VouchTally counts distinct sponsor nullifiers per newcomer commitment and feeds the **F50** gate. Record the circuit choice; ship its wasm+zkey to `frontend/public/zk/` (only `member_vote` is shipped to the browser today). |
| F54 | E2 | MemberTree recent-roots ring buffer + good-standing member set | ✅ | `RecentRoots` PDA `["roots", circle]` (16-root ring); `note_root` (permissionless crank), `begin_member_epoch` + `reinsert_member` (epoch rebuild); `attest_admission_zk` accepts any recent root; `EpochLeaf` PDA; `tests/epic2.ts` | **Shipped 2026-08-11b.** (a) Concurrent-admission defect closed: crank `note_root`, prove against any of the last 16 roots. (b) Good-standing defect closed: an epoch rebuild empties the tree and only **live** memberships re-enter (`reinsert_member` rejects expired; provisional excluded), so expired/revoked commitments drop out — no per-leaf deletion needed. Ring buffer is 16 (not 32) because borsh deserializes the array on the 4 KiB SBF stack. |
| F55 | E2 · E7 · E10 | Relayer service (fee-payer anonymity) | ✅ | `frontend/app/api/relay/route.ts`, `frontend/lib/relayer.ts`, pure allowlist `frontend/lib/relayPolicy.ts`; wired into `cast_vote`/`attest_admission_zk`/`send_message`/`publish_maci_message`/cranks; `tests/relayer.ts` | **Shipped 2026-08-11b (ADR 0005 hybrid).** The relayer signs+pays allowlisted instructions with ITS key, so `payer: wallet.publicKey` no longer names the prover. Strict policy: pinned discriminators (asserted vs IDL), exact account/data shapes, **relayer is the only signer** (its signature = "paid the fee", never authority), spend floor + daily cap, **no logging**. Honest fallback: unconfigured ⇒ self-pay (named), stated in UI. Remaining hardening: batching/mixing to blunt the timing/IP channel the relay still sees. |
| F56 | E2 | Fellowship-wide verification anchor | ✅ | `approve_federation_child` (foundation-seat consent), `publish_member_root` (approved children only), `verify_fellow_member` (anonymous `VisitPass`, host external nullifier); `CircleRootAnchor`/`VisitPass`/`FederationChild` PDAs; `tests/epic2.ts` | **Shipped 2026-08-11b.** A visiting member proves membership of their home Circle to any sibling Circle in the federation, against the anchored root, naming no one. **A VisitPass means "a member of a FOUNDATION-APPROVED child":** an ultracode CRITICAL found that self-claimed `parent` (creation is permissionless) let a rogue circle anchor its own root and forge fellow-member passes — closed by requiring the foundation's `FederationChild` approval (a foundation Council seat signs) before any root can be anchored (`tests/epic2.ts` "federation-infiltration fix"). Freshness = the anchor's freshness (crank `publish_member_root`). |

### E3 — the quipu
| # | Epic | Item | Status | Notes |
|---|------|------|--------|-------|
| F57 | E3 | `QuipuCord` (steps 1–12) + colour/knot-date logic + reading guide | 🟡 (built this round: `QuipuCord` PDA `["quipu", circle, member, step]`, `tie_quipu_cord(step)` **sponsor-signed via the WingPeer wing** — not `require_any_seat` — one cord per (member, step), 1..=12; `frontend/lib/quipu.ts` colour-by-step + fully-specified Inca knot-date codec; `docs/quipu.md` reading guide; `tests/epic3.ts`. Distinct from F27's day-chips by design. Colour is derived off-chain so the mapping finalises with no chain change.) ⛔ **Colour VALUES still blocked:** the Emerald correspondence table is not in this repo — the stage sequence + rough boundaries are the epic's own (shipped provisionally); the exact hexes/per-step distinctions await the table. The rendered necklace is E4. |

### E4 — the quipu page
| # | Epic | Item | Status | Notes |
|---|------|------|--------|-------|
| F58 | E4 | Member trust page `/member/[commitment]` | 🟡 (built this round: `frontend/app/member/[commitment]/page.tsx` + `components/QuipuNecklace.tsx` (SVG cords, colour-by-step, knot-date knots — **no fraction/progress/count**) + `lib/trustpage.ts` (reads circle/region/vouch-status/cords, computes no score); the member's own necklace also renders on `/me`. `lib/quipu.ts` codec unit-tested `tests/quipu.ts` 4/4. Bio + served service-history await the disclosed data layer — **Epic 5 / F60**; presence line awaits **F59**.) | The ten frontend routes contain **no per-member page**; `/me` is strictly a self-console. Needs: the quipu render component (cords and knot-dates, **never a fraction or progress bar**, with a no-counts DOM regression test in the Sentinel checklist); the one-line bio ("Who do you think you are?", zero hits in `frontend/` today), stored client-side encrypted under **F60**; per-member service history **listed with dates and never summed**; member-level circle-name and region fields. Depends on F60 for a data layer — F33 lives in per-device localStorage and cannot be served to another viewer. |
| F59 | E4 | ZK presence attestation ("last stood in circle: March 2026") | ⬜ | No circuit, instruction or account anywhere touches attendance. |

### E5 — per-element visibility
| # | Epic | Item | Status | Notes |
|---|------|------|--------|-------|
| F60 | E5 | Per-element visibility policy + read-path enforcement | 🟡 (policy engine built this round: `VisibilityPolicy` PDA `["visibility", circle, member]`, `set_visibility(avatar,quipu,bio)` member-signed, tiers 0 chosen / 1 my-circle DEFAULT / 2 all-members, range-checked; `lib/visibility.ts` client + `mayView` read-path decision + client-side chosen-ones list; the trust page gates the quipu — hidden ≡ absent; `tests/epic5.ts`. **Remaining Phase-2**: the encrypted per-tier KEY distribution for the served bio/avatar, and moving `MyCircle` enforcement from app-level to a ZK circle-membership proof on the read path — the pilot enforcement is app-level, documented honestly in `lib/visibility.ts`.
**Phase-2 shipped 2026-08-12**: served bio/avatar are now CIPHERTEXT on chain —
`MemberProfile` PDA `["mprofile", circle, commitment]` with a fixed-length
200-byte `bio_ct` (a member with no bio stores random bytes, so silence and
secrecy are the same account), per-element keys derived from the member's
viewing secret, and `VisibilityKeyDrop` PDA `["vdrop", drop_id]` where
`drop_id = SHA-256(domain ‖ X25519(owner,viewer) ‖ owner_commitment ‖ epoch)` —
the drop names NEITHER party and has no authority field, so no audience graph
exists to scrape; revocation is an epoch bump, which strands every drop at once
and names nobody. Read path decides by DECRYPTING, not by `mayView`.
`frontend/lib/visibilityCrypto.ts` + `lib/visibility.ts`; `docs/visibility.md`.
**Still Phase 3**: granting is O(audience) — the scalable tier-key release
against a ZK circle-membership proof is not built, so a wide tier is enforced by
whom the owner grants to.) | Schema: (avatar \| quipu \| bio) × (all members \| my circle \| chosen ones), **defaulting every element to "my circle"** on day one. Keys: the circle key distributed through the existing sealed X25519 `MessagingKey` registry; a fellowship key released against a membership proof; per-recipient sealed envelopes for chosen-ones. Critically, membership-proof verification must move **off-chain / client-side on the read path** — every proof check in the repo today is a write-path instruction that mints a public record, so reusing the F16 AccessPass pattern would publish the interest graph E5 forbids. **Effectively a Phase 2 item**: E4, E6 and E9 all depend on it. |
| F61 | E5 | Bare-page rendering + public-surface retrofit | 🟡 (hidden ≡ absent shipped this round: the trust page shows no quipu card and NO lock/"hidden" indicator when a viewer is outside the audience — identical to a member with no cords; an unconnected visitor is a member of nothing and sees no gated element. `Membership.level` dropped from `/me` and the admin member list — Sentinel R7 retrofit. **2026-08-12**: both remaining items addressed. `/board` now renders nothing to
an unconnected visitor and issues no post query at all. `Membership.owner` is
de-enumerated by `shield_membership` — the member's private index moves to
`OwnerTag` PDA `["mownr", tag]`, whose ADDRESS is
`SHA-256("aha-owner-tag-v1" ‖ viewing_secret ‖ circle ‖ index)`, so there is no
field to memcmp and the address is uncomputable without the member's secret;
`owner` is rebound in the SAME instruction to a key derived from the master
secret (atomic, so no window exists where the tag is written and the wallet is
still bound). `findMyMemberships` resolves both generations. NO layout change,
so no account migration. **Honestly still open**: shielding is OPT-IN and no UI
exposes it, so existing memberships stay enumerable until they shield; frontend
write paths other than profile/grant do not yet carry the derived signer;
transaction history still links wallet↔membership (fees are not relayed);
`recovery_keys` remain enumerable by the same attack. `docs/visibility.md`.) | Hidden ≡ absent: no lock icons, no "this is private" indicators, identical layout for a sparse newcomer and a private elder. Retrofit so nothing is readable by an unconnected visitor — today `/board` renders posts and author identicons with no wallet connected (posting is gated, reading is not), `Membership.owner` wallets are enumerable via memcmp, and shared material is served through a public IPFS gateway. |

### E6 — avatar / stone-mark
| # | Epic | Item | Status | Notes |
|---|------|------|--------|-------|
| F62 | E6 | Stone-mark canvas + private, deliberately-disclosed avatar | ⬜ | Drawing canvas for a personal sign inside an equilateral triangle, as an alternative to photo upload (only upload exists — `frontend/lib/profile.ts` `fileToAvatarDataUrl`, canvas resize to 128 px). Move the avatar out of localStorage into the **F60** object; add audience selection; render **one identical neutral silhouette** when not disclosed, never a lock or placeholder that signals hiddenness. Off-device storage must be ciphertext only — no public IPFS gateway. |

### E7 — encrypted messaging
| # | Epic | Item | Status | Notes |
|---|------|------|--------|-------|
| F63 | E7 | Off-chain encrypted transport + **F32 sunset plan** | 🟢 **v2 shipped** | v1: `frontend/app/api/mailbox/route.ts` + `frontend/lib/mailbox.ts` + pure `frontend/lib/mailboxCrypto.ts`; `tests/mailbox.ts`; `docs/messaging-migration.md` | **v1 shipped 2026-08-11b:** off-chain sealed-sender mailbox — nothing about a message touches the chain (no recipient index, no public timestamp, no fee-payer). Signed **rotating prekeys** give coarse (prekey-granular) forward secrecy; the directory is keyed by wallet but has **no enumeration op**, deletion is recipient-signed, the relay never logs. The Inbox sends here first and falls back to on-chain F32 (labeled legacy) only when the recipient has no bundle. **Remaining for ✅ (v2):** libsignal X3DH + **double ratchet** (per-message FS) and **PQXDH** hybrid KEM (ADR 0002), group sessions, relay mixing/batching, and retiring F32 + reworking **F32b**/**F40** off the on-chain design. **v2 shipped 2026-08-12** (`frontend/lib/mailboxMixing.ts` shared by relay and client, `docs/messaging.md`, `tests/mailbox-mixing.test.mjs` 27/27, gate `tests/sentinel/f63-mixing-check.sh` 15/15): four measures — send jitter + fixed-grid **bucketed release** (monotone ceiling so ordering cannot invert; `get` now sorts on full-precision arrival **before** the 100-row cap, strengthening v1 FIFO), **cover traffic** (decoys identical in op/fields/1040-byte ciphertext/padded body, `expiresAt` drawn from the compose form's real menu so it is not a tell, `cover:1` marker carried **inside** the ciphertext as its own field so no real message can be suppressed by what its author typed, capped at 16 outstanding vs `MAX_PER_BOX` 500 so cover can never evict real mail, decoy ids ride along on the next ack with no extra wallet prompt), **2 KiB request padding** with padded replies (enrolled/unenrolled `bundle` lookups indistinguishable), and **constant-rate polling** driven only by (state, config, clock) so mailbox contents cannot influence the schedule. Storage row is now `{v:2, releaseAt, env}`; v1 rows still deliver (tested) — note a *rollback* to v1 code could not read v2 rows until TTL. **Honest residuals, stated in `msg.inbox.metadata` in all 19 locales and in `docs/messaging.md` §5:** the relay still sees the **source IP next to the mailbox id**, so an operator correlating addresses over time can still infer who talks to whom; a **first message to a new contact has no decoys around it**; the prekey directory remains an enrollment oracle. Closing those needs Tor/a mixnet or PIR — deliberately **not** half-built (§6). |
| F64 | E7 | Client-side encrypted trust list | 🟡 | Trust / block / mute under a device- or passkey-wrapped key. Today there is only an unencrypted localStorage sent-log and read-markers; **no trust/block/mute concept exists anywhere.** **Seeded 2026-08-12** (`frontend/lib/trustlist.ts`): trust/block/mute per member commitment, stored **only** as an F65-keystore-sealed blob (`"trustlist"`) — never on chain, never plaintext localStorage; legacy exports preserved via an overload. Writes refuse (with a pointer to Settings → Security) rather than silently downgrading storage when no keystore exists. Remaining: UI surfaces that consume block/mute (inbox filtering, board, trust page). |

### E8 — authentication
| # | Epic | Item | Status | Notes |
|---|------|------|--------|-------|
| F65 | E8 | Passkey-unlocked local keystore (WebAuthn) | 🟢 | `webauthn` and `passkey` have **zero hits** in program, frontend or docs. The epic assumes a server receiving an attestation; in a serverless wallet-adapter app the least-new-attack-surface shape is a **passkey that unlocks a locally-encrypted keystore** wrapping the wallet, messaging and profile keys. Record that reframing as part of **F70**. Document that no biometric ever leaves the device and add it as a Sentinel Layer-D assertion. **Done 2026-08-12:** `frontend/lib/keystore.ts` — three honest modes: **prf** (key HKDF-derived from the WebAuthn PRF output at every unlock, never stored, UV-gated), **largeBlob** (32-byte secret stored *inside the credential*, read back UV-gated), **local** (non-extractable AES-GCM `CryptoKey` in IndexedDB — documented as weaker: no UV gate). AES-GCM-256 with `additionalData` binding each ciphertext to its name (no blob swapping); IndexedDB `aha-keystore`; per-tab session cache so members see at most one prompt; **no enumeration API** (exact-name get/put/delete only, mirroring `shardCustody`). Serverless: local challenge, `attestation: "none"` discarded, zero fetch/XHR/WebSocket. `frontend/app/settings-security/page.tsx` surfaces mode honestly. **Locked position honoured:** the passkey is a device-local unlock, *never* the credential of record and never gates recovery — losing it is survivable; Epic 11 shard recovery is the identity safety net (stated in-module and to the member). |
| F66 | E8 | Sponsor-bound recovery via blinded one-time keys | 🟢 | The on-chain half exists (`issue_membership` accepts `recovery_keys[2]`, `set_recovery` updates them), but putting **raw sponsor pubkeys** there would record a permanent, public, minable sponsor edge — forbidden by E2 and the Traditions Audit. Must use blinded keys handed over out-of-band, or a ZK co-sign. Also decide the threshold: today 1-of-2, the epic implies both sponsors. Behind **F50**. **Done 2026-08-12:** `frontend/lib/recoveryKeys.ts` — blinded one-time guardian keys via HKDF-SHA-512 (WebCrypto, domain tag `AHA-F66-recovery-v1`, info = memberCommitment‖u64le(epoch)) → `Keypair.fromSeed`; `blindedKeysForMember` (rejects duplicate sponsor secrets), sponsor-side `proveRecoveryControl` re-derivation; no storage/enumeration. Unlinkable without the sponsor secret; epoch rotation = single-use. 11/11 node tests (`tests/recovery-keys.test.mjs`). Explicitly the F9/F10/F11 on-chain guardian-rebind mechanism — distinct from Epic 11 local recovery, which emits nothing on chain. ⬜ follow-up: wire `blindedKeysForMember` into `issueMembership` (`lib/member.ts:251` still passes `PublicKey.default`) — deliberate, since it changes what lands on chain at issue time. |

### E9 — graphical onboarding
| # | Epic | Item | Status | Notes |
|---|------|------|--------|-------|
| F67 | E9 | `docs/wallets.json` + shuffled WalletChooser | ⬜ | Five non-custodial wallets with per-platform deep links, **Fisher-Yates shuffled client-side on every page load** (Tradition 6 — no permanent first position). Today `frontend/app/create/page.tsx:289-290` has two hardcoded anchors in fixed order (Solflare then Phantom): wrong count *and* a permanent first position. No dependencies — pull to Phase 1. |
| F68 | E9 | `/onboarding` — three-step illustrated stepper | ⬜ | Wallet → Vouch → Face. Arrows, one action per screen, position always visible; unskippable seed-phrase backup guidance with a clear warning in step 1, then sign-in by signing a message with the new address; step 2 wires the **F50** parrain attestation plus the fund-or-faucet choice (`activateFaucet` already exists in `frontend/lib/faucet.ts` and is surfaced in `/me`, so the faucet branch is a small hookup). Measure end-to-end against the **under-ten-minutes** target. Skeleton has no dependencies and can land in Phase 1. |
| F69 | E9 | On-device photo cartoonisation | ⬜ | Recognisable to the circle, useless to face recognition. **Assert that no original photograph reaches any storage, upload or log** — F33 today stores the resized raw photograph as a data URL in localStorage. |

### E10 — decisions & stewardship
| # | Epic | Item | Status | Notes |
|---|------|------|--------|-------|
| F70 | E10 | Land the six ADRs in `docs/decisions/` | ✅ | `docs/decisions/0001-chain-and-scope` · `0002-quantum-resistance` · `0003-phone-number-registration` · `0004-interim-vs-final-admission` · `0005-faucet-vs-relayer` · `0006-software-stewardship` + README index, each grounded in verified repo evidence. Original notes: | (1) **Chain + scope-of-chain** — Solana is decided de facto (a 58-instruction devnet-deployed Anchor program); the open half is what belongs on chain at all. (2) **Quantum resistance** — genuinely undecided: Ed25519 + BN254 Groth16 throughout, no migration path, no `ProofAnchor` seam; Poseidon commitments are the only hash-based piece. Needs at minimum an exposure document and a migration trigger. (3) **Phone-number registration** — dropped de facto (zero hits repo-wide; auth is wallet-signature only); ratify in a paragraph. (4) **Interim vs final admission** — pilot first, ZK in parallel; but the shipped pilot is **not** the epic's named-two-sponsor pilot, it is zero-sponsor (F31) or one-role-key (Secretary) admission, so the cutover plan and the F31 reconciliation are unresolved. (5) **Faucet vs relayer** — hybrid (**F35** + **F55**). (6) **Software stewardship** — AGPL-3.0, `CODE_OF_CONDUCT.md`, `SECURITY.md`, F29 and F34 point the right way; the service-committee model is unwritten and the upgrade authority is one keypair (**F45**). Also covers the E8 passkey reframing and the E7 transport choice. |

### E11 — sponsor recovery (two-of-three key shards)
Builds on E1 (the two sponsors) and E8 (the passkey device-local unlock). **Distinct from the existing on-chain recovery** (F9/F10 Council 4-of-7 wallet migration, F11 guardian co-sign): those rebind the *owner wallet* in a visible transaction; E11 reconstructs the *master secret itself*, bit-identically and **entirely off chain** — recovery emits nothing on the anchor, which is the whole point. Everything here is client + off-chain; the program is not touched.

| # | Epic | Item | Status | Notes |
|---|------|------|--------|-------|
| F72 | E11 | Shamir 2-of-3 sharding core | 🟢 (built: `frontend/lib/sharding.ts` via the vetted `shamir-secret-sharing` lib — no hand-rolled field arithmetic; `newMasterSecret`/`splitMaster`/`reconstructMaster`/`deriveFromMaster` (one master backs both zk secret + wallet seed); property-tested `tests/sharding.ts` — any 2 reconstruct, any 1 nothing, corrupted fails loudly) | Split the member's **master secret** (from which both the Solana keypair and the Semaphore commitment derive) into 3 shards, 2-of-3 to reconstruct, using a **vetted constant-time Shamir library — no hand-written field arithmetic**. Property-test: any two reconstruct exactly; any one yields nothing; a corrupted shard fails loudly, never returns garbage. **Prerequisite:** a unified master-secret derivation (today the wallet is external + independent of the on-device `Poseidon(secret)` commitment — `zk-vote.ts`). **UI shipped 2026-08-12 — see F85.** |
| F73 | E11 | Shard blinding + `ShardCustody` (no enumeration) | 🟢 (built: `frontend/lib/shardCustody.ts` — the interface has **no list/count/iterate/keys**; `localShardCustody` stores opaque base64 blobs under SHA-256-hashed one-time codes, no name/key/commitment/timestamp beside a blob, no network import; statically asserted in `tests/sharding.ts`) | A shard at rest is an opaque blob encrypted under a key the sponsor does not hold, indexed by a one-time code the member supplies at recovery. Custodian storage holds **no** name, address, public key, identity commitment, or admission-correlated timestamp, and offers **no enumeration path** — no list, count, iteration, or debug view. Implement the `ShardCustody` interface exactly, including its omissions (**the interface must be authored first**). **UI shipped 2026-08-12 — see F85.** |
| F74 | E11 | In-person device-to-device handover | 🟢 (built: `frontend/lib/shardHandover.ts` — a pure, DOM/network-free payload codec `encodeShardPayload`/`decodeShardPayload` (versioned frame + CRC-32, prefixed `AHA-SHARD-1.`, fails loudly on any corrupt/truncated scan), property-tested in `tests/sharding.ts`; `frontend/components/ShardHandover.tsx` — NFC via `NDEFReader` (local radio, no network) + paste-scanned-QR receive + the F79 disclosure. Remaining: the **QR-image render** (a thin presentational layer over the exact codec string — deferred rather than hand-roll an untested Reed-Solomon encoder). The no-network-sink static gate now covers `shardHandover.ts`.) | **BOTH QR and NFC** (decided v0.2), at a circle meeting; the member uses whichever the two devices support. A shard must **never** appear in a request body, server relay, cloud backup, or log — built so there is **no network code path** a shard could take, not a promised-unused one. NFC uses `NDEFReader` (local); the codec imports no fetch/socket/chain. **UI shipped 2026-08-12 — see F85.** |
| F75 | E11 | Member-present recovery (fast path) | 🟢 (built: `recoverMemberPresent` in `frontend/lib/recovery.ts` — **requires a genuine member shard**; two sponsor shards cannot masquerade, tested) | Own shard + one sponsor shard → immediate reconstruction, no waiting. **Must require a genuine member shard** — two sponsor shards must not masquerade as member-present. **UI shipped 2026-08-12 — see F85.** |
| F76 | E11 | Sponsor-only recovery (challenge window) | 🟢 (built: `openSponsorRecovery`/`windowElapsed`/`completeSponsorRecovery` in `recovery.ts` — 7-day window not client-shortenable (no window param), member cancellation aborts + burns, tested; the intent is an off-chain custody signal). Two sponsor shards → publish a recovery **intent**, then wait out a challenge window (**7 days, decided v0.2** — configurable by the fellowship, **never** client-shortenable); a valid cancellation signature from the member's existing device aborts the recovery and **burns the shards**. **Decided:** the intent lives in the **off-chain shard-custody layer** — it must NOT be an on-chain, member-linkable event; even the fact a recovery is pending must not be publicly correlatable to an identity. **UI shipped 2026-08-12 — see F85.** |
| F77 | E11 | Shard lifecycle — burn / re-issue / holder-replace | 🟢 (built: `reshareMaster` cuts a fresh incompatible set; `ShardCustody.burn`; tested that a stale shard cannot combine with a fresh one. Holder-replacement UI remains) | Burn and re-issue **all** shards after any recovery that consumed a sponsor shard, after key rotation, and after a shard-holder replacement — a stale shard is worse than none because it looks like protection. Includes the flow to replace a holder when a sponsor leaves or loses their device. **UI shipped 2026-08-12 — see F85.** |
| F78 | E11 | Provisional-member guard + onboarding disclosure | 🟢 (built: `sponsorRecoveryAvailable(count)` false for 1 sponsor, tested; the onboarding-disclosure copy remains to wire into E9's step) | A provisional member has only one sponsor, so no valid 2-of-3 split exists → **no sponsor recovery**. Onboarding (E9) must say this **before** the member finishes, not after they lose a device. **UI shipped 2026-08-12 — see F85.** |
| F85 | E11 | **Recovery UX — shard ceremony, handover, and recovery wizard** | 🟢 | `frontend/app/recovery/page.tsx` (wizard), `frontend/app/recovery/setup/page.tsx` (ceremony), `frontend/components/ShardSend.tsx` / `ShardReceive.tsx` (QR + Web NFC + manual entry, in-person only), `frontend/lib/shardSeal.ts` (shared seal/unseal: SHA-256 role+code key → `nacl.secretbox`, nonce‖box), `frontend/lib/recoveryUi.ts`, F78 disclosure card in `frontend/app/onboarding/page.tsx`, Recovery card on `/me` | **Done 2026-08-12.** The human layer over F72–F78's tested cores, honouring every locked position: **purely local** (no web3/anchor/wallet import, no fetch/socket in any recovery file — grep-gated), member-present flow needs a **genuine member shard** (cryptographically enforced: a sponsor blob cannot open under the `member` seal key), sponsor-only flow shows a display-only countdown gated by `windowElapsed` with **no skip affordance** (tampered stored window clamps UP to `CHALLENGE_WINDOW_MS`), the intent lives in **this device's local storage/custody only**, cancel-from-existing-device burns the collected blobs, every recovery **ends in burn-and-reissue** (`reshareMaster` → new one-time code shown once → two fresh in-person handovers), provisional members see the honest no-sponsor-recovery note (ceremony refuses to fake a 1-sponsor split). Buffer hygiene: 21 `fill(0)` wipe sites; secrets never in React state, logs, or storage. QR renders locally (`qrcode` dep); scanning uses native `BarcodeDetector` when present (no JS decoder dep added), Web NFC where available, and a typed-code fallback everywhere. |
| F86 | E12 | **Embedded AHA wallet — core + wallet-standard adapter** | 🟢 | `frontend/lib/embeddedWallet.ts`, `frontend/lib/embeddedWalletStandard.ts`, `frontend/components/EmbeddedWalletBoot.tsx`, layout wiring | **Started 2026-08-12.** A built-in, self-custodial wallet registered via the wallet-standard runtime handshake as "AHA Wallet", so every existing page (useWallet/useAnchorWallet, the wallet modal) works with it unchanged. Secret key sealed device-locally via the **F65 keystore** (never plaintext, never network). Create fresh / import; export gated behind explicit warnings. Documented integration point: derive the keypair from the Epic 11 **master secret** (`deriveFromMaster().walletSeed`) once the master-rooting round lands — the locked credential-of-record model made real. **Done 2026-08-12:** registered via `registerWallet` from `@wallet-standard/wallet` (already present transitively — **no new dependency**) as **"AHA Wallet"**, chains devnet/testnet/mainnet, features `standard:connect`/`disconnect`/`events` + `solana:signTransaction` (variadic, legacy + v0) / `signAllTransactions` / `signMessage`. Every existing page works with it unchanged (they only use `useWallet()`). Secret sealed exclusively through the F65 keystore; raw bytes wiped after `Keypair` construction; only the **public** key is cached in localStorage. **Explicit connect never silently creates a key** — it throws and points at Settings → Security; silent auto-connect restores from the cached public key with no biometric prompt, deferring unlock to the first signature. `solana:signAndSendTransaction` deliberately not implemented: it would require an RPC connection inside the wallet module, and wallet-adapter correctly falls back to sign-then-send app-side, keeping the no-network boundary. Boot component is double-guarded against React strict-mode/fast-refresh re-registration. |
| F87 | E12 | **/wallet UI — send/receive SOL, SPL tokens, NFT gallery** | 🟢 | `frontend/app/wallet/page.tsx` | **Started 2026-08-12.** Works with any connected wallet (the embedded one included): SOL balance + send, QR receive, SPL token list + send (manual Transfer/ATA-create instruction encoding — no new deps; Token + Token-2022), NFT gallery via Metaplex metadata PDA parse with IPFS image resolution, send-NFT. **Done 2026-08-12:** wallet-agnostic (`useWallet()` only), so it serves the embedded wallet and any external one identically. SOL balance + send with fee headroom, QR receive rendered locally, SPL token list and transfer across **both** Token and Token-2022 with hand-encoded instructions (no `@solana/spl-token` dependency) including idempotent ATA creation for the recipient, and an NFT gallery parsing Metaplex metadata PDAs defensively with IPFS image resolution and per-item error isolation. |
| F88 | E12 | **Capacitor native shells (Android + iOS)** | 🟢 | `mobile/` (capacitor.config.ts, android/ + ios/ scaffolds) | **Started 2026-08-12.** v1 loads the deployed web app (https://aha.a13z.org:8443) in the native WebView — every web feature ships on mobile day one, embedded wallet included. v2 roadmap: bundled static export, deep links, push. **Done 2026-08-12:** `mobile/` Capacitor project (appId `org.a13z.aha`), **android/ and ios/ scaffolds generated**. v1 loads the deployed web app in the native WebView, so every web feature — including the embedded AHA Wallet — ships on mobile immediately; v2 (bundled static export, deep links, push) documented as the follow-on. |
| F89 | E12 | **Mobile build pipeline + store packaging** | 🟢 | `.github/workflows/mobile.yml` (workflow_dispatch only), `docs/mobile.md` | **Started 2026-08-12.** CI builds the debug/unsigned-release APK (ubuntu) and unsigned .xcarchive (macos) as artifacts on manual dispatch; signing + store submission need the user's Play Console / App Store Connect credentials (documented, never in repo). **Done 2026-08-12:** `.github/workflows/mobile.yml`, **workflow_dispatch only** (deliberately never on push/PR — this repo removed a failing required PR check). Android job builds debug + unsigned release APKs; macOS job produces an unsigned `.xcarchive`; both upload as artifacts. `docs/mobile.md` carries the architecture, manual-run and install instructions, and the store-submission checklist — signing credentials stay with the user and never enter the repo. |
| F90 | E9 | **The Twelve Steps & Twelve Traditions pages + "The 12" nav menu** | 🟢 | `frontend/app/twelve-steps/page.tsx`, `frontend/app/twelve-traditions/page.tsx`, `TwelveMenu` in `frontend/components/Nav.tsx`, `.twelve-*` / `.nav-drop` styles in `globals.css`, `twelve.*` + `nav.twelve*` i18n keys | **Done 2026-08-12.** The fellowship's foundational texts now live in the app: two reading pages (numeral column + measured 78ch line length, violet numerals for the Steps, green for the Traditions) reached from a **"The 12"** dropdown placed after "Start here" — opens on hover for pointers, on click/focus for keyboard and touch, closes on Escape or outside-click, RTL-aware. Nav label **"Find a Circle" → "Find your Circle"** (chrome dicts updated in all 19 locales). Text transcribed from the user's source with clear typos corrected (`compationate`→`compassionate`, `spritually`→`spiritually`, `yourslef`→`yourself`, and Tradition 10's `the AA name`→`the AHA name`); Tradition 1's `Awakening and personal depends upon AHA unity` was missing a word and reads `personal recovery depend`, and Step 7's `learn` was made `learned` for tense consistency — **both flagged to the user for confirmation**. Footnote credits the A.A. adaptation without implying endorsement (Tradition 6). |
| F91 | E11 · E8 | **Master-secret rooting — Steps 1–2 (scalar-field fix + frozen v2 derivation contract)** | 🟡 | `frontend/lib/zk-vote.ts` (`R`, `secretScalarFromBytes`, optional `newMemberIdentity(opts)`), `frontend/lib/sharding.ts` (`zkSecretForCircle`), `tests/zk-field-constants.test.mjs` | **Steps 1–2 done 2026-08-12; Steps 3–5 remain.** The hole this closes: the shard ceremony mints a master secret, but `newMemberIdentity()` still draws its OWN random Semaphore secret — so reconstructing the master does **not** restore a membership identity. The locked position says the master is the credential of record for BOTH the Solana keypair and the identity commitment. **Step 1 (bugfix):** `R` was labelled the BN254 *scalar* field but held the *base* field value q (identical to `Q`) — latent and currently inert, because `rnd[0] &= 0x1f` caps draws at 2^253−1 < r, so `x % q === x % r === x`. Proven a no-op over 2000 random masked draws plus boundary values; `R` is now the true r, with `secretScalarFromBytes()` reducing mod it and the ~2.4× modulo bias documented as deliberately accepted. Had this been found *after* rooting shipped, it would have minted unrecoverable identities. **Step 2 (dark contract):** `zkSecretForCircle(master, circle, index)` = SHA-256(`aha-zk-secret-v2` ‖ master ‖ circle32 ‖ u32le(index)) — per-circle domain separation keeps cross-circle commitments unlinkable, `index` allows a fresh votable identity on rejoin under determinism; `walletSeed` (`aha-wallet-seed-v1`) frozen and unchanged; `aha-zk-secret-v1` retired unconsumed. `newMemberIdentity(opts?)` derives from the master when given options and is byte-identical to today otherwise — **no call site passes opts**, enforced by a test that greps all of `frontend/`. Frozen test vectors pinned (master→circle→index→secret→commitment) as the one-way-door guardrail; the modulus is pinned three ways incl. cross-checks against circomlibjs and snarkjs. 22/22 new tests; zk-e2e still 23/23; zk-integrity holds. ⬜ **Remaining: Steps 3–5** — master keystore + rooted joins + ceremony load-or-create (one step, to avoid an orphan-master window), stale-shard detection, re-attach UI. |
| F79 | E11 | Honest handover UI + Sentinel **Layer F** | ✅ (Sentinel Layer F written — `.claude/agents/sentinel.md` + `backlog/sentinel-agent.md`; CLAUDE.md **locked positions**; **handover-screen disclosure copy now shipped** in `frontend/components/ShardHandover.tsx`: it states on the screen itself that two sponsors together can reconstruct the secret without the member, and that a shard never touches a server). On the handover screen itself (not a help article): state that two sponsors acting together can reconstruct the secret without the member. Extend `.claude/agents/sentinel.md` with a **Layer F** whose assertions cover what the existing layers do not reach — **recovery emits nothing on chain** (assert in a test, not review), **no shard (blinded or otherwise) on any server**, **no structure links a shard to a member**, **no enumeration path**, the fast path requires a real member shard, and the passkey never gates recovery on its own. Close only on Sentinel PASS; relaxing any assertion requires a commit note citing the backlog line that authorises it. |

---

## Known issues (Sentinel findings)

Source: `reports/sentinel/NRR-2026-08-10-1.md` and the round-2 pass.
**`architectural`** means it cannot be patched — the epic named against it is the
redesign that fixes it.

| ID | Issue | F-number / Epic | State |
|----|-------|-----------------|-------|
| R0 | Working tree changed mid-round; the audited artefact was not a commit | F35 / E0 (process) | **fixed this round** (`31f2b6d`) — but **recurred**: `Anchor.toml`, `docs/faucet.md`, `tests/README.md`, `tests/ayni.ts`, `tests/cosign.ts`, `tests/faucet.ts` are modified-uncommitted right now and reflected in no status doc |
| R1 | **A Circle's full roster and the wallet behind each member are publicly enumerable** — `Membership` stores `commitment` and `owner` in one public account (`state.rs:57-80`, owner at offset 89), the join flow always binds the wallet, and `zk-vote.ts` fetches the whole roster to rebuild the tree | F1 / F2 / F22 → **E2 + E5** | **architectural** — this is what E2 exists to fix; a ZK vouch proof over a publicly enumerable set leaks far more than the epic assumes |
| R2 | **The sponsor edge is public** — `WingPeer` (`state.rs:396-406`) names both sides by commitment and `LevelGrant.issuer_commitment` names the granting teacher. ~~`activate_faucet` puts parrain and neophyte in one transaction with a lamport transfer between them~~ **fixed 2026-08-12f**: `activate_faucet_zk` grants on an anonymous member proof with no parrain account, commitment or wallet in the transaction (named path deprecated, kept only as the no-device-key fallback) | F27 / F35 → **E2 + E10** | **partly fixed / still architectural** — the F35 half is closed; the F27 half is not: `WingPeer` is keyed by mentee, so any observer can derive the bond from a neophyte commitment and *guess* the endorser without our help. That guess is against the whole member set, not a record — but the public `wing` field must still go (needs a new circuit, **F44**, to prove the bond in-band). `LevelGrant.issuer_commitment` untouched |
| R3 | Circle-email endpoint: **abuse limb fixed** (per-IP 10/60 s, on-chain name match, on-chain membership proof). **Privacy limb open** — the mail body still exports the member wallet to Mailgun/SMTP logs, `indexer/email-indexer.js:110-115` still supplies it, a `kind:"join"` POST with no `memberAddress` skips verification entirely, and the rate limit is per-instance | F25 → E9 / E10 | **still open** (half-closed) |
| R4 | Message metadata is public — PDA `["msg", recipient, id]` + a plain `recipient` field expose who received mail and when; the fee-payer identifies the sender. Content confidentiality is sound (NaCl box, sealed sender, fixed `CT_LEN` 528) | F32 → **E7** | **architectural** — the code itself (`state.rs:539-543`) states true sender anonymity needs a relayer/mixnet (**F55**, then **F63**) |
| R5 | Publishing a Post is a permanent public proof that a named wallet is a member (`create_post.rs:27`, `Post.author` is a public field and a PDA seed); owner-less anonymous memberships cannot post at all | F30 → **E5** | **architectural** |
| R6 | The client sends the visitor's IP to two third-party geolocation APIs and precise coordinates to Nominatim | **F71** (F18/F23) | **still open** — *not* architectural; fixable by self-hosting/proxying |
| R7 | Publicly comparable per-member achievement and rank — `ProgressToken` chips are enumerable (members orderable by chip count *and* by awarding seat) and `Membership.level` is a public integer rank rendered beside identities. **The required written justification was never produced** (zero "justif" hits in `docs/`, `BACKLOG.md`, `PROJECT.md`, `tests/sentinel/checklist.yaml`) | F27 + F12 → **E3 + E4** | **still open, escalating** — round-1 WARNING becomes a round-2 FAIL unless justified or descoped (**F57** replaces the model; E4 demands the level demotion) |
| R8 | MACI advertises coercion resistance it cannot deliver — no coordinator, no process/tally circuits, no `submit_maci_tally`; `tally_hash` unused; the doc-comment describes the full receipt-free flow in the present tense | **F39** → E2 / E10 | **still open** |
| R9 | The **root** TypeScript project does not typecheck — `tsconfig.json` is `"target": "es6"` / `"lib": ["es2015"]`, below the ES2020 needed for BigInt literals in `app/**`; tests importing `../target/types/ayni` resolve only after `anchor build`. `frontend/` typechecks clean | build health (no F-number) | **still open** |
| R10 | Root formatting check red — `npm run lint` is `prettier --check` over `app/*.ts` and `tests/*.ts`, 12 files reported; no prettier config, no formatting commit, and `tests/*.ts` were edited again this round | build health (no F-number) | **still open** (unverified by execution — `npm` not on `PATH`) |
| R11 | Documentation drift in `BACKLOG.md` | this file | **fixed this round** for the original three sub-items; the replacement drift (`appoint_seat` in F7, F28's phantom instructions, "Agave 2.3.13", the 7/7 baseline, the "no native toolchain" claim) is **fixed in this rewrite** |
| R12 | No host toolchain, so BPF build and validator tests were unverifiable | build health / CI (no F-number) | **fixed this round** — `cargo`/`anchor`/`solana-cli` on `PATH`, CI pins corrected. **Remaining:** no BPF/validator result recorded in any status document; `tests/sentinel/baselines/` still does not exist |
| R13 | Dependency audit baseline: root 31 findings (10 high, 0 critical), frontend 28 (10 high, 0 critical) — `ws`, `sharp/libvips`, `underscore`, `elliptic` (transitive via `@solana/web3.js` → `@coral-xyz/anchor`, no fix available) | dependencies (no F-number) | **still open** (informational) — no `baselines/npm-audit.json` was ever committed, so round 2 has no comparison point |

### Documentation drift to reconcile (same commit as this file)

- `docs/shipped.md:143-149` claims the faucet has "no dedicated test suite or UI"
  — **wrong**: `tests/faucet.ts` (15 cases) and `frontend/lib/faucet.ts` shipped
  in the *same* commit that created `shipped.md`. §6's test inventory also omits
  `tests/faucet.ts`; §7 declares `tests/sentinel/` and
  `.github/workflows/sentinel.yml` absent when both exist; §7 says the product
  backlog is untracked when `git ls-files backlog/` lists all four files; and the
  "(see §4)" cross-references for circuit evidence point at §4 (Frontend) instead
  of §3 (Circuits).
- `tests/README.md` repeats the phantom `appoint_seat` in its wallet/role table,
  claims `build/` artifacts are git-ignored (**15 are tracked**: all three
  `*_final.zkey`, all three `*_vkey.json`, the `*_js/` witness wasm and
  calculators), and its suite table omits `profile.ts`, `jazzicon.ts` and
  `faucet.ts`.
- `SECURITY.md:13` cites the non-existent `SetAuthority` — same correction as F9.
- `docs/zk-lineage.md` §6 still calls the verifying key a placeholder.
- `tests/sentinel/checklist.yaml` has per-feature coverage for **2 of 41**
  features (F35 and F25 only). CLAUDE.md requires every shipped feature to appear
  in the round it ships. F20's "do not remove that test" brand rule and F32b's
  seat-messaging policy have no entry at all.

---

## Open decisions (ADRs, not F-numbers)

These are governance/policy questions. Write the ADR in `docs/decisions/` first
(**F70**); only spawn an F-number if the answer is "implement something".

- **Mainnet operational gates.** Still open: the program upgrade authority is one
  keypair (**F45**); the genesis key is not in MPC; `withdraw_treasury` has **no
  rent-exempt floor**, so a 4-of-7 vote can drain the treasury PDA to 0 (F17).
  *Closed:* real (non-placeholder) VKs shipped — the remaining VK gate is the
  multi-party ceremony (**F44**), not "real VKs"; and the treasury steward is
  already enforced on-chain as an m≥2 multisig (F29).
- **Council size for small Circles** (7/4 vs a smaller m/n until grown).
  `initialize_circle.rs:22-28` hard-requires 7 filled distinct seats and
  `council.rs:42` pins the threshold to `DEFAULT_THRESHOLD` (4); nothing supports
  a smaller Council. Genuinely open, with a Traditions dimension.
- **Cross-Circle / World Service: binding votes vs suggestions only.** Partly
  pre-empted: **F34** already makes the foundation Council's rotate/close of a
  child Circle **binding**, and member votes are binding for
  `install_elected_seat` and `refill_faucet`. `SECURITY_REVIEW.md`'s headline
  concept finding ("the Council is the authority, member votes are advisory") is
  the same question. Ratify the sovereignty model against what already shipped.
- **F31 open membership vs E1 two-sponsor admission.** Decide whether zero-vouch
  self-admission survives at all, or is restricted to explicitly-labelled pilot
  circles.
- **Chain decision (EVM vs Solana)** — *no longer open*: decided de facto, the
  EVM branches are scaffolds. The open half is **scope-of-chain** (see F70).
  The stale ⬜ row that used to sit here has been removed.
- **Re-run `/security-review` against the current 58-instruction build.**
  `SECURITY_REVIEW.md` exists (multi-agent adversarial review, 22 candidates → 16
  confirmed) but is dated 2026-06-10 and predates ~15 instructions (faucet, MACI,
  child-federation, messaging, posts, config/allowlist). Process task, not a
  feature.
- **Off-chain mirror linking meetings / material / docs to on-chain proposals.**
  The pieces exist on chain (F26 `set_meetings`, F18 doc CIDs,
  `Proposal`/`MemberProposal`) but nothing links them. Too under-specified for an
  F-number; number it once the scope-of-chain ADR lands. Overlaps E10, E5, E4.

### Removed from this backlog (shipped; kept here only as a pointer)

- **S1** bound `verify_disclosure` policy to the `AccessPass` — shipped
  (`verify_disclosure.rs:51-59`, hash is also a PDA seed). Historical record →
  `SECURITY.md`.
- **S2** "Council can rotate a compromised Circle `authority`" — **the risk was
  removed by design, not implemented**: there is no authority field and no
  `SetAuthority` action; the Council *is* the authority. Wallet compromise →
  `MigrateWallet` (time-locked, contestable), seat compromise → `RotateSeat` /
  `install_elected_seat`. `SECURITY.md:13` must be corrected, not just ticked.
- **S3** Council seat uniqueness — shipped on all three write paths
  (`initialize_circle.rs:23-28`, `execute_proposal.rs:34-38`,
  `install_elected_seat.rs:27`, plus the child-rotation paths).
- **S4** member-tree depth pinned to circuit depth — shipped
  (`initialize_member_tree.rs:11`).
- **RotateSeat "purge before migration" hardening** — shipped: `arm_if_ready`
  (`council.rs:148-162`) applies the uniform contest window to every action,
  which makes the alternative "freeze during pending migration" redundant.
- **Membership revocation** — shipped (`revoke_membership`, credited in F24).
- **"Create a Circle" wizard** — shipped (F23).
- **Solana multisig docs + helper + treasury enforcement** — shipped (F29).
- **Token-2022 NonTransferable mint creation** — shipped (F3).
- **Frontend (Realms-style UI)** — shipped across F18/F22/F23/F24/F30/F32/F40.
  *Onboarding was the only genuinely open half; it is now E9 / **F67**–**F69**.*
- **Per-Circle email provisioning** duplicate bullet — folded into F25, which
  carries the identical 🟡 status and the residual DNS task.
- **Build changelog** (first-compile bug fixes, `Cargo.lock` MSRV pins, the
  0.30.1→0.31 migration) — not backlog; belongs in `BUILD.md`.

---

## Instruction index (58)

Derived, not a backlog item: one file per instruction under
`programs/ayni/src/instructions/` (58 files excluding `mod.rs`), 58 `pub fn`
entry points in `lib.rs`, and 58 entries in `target/idl/ayni.json`. **Verified
2026-08-10: the three sets are identical — zero in one and not the others.**
`appoint_seat` is **not** an entry point and never was; seats are set at
`initialize_circle` and changed via `ProposalAction::RotateSeat` or
`install_elected_seat`. *This list should be generated from the IDL so it cannot
drift.*

`activate_faucet` · `approve` · `approve_child_close` · `approve_child_rotation` ·
`cancel_proposal` · `cast_vote` · `close_circle_profile` ·
`create_member_proposal` · `create_membership_mint` · `create_post` ·
`delete_message` · `delete_post` · `donate` · `donate_token` · `end_wing_peer` ·
`establish_wing_peer` · `execute_child_close` · `execute_child_rotation` ·
`execute_proposal` · `finalize_member_proposal` · `grant_level` · `init_faucet` ·
`initialize_circle` · `initialize_lineage` · `initialize_member_tree` ·
`install_elected_seat` · `issue_acknowledgment` · `issue_membership` ·
`issue_progress_token` · `link_seat_election` · `member_migrate` ·
`mint_membership_token` · `open_maci_round` · `propose` · `propose_child_close` ·
`propose_child_rotation` · `prove_personhood` · `publish_maci_message` ·
`recover_membership` · `refill_faucet` · `register_messaging_key` ·
`renew_membership` · `revoke_membership` · `send_message` · `set_circle_config` ·
`set_circle_country` · `set_faucet_amount` · `set_meetings` ·
`set_membership_mint` · `set_open_membership` · `set_personhood` ·
`set_recovery` · `set_treasury_allow` · `set_treasury_wallet` ·
`update_circle_location` · `upsert_circle_profile` · `verify_disclosure` ·
`withdraw_treasury`

### Instruction → F-number coverage

Every entry point now maps to a registry row: F1 (`issue_membership`,
`renew_membership`) · F3 (`create_membership_mint`, `set_membership_mint`,
`mint_membership_token`) · F5 (`set_personhood`, `prove_personhood`) ·
F6 (`initialize_member_tree`, `create_member_proposal`, `cast_vote`,
`finalize_member_proposal`) · F7 (`propose`, `approve`, `execute_proposal`,
`cancel_proposal`) · F8 (`initialize_circle`) · F9/F11 (`recover_membership`,
`member_migrate`, `set_recovery`) · F12 (`initialize_lineage`, `grant_level`) ·
F13 (`issue_acknowledgment`) · F16 (`verify_disclosure`) · F17 (`donate`,
`donate_token`, `withdraw_treasury`) · F18/F19/F21 (`upsert_circle_profile`,
`update_circle_location`, `close_circle_profile`) · F24 (`revoke_membership`) ·
F26 (`set_meetings`) · F27 (`establish_wing_peer`, `end_wing_peer`,
`issue_progress_token`) · F28 (`link_seat_election`, `install_elected_seat`) ·
F29 (`set_treasury_wallet`) · F30 (`create_post`, `delete_post`) ·
F31 (`set_open_membership`) · F32 (`register_messaging_key`, `send_message`,
`delete_message`) · F34 (`propose/approve/execute_child_rotation`,
`propose/approve/execute_child_close`) · F35 (`init_faucet`, `set_faucet_amount`,
`activate_faucet`, `activate_faucet_zk`, `refill_faucet`) · F36/F37/F38 (`set_circle_config`,
`set_treasury_allow`) · F39 (`open_maci_round`, `publish_maci_message`) ·
F41 (`set_circle_country`).
