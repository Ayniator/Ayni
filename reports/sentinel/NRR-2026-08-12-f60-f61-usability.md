# Non-Regression Report — 2026-08-12 — Round f60-f61-usability

**Verdict: FAIL**

Scope: the uncommitted working-tree change set on top of HEAD `2c49722`
(branch `solana`, in sync with `origin/solana`) — the F60/F61
encrypted-read-path + de-enumeration usability round ("F61-R2"). Files:
`frontend/app/{api/relay/route.ts,board/page.tsx,create/page.tsx,me/page.tsx,
recovery/page.tsx,recovery/setup/page.tsx}`, `frontend/lib/{admission,ayni.json,
peers,posts,relayPolicy,relayer,visibility,visibilityCrypto}.ts`,
new `frontend/lib/{masterSecret,shielded}.ts`,
`tests/{epic1,epic3,epic5,faucet,relayer}.ts`, `tests/sentinel/checklist.yaml`,
`BACKLOG.md`, `docs/{shipped,visibility}.md`. `programs/` has no uncommitted
changes — confirmed (`git status programs/` clean). Previous baseline:
`reports/sentinel/NRR-2026-08-12-governance-review.md` (FAIL, unrelated
process-control finding).

## Headline finding — CRITICAL — the on-chain fix this round depends on was never applied; it sits in `git stash@{0}`, uncommitted

**This is not a corner case. It breaks core, previously-shipped functionality
for every member, shielded or not: posting to the board, setting visibility,
tying a quipu cord, establishing a wing peer, and attesting an admission are
all non-functional against the program that `programs/` currently builds.**

### What I found

Five instruction files under `programs/ayni/src/instructions/` —
`create_post.rs`, `tie_quipu_cord.rs`, `set_visibility.rs`,
`establish_wing_peer.rs`, `attest_admission.rs` — still have the member/
authority signer as the Anchor `payer` for their `init`/`init_if_needed`
account, exactly as before this round:

- `frontend/... programs/ayni/src/instructions/set_visibility.rs:49` — `payer = member`
- `programs/ayni/src/instructions/create_post.rs:56` — `payer = author`
- `programs/ayni/src/instructions/tie_quipu_cord.rs:88` — `payer = sponsor`
- `programs/ayni/src/instructions/establish_wing_peer.rs:52` — `payer = signer`
- `programs/ayni/src/instructions/attest_admission.rs:61` — `payer = parrain`

None of the five has a separate `payer` account in its `#[derive(Accounts)]`
struct. But every consumer of these instructions in this round's diff was
written against a **different, 6-account shape with a separate `payer`
Signer**, matching the shipped.md / BACKLOG.md claim that "the five
instructions that made the member pay their own rent now take a separate
payer":

- `frontend/lib/relayPolicy.ts` — the new `RELAY_ALLOWLIST` entries for
  `set_visibility`, `create_post`, `tie_quipu_cord`, `establish_wing_peer`,
  `attest_admission` all declare `accountCount: 6/7/8` with a distinct
  `authorityIndex` and `payerIndex`.
- `frontend/lib/{visibility,posts,peers,admission}.ts` — every write path
  now builds instructions with an explicit `payer` account (via
  `sendMemberTx()`/`memberAuthority()` in `frontend/lib/shielded.ts`).
- `frontend/lib/ayni.json` (the committed IDL, byte-identical to a locally
  rebuilt `target/idl/ayni.json`) lists 6 accounts for `set_visibility`
  (`circle, member_membership, policy, member, payer, system_program`), 6 for
  `create_post`, 8 for `tie_quipu_cord`, 7 for `establish_wing_peer`, 6 for
  `attest_admission` — matching the frontend's expectation, **not** the
  committed Rust source.
- `tests/epic1.ts`, `tests/epic3.ts`, `tests/faucet.ts` were all edited this
  round to add a `payer: signer.publicKey` account to their
  `attestAdmission` / `tieQuipuCord` / `establishWingPeer` calls.
- `docs/visibility.md` §3b explicitly tabulates
  `set_visibility authority 3 payer 4 (6)`, etc., for all five.

