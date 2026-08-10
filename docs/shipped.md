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
| MACI submission layer (`open_maci_round`, `publish_maci_message`) | `MaciRound`, `MaciMessage` | code, built. **Partial by design** — no coordinator, no process/tally circuits, no `submit_maci_tally`. A round collects sealed commands and produces **no verified result**. |

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
`lib/country.ts`, `lib/circleEmail.ts`.

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
