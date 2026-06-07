# Ayni — ZK shamanic-lineage verification

How a shaman grants a level to a student so that the grant is **provably
legitimate** (the granter holds sufficient level and chains back to the World
Service root) **without revealing who the granter is**.

This is the design behind the `grant_level` instruction and the
`lineage_grant.circom` circuit.

---

## 1. Model

The lineage is an **append-only Poseidon Merkle tree** of *credentials*. Each
credential is a leaf:

```
leaf = Poseidon(identity_commitment, level)
identity_commitment = Poseidon(secret)        // secret known only to the holder
```

- The tree **root** lives on-chain in a `Lineage` account.
- The tree is bootstrapped with one **genesis credential** at the maximum
  level — the **World Service root** of authority.
- Every accepted grant **appends the new student's credential** to the tree, so
  the student can later become a granter themselves. The lineage grows as a
  living chain of transmission.

Members (students and shamans alike) are identified on-chain only by their
`identity_commitment` — a pseudonymous hash, never a wallet. This matches the
membership model (`Membership` is keyed by the same commitment).

## 2. What the proof establishes

When calling `grant_level(granted_level, grantee_commitment, nullifier, proof)`,
the Groth16 proof attests, in zero-knowledge, that the (hidden) granter:

1. **Knows the secret** behind some credential — i.e. it is really them.
2. That credential is **in the lineage tree** under the current on-chain `root`
   (Merkle inclusion) — so their authority traces back to World Service.
3. Their own level is **≥ the level being granted** (`granted_level ≤ issuerLevel`).
4. Binds the proof to **this specific student and level** (both are public
   inputs, so the proof can't be replayed for a different grant).
5. Emits a **nullifier** = `Poseidon(secret, grantee_commitment)` to prevent the
   same granter issuing the same student a duplicate grant.

The proof **reveals nothing** about which leaf, which level, or whose secret —
only that *a* valid authority within the lineage authorized this grant.

## 3. Public vs. private signals

Circuit `LineageGrant(depth)`:

| Signal | Visibility | Meaning |
|---|---|---|
| `root` | public input | current lineage Merkle root (must equal on-chain `Lineage.root`) |
| `grantedLevel` | public input | level being conferred (1..=issuerLevel) |
| `granteeCommitment` | public input | student's pseudonymous identity commitment |
| `nullifier` | public **output** | `Poseidon(secret, granteeCommitment)`; spent on-chain |
| `issuerSecret` | private | granter's secret |
| `issuerLevel` | private | granter's own level |
| `pathElements[depth]`, `pathIndices[depth]` | private | Merkle authentication path of the granter's credential |

**Public-signal order** (snarkjs convention: outputs first, then public inputs):
`[ nullifier, root, grantedLevel, granteeCommitment ]`. The on-chain verifier
builds its public-input array in exactly this order.

## 4. On-chain flow (`grant_level`)

1. Build public inputs `[nullifier, Lineage.root, field(grantedLevel), granteeCommitment]`.
2. **Verify** the Groth16 proof with `groth16-solana` against the embedded
   verifying key. Reject on failure (`InvalidLineageProof`).
3. **Spend the nullifier**: a `Nullifier` PDA seeded by the nullifier is created
   with Anchor `init` — if it already exists the tx fails, giving replay
   protection for free.
4. Require `grantedLevel > membership.level` (monotonic record).
5. **Append** the student's new credential
   `Poseidon(granteeCommitment, field(grantedLevel))` to the on-chain tree via
   incremental Poseidon insertion, updating `Lineage.root`.
6. Record a `LevelGrant` and set `membership.level = grantedLevel`.

Step 3 makes the granter pay through a **relayer** (`payer`) so their wallet is
never linked to the grant — see the metadata caveat in `IMPLEMENTATION.md`.

## 5. Hash-function compatibility (the #1 footgun)

The circuit (circomlib `Poseidon`) and the on-chain tree (Solana
`poseidon` syscall via `light-poseidon`) **must** use identical parameters:
**BN254, x⁵ S-box, the circom round constants** — i.e. `Parameters::Bn254X5`
with `Endianness::BigEndian`. `light-poseidon` exists precisely to be
circom-compatible, so this matches by construction — but any deviation (arity,
endianness, a different curve) silently breaks every inclusion proof.

Empty-subtree ("zero") hashes use `zeros[0] = field 0`,
`zeros[i+1] = Poseidon(zeros[i], zeros[i])`. The off-chain prover must use the
same zeros when reconstructing authentication paths.

## 6. Trusted setup

Groth16 needs a per-circuit trusted setup (Powers of Tau + a circuit-specific
phase-2 ceremony). The verifying key is compiled into the program
(`verifying_key.rs`). Re-running the ceremony ⇒ regenerate that file. See
`circuits/README.md` for the exact commands.

> The `verifying_key.rs` checked in now is a **zeroed placeholder**. The program
> will not verify real proofs until a ceremony is run and the key regenerated.

## 7. Threat notes / limits

- **Genesis trust:** whoever holds the genesis secret can mint authority freely.
  In practice the World Service Circle should hold it behind a Realms/Squads
  governance multisig, or split it with MPC.
- **Granter level confidentiality:** the proof hides `issuerLevel`, but
  `grantedLevel` is public — observers learn the *level conferred*, not the
  granter's level.
- **Nullifier linkage:** `Poseidon(secret, granteeCommitment)` is unique per
  (granter, student) pair, so it stops duplicate grants but does not link grants
  across different students. If you want to cap total grants per shaman, switch
  the external nullifier to an epoch and add a per-epoch counter.
- **Revocation** is not modeled: an append-only tree cannot un-grant. Add a
  separate revocation accumulator if a Circle needs to strip a level.
