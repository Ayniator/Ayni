# ADR 0002 — Quantum resistance

## Status

**Accepted** — document the exposure and a migration trigger; **defer**
post-quantum signatures. This is the one item in the E10 set that was genuinely
undecided before this ADR.

## Context

Ayni's cryptography is entirely pre-quantum today, with **no migration seam**:

- **Signatures / accounts:** Ed25519 everywhere (Solana's native scheme; every
  wallet, every `payer`, the program upgrade authority).
- **ZK proofs:** BN254 Groth16 (`verifying_key*.rs`, snarkjs/circom pipeline).
  BN254 is a pairing curve whose security rests on discrete-log hardness.
- **Messaging:** X25519 (`nacl.box`) sealed boxes in `frontend/lib/messaging.ts`.

A cryptographically-relevant quantum computer breaks all three: Ed25519 and
X25519 (Shor on ECDLP) and BN254 pairings alike. There is **no `ProofAnchor`
abstraction**, no algorithm-agility field, no versioned verifier — a swap would
touch the circuits, the on-chain verifying keys, and the wallet layer at once.

The **only** hash-based, plausibly post-quantum piece is the Poseidon
commitments used for membership/nullifiers. A hash commitment does not save a
signature scheme, but it means the *identity-commitment* layer is less exposed
than the *authentication* layer.

## Decision

- **Do not build PQ signatures now.** The whole ecosystem Ayni depends on
  (Solana's Ed25519 accounts, the BN254 precompile-equivalent, wallet adapters)
  is pre-quantum; migrating ahead of the platform buys nothing and forks us off
  maintained tooling.
- **Write down the exposure** (this document) so it is a known, owned risk and
  not a silent one.
- **Set an explicit migration trigger.** Begin the PQ migration project when
  **any** of:
  1. Solana ships native support for a PQ signature scheme (account-level), or
  2. a standardized SNARK over a PQ-secure assumption (e.g. a STARK or a
     lattice-based proof system) is production-viable for our circuit sizes, or
  3. credible public estimates put a CRQC within ~10 years.

## Consequences

- Accepting a known future break: harvested ciphertext and on-chain signatures
  are retro-vulnerable. For a fellowship whose threat model is *social
  deanonymization now*, this is an acceptable trade against *cryptographic break
  later* — but it must be revisited at the trigger, not forgotten.
- **Design debt to pay before it is urgent:** introduce a `ProofAnchor` /
  verifier-version seam so a future scheme can be added without a flag-day. This
  is a pre-condition of a smooth migration and should be scheduled well before
  any trigger fires, but it is not blocking today.
- Nullifier/commitment data (Poseidon) is the most durable layer and least in
  need of change; plan the migration signatures-first.
