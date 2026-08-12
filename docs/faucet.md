# Ayni — gas faucet (first gas for the neophyte)

Trust Platform **Epic 0**: each Circle operates a faucet that grants a newly
admitted member a small amount of SOL, **one single time, ever**, so they can
pay their first transaction fees. Activated on an endorsement from the neophyte's
own sponsor (their WingPeer), tuned by the Treasurer within a program-enforced cap, refilled
only by an anonymous member vote.

## Two activation paths — and why

The faucet shipped with `activate_faucet`, where the **parrain signs**. That put
the parrain's wallet, the parrain's commitment, the neophyte's commitment, the
neophyte's wallet and a transfer between the two parties in one public
transaction: the **named sponsor edge** that Epic 2 exists to abolish, published
by us (Sentinel R2). It was the sharpest Traditions tension in shipped code.

`activate_faucet_zk` replaces it. The endorsement is a **Groth16 proof instead
of a signature**, and the transaction contains no parrain account, no parrain
wallet, no parrain signature and no transfer between members.

**F35-R2 — what changed in this round.** F35 as first shipped proved only *"some
member of this Circle's tree endorses"*. That dropped the one structural property
the named path had: `establish_wing_peer` refuses `mentee == wing`, so a member
could never serve themselves. An anonymous "some member" proof let an admitted
neophyte endorse their **own** first gas — the ceremony became optional in code,
not merely in spirit. It is now closed. The proof's `root` must equal
`single_leaf_root(wing_peer.wing)` — a depth-20 Merkle root the **program**
computes from the bond's own `wing` commitment, with a single leaf and zero
siblings — so the only witness that satisfies it is a secret `s` with
`Poseidon(s) == wing`. **Mandatory sponsorship is restored, with no sponsor
account and no sponsor wallet in the transaction, and with no new circuit and no
new trusted setup.** The circuit constrains only `root === cur[depth]` and never
learns which set `root` denotes, so 100% of that meaning lives in the program's
root check; repointing it is a program-side change and nothing else.

| | `activate_faucet_zk` (**preferred**) | `activate_faucet` (**deprecated**) |
|---|---|---|
| Endorsement | ZK proof: **the neophyte's own wing** (F35-R2) | signature of the neophyte's designated wing |
| Parrain in the tx | no account, no wallet, no signature — but the `root` argument names their **commitment** arithmetically | wallet (signer + fee-payer) **and** membership PDA |
| Fee/rent payer | the F55 relayer | the parrain |
| One-shot guard | `["faucetnull", circle, commitment]` | the **same** PDA — the two cannot be stacked |
| Amount, cooldown, rent floor, recipient | identical (`pay_uniform_grant`) | identical (`pay_uniform_grant`) |

The named path is **kept only as a fallback**: a parrain whose device holds no ZK
voting key (a membership minted before anonymous identities, or a parrain acting
from a second device) cannot produce a proof, and their neophyte would otherwise
be stranded without gas. `frontend/lib/faucet.ts` branches on
`haveVotingKey(parrain)` and takes the anonymous path whenever it can; when it
falls back, the UI says so in plain words. When every live membership carries a
device secret, `activate_faucet` can be deleted outright.

No new circuit and no new ceremony: this is `member_vote.circom` and the shipped
`VERIFYING_KEY_VOTE`, reused exactly as `prove_personhood` and
`attest_admission_zk` already reuse them.

```text
root        = the Circle's member tree (current, or in the F54 recent-roots ring)
proposalId  = SHA-256("AHA-faucet-grant" ‖ circle ‖ neophyte_commitment), top 3 bits cleared
choice      = 1 ("I endorse this grant")
nullifier   = Poseidon(secret, proposalId)     ← the circuit's public output
```

The domain tag in `proposalId` is load-bearing. `attest_admission_zk` uses the
raw newcomer commitment as its external nullifier; had the faucet reused that,
one member endorsing both would emit the **same** nullifier twice and any
observer could link the two anonymous acts. Hashing under a distinct tag makes
them independent. `faucet_external_nullifier` is property-tested
(`crate::proptests`) for determinism, in-field encoding, binding to
(circle, neophyte), and separation from the raw commitment.

