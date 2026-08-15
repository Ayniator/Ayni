# Testing the Foundation, and running a Circle end to end

Written 2026-08-15, against program `AHAHnRiJEANtYJpWZxGZZa63ZTFzMa5e5Q8DszCgavSG`
and devnet as it stands today. Every fact below was read from the chain or from
the program source, not from the backlog.

---

## 0. The short answers

**Can a Foundation close a Circle?** Yes. Four of its seven Council seats
propose → approve → execute, and the child Circle account is closed with its
rent going to a recipient the executor names. Two guards: the target must be a
**direct** child (`child.parent == foundation.key()`, re-asserted at execute),
and `propose_child_close` explicitly refuses `child == foundation`, which is
what makes the root permanently un-deletable on chain.

**Can a Foundation transfer the child's treasury?** **No.** There is no
instruction anywhere in the program that moves one Circle's treasury to another,
and no `ProposalAction` variant that could express it. A treasury can only be
spent by *its own* Circle's Council, via a 4-of-7 `WithdrawTreasury` (SOL) or
`WithdrawTreasuryToken` (SPL) proposal drawn by `withdraw_treasury[_token]`.
The Foundation has no authority over a child's funds at all — only over the
child's existence.

**Which means closing a funded child hands its treasury to whoever asks for it
next. This is confirmed, not suspected** — `tests/treasury-orphan.ts` performs
the whole sequence against a local validator and all six steps pass:

1. A Foundation closes a funded child, 4-of-7, by the ordinary path.
2. **The treasury keeps the money.** It is a *separate* PDA,
   `["treasury", circle]`, so closing the Circle does not close it.
   `execute_child_close` never checks that it is empty.
3. **Nobody can spend it.** `withdraw_treasury` takes
   `circle: Account<'info, Circle>` and a `Proposal` with `has_one = circle`;
   with the Circle account gone there is nothing to deserialise, and every other
   spend path fails the same way.
4. **A stranger re-registers the same name.** A Circle is a PDA seeded
   `["circle", parent, name]`, and `initialize_circle` is permissionless with
   **caller-chosen seats** ("whoever submits the tx is only a fee-payer"). The
   address comes back under a Council with no relation to the original.
5. **They vote themselves the funds** with their own 4-of-7 and draw them.

So the money is not burned and it is not the Foundation's — it is a prize for
whoever re-registers the name first. Three devnet treasuries are funded today
(0.1, 0.205 and 0.08 SOL), so this is reachable rather than theoretical, though
the amounts are small.

Fixes, in order of how much they cost — **none is implemented**; this document
reports the gap and the test proves it, neither closes it:

- require the child's treasury lamports to be zero in `execute_child_close`
  (cheapest; makes the Council empty the treasury deliberately first);
- or sweep the treasury to `recipient` in the same instruction (no separate
  step to forget, but it lets a Foundation take a child's funds, which is a
  governance change and not obviously wanted);
- or refuse re-registration of a closed name (largest change; needs a tombstone,
  which costs rent and leaks that a Circle once existed).

The first is the one to write. The choice between them is the user's.

---

## 1. Ground truth: you cannot test the Foundation on the live site today

This is the blocker, and it is not in any document:

| | |
|---|---|
| Current program | `AHAHnRiJEANtYJpWZxGZZa63ZTFzMa5e5Q8DszCgavSG` |
| Circle accounts owned by it on devnet | **1** — see the note below; it was **0** when this document was written |
| Old program | `3ogteUFYhbHaV7UEWuGCqGVm1X4HDgAswvSePvDspHCw` |
| Circle accounts owned by it | **14**, including the configured Foundation |
| `NEXT_PUBLIC_FOUNDATION_CIRCLE` (in `frontend/.env`) | `DH6uDzb77mZuF8TP2ucdHUkwyW6wyZkJj8nm3i79EAUo` — owned by the **old** program |

