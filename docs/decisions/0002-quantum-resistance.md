# ADR 0002 — Quantum resistance

## Status

**Accepted** — a **staged migration architecture**, replacing the earlier
"document the exposure and defer" version of this ADR. The earlier version also
said "plan the migration signatures-first"; that ordering was wrong and is
reversed here: the only quantum threat that acts *retroactively* is
harvest-now-decrypt-later against encrypted data, so **messaging
confidentiality migrates first**, the proof system gets a seam second, and
wallet signatures — which Solana itself must migrate before Ayni can — come
last. The stages below are the decision; the F-numbers they spawn own the work.

## Context — the threat model, ranked

A cryptographically-relevant quantum computer (CRQC) runs Shor against every
discrete-log assumption Ayni uses: X25519 (messaging), Ed25519 (every wallet,
every payer, the upgrade authority), and BN254 pairings (Groth16,
`verifying_key*.rs`). But the three exposures are **not equally urgent**,
because only one of them reaches backward in time:

1. **Harvest-now-decrypt-later against encrypted data — retroactive, live
   today.** An adversary who records ciphertext now decrypts it the day a CRQC
   exists. This applies to everything sealed with `nacl.box`
   (`frontend/lib/messaging.ts`: `deriveBoxKeypair` + single-use ephemeral
   x25519). The F32 on-chain `Message` accounts are the worst case: ciphertext
   in **permanent, globally-replicated ledger history** — the harvest has
   already happened, by design of the chain. The F63 off-chain relay
   (`docs/messaging-migration.md`) shrinks the harvest window to relay
   retention, which is a real improvement but not immunity: a recording
   adversary between the parties still captures the x25519 key agreement.
   The on-chain `MessagingKey.box_pubkey` registry
   (`register_messaging_key.rs`) hands that adversary every long-term public
   key; Shor recovers the private half, and with it every non-forward-secret
   box ever sealed to it.
2. **ZK soundness (BN254 discrete log) — future-acting.** A CRQC forges
   Groth16 proofs: fake memberships, fake votes, fake attestations, at every
   verification site. This threatens *integrity from that day forward*, not
   the past. Critically, Groth16's **zero-knowledge is
   information-theoretic** (perfect ZK), so proofs already on chain do not
   retroactively deanonymize their provers. The commitments those proofs open
   are Poseidon hashes — preimage resistance degrades only **quadratically**
   under Grover (≈2^127 effective for a 254-bit field), so the identity
   commitments, nullifiers, and Merkle trees (`merkle.rs`) are the most
   PQ-robust layer Ayni has. The hash layer is fine; the *pairing* layer is
   the exposure.
3. **Signature forgery (Ed25519) — future-acting, chain-inherited.** A CRQC
   derives private keys from on-chain public keys and forges *future*
   transactions. It cannot rewrite signed history. And Ayni cannot fix this
   alone: Ed25519 is Solana's native account scheme. When Solana ships PQ
   signatures (hash-based signature proposals are the visible upstream
   direction), Ayni inherits them; migrating ahead of the platform forks us
   off maintained tooling for zero gain — the earlier ADR was right about
   that and it stands.

One more piece is not exposed at all: **Shamir 2-of-3 over the master secret
(`frontend/lib/sharding.ts`) is information-theoretically secure.** A single
shard reveals *nothing* about the secret to an adversary with unbounded
compute, quantum or otherwise. The shards at rest have no quantum exposure —
full stop. What is exposed is the *derived* keys (Ed25519 wallet, x25519 box
key), and the derivation seam already exists (`deriveFromMaster`,
domain-separated tags), which is exactly the hook a PQ migration needs.

## Decision

**Priority order:** messaging confidentiality (retroactive threat) → proof
system seam (integrity, needs lead time) → wallet signatures (chain-inherited,
last). Recovery and shard custody need no cryptographic migration; the locked
positions in `CLAUDE.md` (recovery emits nothing on chain, credential of
record = master secret) are untouched by every stage below.

### Stage 0 (now): this ADR + the exposure inventory

