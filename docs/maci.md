# MACI — coercion-resistant member voting

MACI (Minimal Anti-Collusion Infrastructure) exists for one situation: a member
can be *made to show* how they voted — by a landlord, a partner, an employer, a
briber, a court — and the vote must still be theirs. The mechanism is that a
later command, signed with a key the coercer does not hold, silently overrides
the earlier one, and **nothing on chain reveals which commands were overridden**.

This document says exactly what the implementation achieves, and exactly where
it falls short. The short version: **ordering, completeness and the electorate
are enforced by the program; the arithmetic of the tally is not — so on-chain
tallying is DISABLED.** If you take one thing from this page, take that sentence.

> ## ⚠️ Status: tallying is disabled on chain
>
> `commit_maci_tally` and `finalize_maci_round` **refuse to execute**
> (`MaciTallyUnverified`). The chain cannot verify a MACI tally without the
> `process_messages` / `tally` circuits and their ceremony (**F44**), and an
> unverified result must not be allowed to decide seats or treasury — see §4.1.
>
> The other six instructions — `open_maci_round`, `maci_signup_commit`,
> `maci_signup`, `publish_maci_message`, `close_maci_round`,
> `process_maci_messages` — are **enabled and sound**: their replay, reorder,
> censorship and front-running guards are enforced by the program and were
> independently reconfirmed by Sentinel (§3).
>
> So a round today can be opened, signed up for, voted in, frozen and folded —
> producing an immutable, publicly recomputable commitment to exactly which
> sealed commands were cast. The result can be computed and audited **off
> chain** (`coordinatorTally` in `frontend/lib/maci-command.ts`); it simply
> cannot be recorded on chain, and nothing on chain acts on it.

See also `docs/member-voting.md` (the F6 anonymous ballot this builds on).

---

## 1. The round, end to end

| Step | Instruction | Who | What it establishes |
|---|---|---|---|
| Open | `open_maci_round(coordinator, challenge_secs)` | any Council seat | Registers the coordinator's x25519 key, creates `MaciState`, and **takes the proposal off the plain-ballot path** |
| Sign up (1) | `maci_signup_commit(commitment)` | anyone (relayed) | Publishes `H("AHA-maci-signup" ‖ round ‖ nullifier ‖ maci_pubkey)` |
| Sign up (2) | `maci_signup(pubkey, nullifier, proof)` | anyone (relayed) | ZK proof of membership in the proposal's snapshotted set; registers one voting key |
| Vote | `publish_maci_message(eph_pubkey, ciphertext)` | anyone (relayed) | Appends one sealed, fixed-size command |
| Freeze | `close_maci_round()` | **anyone**, after the deadline | Snapshots the message count; refuses new commands |
| Fold | `process_maci_messages(count)` | **anyone** (crank) | Folds messages into `chain_digest`, in strict index order |
| Tally | `commit_maci_tally(yes, no, plaintext_digest)` | the coordinator only | **DISABLED** (§4.1). Would publish and bind the claimed result |
| Finalize | `finalize_maci_round()` | **anyone**, after the dispute window | **DISABLED** (§4.1). Would record the outcome in `MaciState` — never on the proposal |

Accounts: `MaciRound` `["maci", proposal]` · `MaciState` `["macistate", round]` ·
`MaciMessage` `["macimsg", round, index]` · `MaciSignup` `["macisignup", round,
pubkey]` · `MaciSignupCommit` `["macicommit", round, commitment]` · sign-up
nullifier `["macinull", round, nullifier]`.

Client: `frontend/lib/maci.ts` (chain plumbing) and `frontend/lib/maci-command.ts`
(the command format, the state machine and every audit digest — pure, so a third
party can run it). Tests: `tests/maci-machine.ts` (the rules) and `tests/maci.ts`
(the round, on chain, with real proofs).

---

## 2. The command format and the state machine

A command is 141 bytes, padded to 160 and sealed to the coordinator in a
176-byte NaCl box with a single-use ephemeral key. **Every sealed command is the
same size and the same shape**: a key change is indistinguishable from a vote,
on chain, to everyone except the coordinator.

```text
 0..4    magic "AHM1"
 4..36   state_key   — the SIGN-UP key this command acts for (the state index)
36..68   new_key     — the key that must sign this voter's NEXT command
68..76   nonce (u64 LE)
76..77   vote        — 0 = no, 1 = yes, 2 = abstain
77..141  ed25519 signature over "AHA-maci-cmd" ‖ round ‖ bytes[0..77]
```

Application rules (`applyMaciQueue`):

1. Unknown `state_key` ⇒ dropped. The sign-up key never changes, so a key change
   does not orphan the voter's slot.
