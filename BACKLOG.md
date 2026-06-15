# AHA / Ayni — feature backlog & status

Living tracker of what's implemented and what's planned. **AHA** (*Ancestral
Humanity Anonymous*) is a worldwide, chain-agnostic decentralized fellowship for
shamanic practice, modeled on AA's structure and traditions. **Ayni** is its
Solana implementation.

- Model (chain-agnostic): `PROJECT.md` — lives on `main`.
- Implementation: `IMPLEMENTATION.md` + `programs/ayni/` — per-chain branches
  (`solana` = Ayni, plus `ethereum`, `avalanche` scaffolds).
- Discipline: model changes land on `main`, then merge into the chain branch;
  implementation lands on the chain branch.

> `BACKLOG.md` is the **single source of truth for feature status**. Update it in
> the same commit whenever a feature is added, finished, or descoped.

**Status legend:** ✅ implemented (code-complete) · 🟡 partial / stubbed · ⬜ planned
**Caveat (whole repo):** nothing is compiled yet — no Solana/Anchor/circom
toolchain present. **Update (2026-06):** the circuits were compiled and a
**single-contributor** phase-2 ceremony was run — `verifying_key*.rs` for
`member_vote`, `lineage_grant`, and `ack_disclose` now hold **real** Groth16
keys (not placeholders), and the deployed devnet program verifies against them.
Functional for devnet; **mainnet still needs a proper multi-party ceremony**
(the single-contributor key is a trust weakness, not a functional one).

---

## Feature registry (Ayni / `solana`)

### Membership & identity
| # | Feature | Status | Instructions / files | Notes |
|---|---------|--------|----------------------|-------|
| F1 | Soulbound yearly membership (ZK-commitment keyed) | ✅ | `issue_membership`, `renew_membership` | anonymous; renews term |
| F2 | Selective-disclosure identity (optional `owner` wallet) | ✅ | `Membership.owner` | default = fully anonymous |
| F3 | Soulbound Token-2022 membership token | ✅ | `create_membership_mint`, `set_membership_mint`, `mint_membership_token`; `frontend/lib/admin.ts`, `/admin` Treasurer control | `create_membership_mint` now creates the Token-2022 **NonTransferable** mint (authority = Circle PDA, 0 decimals, no freeze) and registers it in one Treasurer-gated instruction — no external setup step. `set_membership_mint` still allows registering an externally-created mint. Deployed to devnet (upgrade `fCbGbo33…`); verified end-to-end via `scripts/test-membership-mint.js` (mint owned by Token-2022, NonTransferable extension present, authority = Circle PDA, `circle.membership_mint` set). |

### Sybil resistance
| # | Feature | Status | Instructions / files | Notes |
|---|---------|--------|----------------------|-------|
| F4 | Social vouching (always-on) | ✅ | `issue_membership` (authority-gated) | a human admits a human |
| F31 | Per-Circle membership policy: **permissionless vs Scribe-Secretary-gated** | ✅ | `set_open_membership`, `OpenMembership` marker PDA; `issue_membership` (optional marker); `lib/member.ts`, `/me`, `/admin`, `/create` | a Circle may be **open** (anyone self-admits) or **validated** (the Scribe-Secretary admits), toggled by any seat. Migration-safe marker PDA `["openjoin", circle]` — no `Circle` layout change. Deployed to devnet; verified: gated→non-Secretary rejected, open→self-join succeeds, re-gate→rejected. |
| F5 | Anonymous proof-of-personhood (one human → one membership/Circle) | ✅ | `set_personhood`, `prove_personhood`, `PersonhoodCredential` | reuses `member_vote` circuit/VK; World ID-style root; `docs/sybil.md` |

### Governance & voting
| # | Feature | Status | Instructions / files | Notes |
|---|---------|--------|----------------------|-------|
| F6 | Anonymous member voting (one member, one vote) | ✅ | `initialize_member_tree`, `create_member_proposal`, `cast_vote`, `finalize_member_proposal`; `circuits/member_vote.circom` | Semaphore-style; per-proposal nullifier; ⅓ quorum + majority; `docs/member-voting.md` |
| F7 | 7-seat Council (4-of-7) | ✅ | `appoint_seat`, `propose`, `approve`, `execute_proposal`, `cancel_proposal`; `council.rs` | 3 servants + 4 elders |
| F8 | Forkable federated Circles | ✅ | `initialize_circle` (per Circle) | World Service authority over local Circles |
| F28 | **Member election of the 7 Council seats** | ⬜ (unblocked; engineering only) | new `ElectionProposal` + `cast_election_ballot` (reuse `member_vote` VK) + `finalize_election` + `install_elected_seat`; in-browser prover from `app/voting/prove.ts` | group-conscience **election** of each seat holder — members nominate + vote anonymously (one-member-one-vote), winner installed into the seat. **NOT blocked** (earlier note was wrong): the `member_vote` ceremony is done and `cast_vote` already verifies real proofs on devnet. Remaining = pure engineering: (1) demonstrate a real ballot end-to-end on the deployed program (proves the snarkjs→groth16-solana encoding + Poseidon match), (2) on-chain election plumbing (an `ElectionProposal` carrying seat_index + candidate, balloted like a `MemberProposal`, with `install_elected_seat` writing `council.seats[i]` on a passed finalize, respecting uniqueness), (3) browser proving + election UI. Open: term length / recall, interaction with `RotateSeat`. Mainnet also wants the multi-party ceremony. |