Every cryptographic surface, its threat, and who owns its migration, in one
table. This is the baseline Sentinel and future ADRs measure drift against.

| Surface | Primitive | Quantum threat | Retroactive? | Migration owner |
|---|---|---|---|---|
| F32 on-chain `Message` ciphertexts | x25519 `nacl.box`, sealed sender | Shor → decrypt; ledger history is a permanent harvest | **Yes — already harvested** | Stage 1 + F32 sunset (ADR 0001) |
| F63 relay messages (target design) | X3DH + double ratchet over x25519 | Shor → decrypt anything recorded in transit/retention | Yes, within harvest window | Stage 1 (hybrid KEM / PQXDH) |
| `MessagingKey.box_pubkey` registry | x25519 public key on chain | Shor → private key recovery | Amplifies the above | Stage 1; rebindable today (`init_if_needed`) |
| Groth16 proofs, 3 verifying keys, 6 verify sites | BN254 pairings | Shor → **proof forgery** (fake members/votes) | No — past ZK is information-theoretic | Stage 2 (ProofAnchor seam → PQ proof system) |
| Poseidon commitments, nullifiers, Merkle trees (`merkle.rs`) | Poseidon hash over BN254 field | Grover only — quadratic preimage degradation | No | **None needed** — survives Stage 2 unchanged |
| Master secret + Shamir shards (`sharding.ts`, `shardHandover.ts`) | Shamir 2-of-3, GF(256), audited lib | **None — information-theoretic** | No | None at rest; Stage 3 adds PQ derivation branches |
| Wallet keys, tx signatures, upgrade authority | Ed25519 (Solana native) | Shor → forge **future** txs from public keys | No | Stage 4 — Solana upstream; Ayni keeps rebind paths |

### Stage 1: F63 v2 messaging goes hybrid — the only urgent stage

> **Status 2026-08-17 — first half SHIPPED as F103.** The v1 prekey sealing
> layer is hybrid now: v2 bundles carry a wallet-co-signed ML-KEM-768 key,
> v2 envelopes seal under a KDF of both shared secrets (either assumption
> surviving keeps the plaintext safe), via the audited `@noble/post-quantum`.
> See `docs/messaging-migration.md` (F103 note) and `tests/mailbox.ts`. The
> PQXDH-through-libsignal half still lands with the v2 ratchet, as below —
> F103 means the ratchet arrives on an already-hybrid base.