> **The one Circle under the current program was created by accident, and it is
> worth knowing why.** While verifying this document's own claims, a Sentinel
> round ran `scripts/seed-foundation.js` against **devnet** rather than a local
> validator. Both seed scripts derive the Circle address from
> `["circle", <local deployer pubkey>, name]`, and this machine's deployer is not
> the one that built the original Foundation — so instead of finding the existing
> Circle and reporting "foundation exists", it silently created a **second**
> Circle also named `AHA Foundation`, at
> `211ED6gqbitukLw6n1VNEAasgnXaQovmUdUPbLuwM29V`.
>
> It is harmless (empty treasury, no members) and it is in fact the only Circle
> the current program can currently talk to. But the footgun is real and
> pre-existing: **the same command means "adopt" or "create" depending on whose
> keypair is in `~/.config/solana`, with no confirmation step.** `seed-foundation.js`
> now prints the address it will use and refuses to create on a non-local cluster
> unless `CONFIRM_CREATE=1` is set.

An Anchor `Account<'info, Circle>` checks the owning program before it
deserialises, so every Foundation instruction against `DH6uDz…` fails at account
validation under the current program. Nothing is wrong with the data; it belongs
to a different program.

Verify it yourself in one call:

```bash
# 5ZAuwS1wuTy is the base58 of the Circle account discriminator
curl -s https://api.devnet.solana.com -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getProgramAccounts","params":
      ["AHAHnRiJEANtYJpWZxGZZa63ZTFzMa5e5Q8DszCgavSG",
       {"encoding":"base64","dataSlice":{"offset":0,"length":0},
        "filters":[{"memcmp":{"offset":0,"bytes":"5ZAuwS1wuTy"}}]}]}' | head -c 200
```

### The Foundation that does exist (old program)

`DH6uDzb77mZuF8TP2ucdHUkwyW6wyZkJj8nm3i79EAUo` — name `AHA Foundation`,
threshold 4-of-7, recovery timelock 604 800 s (7 days), membership period
31 536 000 s (1 year), `member_count` 0, personhood gate off. Seats:

```
0  AHAQjDz6KbRvJcju2Wa7FLceEEgSZ9Yaq3KiFGFFaXT8
1  AHAYZpbUKPWjsCvwyqn5Y6dhV1MFcYWSVGYuNoU17MBV
2  AHAxVqcCgDJx56y9xt9TheyvyoPwuBEjmyJnTUL1wt7u
3  AHAzEk8yWyMyLCzZYRTpbeeWHtw7qstg5uyt2Xti4wjC   (also the old program's upgrade authority, and the Circle's `parent`)
4  B3hJoFEyXB5ViCpr1nrF1BUEGQuB7Hu5PdA91JdiTs25
5  3TNet8h4xhDYbvGGyutJiN3cabPCiUVSeVRs17xTjhnE
6  4ZVGqKMgKeC7H9sMPPhvnH9kBM7gZgu4eDpuT7LC3VDa
```

---

## 2. Which account can you test with?

**Only one signing key exists on this machine**, and it is not a Council seat:

| Keypair | Address | Devnet balance | What it is |
|---|---|---|---|
| `~/.config/solana/aha-deployer.json` | `AHAimdiM1YwRDzbY9htW8WcDmz831C6Va6QXNQHs1nYk` | 46.65 SOL | **Upgrade authority of the current program.** Not a seat anywhere. |
| `~/.config/solana/id.json` | `CuhhusRStLW9HCfGjVJpKFbbkSm77BKKkPZzYRgHpT2R` | 0 SOL | Default CLI identity, unfunded, unused. |

`tests/test accounts.txt` lists seven World Service seat *addresses*, but its own
instructions say the rows marked "(signs)" need keypair **paths** to actually
run, and no such files exist here. Address alone cannot sign. So:

> **You cannot act as the existing Foundation.** You hold no seat key for it, and
> its Circle belongs to the old program in any case.

**What you can do, and it is the right move anyway:** create a *fresh* Foundation
under the current program with all seven seats set to keypairs you generate.
`initialize_circle` is permissionless and the caller picks the seats, so this
needs no permission from anyone — only the deployer wallet's SOL for fees. This
is what §4 does.

---

## 3. Plan A — the local validator (recommended; minutes, not hours)

Use this for everything except "does the deployed site work". It is
deterministic, free, needs no faucet, and lets you warp past timelocks.

```bash
anchor test                       # whole suite; boots its own validator
# or one file, against an already-running validator:
solana-test-validator -r &
anchor deploy --provider.cluster localnet
npx ts-mocha -p ./tsconfig.json -t 1000000 tests/federation.ts
```

