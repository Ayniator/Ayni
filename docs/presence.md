# F59 — ZK presence attestation ("last stood in circle: March 2026")

Status: **design of record, implementation in progress** (2026-08-14).

This document exists before the code because F59 required an explicit amendment
to an Epic 4 rule. That amendment, and what it costs, is written down here
first so it cannot be discovered later in a diff.

---

## 1. The Epic 4 amendment (user decision, 2026-08-14)

Epic 4's rule was: service and presence are shown as **dated entries, never a
fraction, progress bar, total, or count** — "never summed", read literally, with
the intent that nothing on a member surface can rank one member above another
(Tradition 2).

**The amendment, as decided by the user:** F59 ships on chain, and the residual
below is accepted rather than treated as a blocker.

**What that accepts, stated plainly rather than implied.** A `Presence` PDA is
derivable from a membership commitment, and `membership.all()` already
enumerates commitments. So:

- `getSignaturesForAddress(presence_pda)` returns **one signature per write**.
  The number of months a member has attested is therefore a single RPC call.
  This is a per-person count. Month-coarseness does not remove it — coarseness
  defeats the *recency ordering*, not the *signature count*, which stays exact.
- Iterating commitments and deriving each PDA yields a **complete ranked table**
  of a Circle. Nobody needs special access to build it.
- Transaction history is immutable, so **no later redesign can retract this**.
  `clear_presence` closes the account and makes erased byte-identical to
  never-claimed *in live state*, but the ledger still records that writes
  happened.

The live-state design below does everything achievable to make counting
impossible — a single overwritten scalar, no history, no timestamp, no streak,
no first-month, thirteen bytes with no room to grow. That is genuinely
non-summable **from state**. It is not non-summable **from the ledger**, and no
on-chain design can be.

**The rule as amended:** live member-facing state must not hold or expose a
count, total, streak, or ordering of a person. Ledger archaeology is an accepted
residual, disclosed in `docs/presence.md` and in the UI before a member
publishes anything.

**Sentinel:** this supersedes the "never summed" reading for F59 only. Rounds
should verify the live-state properties above and record the ledger residual as
**waived / accepted risk**, not re-raise it as CRITICAL each round. Any other
feature that introduces a per-person counter is still a CRITICAL.

**The alternative that was offered and declined**, recorded so the trade-off is
legible: the same line — "last stood in circle: March 2026" — could be carried
as a signed credential inside the member's F60 encrypted profile, disclosed at
their discretion, with no PDA, no signature history, and nothing to enumerate or
sum. It needs no new circuit and no ceremony. It was declined in favour of the
on-chain form; this note is not an objection, only the record that a
counter-free option existed.

---

## 2. What the attestation actually means

**"Vouched by a fellow member", never "verified attendance".** The chain cannot
know who stood in a room. It knows that two distinct members of the Circle both
produced a proof naming the same month. Every string in the UI must use the
vouching wording; none may imply attendance was checked.

Two parties, both anonymous:

- **Subject (consent).** Proves against `single_leaf_root(subject.commitment)` —
  the F35-R2 trick from `activate_faucet_zk`. The only witness satisfying it is
  a secret `s` with `Poseidon(s) == commitment`. **Nobody can be written about
  involuntarily**, and a wallet-less or F61-shielded member can still act, which
  an `owner` signature could not achieve.
- **Witness (anonymity).** Proves against `member_tree.root` or a `RecentRoots`
  entry, byte-identical to `attest_admission_zk`'s F54 gate. The witness is any
  member of the tree and is named nowhere.

**The distinct-persons rule, restored on chain.** Both proofs are taken under
the *same* external nullifier `E`. Since `member_vote.circom` computes
`nullifier = Poseidon(secret, proposalId)`, requiring
`nullifier_w != nullifier_s` proves two different secrets acted. This is
strictly stronger than `confirm_admission`, whose own comment concedes the
distinct-persons rule "downgrades from program-enforced to circle-visible" for
anonymous attestations. The shared `E` is load-bearing: comparing nullifiers
taken under different `proposalId`s would prove nothing.

No new circuit, no new trusted setup: both proofs reuse the shipped
`member_vote` verifying key and its ceremony artifacts. F44 stays out of scope.

### External nullifiers (exact preimages)

```
E_attest = SHA-256("AHA-presence-month" ‖ circle ‖ commitment ‖ month_index_le32)
E_clear  = SHA-256("AHA-presence-clear" ‖ circle ‖ commitment ‖ last_month_le32)
```
both masked `b[0] &= 0x1f` so they land in the BN254 field. Computed **in the
program**, never taken from the client. The tags are distinct from
`AHA-faucet-grant`, the raw newcomer commitment, `field_from_pubkey(circle)` and
the proposal nonce — so one member's separate anonymous acts never share a
nullifier and cannot be joined.

---

## 3. State — one account, thirteen bytes

```
PDA: ["presence", circle, subject_commitment]
Presence { last_month: u32, bump: u8 }   // SPACE = 8 + 4 + 1 = 13
```

Deliberately absent, each for a reason:

| Not stored | Why |
|---|---|
| any timestamp (`i64`) | a written-at time is a finer-grained record than the month the design promises |
| any count / total / streak | the thing Epic 4 forbids; there must be no field to increment |
| `first_month` | two scalars make a span, and a span is a duration to compare |
| any `Vec` | a list is a history, and a history can be summed |
| witness identity | the witness is anonymous by construction; storing it recreates a social edge |
| `circle` / `member` field | both are already PDA seeds; repeating them adds a memcmp handle for enumeration |

A **closed month only** (`month_index < current_month`) may be attested, and
each write must strictly advance (`month_index > last_month`). The closed-month
rule is what keeps granularity honest: attesting the *current* month narrows a
member to a window that a public meeting calendar can resolve to one evening.
**This rule must never be relaxed for convenience.**

---

## 4. What still leaks — the honest list

1. **Ledger archaeology** — §1. Accepted risk, user decision.
2. **Witness anonymity set = the Circle's published member count.** At two
   members it collapses to 1: the witness is the other person. The UI states the
   current member count before either party proves.
3. **Place and time.** A monthly attestation plus `CircleProfile.address` and
   coordinates plus `CircleMeetings` narrows a pseudonym to a locality and a
   month. Presence never *reads* `CircleMeetings`, but an observer can join them.
4. **The relay operator** sees the submitting IP and the full account list —
   including the derivable `Presence` PDA — for every attestation, and the
   ceremony produces two writes close together. Client-side jitter is required,
   and its bound must be stated rather than assumed.
5. **The QR handoff discloses the subject's raw commitment** to the witness —
   the primary key of their `Membership`, trust page, QuipuCord and F60 profile.
   For a member with `owner == default()` this may be the first artifact that
   ever forces it. This must be said on the handoff screen, before the scan.

---

## 5. Rules for anyone touching this later

- Never push `single_leaf_root(...)` into `RecentRoots`. The subject-consent
  proof's soundness depends on that value never becoming an accepted tree root.
- `trustpage.ts` exposes a **scalar**, never an array — the type itself must be
  unable to hold a history — and reads the PDA by derivation, never via
  `getProgramAccounts` or `getSignaturesForAddress`.
- The member page renders a month, or nothing. No "not yet attested" line: an
  absent record and a member who never attested must look identical.