2. A voter's commands are applied in **ascending nonce** order, ties broken by
   message index. The result is therefore a function of the *set* of messages,
   not of the order they were published in — no sequencer, relayer or coordinator
   gains anything by shuffling the queue.
3. A command must be signed by the voter's **current** key and carry a nonce
   strictly greater than the last applied. Otherwise dropped.
4. Applying a command sets the vote **and** rotates the current key to `new_key`.

Rule 4 is the coercion defence. Rule 2 is what makes the tally reproducible.
Registered voters who never command are abstentions and count toward neither
column (and therefore not toward turnout, exactly like a member who does not
vote on a plain ballot).

---

## 3. What is genuinely enforced, without trusting anyone

**One member, one voice.** `maci_signup` verifies a `member_vote.circom` proof
against the proposal's snapshotted member root and creates a nullifier PDA at
`["macinull", round, nullifier]`. A second sign-up from the same membership
fails on account creation. The member is not named: the proof says "some member
of this set", and the fee is relayed.

**No ballot stuffing.** `commit_maci_tally` refuses if `yes + no >
signup_count`. Votes cannot be conjured from outside the electorate, and
`signup_digest` — folded by the program at each sign-up — pins exactly which
keys that electorate contained.

**No censoring, no stuffing, no reordering of the queue.**
`process_maci_messages` walks the message PDAs in strict ascending index order
from `processed_count`, verifies each one is this round's message at that index
(program-owned, canonical PDA, right discriminator, right length), and folds

```text
chain_digest ← H(chain_digest ‖ index ‖ eph_pubkey ‖ ciphertext)
```

`commit_maci_tally` refuses unless `processed_count == frozen_message_count`. So
the coordinator's tally is bound to a digest **the program itself computed over
every published message and nothing else**. The crank is permissionless: anyone
can drive it, so the coordinator cannot stall it.

**No replay, no re-ordering of processing.** A message is foldable only when its
index equals `processed_count`, which only advances. Feeding the same account
twice, skipping one, or submitting a batch out of order all fail.

**No holding the window open or shutting it early.** `close_maci_round` is
permissionless and refuses before the proposal's deadline. The coordinator can
neither keep collecting overrides after learning where things stand, nor shut
the queue to censor a late one.

**No sign-up front-running.** The `member_vote` circuit has no input for the
MACI key, so a sign-up proof does not bind the key it registers (adding one
means a new circuit and a new trusted setup — F44, out of scope). Without a
guard, anyone who saw a sign-up transaction could re-submit the same proof with
their own key and steal the member's vote. Sign-up is therefore commit–reveal:
the commitment must be **strictly older** than the reveal, and an attacker only
learns the nullifier from the reveal itself, by which time no earlier commitment
of theirs can exist.

**No proof re-aiming into a public ballot.** A sign-up uses a domain-separated
external nullifier, `H("AHA-maci-signup-nul" ‖ round)`. If it reused the plain
ballot's `proposalId`, a sign-up proof would be byte-identical to a *yes* ballot
proof and could be replayed into `cast_vote` — turning a sealed vote into a
public YES. It also keeps the two nullifiers uncorrelated.

**No double counting against the plain path.** `open_maci_round` marks the
member proposal finalized, which makes `cast_vote` and `finalize_member_proposal`
refuse it, and refuses to open over a proposal that already carries ballots.
A proposal is either a plain ballot or a MACI round, never both, and never in a
race between the two.

**The same conscience threshold.** `finalize_maci_round` calls the *same*
`member_vote_outcome` as `finalize_member_proposal`, against the same
`CircleConfig` quorum/pass thresholds (created on first use with safe defaults,
bound to the Circle by seeds) and the same `eligible_count`. Sealed voting does
not buy a Circle a laxer bar. Finalization is permissionless after the dispute
window, so a coordinator cannot sit on a result it dislikes.

**An unverified tally decides nothing — and cannot even be recorded.** See
§4.1. This is the single most important structural property of the
implementation, and the six instructions listed above are exactly the ones that
remain enabled.

---

## 4. What is NOT enforced — the coordinator trust assumption

**The chain cannot check the tally.** The commands are sealed to the
coordinator; verifying "these ciphertexts, under the MACI rules, sum to 12 yes
and 9 no" without revealing them requires `process_messages` and `tally`
circuits, a trusted-setup ceremony for each, and an on-chain verifier. Those do
not exist here, and creating them is F44, deliberately out of scope. **This
implementation does not have ZK-verified tallying, and nothing in the UI or the
registry may say otherwise.**

What we have instead is a **committed, publicly recomputable tally**:

* `commit_maci_tally` publishes `yes`, `no`, and `plaintext_digest` — a
  commitment to the exact ordered sequence of decrypted commands the coordinator
  claims to have applied (one status byte + the 160-byte padded plaintext per
  message, hashed).
* `MaciState.tally_hash` (mirrored into the long-unused `MaciRound.tally_hash`)
  binds all of it together:
  `H("AHA-maci-tally" ‖ round ‖ chain_digest ‖ signup_digest ‖ signup_count ‖ yes ‖ no ‖ plaintext_digest)`.
* Only the wallet that opened the round can sign it, and it is committed before
  anyone can argue about it.

### How a wrong tally is proven

A NaCl box is authenticated. If the coordinator publishes, per message, the
X25519 shared secret `DH(eph_pubkey, coordinator_sk)`, anyone can open the
ciphertext themselves and the Poly1305 tag will only verify for the *correct*
shared secret — so a published witness is a **self-verifying decryption**, not a
claim. An auditor then:

1. rebuilds `chain_digest` from the message accounts and checks it against
   `MaciState` (`auditMaciRound` does this without any secret at all);
2. rebuilds `signup_digest` from the `MaciSignup` accounts;
3. opens every message with the published witnesses, checks the plaintexts hash
   to `plaintext_digest`, and re-runs `applyMaciQueue`;
4. recomputes `tally_hash` and compares.

A coordinator that cheated cannot produce witnesses matching its committed
`plaintext_digest` and its committed `yes`/`no` at the same time. So it must
either be caught by the arithmetic, or publicly refuse to open the round. That
is what the `challenge_secs` dispute window between `commit_maci_tally` and
`finalize_maci_round` is for.

### 4.1 An unverified tally must not decide anything — so it is disabled

The first draft of `finalize_maci_round` wrote `passed` onto the
`MemberProposal`. Sentinel flagged that as CRITICAL
(`reports/sentinel/NRR-2026-08-12-f60-f61-maci.md`) and was right:
`install_elected_seat` and `refill_faucet` read `MemberProposal.passed`
**unconditionally**, and opening a round costs one seat signature. An unverified
coordinator claim would therefore have been able to install a Council seat or
move treasury→jar, bypassing the 4-of-7 that every other consequential action
requires.

There are now **two independent guards**, and both must be removed together —
deliberately, and only alongside a verified tally:

1. **The instructions refuse to execute.** `commit_maci_tally` and
   `finalize_maci_round` both `return Err(MaciTallyUnverified)` as their first
   statement. Their bodies are kept intact below the guard, and accounts,
   layouts and the IDL are unchanged, so re-enabling is a deletion rather than a
   migration.
2. **The consumer is severed.** Even with guard 1 gone,
   `finalize_maci_round` writes `passed` **only into `MaciState`** — the
   `MemberProposal` account is read-only there (it supplies `eligible_count` for
   the quorum, nothing more). And `open_maci_round` leaves the proposal at
   `finalized = true, passed = false` for the whole life of the round, so
   `install_elected_seat` and `refill_faucet` stay fail-closed throughout.

`tests/maci.ts` asserts both — behaviourally (the deployed program returns
`MaciTallyUnverified`) and structurally (the guard line is present and the
proposal write is absent). It fails if either is quietly removed.

What a round produces meanwhile is a **publicly recomputable group conscience**,
computed and audited off chain from the on-chain commitments. Connecting a MACI
result to an automatic on-chain consequence is gated on F44's ZK-verified tally,
and must not be done by relaxing these instructions.

### The honest residual, stated plainly

* **A coordinator willing to be caught can still publish a false tally** — off
  chain, since the on-chain path is disabled. What the design removes is
  deniability (the digests pin the inputs) and any automatic consequence; it does
  not remove the possibility of the lie itself.
* **The reveal costs receipt-freeness for that round.** Opening the queue shows
  every key change, which is exactly what a coercer wants. A coercer with the
  means to force a dispute can therefore trade the round's secrecy for the
  audit. Treat a reveal as a last resort that voids the round's coercion
  resistance retroactively.
* **A member cannot verify that their own vote was counted.** Any per-voter
  receipt is, by construction, a receipt — the thing MACI exists to abolish.
  This is inherent to MACI, not a shortcut taken here.
* **The coordinator sees everything.** It decrypts every command, so it knows
  who key-changed and how everyone voted. It cannot prove any of that to a third
  party (nothing binds a sign-up key to a person), but it is not blind. Real
  MACI deployments split this key across an MPC; that is still future work
  (`challenge_secs` and a named `coordinator_authority` are the interim
  accountability).