`tests/federation.ts` already covers the two audit CRITICALs on this exact path —
a foreign "foundation" cannot close a Circle it does not parent, and cannot seize
a Council. Read it before writing anything new; it is the model for the tests
below.

**Why local, specifically:** the treasury-stranding question in §0 needs a
sequence — fund a child, close it, then try every spend path — that you do not
want to discover the answer to on a cluster you share.

---

## 4. Plan B — devnet, end to end

Fees come from the deployer wallet. Every command assumes
`--url devnet` and `ANCHOR_WALLET=~/.config/solana/aha-deployer.json`.

### 4.1 Make the seats

```bash
mkdir -p ~/aha-test-keys
for i in 0 1 2 3 4 5 6; do
  solana-keygen new --no-bip39-passphrase -s -o ~/aha-test-keys/seat$i.json
done
for i in 0 1 2 3; do            # only the 4 that will sign need SOL
  solana transfer $(solana-keygen pubkey ~/aha-test-keys/seat$i.json) 0.2 \
    --keypair ~/.config/solana/aha-deployer.json --url devnet --allow-unfunded-recipient
done
```

Four is the threshold, so four funded seats is enough to govern. Fund all seven
only if you want to test that a fifth approval changes nothing.

### 4.2 Create the Foundation, then a child under it

`initialize_circle(parent, name, membership_period, recovery_timelock, seats)`

- **parent** — any pubkey; it is a seed, never an actor. Use the deployer's for
  the Foundation. For the child, pass the **Foundation's address** — this is the
  only thing that makes the Foundation its parent, and every close/rotation
  authority hangs off it.
- **name** — a PDA seed, so it fixes the address. Distinct per Circle.
- **recovery_timelock** — the contest window before a passed high-stakes
  proposal may execute. `0` is a legal explicit opt-out and is what you want for
  a same-day test; production Circles should set a real window. A **negative**
  value is rejected (it used to silently delete the contest window).
- **seats** — all seven must be non-default and distinct.

Circle PDA: `["circle", parent, name]`. Treasury PDA: `["treasury", circle]`.

### 4.3 The end-to-end Circle walkthrough

Run in order; each step's check is the thing that would actually be broken.

| # | Step | Instruction | What to check |
|---|---|---|---|
| 1 | Create the Circle | `initialize_circle` | 7 seats stored, `threshold == 4`, `member_count == 0`, `parent` is what you passed |
| 2 | Stand up the member tree | `initialize_member_tree(depth)` | depth matches the circuits' `CIRCUIT_DEPTH` (20) |
| 3 | Admit a member | `issue_membership(commitment, owner, recovery_keys, require_cosign)` | `member_count` increments; the commitment is a Poseidon hash, never a wallet |
| 4 | Fund the treasury | `donate(amount)` | treasury PDA balance rises; **anyone** may donate, by design |
| 5 | Propose a spend | `propose(nonce, WithdrawTreasury { amount, recipient })` from a seat | proposer's approval is recorded automatically |
| 6 | Reach threshold | `approve` from three more seats | a **fifth** approval must be harmless; a **non-seat** signer must be refused |
| 7 | Wait out the contest window | — | with `recovery_timelock > 0`, executing early must fail; any seat may `cancel_proposal` during it |
| 8 | Execute | `execute_proposal` | marks executed; does **not** move funds by itself |
| 9 | Draw the funds | `withdraw_treasury` | recipient receives exactly `amount`; **replaying it must fail** (`drained`) — this guard fixed a drain-the-whole-treasury bug, so assert it explicitly |
| 10 | Rotate a seat | `propose` + `approve` ×4 + `execute_proposal` with `RotateSeat` | old holder loses authority immediately after |

Two more worth running because they are cheap and they are where the money is:

- **Spend allowlist.** Turn on `CircleConfig.treasury_allowlist`, then confirm a
  4-of-7-approved withdrawal to a **non-allowlisted** recipient is refused. The
  `config` account is seed-bound and `init_if_needed`, so it cannot be omitted to
  dodge the check — assert that by omitting it.
