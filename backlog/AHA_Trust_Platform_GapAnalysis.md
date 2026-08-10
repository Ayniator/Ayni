# AHA Trust Platform Backlog × Ayni codebase — Gap Analysis

**Repo:** `/home/alkia/Ayni` (branch `solana`), analyzed 2026-08-10 against `backlog/AHA_Trust_Platform_Backlog.md` (Epics 0–10).

**Freshness note (important):** the six analyst passes ran against commit `aea1438`, but the working tree has moved *during* this analysis cycle: **Epic 0's faucet is now implemented in the program** (uncommitted: `programs/ayni/src/instructions/{init_faucet,set_faucet_amount,activate_faucet,refill_faucet}.rs` + `FaucetJar` in `state.rs`, wired into `lib.rs`/`mod.rs`/`errors.rs`), and **Sentinel Round 1 has already run** (`reports/sentinel/NRR-2026-08-10-1.md`, `docs/shipped.md` created). Analyst 1's "zero grep hits for faucet" and analyst 6's "docs/shipped.md missing" are stale; this report reflects the verified current tree. All analyst claims with adversarial verdict `confirmed=false` have been downgraded as instructed.

---

## 1. Scorecard

| Epic | Title | Verdict | What covers it (verified) | Remaining effort |
|---|---|---|---|---|
| **E0** | Faucet — first gas | **Mostly built** (program pilot form, landed mid-round, uncommitted) | New `init_faucet`, `set_faucet_amount` (Treasurer, on-chain cap `FAUCET_MAX_GRANT_LAMPORTS`), `activate_faucet` (WingPeer-parrain-gated, one-grant-ever nullifier `["faucetnull", commitment]`, uniform amount), `refill_faucet` (member-vote-bound via `description_hash`); riding F17 treasury, F6 member votes, Wave-2 WingPeer | **M** — commit+build+tests+devnet deploy, frontend panel, treasurer off-chain encrypted ledger, anonymous form (needs E2) |
| **E1** | Two-sponsor admission | **Greenfield** (substrate only) | F4 Secretary-gated `issue_membership`, F31 `set_open_membership`, F5 personhood — none is peer sponsorship; no attestation instruction exists | **M–L** — named pilot M; anonymous form gated on E2 |
| **E2** | ZK vouch-proofs | **Partial substrate, feature greenfield** | Proven Semaphore-style stack: `circuits/member_vote.circom` + real Groth16 VKs + browser prover `frontend/lib/zk-vote.ts` + nullifier-PDA pattern (`grant_level`, `prove_personhood`→credential→consume) | **L** — vouch instruction+tally, root freshness, good-standing set, relayer, multi-party ceremony |
| **E3** | Quipu — physical / data model | **Partial** | Wave-2 `ProgressToken` (`["progress", circle, member, milestone]`) + `WingPeer`; **but day-count chips, not Steps 1–12** (verdict: refuted as step model); Emerald table **not in repo** | **M** — step-token model, sponsor-gated issuance, docs/quipu.md (external input needed) |
| **E4** | Quipu page (trust page) | **Greenfield** | Only `/me` self-console (chips shown without sums ✓); **no visitable member page exists** (verdict: refuted), no bio, no service history, no presence attestation | **L** |
| **E5** | Per-element visibility | **Greenfield** | Design templates only: `ack_disclose.circom` per-field disclosure, `member_vote` membership proof, sealed-sender key registry; **no read-path proof check anywhere** (verdict: refuted) | **L** — key architecture + off-chain verification path |
| **E6** | Avatar / stone-mark | **Partial** (small, but gated on E5) | F33 client-side resize + localStorage avatar (private by default, vacuously); F20 Jazzicon fallback | **S** own work (draw tool, rendering policy); blocked by E5 |
| **E7** | Encrypted messaging | **Partial — architecturally conflicting** | F32 v2: E2E nacl.box, sealed account record, fixed-size padding, device-only keys | **L** — epic requires fully off-chain; current design is on-chain by construction; fee-payer links sender (verdict: Signal-sense sealed sender refuted) |
| **E8** | Passkeys + sponsor recovery | **Partial** | F11 guardians (≤2, 1-of-2) + council fallback (F9/F10) = human recovery ✓; **WebAuthn: zero code**; sponsor binding impossible until E1 (verdict: refuted) | **M** |
| **E9** | Graphical onboarding | **Partial / mostly greenfield** | Wallet-only entry (F22), self-join/join-request (F31), local profile (F33); `activate_faucet` now supplies the fund step's machinery | **L** — /onboarding route, wallets.json+shuffle, cartoonisation, provisional membership, parrain step |
| **E10** | Open decisions | **Mostly decided de facto, none recorded** | Chain=Solana (whole repo); phone=dropped (absence); pilot-vs-ZK=pilot shipped; faucet-vs-relayer=**faucet just shipped**; quantum & stewardship genuinely open | **S** — write the ADRs; M for authority-to-multisig |

