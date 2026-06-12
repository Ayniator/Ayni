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
toolchain present. All ZK verifying keys are zeroed placeholders pending
trusted-setup ceremonies. "✅" means code-complete & wired, not build-verified.

---

## Feature registry (Ayni / `solana`)

### Membership & identity
| # | Feature | Status | Instructions / files | Notes |
|---|---------|--------|----------------------|-------|
| F1 | Soulbound yearly membership (ZK-commitment keyed) | ✅ | `issue_membership`, `renew_membership` | anonymous; renews term |
| F2 | Selective-disclosure identity (optional `owner` wallet) | ✅ | `Membership.owner` | default = fully anonymous |
| F3 | Soulbound Token-2022 membership token | 🟡 | `set_membership_mint`, `mint_membership_token` | mints from a pre-created NonTransferable mint; **mint creation is an external setup step**, not yet an instruction |

### Sybil resistance
| # | Feature | Status | Instructions / files | Notes |
|---|---------|--------|----------------------|-------|
| F4 | Social vouching (always-on) | ✅ | `issue_membership` (authority-gated) | a human admits a human |
| F5 | Anonymous proof-of-personhood (one human → one membership/Circle) | ✅ | `set_personhood`, `prove_personhood`, `PersonhoodCredential` | reuses `member_vote` circuit/VK; World ID-style root; `docs/sybil.md` |

### Governance & voting
| # | Feature | Status | Instructions / files | Notes |
|---|---------|--------|----------------------|-------|
| F6 | Anonymous member voting (one member, one vote) | ✅ | `initialize_member_tree`, `create_member_proposal`, `cast_vote`, `finalize_member_proposal`; `circuits/member_vote.circom` | Semaphore-style; per-proposal nullifier; ⅓ quorum + majority; `docs/member-voting.md` |
| F7 | 7-seat Council (4-of-7) | ✅ | `appoint_seat`, `propose`, `approve`, `execute_proposal`, `cancel_proposal`; `council.rs` | 3 servants + 4 elders |
| F8 | Forkable federated Circles | ✅ | `initialize_circle` (per Circle) | World Service authority over local Circles |

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

### Directory & frontend
| # | Feature | Status | Instructions / files | Notes |
|---|---------|--------|----------------------|-------|
| F18 | Public Circle directory (geo + IPFS doc CIDs) | ✅ | `upsert_circle_profile`, `CircleProfile`; `frontend/` (Find a Circle / Reflections / Documents) | "Find a Circle Near You" map; one `getProgramAccounts` read |
| F19 | Update circle locations (in-place, no history) | ✅ | `update_circle_location` | a relocating Circle changes only its coordinates/city/address — name & doc CIDs untouched; **overwrite only, no location history kept** |
| F20 | Deterministic Jazzicon identicons | ✅ | `frontend/lib/jazzicon.ts`; `tests/jazzicon.ts` | self-contained SVG + SHA-256; used as the avatar everywhere |
| F21 | Delist a Circle from the directory | ✅ | `close_circle_profile` | closes the `CircleProfile` (rent → seat); Circle/Council/members untouched; `scripts/close-circle.js` |

---

## Backlog (planned / open)

### Security (see SECURITY.md)
- ✅ Bound `verify_disclosure` policy to the AccessPass (`requirements_hash`) — S1.
- ✅ Council can rotate a lost/compromised Circle `authority` (4-of-7 + time-lock + contest) — S2.
- ✅ Council seat uniqueness (no wallet in two seats) — S3.
- ✅ Pin tree depth to the circuit depth — S4.
- ⬜ Operational gates before mainnet: real VKs (fail-closed), `authority` = multisig, genesis key in MPC, rent-exempt treasury.
- ⬜ **Deeper audit pass once the toolchain is up** (needs a compiled build):
  - ⬜ Real **fuzz / property tests** of Council vote accounting (approvals bitmask, threshold, time-lock/contest, quorum + majority) and nullifier logic (no replay across the `nullifier` / `ack_nullifier` / `vote_nullifier` / `personhood` namespaces).
  - ⬜ Run **`/security-review`** against the compiled build to catch anything static analysis surfaces.

### Build & cryptography
- ✅ **Builds + no-ZK tests pass** on **Anchor 0.31.1 / Agave 2.3.13**. `anchor build` → `.so` + IDL (`ayni.json`) + types; `anchor test` → **7/7** (membership, co-signature/2-guardian, self-recovery, Council 4-of-7, time-lock, contest). Migrated 0.30.1→0.31 (the 0.30.1 IDL builder is incompatible with 2025+ Rust); poseidon now from the `solana-poseidon` crate (moved out of solana-program in 2.x); groth16-solana 0.2.0 (same API).
- First real compile fixed **4 bugs**: 2 borrow-checker (disjoint borrow through `Account` Deref) + 2 BPF stack-overflow (`Box` the large accounts in `GrantLevel`/`IssueAcknowledgment`). Cargo.lock pins keep edition2024/MSRV crates off the platform-tools cargo (rust 1.79).
- ⬜ **ZK instructions need trusted-setup keys to test** (`cast_vote`, `grant_level`, `issue_acknowledgment`, `verify_disclosure`, `prove_personhood`). Per circuit (`lineage_grant`, `ack_disclose`, `member_vote`): compile + a single-contributor ceremony → regenerate `verifying_key*.rs` (3 placeholders), then write ZK tests with `app/**/prove.ts`. Also validates Poseidon/circom ↔ on-chain compatibility and the snarkjs→groth16-solana proof byte encodings.

### Feature completions
- 🟡 Token-2022 **NonTransferable mint creation** as a program instruction (currently external setup) — finishes F3.
- ⬜ Enforce **donation-on-renew** (`renew_membership` currently extends term without requiring a transfer).
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
`withdraw_treasury` · `set_membership_mint` · `mint_membership_token` ·
`appoint_seat` · `propose` · `approve` · `execute_proposal` · `cancel_proposal` ·
`recover_membership` · `set_recovery` · `member_migrate` · `initialize_lineage` ·
`grant_level` · `issue_acknowledgment` · `verify_disclosure`
