# Ayni — anonymous member voting (one member, one vote)

Group-conscience voting by the whole membership on ideas and material/
documentation changes — distinct from the 7-seat Council (which handles seats and
key recovery). One member = one vote, cast **anonymously**.

## Model

- Every member's identity commitment `Poseidon(secret)` is a leaf in a per-Circle
  **member-set Merkle tree** (`MemberTree`), inserted at `issue_membership`.
- A **`MemberProposal`** snapshots the member-set root at creation, so the
  eligible roll can't shift mid-vote. Its text is off-chain; `description_hash`
  commits to it (e.g. an IPFS CID hash).
- A vote is a Semaphore-style ZK proof (`circuits/member_vote.circom`): the voter
  proves their commitment is in the snapshot root and emits a **nullifier**
  `Poseidon(secret, proposalId)`. The nullifier PDA enforces **one vote per
  member**; the voter's identity is never revealed. A relayer pays, so the
  ballot isn't linked to a wallet.

## Flow

| Instruction | Who | Effect |
|---|---|---|
| `initialize_member_tree(depth)` | circle `authority` | create the votable set (once) |
| `issue_membership(...)` | authority (vouching) | also inserts the member into `MemberTree` |
| `create_member_proposal(nonce, hash, period)` | a Council seat | open a proposal; snapshot root + eligible count |
| `cast_vote(choice, nullifier, proof)` | any member (anon, via relayer) | verify proof → spend nullifier → tally |
| `finalize_member_proposal()` | anyone, after deadline | record outcome: quorum (⅓) + `yes > no` |

The ballot **`choice`** is public per-vote (a secret ballot whose content is
visible but whose caster is not). Coercion-resistance (hiding *how* each member
voted) would layer MACI on top — an open upgrade.

## Notes

- **Proposal creation is Council-gated** (a trusted servant records the agenda
  item raised at a meeting). Voting is open to all members, anonymously.
- **Quorum/majority** are a simple default (⅓ turnout, simple majority);
  thresholds can be made per-Circle config later.
- **Execution** of a passed conscience (applying a doc/material change) is
  off-chain or a follow-up governance action; this records the decision.
- **Trusted setup:** `member_vote.circom` has its own VK (`verifying_key_vote.rs`),
  reused for proof-of-personhood at issuance (docs/sybil — same inclusion +
  nullifier shape).