The matching Rust source **does exist** — but it is sitting, uncommitted and
unapplied to the working tree, in `git stash@{0}` ("WIP on solana: 2c49722
chore(sentinel): record the override for the toolchain script"),
`git show 5a0b5f6` (a stash merge commit reachable only via `refs/stash`).
`git show 5a0b5f6:programs/ayni/src/instructions/set_visibility.rs` contains
exactly the separate-`payer` struct the frontend needs, word-for-word
matching the doc-comment now living in `docs/visibility.md`. Someone built
the IDL and wrote the frontend/tests/docs against that stashed tree, then the
Rust change was stashed and never re-applied or committed.

### Proof (executed, not inferred)

Built `target/deploy/ayni.so` / `target/idl/ayni.json` are consistent with
`programs/` as currently committed (confirmed: `frontend/lib/ayni.json` is
byte-identical to a fresh `target/idl/ayni.json`, and this **local IDL** —
generated at some point from the stashed tree, not the current one — already
carries the 6-account shape; the **deployed `.so`**, however, was built from
the working tree's actual `set_visibility.rs` et al., i.e. the OLD 5-account
shape). I started a local validator from `target/deploy/ayni.so` and ran the
affected suites unmodified:

```
solana-test-validator --reset --bpf-program AHAHnRiJEANtYJpWZxGZZa63ZTFzMa5e5Q8DszCgavSG target/deploy/ayni.so
ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=~/.config/solana/aha-deployer.json \
  NODE_OPTIONS=--experimental-global-webcrypto npx ts-mocha -p ./tsconfig.json -t 1000000 tests/epic5.ts
ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=~/.config/solana/aha-deployer.json \
  NODE_OPTIONS=--experimental-global-webcrypto npx ts-mocha -p ./tsconfig.json -t 1000000 tests/epic1.ts
ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=~/.config/solana/aha-deployer.json \
  NODE_OPTIONS=--experimental-global-webcrypto npx ts-mocha -p ./tsconfig.json -t 1000000 tests/epic3.ts
```

Results:
- **`tests/epic5.ts`: 13 passing, 8 failing.** Failures include the plain,
  *non-shielded* case `"lets the member set their per-element visibility"` —
  i.e. this is not shielding-specific — plus every new F61-R2 shielded-write
  case. All fail with `AnchorError ... account: system_program ... Error Code:
  InvalidProgramId`: the client sends 6 accounts, the deployed program's
  5-field struct consumes the wrong one (the client's `payer`) as its
  `system_program`, so the constraint check fails.
- **`tests/epic3.ts`: the suite's `before all` hook throws immediately** with
  the identical `InvalidProgramId`/`system_program` error — 0 of the file's
  tests can even run, because fixture setup calls `tieQuipuCord`/
  `establishWingPeer` with the new 6/7-account shape.
- **`tests/epic1.ts`: 7 passing, 6 failing** — `attestAdmission` fails the
  same way, and every downstream admission test in the file cascades from it
  (confirmation, distinct-persons check, anonymous-attestation acceptance).

`tests/relayer.ts` (12/12 passing) is not evidence against this: it is a pure
unit-test of `validateRelayRequest()`'s policy logic and never sends a
transaction to a validator, so it cannot see the mismatch between the policy's
assumed account shape and the deployed program's actual one.

### Consequence, stated concretely

1. **The round's headline claim is false as committed.** "F61-R2 — shielding
   becomes a feature a member can actually use" and "a shielded member keeps
   every action" do not hold: a shielded member's `setVisibility`,
   `createPost`, `tieQuipuCord`, `establishWingPeer`, or `attestAdmission`
   call fails on-chain **both** via the relayer path and via the wallet-paid
   fallback in `sendMemberTx()` (`frontend/lib/shielded.ts:135-172`), because
   both build the identical (currently-invalid) 6-account instruction. A
   member who follows the new Shield UI (`frontend/app/me/page.tsx`
   `ShieldCard`) into losing their wallet-linkage and then tries to post or
   set visibility will get a failed transaction, not the private write the UI
   promises.
2. **It also regresses already-shipped, working features that have nothing to
   do with shielding.** Every member — shielded or not — who tries to post
   (`board/page.tsx` → `lib/posts.ts createPost`), set visibility, tie a
   quipu cord, establish a wing peer, or have a parrain attest their
   admission will hit the same `InvalidProgramId` failure, because the
   client now always sends the 6-account shape (an unshielded write still
   goes through `sendMemberTx()` and `build(wallet.publicKey)`, which still
   inserts the extra `payer` account). This is a regression of Epic 0
   (faucet's wing-peer fixture), Epic 1 (admission), Epic 3 (quipu), and the
   basic board-posting path — all previously green.
3. **The self-verification this round reports (`docs/shipped.md`: "`cargo
   check --workspace` clean, `anchor build` clean ..., `cargo test -p ayni
   --lib` 22/22") does not and cannot catch this.** `cargo test --lib` runs
   Rust unit tests, not the Anchor account-resolution path; only an
   integration run against a validator (`anchor test` / `ts-mocha` against a
   local validator) exercises it, and that is exactly where this round's own
   `tests/epic5.ts`, `tests/epic1.ts`, `tests/epic3.ts` fail. The "full
   anchor test suite green at 160/160" figure handed to this round could not
   have been produced against the currently-committed `programs/` tree while
   also being consistent with the currently-committed frontend/tests; the two
   are mutually contradictory, and the stash strongly suggests the 160/160
   run (if genuine) was against the stashed tree, after which the Rust change
   was stashed and lost from the branch.

### Fix location (for the record — Sentinel does not fix code)

The fix already exists, unapplied: `git stash pop` (or manually re-applying
`git show 5a0b5f6:programs/ayni/src/instructions/{create_post,tie_quipu_cord,
set_visibility,establish_wing_peer,attest_admission}.rs`) restores the
intended separate-`payer` structs, then `anchor build` + redeploy to devnet is
required before this round's frontend can be considered to have shipped
anything. Sentinel is not applying it.

## Summary table

| Layer | Tests | Pass | Fail | New since last round |
|-------|------:|-----:|-----:|---------------------|
| E — Build health | `tsc --noEmit` (root + frontend) | 1 | 0 | — |
| B — API contract / relay policy | `tests/relayer.ts` | 12 | 0 | 11 new (F61 co-signer boundary) |
| C — Proof/contract, on-chain | `tests/epic5.ts` | 13 | 8 | 8 new failures, root cause above |
| C — Proof/contract, on-chain | `tests/epic1.ts` (Epic 1, previously shipped) | 7 | 6 | regressed by this round |
| C — Proof/contract, on-chain | `tests/epic3.ts` (Epic 3, previously shipped) | 0 | 1 (before-hook, blocks whole file) | regressed by this round |
| D — Privacy invariants (static) | grep for analytics/telemetry/console.log of identity, forbidden field names | pass | 0 | new files clean |
| D — Privacy invariants (de-enumeration) | no `getProgramAccounts` reintroduced outside pre-existing/documented call sites | pass | 0 | — |
| F — Sponsor recovery / master secret | recovery emits nothing on chain; passkey never gates recovery; no shard on relay/relayPolicy path | pass | 0 | new (masterSecret.ts, recovery adoptMaster wiring) |

## Regressions

1. **CRITICAL — on-chain account-shape mismatch, programs/ vs. frontend/tests/docs (see headline finding above).**
   - Epic: F61-R2 (new), but regresses Epic 0/1/3/5 and basic board posting.
   - Reproduction: see commands above (local validator + `ts-mocha` against
     `tests/epic5.ts`, `tests/epic1.ts`, `tests/epic3.ts`).
   - First bad state: not a single commit — the working tree as handed to
     this round. `git stash@{0}` / `git show 5a0b5f6` contains the missing
     Rust changes; they were never committed to `programs/`.

No other functional regressions found in the areas this round touches.

## Privacy-invariant status (Layer D's seven assertions)

Full adversarial DB/log dump simulation (`npm run test:adversarial`) was not
re-run natively this round for time reasons (no change to storage schemas or
server-side persistence in this diff beyond the relay route, which is
stateless and already covered above); this is a **coverage gap carried
forward**, not a pass claim. What I did verify directly against this round's
diff:

1. Sponsor identity / sponsor→member edge — ✔ `attest_admission` still
   records only the parrain's *commitment* (unchanged, named path); the
   anonymous path (`activate_faucet_zk`) is untouched by this diff.
2. Trust list / chosen-ones list — ✔ untouched by this diff (client-side only).
3. Message content / who-messaged-whom — ✔ untouched by this diff.
4. Biometric material — ✔ `masterSecret.ts` / `shielded.ts` never read or
   transmit anything passkey/biometric; the passkey remains a device-local
   *unlock* via `lib/keystore.ts`'s existing `unlock()`, never a gate on
   recovery (`recovery/page.tsx`, `recovery/setup/page.tsx` — no passkey
   check anywhere in the recovery flow; `adoptMaster()` is purely local).
5. Roster of any circle — **partially regressed in spirit, not in fact**: the
   shielding mechanism itself (`OwnerTag`, no field to memcmp) is unchanged
   from the already-verified F60/F61-phase2 round and still closes the
   `owner`-memcmp leak for memberships that *do* shield. But because shielded
   writes fail on-chain (headline finding), no member can actually use
   shielding without also losing the ability to act — so the roster leak
   this round claims to make "closeable in practice" is not, in practice,
   closeable without breaking the membership.
6. Whether a member has hidden content — ✔ hidden ≡ absent path untouched by
   this diff (`lib/trustpage.ts`, existing tests still pass where they run).
7. Parrain→neophyte faucet link — ✔ untouched by this diff (F35/F35-R2 code
   not modified this round).

**Relay route (`frontend/app/api/relay/route.ts`)** — audited line by line.
No `console.*`/logging call of any kind (grep confirms, matches the file's
own stated invariant). The co-signed path (`F61`) only ever receives a
**signature**, a **pubkey**, and a **blockhash** for the authority slot —
never a private key or shard; `tx.serialize()` verifies both signatures
before anything reaches the network, so a forged co-signature is rejected
locally. `relayPolicy.ts`'s widened acceptance (one pinned `authorityIndex`
per instruction) does not let the relayer itself ever occupy that slot
(explicitly checked and tested: `"refuses the relayer as the authority"`),
and does not add any account/data-length laxity beyond the one documented,
bounded exception (`create_post`'s variable-length text/CID, bounded by the
program's own `MAX_TEXT`/`MAX_CID`, tested).

No shard-carrying code path exists anywhere in this diff: `masterSecret.ts`
and `shielded.ts` have no `fetch`/`XMLHttpRequest`/`WebSocket`/
`sendBeacon`/network import at all — confirmed by reading both files in
full. Recovery pages (`recovery/page.tsx`, `recovery/setup/page.tsx`) only
gained calls to `getOrCreateMaster()` / `adoptMaster()`, both of which are
local keystore operations; no new network call was added to either page in
this diff. `adoptMaster()` copies the buffer (`Uint8Array.from(master)`)
before sealing, so the caller's `masterRef` can still be safely wiped after
adoption (confirmed: `recovery/page.tsx:771` wipes `m` — the parameter passed
to `adoptMaster` — after re-sharing, without corrupting the already-copied
session cache in `masterSecret.ts`).

Provisional members and sponsor recovery: unchanged by this diff (no edits to
the provisional-membership gating or the 2-of-3 shard logic); not
independently re-verified this round beyond confirming no file in scope
touches it.

## Traditions check (rank/compare/aggregate/name-a-sponsor/leak-a-relationship)

None found in this diff. `Tier` in `frontend/lib/visibility.ts` is the
existing three-level *visibility* setting (0/1/2 = chosen/circle/all), not a
member ranking; `SHIELD_INDEX_SCAN` is a bounded private derivation walk, not
a count exposed to anyone; `dayCount`/`daySpent` in the relay route are
server-side rate-limit bookkeeping, not member-facing. No new field matching
`/(score|rating|rank|karma|tier|badge|count)/i` was added to any
member-facing model.

## Baseline changes this round

None declared, and none should have been needed — but `frontend/lib/ayni.json`
(a schema snapshot, effectively) changed to reflect an IDL that does **not**
match the committed `programs/` source (see headline finding). This is not a
baseline update in the Sentinel sense (no `tests/sentinel/baselines/` file
touched), but it is the same category of problem: a committed artifact that
silently asserts a shape the source code does not produce. Flagged here
rather than under "baseline changes" narrowly because it is not a Sentinel
baseline file, but the same discipline applies — it should not have been
committed without the Rust change it depends on.

## Coverage gaps (shipped behavior not yet under Sentinel test)

- Layer A (Playwright e2e) still has no runnable suite in this environment —
  `npm run test:e2e` was not exercised this round (carried-forward gap,
  matches prior rounds' notes). The Shield UI's three pre-commit disclosures
  (irreversible / wallet-linked-forever / master-secret-dependent) and the
  `relayed: false` "paid by your wallet" disclosure in `board/page.tsx` are
  present in the code and read correctly by inspection, but are not
  DOM-asserted.
- `npm run test:adversarial` (full DB/log dump simulation) not re-run natively
  this round; see Privacy-invariant status above for the narrower, diff-scoped
  verification that substitutes for it.
- Devnet reality check not performed: the task materials asserted "the
  on-chain side already shipped and is deployed to devnet at the verified
  build," but this round's own evidence (the stash) makes that claim
  unreliable; a live devnet check (fetch the deployed program's account
  layout / try a real `set_visibility` against devnet) is recommended before
  the next round and was not done here due to time budget.

## Verdict rationale

This round set out to make an already-shipped privacy mechanism (hiding a
member's wallet address on their membership record) actually usable, and it
wrote real, well-designed frontend code, a real relayer extension, and real
tests to do it — the parts I could inspect closely (the relay route's
signature handling, the master-secret/keystore design, the recovery
non-emission guarantees, the Shield UI's disclosures) are careful and
privacy-conscious work. But the on-chain half of the change — the actual
Solana program code that was supposed to let someone other than the member
pay for these five actions — never made it into the code that will actually
run. It's sitting in a `git stash` entry that nobody applied. Because of
that, when I actually stood up a local copy of the chain and tried the
features, five different member actions failed outright: setting your
visibility, posting to the board, tying a step on your necklace, choosing a
sponsor, and a sponsor vouching for a newcomer. None of these are exotic
edge cases — they are ordinary, everyday actions, and three of them (quipu,
admission, and basic posting) worked before this round and don't work now.
A member who follows the new "Shield this membership" button would end up
worse off than before: unable to act at all until someone notices and
un-stashes the fix. This has to be a FAIL, and the fix is not a design
change — it is applying work that has already been written and is sitting
one `git stash pop` away.