- **Token treasury.** `donate_token` then `WithdrawTreasuryToken`. Tokens sent by
  `donate_token` were once unrecoverable (audit: permanent fund-lock); this is
  the path that fixed it.

### 4.4 The Foundation walkthrough

| # | Step | Instruction | What to check |
|---|---|---|---|
| 1 | Open a close vote | `propose_child_close(nonce, validity_secs)` from a Foundation seat | `validity_secs` must be 1–90 days; a shorter or longer one is refused |
| 2 | Refuse a foreign parent | same, with a Circle that is **not** a child | must fail `Unauthorized` — this is audit CRITICAL #1 |
| 3 | Refuse self-deletion | same, with `child == foundation` | must fail — the root is un-deletable by construction |
| 4 | Approve | `approve_child_close` ×3 more seats | reaches the 4-of-7 threshold |
| 5 | Let it expire | wait past `expires_at` | executing after expiry must fail |
| 6 | Execute | `execute_child_close` | child Circle closed, rent → `recipient`; pass the child's `CircleProfile` too and confirm it leaves the directory |
| 7 | Re-execute | `execute_child_close` again | must fail (`AlreadyExecuted`) — one-shot |

### 4.5 F-1, the test this plan exists for — already written and passing

`tests/treasury-orphan.ts`. Run it against a local validator:

```bash
solana-test-validator -r --ledger /tmp/aha-ledger &
solana airdrop 100 $(solana-keygen pubkey ~/.config/solana/aha-deployer.json) --url http://127.0.0.1:8899
anchor deploy --provider.cluster http://127.0.0.1:8899 --provider.wallet ~/.config/solana/aha-deployer.json
ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 \
ANCHOR_WALLET=$HOME/.config/solana/aha-deployer.json \
  npx ts-mocha -p ./tsconfig.json -t 1000000 tests/treasury-orphan.ts
```

6 passing, ~10 s. **Do not run it on devnet**: step 5 really does move the
funds.

Its assertions are written so that a *fix* turns them red — the last two say in
their failure messages that the finding would then be overstated, which is the
outcome to want. The sequence it performs:

1. Create Foundation `F` and child `C` with `C.parent == F`.
2. `donate` 0.5 SOL to `C`'s treasury.
3. Close `C` through §4.4.
4. Read `["treasury", C]`. **Expected: the lamports are still there.**
5. Try `withdraw_treasury` for `C`. **Expected: fails — `C` cannot be
   deserialised.** Confirm every other spend path fails the same way.
6. Now call `initialize_circle` with the **same parent and the same name**,
   seating seven wallets of your own. **Expected: it succeeds, at the same
   address.**
7. Vote yourself the treasury 4-of-7 and draw it.

All seven steps succeed today. `execute_child_close` needs a guard before any
Circle holding real funds is closed on a real cluster.

---

## 5. Testing the deployed site

The frontend is a separate question from the program, and it is the one part
already covered: `cd frontend && npx playwright test` runs 66 tests over two
projects against `https://aha.a13z.org:8443`, and `E2E_BASE_URL` retargets it.
That suite is a black-box observer — it proves pages render, the nav and footer
translate, no third-party host is contacted, and the wallet controls behave. It
proves **nothing** about Council governance, because no test authenticates as a
seat.

To make the site show a Foundation at all, point
`NEXT_PUBLIC_FOUNDATION_CIRCLE` (in `frontend/.env`) at the Circle you create in
§4.2 and rebuild — it is inlined at build time, so an edit alone changes
nothing:

```bash
cd frontend && docker compose up --build -d frontend
```

---

## 6. What this plan does not cover

Said plainly, so a green run is not read as more than it is:

- **No presence attestation.** F59's instructions are on chain and proved
  offline (`node tests/presence-zk.test.mjs`, 12/12 with real Groth16 proofs),
  but there is no browser prover and no UI yet, so there is nothing to click.
- **No MACI round**, no elections, no federation rotation beyond the close path.
- **The old program's 14 Circles are not migrated.** Nothing here moves them, and
  nothing can: their accounts are owned by a program whose source no longer
  matches this tree.
- **Devnet is not a rehearsal for mainnet economics.** Rent, fees and the free
  RPC's rate limits all differ, and the RPC will 429 a parallel test run.
