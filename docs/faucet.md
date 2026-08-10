# Ayni — gas faucet (first gas for the neophyte)

Trust Platform **Epic 0**: each Circle operates a faucet that grants a newly
admitted member a small amount of SOL, **one single time, ever**, so they can
pay their first transaction fees. Activated only by the newcomer's **parrain**
(sponsor), tuned by the Treasurer within a program-enforced cap, refilled only
by an anonymous member vote.

## Model

- Each Circle has a **`FaucetJar`** PDA (`seeds = ["faucet", circle]`) holding
  its lamports directly on the account. The jar is its own blast radius: a
  compromised faucet loses one jar, never the treasury.
- The **parrain attestation is the existing WingPeer bond**: the neophyte
  designated their sponsor via `establish_wing_peer`, and only a signer holding
  that wing membership can trigger the grant — no other member, no seat, no one
  (`NotParrain` otherwise). Both memberships must be unexpired.
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
| `activate_faucet()` | the parrain (the neophyte's WingPeer) | one-time grant of exactly `grant_lamports` to the neophyte's wallet; global nullifier spent; parrain pays the nullifier rent — part of the welcome |
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

## Traditions

- **T7 (self-supporting)** — the faucet is circle-level mutual aid, funded from
  the Circle's own treasury or direct donations; nothing external is solicited.
- **T2 / T9 (trusted servants, not governors)** — the Treasurer *tunes* within a
  cap the program itself enforces and can *watch* the jar, but cannot refill it:
  moving common funds is the whole membership's group conscience, one member one
  anonymous ballot.

## Pilot limitations (honest)

- **The activation tx publicly links the parrain's wallet to the neophyte's
  wallet** — as does the WingPeer record it rests on. The fully anonymous form
  (ZK vouch-proofs proving "sponsored by a member in good standing" without
  naming anyone, submitted via a relayer) arrives with **Epic 2**; whether the
  circle instead pays gas through a fee-payer relayer — so no funding transfer
  ever appears on chain — is the **Epic 10** open decision.
- **No treasurer one-time-code ledger yet.** Epic 0 specifies an encrypted
  off-chain ledger where the Treasurer reviews faucet activity under one-time
  pseudonymous codes (codes, never identities). That is future frontend work;
  today the Treasurer sees the jar balance and the `granted` counter on-chain.
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
