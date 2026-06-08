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
| `recover_membership()` | anyone (+ member if `require_cosign`) | under an executed `MigrateWallet`, rebind a membership's `owner` |
| `set_recovery(key, require_cosign)` | the member (`owner`/`recovery_key`) | set/rotate the guardian key and the co-sign policy |
| `member_migrate(new_owner)` | the member (`owner`/`recovery_key`) | self-migrate own membership — no vote, no time-lock |

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

## Member co-signature & self-recovery

A `Membership` carries up to **two guardian keys** (`recovery_keys`, a 1-of-2
backup set the member controls, separate from `owner`) and a **`require_cosign`**
policy. Two guardians give redundancy — losing one still leaves recovery
possible. They give the member control over their own recovery, independent of
the Council:

- **`require_cosign = true`:** `recover_membership` additionally requires a
  signature from `owner` or **either** guardian. *No Council majority — even all
  7 colluding — can migrate this membership without the member.* The trade: lose
  **every** key and the membership is unrecoverable. The member chooses this
  availability-vs-collusion-resistance balance for themselves.
- **Self-recovery (`member_migrate`):** a member still holding any key rebinds
  their own `owner` with no Council vote and no time-lock — because they
  personally authorize it, no collusion is possible.
- **Anonymity preserved:** `owner` may stay `default()` (no public wallet) while
  a guardian is set, so even a fully anonymous member can self-migrate and
  co-sign via a guardian key.

The Council-only path (`require_cosign = false`, default) remains for members who
may lose every key — that is what the time-lock and contest protect.

## Recovery options by level

The same primitives apply at every level; what differs is **who recovers what**
and the **recommended parameters**.

| Level | What can be recovered | Mechanism | Recommended params |
|---|---|---|---|
| **Member** (any Circle) | the member's own `owner` wallet | `member_migrate` (self, any key held); else Council `MigrateWallet` + `recover_membership` (with co-sign if opted in) | up to 2 guardians; `require_cosign` for key-confident members |
| **Council seat** (any Circle) | a seat's wallet | `RotateSeat` (4/7, immediate) or `MigrateWallet` (4/7 + time-lock + contest) | — |
| **Local Circle** | its own seats + members | its own 7-seat Council, **autonomously** — never needs World Service (T4) | shorter contest window, e.g. **3–7 days** |
| **Foundational — World Service Circle** | World-Service seats + the **lineage genesis key** | its own 7-seat Council; genesis key in **MPC / governance multisig**, never one wallet | longer window, e.g. **14–30 days**; elders from distinct trust domains |

The genesis lineage key is the one secret with no on-chain recovery (it roots all
ZK lineage proofs — see docs/zk-lineage.md §6/§7). Custody it in MPC or a Squads
multisig from the start; "recovery" there means the multisig's own m-of-n, not
this program.

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

- **Social trust:** for `require_cosign = false` memberships, 4 colluding seats
  could seize a wallet's artifacts. Defences, in order of strength: members who
  opt into **`require_cosign`** are immune (the Council cannot migrate them at
  all); the **time-lock + any-seat contest** blunt the council-only path (a
  single honest seat halts a migration); and operationally, elders from distinct
  trust domains.
- **Purge-before-migration:** because `RotateSeat` is instant, a 4-seat majority
  could rotate out the honest minority *before* proposing a migration, defeating
  the contest. `require_cosign` sidesteps this for memberships; hardening seat
  rotation (time-lock / freeze-during-migration) is an open decision (PROJECT.md
  §10).
- **Total key loss under `require_cosign`:** losing both `owner` and
  `recovery_key` makes the membership unrecoverable — the accepted cost of being
  collusion-proof.
- **No revocation of the migration itself:** once executed, a `MigrateWallet`
  is authoritative; a wrongful migration is corrected only by another vote.
- **Bootstrap:** `appoint_seat` trusts `authority` (the governance PDA). Seat
  the Council before handing `authority` to a Realms/Squads governance address.