### Resilience & recovery
| # | Feature | Status | Instructions / files | Notes |
|---|---------|--------|----------------------|-------|
| F9 | Key recovery — migrate all artifacts (4-of-7) | ✅ | `propose`/`execute_proposal` (MigrateWallet / **SetAuthority**), `recover_membership` | seats rebound atomically; memberships per-account; **authority** rotatable (time-locked) |
| F10 | Migration time-lock + any-seat contest | ✅ | `execute_proposal`, `cancel_proposal`, `Council.recovery_timelock` | anti-collusion |
| F11 | Member co-signature & self-recovery (≤2 guardians, 1-of-2) | ✅ | `set_recovery`, `member_migrate`, `recover_membership` | `docs/resilience.md` |

### Shamanic lineage & credentials
| # | Feature | Status | Instructions / files | Notes |
|---|---------|--------|----------------------|-------|
| F12 | ZK lineage level grants (issuer-anonymous) | ✅ | `initialize_lineage`, `grant_level`; `circuits/lineage_grant.circom`; `merkle.rs` | append-only Poseidon tree; `docs/zk-lineage.md` |
| F13 | Acknowledgment credentials (PPP·CCC·XXX·DDD) | ✅ | `issue_acknowledgment`; `Acknowledgment` | stores only root R; reuses lineage VK for attestation |
| F14 | ZK selective field disclosure | ✅ | `circuits/ack_disclose.circom`; `app/acknowledgment/prove.ts` | reveal/hide each field |
| F15 | ZK predicate proofs (date / course-in-catalog / teacher-in-set) | ✅ | `ack_disclose.circom`; `prove.ts buildSet` | `docs/acknowledgments.md` |
| F16 | On-chain predicate-gated access | ✅ | `verify_disclosure`, `AccessPass`, `verifying_key_ack.rs` | mints an AccessPass |

### Treasury
| # | Feature | Status | Instructions / files | Notes |
|---|---------|--------|----------------------|-------|
| F17 | Self-supporting donation treasury | ✅ | `donate`, `donate_token` (any SPL/Token-2022), `withdraw_treasury` (treasury PDA) | `app/treasury/fund.ts` (`fundFoundation`); `docs/treasury.md` |
| F29 | **Change the Circle treasury wallet (4-of-7) — must be a multisig** | ✅ | `ProposalAction::SetTreasuryWallet`, `propose`/`execute_proposal`/`set_treasury_wallet`, `TreasuryConfig` PDA; admin console "Council votes" + "Apply"; `frontend/lib/multisig.ts`, `scripts/create-multisig.js`, `docs/multisig.md` | Council **4-of-7** designates/rotates the treasury steward wallet. New time-locked, contestable proposal action (same machinery as `WithdrawTreasury`): `execute_proposal` authorizes, `set_treasury_wallet` writes the wallet into a separate `TreasuryConfig` PDA (`["treasurycfg", circle]` — migration-safe, no `Circle` layout change). **The steward wallet MUST be a multisig** (Tradition 7 — money held in common, never by one key): `set_treasury_wallet` re-checks on-chain that the passed account is an initialized SPL Token / Token-2022 `Multisig` with `m ≥ 2` (`TreasuryNotMultisig` otherwise); the admin console validates the same before proposing, and ships a create-a-multisig helper. Deployed to devnet (upgrade `cDX8sWiJ…`); helper verified against a real 2-of-3 multisig (`AHvaueFp…`). |

