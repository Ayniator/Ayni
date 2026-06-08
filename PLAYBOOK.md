# Ayni Playbook

*How we build, test, review, govern, and operate **Ayni** — the Solana
implementation of **AHA (Ancestral Humanity Anonymous)**.*

This is the operational companion to the design docs. Read `PROJECT.md` for the
*what and why*, `SECURITY.md` for the threat model, and `BACKLOG.md` for open
risks. This file is the *how*.

> **Two names, kept separable.** **AHA** is the chain-agnostic fellowship (its
> Traditions, roles, rules). **Ayni** is this codebase — one implementation of
> AHA. When you change Ayni, never quietly change the definition of AHA; raise
> that as a proposal.

---

## 1. Orientation — read in this order

| If you want to… | Read |
|---|---|
| Understand the fellowship & its principles | `PROJECT.md` |
| Build and test the program | `BUILD.md`, then §3 below |
| Understand the threat model & deploy gates | `SECURITY.md` |
| See what's still open / risky | `BACKLOG.md` |
| Work on the privacy circuits | `circuits/README.md`, `docs/zk-lineage.md` |
| Understand a specific subsystem | `docs/` — `resilience.md`, `sybil.md`, `treasury.md`, `member-voting.md`, `acknowledgments.md` |
| Know how we treat each other | `CODE_OF_CONDUCT.md` |

---

## 2. Principles that constrain the code

These are non-negotiable. A change that violates one is wrong even if it compiles
and passes tests.

1. **No tradeable token, ever.** Membership is soulbound / non-transferable. No
   liquidity, price, or market. (Non-goals, `PROJECT.md` §9.)
2. **One member, one vote.** No mechanism may grant weighted voice. No whales.
3. **Anonymity is a hard requirement.** ZK roots are read on-chain, never
   caller-supplied; nullifiers prevent replay; metadata must not re-link a
   member. Prefer designs that *can't* leak identity over ones that merely
   *don't today*.
4. **No single point of failure.** Every privileged key is recoverable by the
   7-seat Council (4-of-7 + time-lock + contest). Don't add an irrecoverable
   authority.
5. **Fail closed.** Overflow panics, missing/placeholder verifying keys must
   reject, weaker access passes must land at a different PDA. When in doubt,
   reject.
6. **Each Circle autonomous.** Local recovery never depends on World Service.
   Don't introduce cross-Circle coupling that breaks Tradition 4.

If a task seems to require breaking one of these, **stop and open a proposal** —
it's a governance decision, not an implementation detail.

---

## 3. Build, test, ship

### Toolchain (pinned)

- **Solana / Agave** and **Anchor** versions are pinned in `scripts/setup.sh`
  and enforced in CI (`.github/workflows/ci.yml`).
- The repo is mid-migration to **Anchor 0.31 / Agave 2.x** (see recent commits
  and `BACKLOG.md`); `BUILD.md` may still reference the older pins — trust
  `scripts/setup.sh` as the source of truth.

### The three commands

```bash
make setup   # idempotent: Rust + Solana CLI + Anchor + JS deps
make build   # anchor build -> BPF .so + IDL + target/types/ayni.ts
make test    # anchor test  -> local validator, the no-ZK suites
```

Put the Solana bin dir on PATH after setup:

```bash
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
```

(Equivalently: `scripts/setup.sh` / `build.sh` / `test.sh` directly.)

### What `make test` covers today (no circuits required)

| Suite | Exercises |
|---|---|
| `tests/ayni.ts` | init Circle + member tree + issue membership |
| `tests/resilience.ts` | 7-seat Council: 4-of-7, time-lock, any-seat contest |
| `tests/cosign.ts` | member co-signature & self-recovery (2 guardians) |

These are the real compile-verification of the Council / recovery / membership
instructions. **Every change must keep these green.**

### Lint

```bash
npm run lint       # prettier --check on JS/TS
npm run lint:fix   # apply formatting
```