---

## 2. Per-epic detail

### E0 — The Faucet *(status changed mid-analysis: program side now built)*

**COVERED (verified in working tree):**
- `FaucetJar` PDA `["faucet", circle]` with `grant_lamports`/`granted` (state.rs:617–634); `init_faucet` (any Council seat).
- **Treasurer-only grant amount within an absolute on-chain maximum** — `set_faucet_amount` gates on `require_seat(SEAT_TREASURER)`, enforces `FAUCET_MAX_GRANT_LAMPORTS = 2_000_000` (≈USD 0.25) as a program constant.
- **Parrain-only activation, exactly once, program-enforced** — `activate_faucet`: signer must hold the wing membership of the neophyte's seed-bound `WingPeer`; parrain must be in good standing (`expires_at` checked); nullifier PDA `["faucetnull", neophyte_commitment]` (circle-less seed → one grant per identity **fellowship-wide**, refusal by `init` collision); uniform grant amount (anti-fingerprinting); jar rent floor preserved (blast radius = jar only, never treasury).
- **Refill only by circle vote** — `refill_faucet` requires a finalized+passed anonymous *member* proposal whose `description_hash = H("AHA-faucet-refill" ‖ circle ‖ amount)`, one-shot `["faucetfill", proposal]` marker; group conscience, not a servant signature.
- Supporting machinery all previously verified: F17 treasury + F6 anonymous member voting + Wave-1c allowlist.

**PARTIAL:**
- Top-circle cap governance: the cap is a program constant "revised each equinox by program upgrade" — process, not a top-circle vote account.
- Neophyte must have `Membership.owner` set (wallet publicly bound to commitment) to receive gas.

**MISSING:** frontend faucet panel / parrain one-tap activation (zero faucet code under `frontend/`); tests (no faucet coverage in `tests/`); devnet deploy (code is uncommitted and unbuilt — Sentinel could only `cargo check` in Docker); treasurer-only **encrypted off-chain ledger with one-time pseudonymous codes**; randomized disbursement timing.

**CONFLICTS (called out prominently):**
- **The pilot rides the on-chain WingPeer sponsor edge** and the activation tx publicly links parrain wallet ↔ neophyte wallet — the code documents this itself as a pilot limitation "until Epic 2". This is exactly the recorded sponsor edge the backlog's Traditions audit rejects; acceptable only as the explicitly-named pilot phase.
- Faucet payouts publicly mark recipient wallets as fellowship-adjacent (epic's own open T12 item).
- The repo's documented relayer anonymity (cast_vote/grant_level comments, docs/member-voting.md) is still fictional: `frontend/lib/zk-vote.ts` has the voter's own wallet pay.

**NEXT STEPS:** commit + `anchor build` + faucet test suite + devnet deploy (S); admin/parrain UI (M); treasurer encrypted off-chain ledger reusing `lib/messaging.ts` crypto — **never WingPeer, never a chain account** (M); anonymous form: faucet-scoped vouch circuit + relayer (L, depends E2); top-circle cap account (M, needs "top circle" designation).

### E1 — Two-Sponsor Admission

**COVERED:** human-gated admission baseline (F4 `issue_membership`, Secretary seat); per-circle policy switch (F31); admitted member anonymous on-chain (commitment-keyed `Membership`, optional `owner`); optional one-human-one-membership gate (F5 `prove_personhood` → `PersonhoodCredential` consumed at issuance).

**PARTIAL:** `WingPeer` is a sponsor-shaped relation but wrong on every axis — one wing not two, post-admission not gate, mentee-set (never proves sponsor consent), and a **public on-chain commitment→commitment edge**. *Downgraded (verdict refuted):* "sponsors in good standing" — nothing anywhere checks a sponsor/wing's standing except the new `activate_faucet` (which checks the parrain's expiry — the first such check in the repo).

**MISSING:** any sponsor-attestation primitive; two-attestor counting gating admission; provisional-member state (issuance and MemberTree insertion are one atomic instruction — full voting power immediately); sponsor UI; even the named pilot flow.