When F63 delivery is built, its session establishment is **hybrid from the
start**: X25519 **and** ML-KEM-768, combined so that the session secret is
secure if *either* survives. This is precisely what libsignal's **PQXDH** does
(X3DH's DH handshake plus an ML-KEM encapsulation, KDF-combined), and
`docs/messaging-migration.md` §2.5 already commits to the libsignal adapter
rather than hand-rolled ratchet code — **adopt PQXDH through that adapter**
when it lands. The double ratchet's forward secrecy then bounds what any
future decryption of a compromised session can reach. F32's on-chain
ciphertexts cannot be un-harvested; the honest mitigation is the one ADR 0001
already orders — sunset on-chain messaging — plus telling members plainly
that pre-F63 messages carry this exposure.

### Stage 2: the ProofAnchor seam

Today all six on-chain Groth16 verification sites — `cast_vote`,
`attest_admission_zk`, `prove_personhood`, `grant_level`,
`issue_acknowledgment`, `verify_disclosure` — each construct
`Groth16Verifier::new(...)` against one of three embedded verifying keys. A
proof-system swap today is a six-site, program-wide rewrite. The seam fixes
that shape:

- **One internal module boundary:** every site calls
  `verify_anchored_proof(kind, public_inputs, proof)` where `kind` selects
  the (circuit, verifying key) pair. The verifier construction, key
  selection, and proof deserialization live in *one* module.
- **A `proof_system: u8` version byte** in every *new* proof-carrying
  account (`0 = Groth16-BN254`), so a future system can coexist during a
  migration window instead of a flag-day.
- **What a swap then costs:** re-express the circuits in the new system, a
  re-ceremony (or none, if the successor is transparent — a STARK needs no
  trusted setup), and one module's verifier. The Poseidon commitments,
  nullifier scheme, and Merkle trees **survive unchanged** — they are hashes,
  and any plausible successor (STARK or lattice SNARK) proves the same
  Poseidon relations. That is the payoff of having kept identity in the hash
  layer.

The seam is cheap now and impossible to retrofit calmly under a live
soundness break. It is the one piece of Stage 2 to schedule *before* any
external trigger.

### Stage 3: master secret and shards — say plainly what is already safe

Shamir sharing is information-theoretically secure: **the shards at rest have
no quantum exposure, and no PQ migration of the sharding layer is needed.**
The QR/NFC handover path (`shardHandover.ts`, no network code path) moves
opaque blobs and is likewise indifferent. What Stage 3 adds is derivation:
`deriveFromMaster` already yields domain-separated keys
(`aha-zk-secret-v1`, `aha-wallet-seed-v1`); when Stages 1–4 need PQ keypairs,
they derive from the **same master secret** under new tags (e.g.
`aha-pq-kem-v1`). The credential of record does not change, recovery
reconstructs the same secret bit-identically, and recovery remains a purely
local event emitting nothing on chain — the locked positions hold through the
entire migration.

### Stage 4: wallet and chain signatures — tracked upstream, not built here

Solana must ship PQ account signatures before Ayni can use them; this stage
is a **watch item**, not a work item. Ayni's own obligation is narrower and
already mostly met: **create no new long-lived Ed25519 commitment that cannot
be rotated.** The rebind paths exist — `member_migrate` (self-recovery,
F9-adjacent), the Council `MigrateWallet` proposal path (F10/F11), and
`register_messaging_key`'s `init_if_needed` rebind for the box key. These
were built as social-recovery features; they are equally the quantum-day
migration rails, because "move every account to a new key type" is just
wallet migration at scale. Keep every future account type rebind-capable;
Sentinel should treat a raw stored `Pubkey` with no rebind path as a finding.

### What we deliberately do NOT do now

- **No hand-rolled PQ crypto**, ever — same rule that put Shamir behind an
  audited library.
- **No PQ library dependency** until Stage 1 lands it with a vetted
  implementation (liboqs / ML-KEM via audited bindings, or libsignal's own
  PQXDH), so no half-integrated Kyber sits unexercised in the tree.
- **No on-chain PQ verification** before the ProofAnchor seam exists —
  PQ proof systems are orders of magnitude larger to verify, and without the
  seam there is nowhere sane to put one.
- **No pre-empting Solana** on account signatures (unchanged from the earlier
  ADR).

## Consequences

- The retroactive exposure is honestly bounded: F32 on-chain ciphertexts are
  already permanently harvestable and only sunset (ADR 0001) plus disclosure
  addresses them; F63+PQXDH closes the harvest window for everything after.
- Stage 2's seam is scheduled work with no external trigger needed; the
  *swap* behind the seam waits for a production-viable PQ proof system at our
  circuit sizes. The earlier ADR's triggers (Solana PQ signatures; viable PQ
  SNARK; credible ~10-year CRQC estimates) remain the triggers for Stages 2's
  swap and 4.
- The most durable layers — Poseidon commitments and Shamir shards — need no
  change; the migration never touches the credential of record or the
  off-chain-silence of recovery.
- New account types carry `proof_system` bytes and rebind paths from birth;
  that discipline, not any new cryptography, is the cost this ADR imposes on
  day-to-day work.

## Summary (BACKLOG-citable)

**Quantum:** staged, priority = retroactivity. Stage 1 hybrid PQXDH
(X25519+ML-KEM-768) in F63 v2 messaging — the only retroactive threat; Stage 2
`ProofAnchor` seam over the six Groth16 sites + `proof_system` byte (Poseidon
layer survives); Stage 3 nothing — Shamir is information-theoretic, PQ keys
derive from the same master secret; Stage 4 Ed25519 inherited from Solana,
Ayni keeps every key rebindable meanwhile.