## Model

- Each Circle has a **`FaucetJar`** PDA (`seeds = ["faucet", circle]`) holding
  its lamports directly on the account. The jar is its own blast radius: a
  compromised faucet loses one jar, never the treasury.
- The **endorsement** is either an anonymous member proof (preferred) or, on the
  deprecated path, the existing WingPeer bond: the neophyte designated their
  sponsor via `establish_wing_peer`, and only a signer holding that wing
  membership can trigger the named grant — no other member, no seat, no one
  (`NotParrain` otherwise). Both memberships must be unexpired.

  Be exact about what the anonymous path proves. `member_vote` knows nothing of
  WingPeer bonds, so the proof says **"a member of this tree"**, not "this
  neophyte's designated wing" — teaching it the bond would need a new circuit and
  a new trusted setup (F44). The neophyte's `WingPeer` must still exist and be
  `active`, so a member with no sponsor at all is not gassed up, but *which*
  member released the grant is not constrained to the wing. What bounds the
  consequence: the grant is still one per neophyte ever, still the uniform
  amount, still payable only to the neophyte's own `Membership.owner` wallet. An
  arbitrary member can only cause the welcome that was already going to happen.
  This is the identical trade `attest_admission_zk` made for admission.
- **One grant per membership, enforced by the program** — the grant nullifier
  PDA is `["faucetnull", circle, commitment]`, and `init` collision *is* the
  refusal, so a second application is rejected even when submitted straight to
  the program, bypassing the app.

  Be precise about the scope: this is one grant **per membership commitment**,
  which means one per member per Circle — matching Epic 0's "each circle
  operates a faucet". It is deliberately *not* fellowship-wide. A single
  fellowship-wide grant would require a member to carry the same commitment into
  every Circle, and commitments are per-membership precisely so that a member's
  Circles cannot be linked (Tradition 12). Deduplicating a *human* across
  Circles is what proof-of-personhood is for (`require_personhood`, F5) — turn
  it on if a Circle wants that guarantee. Buying anti-Sybil with a linkable
  identifier would cost more privacy than it buys.
- **Uniform grants**: every activation pays exactly `jar.grant_lamports` to the
  neophyte's own wallet (`Membership.owner`, which must be set —
  `NeophyteWalletUnset`), so grants are byte-identical on-chain and the amount
  cannot fingerprint a recipient. The jar always keeps its rent-exempt floor
  (`FaucetInsufficient` otherwise).

  Uniformity is *enforced*, not merely intended. Once a jar has paid at least
  once, changing the amount pauses grants for `FAUCET_AMOUNT_COOLDOWN` (24h,
  `FaucetAmountCooling`). Without that wait, a Treasurer could set a distinctive
  amount immediately before one neophyte's activation and restore it after —
  tagging that person's wallet with a correlatable transfer, which is exactly
  what uniform amounts exist to prevent. A jar that has never granted is simply
  being configured, so a new Circle can welcome its first member at once.
- **Treasurer tunes, the program caps**: only the Treasurer (seat 0) can change
  the per-grant amount, and only within `FAUCET_MAX_GRANT_LAMPORTS = 2_000_000`
  (0.002 SOL — the "≈ USD 0.25" absolute maximum, in lamports, no price
  oracle). Default: `FAUCET_DEFAULT_GRANT_LAMPORTS = 1_500_000` (0.0015 SOL —
  rent-exempt wallet minimum plus well over a hundred transactions).
- **Refill only by circle vote**: moving treasury funds into the jar requires a
  **passed anonymous member vote** (F6) whose `description_hash` commits to
  exactly this refill:

  ```
  description_hash = sha256("AHA-faucet-refill" || circle_pubkey || amount_le_u64)
  ```

  (same domain-separation pattern as the F28 `election_hash`). Execution is then
  permissionless, and a one-shot marker PDA (`["faucetfill", proposal]`) makes a
  passed proposal spendable exactly once — a refill can never be replayed to
  drain the treasury into the jar.

