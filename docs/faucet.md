# Ayni — gas faucet (first gas for the neophyte)

Trust Platform **Epic 0**: each Circle operates a faucet that grants a newly
admitted member a small amount of SOL, **one single time, ever**, so they can
pay their first transaction fees. Activated on an endorsement from the Circle's
own membership, tuned by the Treasurer within a program-enforced cap, refilled
only by an anonymous member vote.

## Two activation paths — and why

The faucet shipped with `activate_faucet`, where the **parrain signs**. That put
the parrain's wallet, the parrain's commitment, the neophyte's commitment, the
neophyte's wallet and a transfer between the two parties in one public
transaction: the **named sponsor edge** that Epic 2 exists to abolish, published
by us (Sentinel R2). It was the sharpest Traditions tension in shipped code.

`activate_faucet_zk` replaces it. The endorsement is a **Groth16 proof instead
of a signature** — "some member of this Circle's tree endorses first gas for
this neophyte" — and the transaction contains no parrain account, no parrain
commitment, no parrain wallet and no assertion about who they are.

| | `activate_faucet_zk` (**preferred**) | `activate_faucet` (**deprecated**) |
|---|---|---|
| Endorsement | ZK proof: a member of the member tree | signature of the neophyte's designated wing |
| Parrain in the tx | nothing | wallet (signer + fee-payer) **and** membership PDA |
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
| Parrain activates, exactly once, no one else | ✅ / 🟡 | Named path: `activate_faucet` requires a signer holding the wing membership of the neophyte's own `WingPeer`; verified by `tests/faucet.ts` (imposter member, non-wing seat both refused). Anonymous path: "exactly once" is unchanged (same nullifier PDA), but "no one else" relaxes to *any member of the tree* — the price of not naming the parrain, since `member_vote` cannot prove a WingPeer bond without a new ceremony (F44). The bond must still exist and be active |
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
- that a member of that Circle's tree endorsed the grant, and the value
  `Poseidon(secret, proposalId)`;
- that the *relayer* paid, plus the block time.

**NOT learned:**

- **which** member endorsed. The anonymity set is every leaf of the member root
  the proof was made against;
- any wallet belonging to the endorser. None appears, and the program asserts
  nothing about the payer;
- any link between this endorsement and the same member's other anonymous acts
  — the ballot nullifier (per proposal), the admission-attestation nullifier
  (per newcomer) and this one (domain-tagged) are three independent Poseidon
  outputs of the same secret;
- whether the endorser was the neophyte's actual wing or some other member.

**Residual correlations — stated, not waved away:**

1. **The WingPeer PDA still publishes the sponsor edge at commitment level.**
   `["wingpeer", circle, neophyte]` is derivable from the neophyte commitment
   and world-readable, so an observer who sees the grant can look up the bond and
   *guess* that the wing was the endorser. That guess is available whether or not
   the faucet exists and whether or not we reference the account — it is **F27 /
   Sentinel R2**, not F35, and it stands until Epic 2 retires the public bond.
   What F35 removed is the harder link: the parrain's **wallet**, and the
   program's own **assertion** that these two parties are sponsor and neophyte.
   A guess against the full member set is not a record.
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
5. **Timing.** F48's 15–120 s client jitter is tab-bound and weak; the treasurer
   ledger travels on its own 1–7 min delay so the two cannot be lined up.

### One capability that genuinely changed hands

The named path could not be self-served: `establish_wing_peer` refuses
`mentee == wing`, so the signer was always someone else. An anonymous proof
cannot be compared against the neophyte's own commitment without a circuit that
takes both, so `activate_faucet_zk` **cannot distinguish "my sponsor endorsed
me" from "I endorsed myself"** — a confirmed member in the tree can, through the
relayer, take their own first gas without waiting for anyone.

Weigh it honestly. What does not change: one grant per commitment ever, the
uniform amount, the neophyte's own wallet, their own Circle's jar, the refill
ceiling. What the faucet is actually bounded by is the **membership door**
(`require_personhood`, closed admission) — a Circle that lets anyone mint
memberships could already farm its jar through sock-puppet wings, and a Circle
that doesn't, can't. So the loss is the *ceremony* — the sponsor's act of
welcome — not the money. Restoring it in-band needs a circuit that proves the
WingPeer bond, which needs a new trusted setup (**F44**). A Circle that wants
the ceremony back today keeps using the named path.

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
  It *does* relax "only the wing may release the grant" to "any member of the
  tree may", but the sock-puppet attack never needed that relaxation — the
  attacker already controlled both sides of the bond. The binding constraints are
  unchanged: one grant per commitment, and a commitment costs a membership. The
  membership door (personhood / closed admission) is what bounds the faucet; the
  endorsement never was.
