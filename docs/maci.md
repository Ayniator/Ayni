# MACI — coercion-resistant member voting (design + status)

MACI (Minimal Anti-Collusion Infrastructure) makes vote-buying and coercion
ineffective: an observer — including a briber holding a gun or a wallet — cannot
tell how anyone voted, and a coerced voter can **silently override** their vote.
On AHA this layers on top of the existing anonymous member vote (F6,
`member_vote` circuit) for high-stakes decisions (e.g. seat elections, F28).

## How MACI defeats coercion

1. **Sign-up.** Each eligible member is the existing membership set (the member
   Merkle tree). A voter registers a MACI public key.
2. **Publish (sealed).** A voter submits an **encrypted command** — a vote
   *or a key-change* — sealed to the **coordinator's** key. Because it's
   encrypted, the chain reveals nothing about the choice (receipt-freeness).
3. **Override.** Commands are append-only and the coordinator applies
   **last-valid-per-voter**. A coerced voter can publish a later vote, or a
   **key-change** that makes every command signed by the coerced key invalid —
   so a briber can never be sure the paid-for vote counted.
4. **Tally with proof.** The coordinator decrypts the queue off-chain, applies
   the state transitions, and submits the result with a **ZK proof** that it
   processed the queue honestly (no censoring, no miscounting). Nobody has to
   trust the coordinator's honesty — only its availability.

The coordinator can decrypt *who could change a vote* but the protocol's ZK
proofs stop it from altering the outcome; combined with key-changes, this yields
collusion resistance.

## On-chain (implemented — the submission layer)

| Account / ix | Role | Status |
|---|---|---|
| `MaciRound` (`["maci", proposal]`) | round state: coordinator key, message_count, processed, tally_hash | ✅ |
| `open_maci_round(coordinator)` | any seat opens a round over a member proposal | ✅ |
| `MaciMessage` (`["macimsg", round, index]`) | one sealed, fixed-length command | ✅ |
| `publish_maci_message(eph_pubkey, ciphertext)` | append a sealed command (permissionless, append-only) | ✅ |

Ciphertext is a NaCl box to the coordinator with a single-use ephemeral key,
padded to a constant 176 bytes — so size and sender leak nothing, mirroring the
sealed-sender messaging design. Client helpers: `frontend/lib/maci.ts`.

## Remaining work (the coordinator + circuits — the large part)

1. **Coordinator service** — watches `MaciMessage`s, maintains the state tree
   (voter pubkey → latest valid vote / voice credits), and produces:
   - **`process_messages` circuit** — proves the batch of messages was applied to
     the state tree correctly (validating signatures, applying key-changes and
     last-vote-wins, ignoring invalid commands) without revealing contents.
   - **`tally` circuit** — proves the final per-option tally is the correct sum
     over the state tree.
2. **On-chain verification** — `submit_maci_tally(proof, tally_hash, results)`
   verifies the tally proof against a deployed VK (same groth16-solana path as
   `member_vote` / `lineage_grant`) and writes `tally_hash` + results into
   `MaciRound`; `processed = true`. For a seat election, a passing tally then
   feeds `install_elected_seat`.
3. **Multi-party coordinator** (mainnet) — split the coordinator key across an
   MPC so no single party can decrypt the queue.
4. **Browser client** — key registration + sealed publish + the local key-change
   UX ("re-vote / panic-rekey").

This is a multi-month cryptographic build (two new circuits + a trusted-setup
ceremony + the coordinator). The submission layer above is the foundation; the
processing/tally circuits are the security-critical remainder and are **not yet
implemented** — until then a `MaciRound` collects sealed commands but no verified
tally is produced. Do not present MACI rounds as final-tallied until step 2 ships.

See also: `docs/member-voting.md` (the F6 anonymous ballot this builds on).
