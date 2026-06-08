# Ayni — resilience & key recovery (Solana)

On-chain realization of the AHA Resilience principle (PROJECT.md §6): a lost key
never strands a member or Circle, because a **7-seat Council** can, by **4-of-7**,
rotate a seat or **definitively migrate every artifact** from one wallet to
another.

## Council

`council.rs` defines a `Council` embedded in each `Circle`:

```
seats: [Pubkey; 7]   // seats 0..2 = treasurer, secretary, rhythm keeper; 3..6 = elders
threshold: u8        // default 4
```

Seven seats so a quorum survives several simultaneous key losses; four elders
exist purely for quorum/resilience so recovery never depends on the three busy
servants alone. The same structure governs the World Service Circle and every
local Circle — *"also 4-of-7 at their level"* (autonomy, Tradition 4).

## Proposals (4-of-7)

A `Proposal` carries one `ProposalAction` and an `approvals` **bitmask over the
7 seats** (so each seat votes at most once; the tally is `count_ones()`).

```
RotateSeat   { seat_index, new_holder }   // replace a seat's wallet
MigrateWallet{ old_wallet, new_wallet }   // definitive key recovery
```

Flow:

| Instruction | Who | Effect |
|---|---|---|
| `appoint_seat(i, holder)` | circle `authority` (bootstrap) | seat the initial Council |
| `propose(nonce, action)` | a Council seat | open a proposal; proposer auto-approves |
| `approve()` | a Council seat | add this seat's approval (once); arms when threshold reached |
| `cancel_proposal()` | **any** Council seat | contest: mark a pending proposal cancelled |
| `execute_proposal()` | anyone | when `approvals ≥ threshold` **and** the time-lock has elapsed: apply the action |
| `recover_membership()` | anyone | under an executed `MigrateWallet`, rebind a membership's `owner` |

`appoint_seat` is the bootstrap/admin path; once seated, the Council rotates
itself only through `RotateSeat` proposals.

## Time-lock & contest (anti-collusion)

When approvals first reach the threshold, the proposal is *armed* — its
`eligible_at` is stamped:

- **RotateSeat** → `eligible_at = now` (reversible; executes immediately).
- **MigrateWallet** → `eligible_at = now + recovery_timelock` (the per-Circle
  contest window, set at `initialize_circle`; default 7 days).

`execute_proposal` refuses until `now ≥ eligible_at`. During the window, **any
single Council seat** can `cancel_proposal`, permanently blocking it (the
migration must be re-proposed). One honest seat is enough to halt a suspicious
recovery — the design favours **safety over liveness** for irreversible
actions. A colluding majority can re-propose, but honest seats can re-cancel and
rotate the colluders out while the migration stays blocked.

## "Migrate all artifacts"

A definitive `walletA → walletB` recovery is completed in two bounded steps:

1. **`execute_proposal`** rebinds every Council **seat** held by `walletA` to
   `walletB` (a bounded loop over the 7 seats — atomic).
2. **`recover_membership`** rebinds each affected **membership** `owner`
   (`walletA → walletB`), called once per membership, each gated by the same
   executed proposal. Unbounded artifacts are handled per-account because
   Solana can't iterate them in one instruction.

Shamanic **levels** travel with the membership (they hang off it), so rebinding
the membership carries the lineage standing. Token-2022 soulbound tokens, when
minted, are burned-and-reissued by the program acting as permanent delegate
(TODO). Funds in Squads/Realms use those tools' own m-of-n recovery, which the
Council mirrors.

## Threat model

- **Social trust:** 4 colluding seats can seize a wallet's artifacts. The
  built-in time-lock + any-seat contest blunt this (a single honest seat halts a
  migration); remaining mitigations are elders from distinct trust domains and
  (optionally) the member's co-signature while they still hold *a* key.
- **No revocation of the migration itself:** once executed, a `MigrateWallet`
  is authoritative; a wrongful migration is corrected only by another vote.
- **Bootstrap:** `appoint_seat` trusts `authority` (the governance PDA). Seat
  the Council before handing `authority` to a Realms/Squads governance address.