**CONFLICTS:**
- **F31 open membership = zero-vouching self-admission**, the direct opposite of "every member enters through two existing members." Must be reconciled or rescoped to pilot-only.
- **The Secretary's wallet signs every gated admission** — a public named-admitter edge per member.
- **Self-join has the newcomer's wallet sign a tx carrying their own commitment** — public wallet↔commitment link at issuance.
- **WingPeer** publishes the sponsor edge the Traditions audit rejected.
- `docs/sybil.md` doctrine ("authority-gated = social vouching") needs rewriting under the two-sponsor model.

**NEXT STEPS:** named-pilot `attest_admission` (PDA `[circle, newcomer_commitment, attestor_membership]` gives distinctness free) + two-attestation `issue_membership` variant (M); provisional membership = defer merkle insert to second attestation (M); good-standing checks on attestors (S — pattern now exists in `activate_faucet`); OpenMembership policy decision (S); anonymous form via E2 (L).

### E2 — Zero-Knowledge Vouch-Proofs

**COVERED (substrate, all devnet-proven):** Semaphore-style circuit + **completed ceremony** + on-chain Groth16 (`member_vote.circom`, `verifying_key_vote.rs`, `cast_vote`/`prove_personhood`; correction from verification: there is no `cast_election_ballot` — F28 reuses `cast_vote` via `link_seat_election`/`install_elected_seat`); in-browser proving with device-held secrets (`zk-vote.ts`); anonymous-attestor-bound-to-beneficiary with replay protection (`lineage_grant.circom`: `nullifier = Poseidon(secret, granteeCommitment)` — **the same sponsor vouching the same newcomer twice collides, so two-distinct-sponsors comes for free**); proof→credential→consume-at-admission template (`PersonhoodCredential`); relayer-ready payer separation; O(1) verification.

**PARTIAL:** personhood proof is a self-proof, not a sponsor's proof about a newcomer; proofs only verify against **frozen snapshot roots** — no recent-roots ring buffer, so vouch proofs would break on concurrent admissions. *Downgraded (verdict refuted):* **the trusted setup does not meet the epic's threat model** — single-contributor ceremony; `circuits/README.md` itself says production must be multi-party; `docs/zk-lineage.md` §6 is stale (still calls the VK a placeholder).

**MISSING:** the vouch feature itself (no `vouch_member`, no tally, no admission wiring); fellowship-wide verification anchor (all trees per-circle); member page to carry the proof; **an actual relayer** (documented pattern only); good-standing proof set (MemberTree is append-only; expired/revoked leaves stay).

**CONFLICTS:** WingPeer's public edge is precisely the minable sponsor graph the epic forbids; `Circle.member_count` + enumerable per-circle commitment lists + issuance-tx timing/signers allow partial graph deanonymization; the codebase has pre-empted E10's "chain?" and "quantum?" decisions (Solana + BN254 Groth16 + Ed25519 baked in).

**NEXT STEPS:** circuit decision — reusing `member_vote.circom` with external-nullifier = newcomer commitment makes the circuit work ~free (S); `vouch_member` + VouchTally (M); recent-roots ring buffer (M); wire into `issue_membership` + provisional path (M); good-standing tree/epoch snapshots (L); relayer service (M, shared with E0/E10); fellowship-wide anchor (L); **multi-party ceremony before mainnet** (M).

### E3 — Quipu (physical / data model)

**COVERED:** per-member, binary, one-per-(member,milestone), circle-attested record exists — `ProgressToken` + `issue_progress_token` + `frontend/lib/peers.ts`; sponsor bond structure exists (`WingPeer`).

**PARTIAL → downgraded (verdict refuted):** milestones are **elapsed-day chips** (`MILESTONES = [1, 30, … 1825]` days, "24 hours / N days / N years"), not Steps 1–12; zero alchemical-stage content anywhere in the repo.

**MISSING:** the **Emerald correspondence table is NOT in this repo** (the epic claims it "exists" — it must be sourced externally; Phase 0 blocker); step→color mapping; knot-date encoding + reading guide; any quipu doc/artifact ("quipu" appears only in `backlog/`).

**CONFLICTS:**
- **Named seat wallet recorded as issuer**: `ProgressToken.issuer: Pubkey` puts a permanent (named seat → member commitment) attestation edge on-chain; epic wants the *sponsor* to tie the knot, and the backlog rejects named attester edges.
- Day-count chips are inherently comparable durations, in tension with "binary and personal — nothing to compare."

**NEXT STEPS:** source Emerald table → `docs/quipu.md` (S, external dependency); StepToken PDA `["step", circle, member, step]` with `step: u8` (M); gate issuance on WingPeer wing signature instead of `require_any_seat`, drop/blind `issuer` (M); frontend step-vs-chip distinction (S).