* **A Circle may set `challenge_secs = 0`.** Then there is no window and the
  coordinator is trusted outright until someone disputes after the fact. The
  client defaults to 24 h; 0 exists so tests and low-stakes rounds can run. (The
  window only bites once §4.1's guards are lifted.)

---

## 5. Coercion scenarios: defeated, and not

**Defeated.**

* *"Vote yes in front of me."* The voter signs and publishes a YES under the key
  the coercer is watching. Earlier, alone, they published a key change carrying
  their true vote. The watched command is signed with a dead key and is dropped.
  Same size, same shape, same silence on chain.
* *"Give me your key and I'll vote for you."* Identical outcome — the surrendered
  key no longer speaks for the voter.
* *"Show me the chain and prove you voted my way."* There is nothing to show.
  Ciphertexts are constant-size and unlinkable to a member; the fee-payer is the
  relayer; the tally publishes only totals; no account, log, or event says which
  messages were applied or overridden.
* *"I'll pay you per vote."* The briber cannot verify delivery, which is the
  same property, and is why MACI is described as collusion-resistant.
* *"I'll flood the queue so your override never lands."* Messages are
  permissionless and append-only; every published message is folded, and the
  program refuses a tally over an incomplete queue. Flooding costs rent and
  achieves nothing.
* *"I'll get the coordinator to drop your message."* It cannot: `chain_digest`
  is computed on chain over every message.

**NOT defeated.**

* **Surveillance from before sign-up.** A coercer who watches the member from
  the moment they sign up, holds the sign-up key, and rotates it to a key of
  their own has captured the slot for the round. There is no later command the
  member can sign. This is MACI's standard boundary: the guarantee assumes the
  voter can act *privately at least once*. A member under total surveillance is
  not protected by this or any MACI.
* **Device compromise.** Malware that reads the current signing key sees, and
  can forge, everything.
* **A dishonest coordinator, at the moment of the tally.** See §4. Detectable
  and non-deniable; not impossible.
* **A coordinator + a coercer, cooperating.** The coordinator can privately tell
  a coercer how a given sign-up key voted. Nothing here prevents that; a
  threshold/MPC coordinator would.
* **Traffic analysis outside the chain.** The relayer sees the submitting IP and
  timing (`docs/messaging-migration.md` §3, the standing residual). Publishing
  a command from a coerced device at a coerced moment is visible to the network,
  even though its content is not.
* **Sign-up is public.** Who is entitled to vote is deliberately public (it is
  a set of keys, unlinked to identities); *how* they voted is not. A coercer
  learns nothing from the sign-up list that they did not already know.

---

## 6. Operating a round

1. A seat generates an x25519 keypair, keeps the secret **offline and backed
   up** — losing it makes the round untallyable — and calls `open_maci_round`
   with a 24 h `challenge_secs`.
2. Members sign up (commit, then reveal one slot later). Provisional members are
   not in the member tree and cannot sign up.
3. Members publish commands. The UI must offer "change my key" as a first-class,
   unremarkable action — a key change that only frightened people use is a
   signal. `publishMaciKeyChange` returns the new secret; the old one is burnt.
4. After the deadline anyone runs `closeMaciRound`, then `crankMaciMessages`
   (20 messages per transaction).
5. The coordinator computes the result locally with `coordinatorTally`
   (decrypt → `applyMaciQueue` → digests). **`commitMaciTally` currently reverts
   with `MaciTallyUnverified`** (§4.1): the result is published to the Circle out
   of band, together with the digests, not written on chain.
6. Anyone runs `auditMaciRound` — without secrets it already verifies the chain
   and electorate digests. If the result is contested, the coordinator publishes
   the per-message shared secrets and everyone re-derives the tally.
7. `finalizeMaciRound` — which would record `MaciState.passed` under the
   Circle's own quorum/pass policy — **also reverts today** (§4.1). Acting on a
   MACI result — installing a seat, releasing funds — is therefore a separate,
   human, 4-of-7 Council decision, and must stay one until the chain can verify
   the tally.

## 7. Still open

* `process_messages` / `tally` circuits + ceremony (**F44**) — the only thing
  that removes the coordinator's ability to lie at all, and the precondition for
  re-enabling `commit_maci_tally` / `finalize_maci_round` at all (§4.1).
* Threshold / MPC coordinator, so no single party decrypts the queue.
* Relayer allowlist entries for `maci_signup_commit` and `maci_signup` in
  `frontend/lib/relayPolicy.ts`; until they are added, those two instructions
  self-pay and name the member's wallet as fee-payer (the client falls back
  automatically, and the UI must say so).
* A voting UI for the round lifecycle, including the panic-rekey affordance.