## Flow

| Instruction | Who | Effect |
|---|---|---|
| `init_faucet()` | any Council seat | create the jar (once); starts at the default grant amount, holding only its own rent — fund it by plain transfer or voted refill |
| `set_faucet_amount(lamports)` | Treasurer only | tune the per-grant amount; `0 < lamports ≤ FAUCET_MAX_GRANT_LAMPORTS`, enforced on-chain (`FaucetCapExceeded`) |
| `activate_faucet_zk(root, nullifier, proof)` | **preferred** — anyone holding a member proof, submitted by the relayer | one-time grant of exactly `grant_lamports` to the neophyte's wallet; nullifier PDA spent; the relayer pays fee + nullifier rent |
| `activate_faucet()` | **deprecated** — the parrain (the neophyte's WingPeer) | same grant, but the parrain signs and pays, publishing the sponsor edge; fallback only |
| `refill_faucet(amount)` | anyone, after a member vote passed | verify the proposal is finalized+passed and its hash commits to (circle, amount) → treasury PDA transfers `amount` into the jar; one-shot marker |

## Accounts

- **`FaucetJar`** `{ circle, grant_lamports, granted, bump }` —
  `["faucet", circle]`; lamports live on the account; `granted` counts
  activations.
- **Grant nullifier** — `Nullifier {}` marker at
  `["faucetnull", neophyte_commitment]` (global — one per identity, ever).
- **Fill marker** — `Nullifier {}` marker at `["faucetfill", proposal]`
  (one per passed refill vote).

In `activate_faucet`, the WingPeer account is seed-bound to the *neophyte's*
commitment (`["wingpeer", circle, neophyte_commitment]`) so it can't be swapped
for someone else's bond, and it must be `active` with
`wing == parrain_membership.commitment`. The parrain must sign with a key of
that wing membership (`is_member_key`); the recipient account must equal the
neophyte membership's `owner` (`WalletMismatch` otherwise).

`activate_faucet_zk` takes the same WingPeer account and reads **only** `active`
— it never touches `wing` and never compares it to anything. Its account list is
`circle, member_tree, recent_roots?, neophyte_membership, wing_peer,
grant_nullifier, jar, recipient, payer, system_program`: exactly one membership
(the neophyte's) and exactly one signer (the fee-payer, whose signature can only
ever mean "paid the fee"). `tests/faucet.ts` asserts that shape directly — the
parrain's membership PDA and wallet must be absent from the built instruction —
so a future edit that reintroduces a parrain account fails a test, not a review.

**No vouch-nullifier PDA is written**, deliberately. It would be redundant (the
proof is bound to (circle, neophyte), whose `faucetnull` PDA is `init`-once, so a
replayed proof cannot pay twice) and it would be a small privacy *loss*: a
`getProgramAccounts` sweep would then enumerate every anonymous endorsement per
Circle.

## Traditions

- **T7 (self-supporting)** — the faucet is circle-level mutual aid, funded from
  the Circle's own treasury or direct donations; nothing external is solicited.
- **T2 / T9 (trusted servants, not governors)** — the Treasurer *tunes* within a
  cap the program itself enforces and can *watch* the jar, but cannot refill it:
  moving common funds is the whole membership's group conscience, one member one
  anonymous ballot.

## Epic 0 conformance

Checked story-by-story against `backlog/AHA_Trust_Platform_Backlog.md` (v0.1,
August 2026). ✅ = in line, 🟡 = deliberate deviation (reason given), ⬜ = not
built yet.

| Epic 0 requirement | Status | How / why |
|---|---|---|
| Parrain activates, exactly once, no one else | ✅ | Named path: `activate_faucet` requires a signer holding the wing membership of the neophyte's own `WingPeer`; verified by `tests/faucet.ts` (imposter member, non-wing seat both refused). Anonymous path (F35-R2): "exactly once" is unchanged (same nullifier PDA) and "no one else" is **restored** — the proof must be made against `single_leaf_root(wing_peer.wing)`, so only the holder of the wing's secret can produce it. Verified by `tests/faucet.ts` §7a: the member-tree root, an unrelated member's tree-of-one, and the neophyte's own tree-of-one are all refused with `EndorsementNotByWing`, and only the wing's root reaches the pairing. It does **not** prove the wing is still in the member tree — see "good standing" below |
| One grant enforced on-chain via nullifier tied to the identity commitment | 🟡 | Enforced (`init` collision is the refusal) — but scoped `["faucetnull", circle, commitment]`, i.e. **one grant per membership per Circle**, not "ever" fellowship-wide. The epic's "ever" is unimplementable without a linkable cross-Circle identifier, which is exactly what Tradition 12 / Epic 2 forbid; fellowship-wide dedup belongs to proof-of-personhood (F5, `require_personhood`) |
| Treasurer is the only role able to modify the amount, within the absolute on-chain maximum | ✅ | `set_faucet_amount` gates on seat 0; `FAUCET_MAX_GRANT_LAMPORTS = 2_000_000` enforced by the program, not the UI |
| Cap set at top-circle level, revised each equinox by top-circle vote | 🟡 | The cap is a program constant; revision = a governed program upgrade rather than a top-circle vote account. Same authority in practice (the upgrade key is governance-held); a dedicated top-circle cap PDA is future work if the fellowship wants vote-legibility for cap changes |
| Treasurer sees jar balance anytime; calls a circle vote to refill from treasury | ✅ | Balance is the jar PDA's lamports (admin panel shows it); refill only via a passed anonymous member vote (F6) hash-bound to `(circle, amount)`, one-shot, and additionally capped at `FAUCET_MAX_REFILL_GRANTS` grants' worth |
| Treasurer reviews transactions via one-time pseudonymous codes, encrypted off-chain, treasurer-only | ✅ (pilot) | Built: at activation the parrain's client generates two one-time codes, seals a fixed-size entry (codes, amount, day — nothing else) to the treasurer's published messaging key, and delivers it to the `/api/faucet-ledger` drop-box after an independent random delay. Only the treasurer's signature-derived key opens entries; the panel reconciles by count against the jar's `granted`. See `lib/faucetLedger.ts` for the model and its honest limits (drop-box arrival times exist server-side; jitter blurs, the Epic 10 relayer erases) |
| Default 0.0015 SOL, max ≈ USD 0.25 | ✅ | `FAUCET_DEFAULT_GRANT_LAMPORTS = 1_500_000`, cap 2_000_000 |
| Per-circle jar caps the blast radius; a compromised faucet loses one jar, not the treasury | ✅ | Jar lamports live on the jar PDA; `tests/faucet.ts` proves jar isolation across two circles and that treasuries are untouched |
| Uniform grant size (anonymity mitigation) | ✅+ | Enforced beyond the spec: once a jar has paid, an amount retune pauses grants for 24h (`FAUCET_AMOUNT_COOLDOWN`), so a Treasurer cannot aim a distinctive amount at one neophyte |
| Randomized disbursement timing (anonymity mitigation) | 🟡 | Pilot form: the parrain's client waits a random 15–120 s before sending the grant, and the ledger entry travels on its own independent 1–7 min delay, so tx and ledger cannot be lined up. Tab-bound and therefore weak — real timing privacy is the Epic 10 relayer |
| Audited and fuzzed before mainnet (fold into Sentinel Layer C) | 🟡 | Three-lens adversarial review done this round (3 findings fixed: refill ceiling, cooldown, nullifier scope); formal audit + fuzzing before mainnet still required, tracked in `tests/sentinel/checklist.yaml` |
| Parrain attestation via Epic 1; "a pilot version can use named-pilot attestations" | ✅ | The sanctioned pilot has been **superseded**: `activate_faucet_zk` is the Epic 2 ZK form, and the named WingPeer attestation survives only as the no-voting-key fallback |

## What an observer can and cannot infer

Adversarially, for an activation that took the **anonymous** path through the
relayer. "The observer" is anyone with the full chain plus the ability to derive
every PDA — which is everyone.

**Learned from the transaction:**

- the Circle, the neophyte's commitment, and the neophyte's wallet (it receives
  the lamports; the recipient must equal `Membership.owner`);
- that the neophyte's **designated wing** endorsed the grant — and **which
  commitment that is**. Since F35-R2 the `root` argument is
  `single_leaf_root(wing_peer.wing)`, a deterministic public function of a
  commitment that is itself world-readable in `WingPeer`, so anyone can
  precompute it over the commitment set and read the endorser off the
  transaction. The endorsement's commitment-level anonymity set is **1**;
- the value `Poseidon(secret, proposalId)`;
- that the *relayer* paid, plus the block time.

**NOT learned:**

- any **wallet** belonging to the endorser. None appears: no membership account
  of theirs, no signature, no lamport transfer, and the program asserts nothing
  about the payer. **This is the F35 win and it survives F35-R2 intact** — the
  wallet-level sponsor edge, which is the link that deanonymises a person rather
  than a commitment, is still abolished on this path;
- any link between this endorsement and the same member's other anonymous acts
  — the ballot nullifier (per proposal), the admission-attestation nullifier
  (per newcomer) and this one (domain-tagged) are three independent Poseidon
  outputs of the same secret. One attributed sample of the wing's nullifier
  function under one domain tag reveals nothing about their ballots,
  attestations, personhood or visit passes;
- that the wing is currently **in good standing**. The proof binds to a
  commitment frozen at bond time, not to the member tree — see the good-standing
  note below.

> **Baseline change, stated loudly.** Before F35-R2 this section said the
> anonymity set was *"every leaf of the member root"* and that *"whether the
> endorser was the neophyte's actual wing"* was **not** learned. Both are now
> false, deliberately. You cannot have "the program enforces that the wing
> endorsed" without the chain recording that the wing endorsed; restoring
> mandatory sponsorship **is** the decision to publish that fact. What is traded
> is a *guess* becoming a *record* at the commitment layer — the WingPeer bond
> already named the wing to anyone who looked. What is **not** traded is
> anything at the wallet layer.

**Residual correlations — stated, not waved away:**

1. **The sponsor edge is public at commitment level, and since F35-R2 the
   endorsement is a record of it rather than a guess.** `["wingpeer", circle,
   neophyte]` is derivable from the neophyte commitment and world-readable, so
   the *edge* was already published independently of the faucet — that is **F27 /
   Sentinel R2**, and it stands until Epic 2 retires the public bond. What
   F35-R2 adds on top is a **liveness/timing record**: cryptographic evidence
   that the holder of that commitment's secret was alive, key-holding and acting
   at that slot. Two further honesties:
   - the *edge* is published even more durably than `WingPeer` itself.
     `establish_wing_peer` is `init_if_needed` and mentee-signed, so the account
     only ever shows the **current** wing; a wing-derived `root` in ledger data
     names the wing **at that instant, forever**, surviving a re-point or a
     closure. That is a permanent historical sponsor record the account layer
     deliberately does not keep;
   - the common claim that "the sponsor's wallet is derivable in one hop anyway,
     via `["membership", circle, wing]` → `owner`" is only *conditionally* true:
     it fails for a fully anonymous wing whose `owner` is unset. For that member
     F35-R2's disclosure is not covered by a pre-existing derivation.

   **F27 forward-compat trap.** After F27 retires the public bond, this `root`
   would still *arithmetically* name the wing, re-introducing by computation
   exactly the leak F27 removes — in immutable ledger data no later work can
   retract. F27 must replace this check with an in-circuit proof of the bond
   (**F44**) in the same change, or it silently regresses.
2. **The relayer sees IP + timing.** It cannot see who acted (no member
   signature ever reaches it) or the proof's witness, but it observes "someone
   at this IP caused a faucet activation at 12:03". Batching/mixing is the
   documented next step (`docs/messaging-migration.md` §3). With **no** relayer
   configured the client self-pays and the fee-payer wallet is on chain — still
   far weaker than the named path (no parrain membership account, no assertion),
   but a correlation, and the UI must not pretend otherwise.
3. **Faucet-funded wallets remain visibly fellowship-adjacent.** A wallet whose
   first inbound lamports came from a Circle's jar is marked as *a* member of
   *that* Circle. Uniform amounts stop the *size* from fingerprinting a
   particular person; they cannot hide the jar. The clean fix is the ADR 0005
   hybrid — gas paid by relayer rather than granted — for members who need it.
4. **A landed proof is public and reusable.** If an activation fails after
   execution begins (empty jar), its proof bytes are on chain and anyone may
   resubmit them later. That can only cause the exact grant the prover already
   authorised, to the recipient they already fixed; the degree of freedom is
   *timing*. Accepted: adding a vouch-nullifier PDA to close it would cost a
   second rent-exempt account per grant and would make endorsements enumerable.
   Since F35-R2 such a re-submittable proof is also trivially *attributable* (its
   `root` names the wing), which changes nothing about what it can cause.
5. **Timing.** F48's 15–120 s client jitter is tab-bound and weak; the treasurer
   ledger travels on its own 1–7 min delay so the two cannot be lined up.

### The capability that changed hands — and came back (F35-R2)

F35 as shipped lost a property the named path had. The named path could not be
self-served (`establish_wing_peer` refuses `mentee == wing`, so the signer was
always someone else); an anonymous "some member of the tree" proof could not tell
*"my sponsor endorsed me"* from *"I endorsed myself"*, so a confirmed member
could take their own first gas without waiting for anyone.

An earlier revision of this document asserted that restoring the ceremony in-band
*"needs a circuit that proves the WingPeer bond, which needs a new trusted setup
(F44)"*. **That was wrong, and F35-R2 refutes it.** The bond does not have to be
proved *inside* the circuit, because the circuit never says what `root` means:
`member_vote.circom` constrains only `root === cur[depth]`, leaving the prover
free to choose a root — which is worthless once the **verifier** fixes the target.
Pinning `root` to `single_leaf_root(wing_peer.wing)`, a value the program folds
from data it already holds, makes the only satisfying witness a secret whose
Poseidon image is the wing's commitment. Same circuit, same `VERIFYING_KEY_VOTE`,
same ceremony, unchanged instruction shape. F44 stays out of scope.

**Claim exactly this much, and no more.** What is restored is that *a capability
held by a commitment other than the neophyte's must be exercised.* What is **not**
restored, and never existed on either path:

- **sincerity.** A mentee can re-point their own bond (`establish_wing_peer` is
  `init_if_needed` and mentee-signed) at a second membership whose secret they
  hold, and endorse from that. The named path had the identical sock-puppet — the
  attacker signs with the puppet's wallet instead. Bounded by the **membership
  door** (`require_personhood`, closed admission, two-sponsor), never by the
  endorsement;
- **good standing.** `wing_peer.wing` is frozen at bond time and the wing root is
  not epoch-scoped, so `begin_member_epoch` — whose whole purpose is that stale
  roots stop authorising things — no longer constrains this instruction. An
  expired, revoked or not-yet-reinserted wing can endorse. **A `provisional`
  commitment can too**: `issue_provisional_membership` writes a `Membership` at
  the same PDA while deliberately *not* inserting into the member tree, and
  `establish_wing_peer` accepts any `Membership` of the Circle as a wing. Under
  F35-as-shipped a provisional could not endorse (the tree *was* the gate); now
  it can. This is **parity with the deprecated named path**, which never checked
  the tree either, but it is a real loosening against the *previous ZK path*, and
  it is **descoped for this round, not overlooked.**

  Bounded loss in every one of those cases: one uniform, one-time grant to the
  neophyte's **own** wallet, with the neophyte's own membership still required to
  be unexpired. Do **not** "fix" it by passing the wing's `Membership` to re-check
  standing — that is the single move that puts a sponsor account back into the
  transaction and hands back the F35 win. The wallet-free tightenings, neither
  taken here: require the `EpochLeaf` PDA (`issue_membership` mints none, so it
  would strand every directly-issued sponsor), or a two-proof/equal-nullifier
  construction (same circuit, ~250–280k CU, which needs a `ComputeBudget`
  instruction the relayer cannot currently send).

**Liveness cost, which is real.** The wing is now a single point of failure for
the neophyte's first gas, and their ZK secret is device-bound (for a legacy
CSPRNG identity, not shard-recoverable). F35's escape hatch — *any* tree member
can activate — is gone by design. The remaining fallback is the deprecated named
`activate_faucet`, where the wing signs with a **wallet** key, which *is*
recoverable through F9/F10/F11 guardian/Council migration; the price is that it
re-publishes the sponsor wallet edge for that grant, and the UI must say so before
the wing takes it. Note what is **not** a fallback: re-pointing the bond.
`establish_wing_peer` is signer-paid and is not on the relay allowlist, so a
neophyte with an empty wallet cannot afford the transaction that would unblock
their own first gas.