### E4 — Quipu Page (Trust Page)

**COVERED:** chips already render without sums/fractions/progress bars in `/me` MentorshipCard; anonymous-by-default identity substrate; self-set avatar (localStorage); circle-level region context.

**PARTIAL → downgraded (verdicts refuted ×2):** **no member page others can visit exists at all** (`/me` is strictly self-view; no `/member/[id]` route; profile data is per-device localStorage and cannot be served to another viewer); **no vouch-proof is rendered anywhere** (substrate exists, feature doesn't).

**MISSING:** one-line bio (zero hits repo-wide); quipu render component; per-member service history (F18b meetings and F30 posts are not it); ZK presence attestation ("last stood in circle: month/year") — no circuit/instruction/account touches attendance; member-level circle-name/region fields; per-element visibility (E5).

**CONFLICTS:**
- **`Membership.level: u8` is a public, ordinal, comparable rank on every membership account** (fed by F12 `grant_level`) — the strongest direct contradiction of "nothing comparative, no verification tiers."
- `ProgressToken.issuer` = named witness edge (epic requires circle-level ZK attestation, never a named witness).
- Day-chip labels ("1825 days") would trip the epic's own no-counts DOM assertion.
- Linking the page to F30 posts/F32 messages re-identifies commitments via named wallets; current posting already excludes fully-anonymous members (`membership.owner == author`), a rank-by-disclosure asymmetry.
- Showing sponsor-tied cords + queryable WingPeer edges maps the sponsor graph.

**NEXT STEPS:** MemberPage encrypted data layer + `/member/[commitment]` route (L, depends E5); quipu SVG component with no-counts regression test (M, depends E3); service entries, date-listed never summed (M); presence attestation circuit reusing the F6 stack (L); never render `level`, migrate it toward ZK-provable credential via existing F14 machinery (M).

### E5 — Per-Element Visibility

**COVERED (templates only):** membership-proof primitive (`member_vote.circom` + on-chain Groth16); per-field selective-disclosure pattern (`ack_disclose.circom` + `verify_disclosure.rs` `DisclosureGate`/`AccessPass`); anonymity-by-default at the wallet layer.

**PARTIAL → downgraded (verdict refuted):** **no ZK membership check exists on any read path** — every verification in the repo is a write-path, on-chain act that mints a public record; all account data is world-readable via RPC.

**MISSING:** the entire visibility model — no (avatar|quipu|bio) × (all-members|my-circle|chosen-ones) schema, storage, engine, or UI; no member profile pages to apply it to; two of the three governed elements (bio, quipu) don't exist; no per-audience encrypted storage or key distribution (though the X25519 `MessagingKey` registry + sealed-sender crypto is reusable raw material for chosen-ones).

**CONFLICTS:**
- **"Nothing visible to the public internet" is violated today**: F30 board posts (author wallets + identicons rendered to any visitor, no membership needed), disclosed `Membership.owner` wallets enumerable via memcmp, IPFS via public gateway as the only shared-storage pattern.
- **Reusing `AccessPass` for profile visibility would publish "viewer V unlocked member M's element" on-chain** — the interest graph the epic forbids. Verification must move off-chain/client-side.
- F20's "Jazzicon as the avatar everywhere" contradicts default-private avatars; demote to key-visualization fallback.

**NEXT STEPS:** profile object + visibility schema, default my-circle, client-side encrypted (S design); per-tier key architecture (circle key via sealed messaging, fellowship key gated on membership proof, sealed per-recipient for chosen-ones) (L); **off-chain** membership-proof verification for reads (M); bare-page rendering — hidden ≡ absent, no lock icons (S, with E4); retrofit board/inbox surfaces (M).

### E6 — Avatar / Stone-Mark

**COVERED:** client-side upload (canvas resize ≤128px webp, localStorage); never public by default (vacuously — no disclosure path exists); deterministic non-biometric fallback (F20 Jazzicon, regression-tested).

**PARTIAL:** upload only — no drawing canvas, no triangle-framed stone-mark, no ceremony framing; no audience disclosure (the `ack_disclose` portrait commitment is credential-scoped, not the display avatar).

**MISSING:** draw tool; any mechanism for another member to ever see the avatar; audience selection UI.

**CONFLICTS:** Jazzicon rendered to unauthenticated public visitors while designated "the avatar everywhere"; publishing marks through the public IPFS gateway pattern would violate the epic — ciphertext-only off-device storage.

**NEXT STEPS:** stone-mark canvas editor (S, no dependencies); move avatar into E5 encrypted profile object (S, gated on E5 — large); rendering policy with identical neutral silhouette (S).

### E7 — Encrypted Messaging

**COVERED:** genuine E2E content encryption (fresh ephemeral nacl.box, plaintext never leaves devices); sealed **account record** (no sender field/seed, sender name+signature inside the envelope, fixed 1040-byte padding); keys derived on-device, memory-cached only.

**PARTIAL → downgraded (verdict refuted):** **not sealed-sender in the Signal sense** — `messaging.ts` sets `payer: wallet.publicKey`, so every message tx is publicly linked to its sender (the code's own RESIDUAL comment admits this); static recipient key from a deterministic wallet signature → one compromise (or one phished sign of `KEY_DERIVATION_MSG`) decrypts all history; no forward secrecy/ratcheting.

**MISSING:** off-chain transport entirely; metadata protection (recipient cleartext + memcmp-indexed, timestamps public, existence permanent in ledger history even after `delete_message`); client-side **encrypted** trust list (only an *unencrypted* localStorage sent-log/read-markers exist; no trust/block/mute anywhere); X3DH/double-ratchet/group sessions.

**CONFLICTS (architectural, the epic's core):**
- **The epic says messages must be entirely off-chain with no record of who wrote to whom or when; F32 stores every message ON Solana.** The current design is what the epic rules out, not a partial version of it.
- `MessagingKey` PDA publicly marks every messaging-enabled wallet as fellowship-adjacent.
- F32b seat-messaging policy, inbox badge, and chain-derived notifications are all built on the on-chain design and break with the move.

**NEXT STEPS:** architecture decision — libsignal + minimal delivery service vs self-hosted relay; prekey directory must not become a member list (M); implement off-chain transport (L); encrypted trust list under a device/passkey-wrapped key (S, interacts with E8); migrate/deprecate F32 + rework reachability/notifications (M); interim relayer fee-payer if F32 lingers (M, shared decision with E0/E10).

### E8 — Passkeys + Sponsor Recovery

**COVERED:** no biometric/personal data server-side, no email/phone recovery (verified by absence — pure wallet-adapter auth; the single API route `/api/circle-email` carries only public chain data and plays no auth role); recovery through trusted humans exists and is tested — F11 guardians (≤2, 1-of-2, settable at issuance) + F9/F10 council fallback with time-lock and contest.

**PARTIAL → downgraded (verdict refuted):** "recovery through my two sponsors" — guardians are arbitrary member-chosen wallets; sponsors don't exist in admission (E1 unbuilt); at most possible by convention.

**MISSING:** WebAuthn/passkeys entirely (zero hits repo-wide); any attestation verifier or session model (the epic assumes a server; Ayni is serverless — passkeys must be reinterpreted before any code makes sense).

**CONFLICTS:**
- **Naively putting sponsor pubkeys in `Membership.recovery_keys` would record a permanent, public, minable sponsor edge** — forbidden by E2/T12. Needs blinded one-time keys handed to sponsors out-of-band, or ZK co-sign.
- Architectural mismatch (server-login assumption vs serverless wallet auth) — a reframing, not a contradiction.

**NEXT STEPS:** passkey-role decision — recommend (b) passkey unlocking a locally-encrypted keystore wrapping wallet/messaging/trust-list keys, least new surface (M); WebAuthn create/get flows (M); blinded sponsor-key handoff at issuance when E1 lands (`issue_membership` already accepts guardians — the on-chain half is essentially done) (M); threshold decision 1-of-2 vs 2-of-2 (S).

### E9 — Graphical Onboarding

**COVERED:** Semaphore-style enforcement mechanism exists (commitment not in MemberTree → no valid proof, "fails by construction"); wallet-based passwordless entry; newcomer-to-member from the web app (open self-join or Secretary hand-off). The new `activate_faucet` now supplies the "parrain funds the neophyte" machinery for step 2.

**PARTIAL:** wallet links = two hardcoded anchors (Solflare, Phantom) in `/create`, not five wallets from `docs/wallets.json` (absent) with per-platform deep links and client-side uniform shuffle; F33 stores the actual resized *photograph* (epic: on-device cartoonisation, raw photo deleted, non-anthropometric); no member bio/region fields; WingPeer is post-admission and optional, not the admission attestation.

**MISSING:** the flow itself — no `/onboarding` route, no 3-step illustrated stepper, no seed-phrase backup guidance; wallets.json + shuffle; cartoonisation model; provisional membership (admission is single-shot with immediate full voting power; seats never check membership age); one-way glass (no members-only read path exists to fail); under-10-minute measurement.

**CONFLICTS:** admission model (fiat or fully open) contradicts two-sponsor humanity proof; member data is public-internet-readable, so "provisional members can't see member data" is unenforceable in the current architecture; WingPeer edge inherited by the vouch step; F33 retains the raw photo; **F25 emails the new member's wallet address through Mailgun at exactly onboarding time** (and `/api/circle-email` has no auth or rate limiting — flagged by Sentinel too); MemberTree is append-only, so provisional must be modeled as not-yet-inserted, never insert-then-remove.

**NEXT STEPS:** `docs/wallets.json` + WalletChooser with Fisher-Yates shuffle (S); two-stage admission (M, depends E1 design); parrain-attestation instruction — named-pilot vs anonymous decision (L for anonymous); `/onboarding` stepper (M); fund-from-parrain one-tap + faucet branch (S — faucet program now exists); on-device cartoonisation (L, model selection); bio/region under E5 (L); empty-quipu finale (S, depends E3).

---

## 3. Epic 10 — what's decided vs genuinely open

| Decision | De-facto state in code | Genuinely open? |
|---|---|---|
| **Chain vs transparency log** | **Decided: Solana.** Full Anchor program (~58 instructions), devnet-deployed and upgraded, message ciphertexts anchored on-chain. But *never recorded* — BACKLOG.md still lists "Chain decision: EVM vs Solana" as ⬜ (verdict: refuted as "recorded"), and no `ProofAnchor` seam exists for a log alternative. **Conflict:** the epic says the chain holds "only proofs and quipu milestones"; today it also holds posts, messages, meetings, profiles, WingPeer edges, member counts. | Ratification + scope-of-chain ADR needed; the swappable-anchor conformance check has nothing to plug into. |
| **Quantum resistance** | Nothing. Ed25519 + BN254 Groth16 throughout; zero docs/plans (Poseidon commitments are the only hash-based piece). | **Fully open.** Needs at least an exposure doc + migration trigger (S). |
| **Phone-number registration** | **Decided: dropped.** Zero hits repo-wide; wallet-signature-only auth. | Ratify in an ADR (trivial). |
| **Pilot vs ZK admission** | **Decided: pilot first, ZK in parallel** — and the new E0 faucet code makes it explicit ("the fully anonymous form lands with Epic 2" in `activate_faucet`'s doc comment). Caveat: the shipped "pilot" is *weaker* than the epic's named-sponsor pilot — it's zero-sponsor (open) or one-role-key admission. | The pilot→ZK cutover plan and the OpenMembership reconciliation. |
| **Faucet vs fee-payer relayer** | **Decided de facto this round: faucet** (pilot form in the working tree). But the repo's documented anonymity model (voter/granter "via relayer" comments everywhere) still *requires* a relayer that doesn't exist — `zk-vote.ts` and `messaging.ts` pay from the user's own wallet. | The relayer half: hybrid is the honest answer — faucet for first gas (shipped), relayer folded into E2 to make the documented anonymity claims true. |
| **Software stewardship** | Partially answered: AGPL-3.0, CODE_OF_CONDUCT, SECURITY.md, F29 treasury-must-be-multisig, F34 federation governance. **But program upgrade authority is one person's keypair** (BACKLOG open item: authority → multisig, genesis key in MPC). | Open: stewardship ADR + the concrete authority-to-multisig move (machinery exists in `lib/multisig.ts` / `scripts/create-multisig.js`). |

**Recommended:** write all five ADRs in `docs/decisions/` now (S, days) — the backlog's own Phase 0 blocks on them, and three of five are just ratifying what the code already did.

---

## 4. Sentinel readiness

**Status: Round 1 has already run** (2026-08-10, commit `aea1438`): the agent is installed at `.claude/agents/sentinel.md`, and it produced `reports/sentinel/NRR-2026-08-10-1.md` (+ `latest.md`) and `docs/shipped.md` (the spec's fallback "create by inspecting the codebase" worked).

**What exists / what Round 1 could do:**
- No native toolchain on the host (no cargo/anchor/solana/node/circom) — everything ran in Docker (`rust:1-slim`, `node:20-alpine`) against an isolated copy.
- `cargo check --workspace --all-targets` passes (type/borrow-checks the program incl. the new faucet code; not a BPF build, no `.so`).
- Frontend: `tsc --noEmit` and `next build` pass, 13 routes.
- `tests/jazzicon.ts` (pure unit) passes 8/8; all Anchor suites (`ayni`, `cosign`, `resilience`, `profile`, `vote`) need `solana-test-validator` — not runnable this round; `f28-election.ts` is a devnet script needing a deployer keypair.

**Verified absent (spec assumptions that don't hold):** `tests/sentinel/{checklist.yaml,baselines,fixtures}`; npm scripts `test:e2e`/`test:api`/`test:adversarial` (root has only lint; frontend only dev/build/start/lint); Playwright is a frontend devDependency but completely unwired (no config, no specs); `packages/proofs` (circuits live in `circuits/*.circom` with manual snarkjs steps); `.github/workflows/sentinel.yml`. Also **`ci.yml` is stale** — pinned Solana 1.18.26 / Anchor 0.30.1 while the repo is on Anchor 0.31.1 / Agave 2.3.13.

**Structural warning for Layer D (adversarial "DB-dump" assertions):** the "database" here is the public chain + localStorage. Three flagship assertions would fail today *by architecture, not by bug*: sponsor edges ARE recoverable (WingPeer, and now the faucet-activation tx), a member roster IS derivable (public Membership accounts + `member_count`), and who-messaged-whom IS partially visible (F32 recipient + fee-payer). Tell the team before wiring the suite, or its first run is all red for known reasons.

**Shortest path to the next meaningful round:** (1) fix `ci.yml` toolchain pins — S; (2) get platform-tools/validator into the Sentinel Docker path so `anchor build` + `anchor test` run, covering the new faucet code — M; (3) `tests/sentinel/checklist.yaml` seeded from `docs/shipped.md` + baselines — M; (4) wire Playwright behind `npm run test:e2e` with first specs (/me join, board, inbox) — M; (5) an honest Layer D chain-assertions suite with the three known-red architectural findings marked expected — M. `test:api` stays N/A until a members-only API layer (E5) exists.

---

## 5. Recommended build sequence

**Phase 0 — decisions & ground truth (days)**
- ~~docs/shipped.md~~ — done (Sentinel Round 1).
- Five ADRs in `docs/decisions/` (chain scope, quantum, phone, pilot→ZK cutover, stewardship) + first-gas hybrid note ratifying the shipped faucet — **S**, blocks everything per the backlog's own sequencing.
- Source the **Emerald correspondence table** from the fellowship (external; blocks E3/E4).
- Fix `ci.yml` toolchain pins — **S**.
- Upgrade authority → multisig — **M** (stewardship ADR).

**Phase 1 — pilot trust loop (weeks)**
- ~~E0 faucet program~~ — done in working tree; remaining: commit, build, **test suite, devnet deploy** (S), faucet UI in admin + parrain one-tap (M), treasurer encrypted off-chain ledger — never WingPeer, never on-chain (M).
- E1 named pilot: `attest_admission` + two-attestation issuance + provisional membership (deferred merkle insert) + attestor good-standing checks (M+M+S); OpenMembership reconciliation (S, policy).
- E9 skeleton: `docs/wallets.json` + shuffled WalletChooser (S), `/onboarding` 3-step stepper consuming E1 attestation + E0 fund/faucet choice (M).
- E3 step tokens: `docs/quipu.md` (S, after Emerald table), StepToken PDA + WingPeer-gated issuance with issuer field dropped/blinded (M), frontend labels (S).
- Sentinel items (2)–(5) above.

**Phase 2 — the anonymity turn (months)**
- E2: vouch circuit decision (S — reuse of `member_vote` makes it near-free), `vouch_member` + tally (M), recent-roots ring buffer (M), admission wiring (M), good-standing member set (L), **multi-party ceremony** (M, pre-mainnet gate).
- **Relayer service** (M) — shared by E0 anonymous form, E2, E7 interim, and making the repo's already-documented voter/granter anonymity true.
- E5: visibility schema (S), per-tier key architecture on the messaging substrate (L), off-chain read-path proof verification (M).
- E7: transport architecture decision (M) then off-chain messaging build (L); encrypted trust list (S); F32 sunset plan (M).
- E8: passkey-as-local-keystore decision + WebAuthn flows (M+M).

**Phase 3 — the visible surface (after Phase 2 lands)**
- E4 trust page: member data layer + `/member/[commitment]` (L), quipu render with no-counts regression (M), service history (M), presence attestation circuit (L), `Membership.level` migration off the public page (M).
- E6: stone-mark draw tool (S), avatar into E5 profile object (S), silhouette rendering policy (S).
- E9 completion: on-device cartoonisation (L), bio/region under E5 (L), empty-quipu finale (S).
- E1/E0 anonymous forms replace the named pilots (L, on E2).
- Resolve the standing privacy debt: WingPeer edge off-chain/blinded, `ProgressToken.issuer` removed, F25 wallet-address emails, F30/F32 metadata — each is a live CONFLICT above.

---

## 6. BACKLOG.md addendum draft

```markdown
## Trust Platform epics (backlog/AHA_Trust_Platform_Backlog.md)

New product backlog (Epics 0–10) mapped against the shipped F-series. Statuses
verified against code, 2026-08-10 (gap analysis + Sentinel Round 1,
`reports/sentinel/NRR-2026-08-10-1.md`). Named-pilot forms count as 🟡; the
anonymous forms (Epic 2 machinery) are the ✅ bar.

| Epic | Title | Status | Maps to / builds on | Notes |
|---|---|---|---|---|
| E0 | Faucet — first gas for the neophyte | 🟡 | **F35 (new)**: `init_faucet`, `set_faucet_amount`, `activate_faucet`, `refill_faucet`, `FaucetJar`; rides F17 treasury, F6 member votes, WingPeer | Program side implemented (pilot, parrain=WingPeer, on-chain cap, vote-bound refill, one-grant-ever nullifier). Missing: tests, devnet deploy, UI, treasurer encrypted off-chain ledger, anonymous form (E2). Pilot limitation: activation tx links parrain↔neophyte wallets. |
| E1 | Two-sponsor admission | ⬜ | F4/F31/F5 are substrate, not coverage — F4 is seat-gated issuance, not peer vouching | Needs `attest_admission`, two-attestor gate, provisional membership (defer merkle insert). **Conflict:** F31 open self-join contradicts two-sponsor entry; Secretary signer is a public admission edge. |
| E2 | Zero-knowledge vouch-proofs | ⬜ | Substrate ✅ and devnet-proven: `member_vote.circom` + real VKs (F6/F28), `lineage_grant` nullifiers (F12), credential-consume (F5), browser prover | New: `vouch_member` + tally, recent-roots buffer, good-standing set, **relayer service**, fellowship anchor, multi-party ceremony (mainnet gate). |
| E3 | Quipu — physical / data model | 🟡 | Wave-2 `ProgressToken` + `WingPeer` | Chips are day-counts, not Steps 1–12; no alchemical mapping; Emerald table NOT in repo (external input). **Conflict:** `ProgressToken.issuer` records a named seat wallet. |
| E4 | Quipu page (trust page) | ⬜ | `/me` MentorshipCard (no-sums rendering ✓), F33 profile (device-local) | No visitable member page, bio, service history, or presence attestation. **Conflict:** `Membership.level` is a public comparable rank. |
| E5 | Per-element visibility | ⬜ | Templates only: `ack_disclose`/`verify_disclosure` (F14), `member_vote` proofs, F32 key registry | All existing proof checks are on-chain write-path and mint public records — read-path must verify off-chain. **Conflict:** F30 board + disclosed owners are public-internet visible. |
| E6 | Avatar / stone-mark | 🟡 | F33 (upload, local-only), F20 Jazzicon fallback | No draw tool, no disclosure path; gated on E5. F20 "avatar everywhere" demoted to key-fallback. |
| E7 | Encrypted messaging (off-chain) | 🟡 | F32 v2 (E2E ✅, sealed record ✅) | **Conflict:** epic requires fully off-chain; F32 is on-chain with public recipient/timing/fee-payer metadata. F32 ✅ stands for its own spec, not E7's. Needs off-chain transport, ratcheting, encrypted trust list. |
| E8 | Passkeys + sponsor recovery | 🟡 | F11 guardians (≤2, at-issuance) + F9/F10 council fallback cover human recovery | WebAuthn: zero code. Sponsor binding blocked on E1; sponsor keys must be blinded (raw keys in `recovery_keys` would record a public sponsor edge). |
| E9 | Graphical onboarding | 🟡 | F22 wallet entry, F31 join flows, F33 profile; E0 faucet supplies the fund step | No `/onboarding` route, wallets.json/shuffle, cartoonisation, or provisional status. **Conflict:** F25 emails newcomer wallet addresses at join time. |
| E10 | Open decisions | 🟡 | De facto: chain=Solana, phone=dropped, pilot-first, faucet-first-gas (E0). Open: quantum, stewardship (authority still a single key) | Write ADRs in `docs/decisions/`; retire the stale "Chain decision ⬜" row above. |

**Standing privacy debt raised by this backlog (pre-dates it, needs scheduling):**
`WingPeer` public sponsor edge · `Membership.level` public rank ·
`ProgressToken.issuer` named attester · F25 wallet-address emails ·
F30/F32 named-wallet metadata · relayer anonymity documented but not implemented
(`zk-vote.ts`/`messaging.ts` pay from the user's own wallet).
```