### The ZK suites (gated on a green build)

`cast_vote`, `grant_level`, `issue_acknowledgment`, `verify_disclosure`,
`prove_personhood` need compiled circuits + trusted-setup keys before they can be
tested. Order of operations:

1. Compile a circuit and run a (local, single-contributor) ceremony — start with
   `member_vote` (simplest). See `circuits/README.md`.
2. Regenerate the matching `programs/ayni/src/verifying_key*.rs` via
   `scripts/vk_to_rust.js`.
3. Write the test using `app/**/prove.ts` to build proofs.

This is where **Poseidon compatibility** (circom ↔ light-poseidon) and the
**snarkjs → groth16-solana** byte encodings get validated for real.

---

## 4. Contribution flow

1. **Find or open an item.** Check `BACKLOG.md` and the open decisions in
   `PROJECT.md` §10 first. For anything touching the principles in §2 above, open
   a **proposal** (issue) and seek group conscience *before* coding.
2. **Branch.** Work off `solana` (current dev branch). Branch names:
   `feat/…`, `fix/…`, `docs/…`, `sec/…`. Never commit straight to `main`.
3. **Keep changes scoped and legible.** Match the surrounding style; one logical
   change per PR; update the relevant `docs/` page in the same PR.
4. **Test before you push.** `make build && make test` green locally. Add a test
   for new instructions or new failure modes — especially *fail-closed* paths.
5. **Commit messages** state the *security/behavioral* effect, not just the
   mechanics. Mirror the existing log:
   - `BACKLOG: …` for design/known-risk bookkeeping
   - `Build fixes: …`, `Build + tests GREEN: …` for toolchain/compile work
   - Prefix `feat/fix/docs/sec:` for feature work
6. **Open a PR into `solana`.** CI runs the same `build` + `test`. Fill in:
   what changed, which principle/threat it touches, what you tested, residual
   risk.
7. **Review** — see §5. Merge by maintainer group conscience after CI is green.

---

## 5. Review checklist

A reviewer is a *trusted servant* of the codebase. Before approving, confirm:

**Correctness & build**
- [ ] CI green: `make build` + `make test` pass.
- [ ] New instructions have tests, including their reject/fail-closed paths.
- [ ] No new lint regressions.

**Security invariants** (cross-check against `SECURITY.md`)
- [ ] ZK roots/commitments are read **on-chain**, never caller-supplied.
- [ ] Every ZK action spends a fresh **nullifier PDA** in its own namespace
      (replay-proof).
- [ ] Privileged actions gated by `has_one = authority`/`circle` + PDA-derived
      accounts (no cross-Circle reach).
- [ ] Access policies are **bound**: `requirements_hash` checked on-chain *and*
      part of the PDA seed (a weaker pass lands elsewhere — S1).
- [ ] Tree depths pinned to `merkle::CIRCUIT_DEPTH` (== 20) — no silent circuit
      mismatch (S4).
- [ ] No wallet may occupy two Council seats (`occupied_elsewhere` — S3).
- [ ] Counters use `saturating_add`; `overflow-checks` stays on.

**Recovery & governance**
- [ ] No new irrecoverable authority; new privileged keys are Council-recoverable
      (4-of-7 + time-lock + contest).
- [ ] Irreversible actions (wallet migration, `SetAuthority`) keep their
      time-lock + any-seat contest; reversible ones (seat rotation) may execute
      immediately.

**Principles**
- [ ] Doesn't introduce tradeability, weighted voting, or outside-money paths.
- [ ] Doesn't weaken anonymity or add metadata that re-links members.

**Anything weakening anonymity or recovery is a blocker, not a nit.**

---

## 6. The deploy gate — DO NOT SHIP WITHOUT THESE

From `SECURITY.md` operational requirements. The program is a **design-audited,
unbuilt-for-prod** artifact; these MUST hold before any mainnet deploy:

1. **Real verifying keys.** All `verifying_key*.rs` are zeroed **placeholders**.
   Run the trusted-setup ceremonies, regenerate them, and confirm the verifier
   **fails closed** with real keys. **Never deploy with placeholders.**
2. **`authority` is a multisig.** Hand each `Circle.authority` to a Squads/Realms
   governance PDA after bootstrap — never a single hot key.
3. **Genesis lineage key in MPC / governance multisig.** It roots all lineage
   proofs and has no on-chain recovery (`docs/zk-lineage.md` §7).
4. **Treasury rent-exemption.** Keep treasury PDAs above the rent-exempt minimum.
5. **Pin predicate roots.** `AccessPass` consumers must check `requirements_hash`
   against *their own* policy hash.
6. **Relayer / account-abstraction in place.** The paying address must not be the
   identity, or ZK anonymity leaks via metadata.

If any box is unchecked, the answer is **do not deploy.**

---

## 7. Operating a Circle (fellowship runbook)

The protocol mirrors the fellowship's governance. Common operations:

- **Summon a Circle.** Fork the template: new Circle account + member tree +
  treasury PDA + 7-seat Council (3 named servants — Treasurer, Secretary, Rhythm
  Keeper — + 4 elders). Pin tree depth to `CIRCUIT_DEPTH`. Draw elders from
  **distinct trust domains**.
- **Admit a member.** Issuance is gated by a trusted servant (social vouching) +
  anonymous proof-of-personhood (one membership per human per Circle). Membership
  is a **yearly, soulbound** token; renewal *is* the donation (T7).
- **Propose & vote.** Any member may propose, anonymously. Voting is anonymous
  one-member-one-vote (Semaphore-style member set + per-proposal nullifier).
- **Recover a lost key** (each action **4-of-7**):
  - *Rotate a seat* — reversible, executes immediately.
  - *Migrate a wallet* — moves **all** artifacts (seats, membership, levels)
    `walletA → walletB`; **time-locked**, and **any single seat can contest**
    during the window. Favors safety over liveness.
  - *Set authority* — rotate the issuance/config authority; time-locked +
    contestable like migration (S2).
  - *Member self-recovery / co-sign* — a member with ≤2 guardian keys can
    self-migrate (no Council, no time-lock), or require co-sign so **no Council
    majority can move their standing** without one of their keys.
- **Choose recovery parameters by scope.** World Service (foundational): long
  contest window (14–30d), elders from distinct domains. Local Circle: shorter
  window (3–7d). Local recovery never depends on World Service (T4). Details in
  `docs/resilience.md`.

---

## 8. Decisions & governance of the code itself

- **Open design questions** live in `PROJECT.md` §10. Don't silently resolve one
  in a PR — propose it, reach group conscience, then implement and tick the box.
- **Known residual risks** live in `BACKLOG.md`. If your change closes one,
  update it; if it opens one, add it.
- **Chain choice is still open** (`PROJECT.md` §7 leans EVM for the mature ZK
  stack). Ayni is the Solana track; keep AHA's definition chain-agnostic so
  another implementation stays possible.

---

## 9. Quick reference

```bash
# Build & test
make setup && make build && make test
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

# Format
npm run lint:fix && npm run lint

# Clean
make clean
```

| Thing | Where |
|---|---|
| Program source | `programs/ayni/src/` |
| Circuits | `circuits/` (`member_vote`, `lineage_grant`, `ack_disclose`) |
| VK → Rust | `scripts/vk_to_rust.js` → `programs/ayni/src/verifying_key*.rs` |
| Proof builders | `app/**/prove.ts` |
| Tests | `tests/` (`ayni`, `resilience`, `cosign`) |
| CI | `.github/workflows/ci.yml` (runs on push to `solana`) |
| Toolchain pins | `scripts/setup.sh` |

---

> *Ayni — sacred reciprocity. We build so that a member can prove what they are
> entitled to without revealing who they are, and so that no lost key, no whale,
> and no single hand can take the fellowship from the group.*