**One new failure mode.** Because the mentee can re-point the bond at any moment,
they can invalidate a proof the wing has already generated or relayed. It harms
only the mentee, but the client must refetch `wing_peer.wing` immediately before
proving rather than trusting cached state (`frontend/lib/faucet.ts` does).

## Pilot limitations (honest)

- ~~**The activation tx publicly links the parrain's wallet to the neophyte's
  wallet.**~~ **Fixed** by `activate_faucet_zk` (F35 → Epic 2): the preferred
  path names no parrain at all. Two things survive and are described in full
  above — the *commitment*-level sponsor edge that the public `WingPeer` record
  publishes independently of the faucet (F27 / Sentinel R2), and the deprecated
  named path, which still leaks everything it always did and is taken only when
  the parrain's device holds no ZK voting key. Whether the circle should pay gas
  through a fee-payer relayer instead of granting it — so no funding transfer
  appears on chain at all — remains the **ADR 0005** hybrid position.
- **A fully anonymous member (no `Membership.owner`) still cannot be reached.**
  Both paths refuse `owner == Pubkey::default()` (`NeophyteWalletUnset`): the
  grant needs somewhere to land. First gas therefore remains available only to
  members who have bound a wallet. That is E0's remaining item, not something an
  endorsement proof can decide.
- **The ledger drop-box is a trusted-but-blind server.** Entries are sealed
  end-to-end (the server cannot read codes or amounts) and carry no identities,
  but the server process necessarily observes arrival order and times. The
  client-side delivery jitter blurs that channel; the Epic 10 relayer decision
  is what would remove it. The treasurer-key model also trusts seat 0's wallet
  (rotatable by circle vote, as the epic requires).