### Directory & frontend
| # | Feature | Status | Instructions / files | Notes |
|---|---------|--------|----------------------|-------|
| F18 | Public Circle directory (geo + IPFS doc CIDs) | ✅ | `upsert_circle_profile`, `CircleProfile`; `frontend/` (Find a Circle / Reflections / Documents) | "Find a Circle Near You" map; one `getProgramAccounts` read |
| F19 | Update circle locations (in-place, no history) | ✅ | `update_circle_location` | a relocating Circle changes only its coordinates/city/address — name & doc CIDs untouched; **overwrite only, no location history kept** |
| F20 | Deterministic Jazzicon identicons | ✅ | `frontend/lib/jazzicon.ts`; `tests/jazzicon.ts` | self-contained SVG + SHA-256; used as the avatar everywhere. **Brand rule (regression-guarded):** addresses starting with `AHA` render entirely in the **purple/violet** family — background *and* every shape (hue 255–305), never orange. Earlier fix only recolored the background; shapes still hashed orange, so the coin read orange. Now the whole palette is constrained for `AHA*`, case-insensitive, and `tests/jazzicon.ts` asserts all stops are purple (R>G ∧ B>G) for `AHA*` and that non-AHA stays full-spectrum — **do not remove that test.** |
| F21 | Delist a Circle from the directory | ✅ | `close_circle_profile` | closes the `CircleProfile` (rent → seat); Circle/Council/members untouched; `scripts/close-circle.js` |
| F22 | Wallet connect + "My Circle" member console | ✅ | `frontend/app/me/`, `lib/member.ts`, `components/WalletProviders.tsx` | connect a Wallet-Standard wallet → see your memberships (memcmp on `owner`), join a home circle, 7th-Tradition `donate` |
| F23 | "Create a Circle" self-serve UI | ✅ | `initialize_circle`, `initialize_member_tree`; `frontend/app/create/`, `lib/createCircle.ts` | guided wizard: name (≤32 B), parent (foundation default), 7 distinct seats (creator auto-seated so they can sign the member-tree init, depth pinned to circuit), advanced term/time-lock; shows the assigned `@aha` address on success |
| F24 | Circle administration console (seat-gated) | ✅ | `propose`/`approve`/`execute_proposal`/`cancel_proposal`, `create_member_proposal`/`finalize_member_proposal`, `issue_membership`/`renew_membership`/`revoke_membership`, `set_open_membership`, `set_treasury_wallet`; `frontend/app/admin/CircleAdmin.tsx` | now embedded at the bottom of **My Circle** (`/me`) with an "Administration of [combo]" picker (the standalone menu was removed). Role, Council + group-conscience votes (CRUD), membership add/renew/**delete** (`revoke_membership`, Scribe-Secretary), and the membership/treasury-wallet policy. Casting member ballots is the ZK flow (F6). |
| F34 | **Foundation-led federation governance** (rotate seats / delete a Circle, 4-of-7) | ✅ | `propose/approve/execute_child_rotation`, `propose/approve/execute_child_close`, `ChildSeatVote`/`ChildCloseVote`; `frontend/app/foundation/` | the foundation Council (4-of-7, 1–90-day validity window) can rotate any federation Circle's 7 seats or delete a Circle (closes it + delists its profile). Federation = Circles sharing the foundation's root `parent`. Deployed. |

### Community & content
| # | Feature | Status | Instructions / files | Notes |
|---|---------|--------|----------------------|-------|
| F30 | **Member posts / bulletins** (text + picture, time-boxed, seat-removable) | ✅ | `create_post` / `delete_post`, `Post` account; `frontend/app/board/`, `lib/posts.ts` | Any **member** (a wallet that owns a live membership in the Circle) publishes a post — text and/or an IPFS image (CID on-chain) — valid `start_date`→`end_date` (shown only in that window). **Any of the 7 Council seats deletes any post anytime** (rent refunded to the acting seat). Member-auth = passing a membership whose `owner == author` (so fully-anonymous, owner-less memberships can't post — noted limitation). UI: the **Board** page (compose for members, delete for seats). Deployed to devnet; verified: post created, non-member rejected, seat-delete succeeds. |

| F32 | **Encrypted 1:1 private messaging** | ✅ | `register_messaging_key`/`send_message`/`delete_message`, `MessagingKey`/`Message`; `frontend/app/inbox/`, `lib/messaging.ts` | **Inbox** menu with a red unread badge. End-to-end encrypted (tweetnacl box; x25519 keypair derived from a deterministic wallet signature, public half published on-chain). Send to any address that enabled messaging; decrypt-on-select (one signature per session); optional expiry (clients hide, anyone may close). Caveat: ciphertext is private but sender/recipient **metadata is public on-chain**. Deployed. |
| F32b | **Seat-holders must have messaging enabled** | ✅ (UX-enforced) | `frontend/components/SeatMessagingGate.tsx` (mounted in `layout.tsx`) | Policy: any wallet holding one of the 7 seats in **any** Circle must have messaging enabled, so servants are always reachable. **Cannot be force-enabled cryptographically** — a wallet's messaging key derives from *its own* signature (`deriveBoxKeypair`), so only the holder can publish it. Enforcement is therefore a **persistent, non-dismissable banner**: when a connected seat-holder lacks a published `MessagingKey`, the app shows "You hold a Council seat — enable messaging" with a one-click enable (one signature). ⬜ optional hardening: also require a `MessagingKey` PDA to exist before `appoint_seat`/`execute` RotateSeat installs a holder (on-chain), with a chicken-and-egg caveat (the appointee must enable first). |
| F18b | Structured **meeting schedule** + calendar on a Circle | ✅ | `set_meetings`, `CircleMeetings`; `lib/meetings.ts`, `/create`, home Circle detail | recurring patterns (e.g. "2nd Wednesday monthly 18:00") + one-off sessions in a per-Circle on-chain account; the home Circle detail expands them into an upcoming-meetings calendar visible to everyone. |
| F33 | **User profile: avatar + timezone** | ✅ | `lib/profile.ts`; `/me` ProfileCard | per-device (localStorage) avatar (overrides the Jazzicon on My Circle) + timezone (localises Inbox timestamps). Cross-device/on-chain publishing remains a future option. |

### Off-chain infrastructure
| # | Feature | Status | Instructions / files | Notes |
|---|---------|--------|----------------------|-------|
| F25 | Mandatory per-Circle email on the AHA domain (auto-provisioned at registration) | 🟡 | `frontend/lib/circleEmail.ts`, `frontend/app/api/circle-email/route.ts`; wired into `/create`, `/me`, `/admin`; `indexer/email-indexer.js` | Every Circle gets a **deterministic** `@aha`-domain address (`slug-<pda6>@DOMAIN`) the moment it is created — mandatory, derived, no opt-out. A Node route sends a *provision* email on creation and a *registration* email (with the new member's wallet) on each `issue_membership`. **Send path live** (Mailgun SMTP wired on the deployed host) and **the server-side hook is built**: `indexer/email-indexer.js` polls the program for new `Circle`/`Membership` accounts and POSTs to `/api/circle-email`, covering registrations outside this UI (baseline-safe — never re-sends the back-catalog; verified end-to-end on devnet). The **only** remaining piece for ✅ is mailbox **receive** on the live domain — an MX + Mailgun inbound *Route* (DNS/dashboard task, see `indexer/README.md`), so the derived addresses can accept replies, not just send. |

---

## Backlog (planned / open)

### Security (see SECURITY.md)
- ✅ Bound `verify_disclosure` policy to the AccessPass (`requirements_hash`) — S1.
- ✅ Council can rotate a lost/compromised Circle `authority` (4-of-7 + time-lock + contest) — S2.
- ✅ Council seat uniqueness (no wallet in two seats) — S3.
- ✅ Pin tree depth to the circuit depth — S4.
- ⬜ Operational gates before mainnet: real VKs (fail-closed), `authority` = multisig, genesis key in MPC, rent-exempt treasury.
  - 🟡 **Treasury steward = multisig** is now *enforced on-chain* (`set_treasury_wallet` requires an SPL/Token-2022 `Multisig`, `m ≥ 2`; helper + `docs/multisig.md`). Still ⬜ for the *program upgrade* `authority` and per-Circle `Council` authority to be a multisig/MPC.
- ⬜ **Deeper audit pass once the toolchain is up** (needs a compiled build):
  - ⬜ Real **fuzz / property tests** of Council vote accounting (approvals bitmask, threshold, time-lock/contest, quorum + majority) and nullifier logic (no replay across the `nullifier` / `ack_nullifier` / `vote_nullifier` / `personhood` namespaces).
  - ⬜ Run **`/security-review`** against the compiled build to catch anything static analysis surfaces.

### Build & cryptography
- ✅ **Builds + no-ZK tests pass** on **Anchor 0.31.1 / Agave 2.3.13**. `anchor build` → `.so` + IDL (`ayni.json`) + types; `anchor test` → **7/7** (membership, co-signature/2-guardian, self-recovery, Council 4-of-7, time-lock, contest). Migrated 0.30.1→0.31 (the 0.30.1 IDL builder is incompatible with 2025+ Rust); poseidon now from the `solana-poseidon` crate (moved out of solana-program in 2.x); groth16-solana 0.2.0 (same API).
- First real compile fixed **4 bugs**: 2 borrow-checker (disjoint borrow through `Account` Deref) + 2 BPF stack-overflow (`Box` the large accounts in `GrantLevel`/`IssueAcknowledgment`). Cargo.lock pins keep edition2024/MSRV crates off the platform-tools cargo (rust 1.79).
- 🟡 **ZK end-to-end proof test exists** (`tests/vote.ts`): builds a member commitment `Poseidon(secret)`, generates a real proof via `app/voting/prove.ts` (+ snarkjs), casts it through `cast_vote`, asserts the on-chain verifier accepts it, and rejects a double-vote — validating the Poseidon/circom ↔ solana-poseidon match and the snarkjs→groth16-solana byte encodings. (Not re-run in the WSL dev env this session — local `anchor test` validator startup is slow; the deployed devnet program already verifies the real VKs.) Still 🟡 only for the **other** circuits (`grant_level` / `issue_acknowledgment` / `verify_disclosure` / `prove_personhood`) lacking an equivalent e2e test, and mainnet's multi-party ceremony.

### Feature completions
- ✅ **Membership revocation** — `revoke_membership` (Scribe-Secretary) closes the membership account; wired into the admin "Delete". (No separate *suspend* toggle; and the commitment leaf remains in the append-only member tree until rebuilt — noted in-UI.)
- ✅ **"Create a Circle" wizard** (F23) — `initialize_circle` + `initialize_member_tree` behind a guided web flow (seat picker, foundation as parent, depth = circuit depth).
- 🟡 **Per-Circle email provisioning** (F25) — address derivation + provision/registration send path done (`/api/circle-email`); SMTP live (Mailgun) on the deployed host; server-side send hook **built** (`indexer/email-indexer.js`, baseline-safe, verified on devnet). Only mailbox **receive** (MX + Mailgun inbound route) remains — a DNS task, see `indexer/README.md`.
- ✅ **Solana multisig: docs + helper + treasury enforcement** — `docs/multisig.md` (and a docs.html card) explain SPL Token m-of-n multisigs and how to make one (`spl-token create-multisig`, `scripts/create-multisig.js`, or the in-browser `lib/multisig.ts` `createMultisigWithWallet`). `lib/multisig.ts` also exposes `isMultisig`. The program now **requires** the treasury steward wallet to be a multisig (see F29).
- ✅ Token-2022 **NonTransferable mint creation** as a program instruction (`create_membership_mint`) — finishes F3. Deployed + verified on devnet.
- ✅ Enforce **donation-on-renew** — `renew_membership` now CPI-transfers the
  Circle's `CircleConfig.renew_donation_lamports` into the treasury PDA as the act
  of renewal (Tradition 7); 0 = free. New per-Circle **`CircleConfig`** sibling
  PDA (`["config", circle]`, no `Circle` migration) + `set_circle_config` (any
  seat) holds the renew fee plus reserved fields for member-vote quorum/pass and
  the treasury allowlist (wired in following waves). Admin console → "Self-support
  (Tradition 7)". Deployed (upgrade `2sZmGW35…`); verified set + renew on devnet.
- ⬜ **MACI / coercion-resistant** member voting (today `choice` is public per ballot).
- ⬜ Per-Circle **quorum/threshold config** for member voting (currently fixed ⅓ + majority).
- ⬜ **Sponsor** relationship + **anniversary/sobriety-chip** schema (map onto acknowledgments/levels).
- ⬜ Treasury **mission/spend allowlist** (Traditions 5/6).

### Design decisions (see PROJECT.md §10)
- ⬜ Harden **RotateSeat** against the "purge before migration" attack (time-lock / freeze during pending migration).
- ⬜ Council size for small Circles (enforce 7/4 vs smaller m/n until grown).
- ⬜ Cross-Circle / World Service binding votes vs suggestions only.
- ⬜ Chain decision: EVM (ZK lego) vs Solana — Ayni is the Solana build; EVM branches are scaffolds only.

### Product layer (not protocol)
- ⬜ Frontend (Realms-style UI), onboarding flow.
- ⬜ Notifications (Dialect-style) for proposals/votes.
- ⬜ Off-chain mirror linking meetings/material/docs to on-chain proposals.

---

## Instruction index (25)

`initialize_circle` · `issue_membership` · `renew_membership` ·
`initialize_member_tree` · `create_member_proposal` · `cast_vote` ·
`finalize_member_proposal` · `set_personhood` · `prove_personhood` · `donate` ·
`withdraw_treasury` · `set_membership_mint` · `create_membership_mint` · `mint_membership_token` ·
`appoint_seat` · `propose` · `approve` · `execute_proposal` · `cancel_proposal` ·
`recover_membership` · `set_recovery` · `member_migrate` · `initialize_lineage` ·
`grant_level` · `issue_acknowledgment` · `verify_disclosure`