- **Faucet-funded wallets are visibly fellowship-adjacent** to any outside
  observer of the chain. Uniform grant size blunts fingerprinting; the clean
  fix is the same Epic 10 relayer decision.
- **A Circle running open membership without personhood can drain its own jar.**
  With `OpenMembership` on and `require_personhood` off, one person can mint
  many memberships, make them each other's wings, and claim a grant per
  commitment. This is bounded by design — the blast radius is one jar, never the
  treasury, and the refill ceiling bounds how fast a jar can be refilled — but a
  Circle that wants the faucet to mean "one human, one grant" should turn
  `require_personhood` on (F5). Epic 0's own answer is the same: the per-Circle
  jar is what caps the damage.

  The anonymous path does not widen this, and it is worth being exact about why.
  Since F35-R2 it no longer relaxes "only the wing may release the grant" at all;
  and even when it did, the sock-puppet attack never needed that relaxation — the
  attacker already controlled both sides of the bond. What F35-R2 *does* widen
  here is who may be a sock-puppet wing: with the member tree no longer consulted,
  a **provisional** membership qualifies, where before it did not (parity with the
  named path, which never checked the tree either). The binding constraints are
  unchanged: one grant per commitment, and a commitment costs a membership. The
  membership door (personhood / closed admission) is what bounds the faucet; the
  endorsement never was.
