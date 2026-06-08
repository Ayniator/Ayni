# Ayni — acknowledgment credentials (selective disclosure)

A course/initiation certificate: *portrait **PPP** followed course **CCC**, taught
by **XXX**, on date **DDD***. The holder chooses, **field by field**, what to
reveal and what to prove without revealing. Built on the same Poseidon + Groth16
stack as the lineage (docs/zk-lineage.md).

---

## 1. The credential is a commitment, not the facts

Four blinded per-field commitments, hashed into one root:

```
cP = Poseidon(ppp, saltP)      ppp = portrait/identity (e.g. hash of the image)
cC = Poseidon(ccc, saltC)      ccc = course id
cX = Poseidon(xxx, saltX)      xxx = teacher's lineage identity commitment
cD = Poseidon(ddd, saltD)      ddd = date (unix seconds)
R  = Poseidon(cP, cC, cX, cD)  ← only R is stored on-chain
```

`R` is held by the member as an `Acknowledgment` account (soulbound; a Metaplex
Core soulbound NFT may mirror `R` in metadata for wallet display — TODO CPI).
By default the chain reveals **nothing** about the four fields.

## 2. Issuance — issuer-anonymous attestation (reuses the lineage tree)

`issue_acknowledgment` records `R` only after verifying that a **real lineage
teacher authorized it, without recording which one**. It reuses the lineage
circuit and verifying key: the teacher proves they hold a lineage credential of
level ≥ `attest_level`, binding `R` in the circuit's `granteeCommitment` slot.

```
public inputs (same layout as grant_level):
  [ nullifier, lineage.root, attest_level, R ]
```

On success the program stores `Acknowledgment { root: R, member_commitment,
attest_level, issuer_attested: true, ... }` and spends an `ack_nullifier`
(replay protection). It does **not** grow the lineage tree or change levels. So
"taught by a genuine lineage holder of level ≥ N" is guaranteed on-chain, while
*which* teacher stays hidden inside `R`. A relayer pays, so the teacher's wallet
is never linked.

## 3. Disclosure — the holder picks what to show

The holder runs `circuits/ack_disclose.circom` (off-chain) and hands a verifier
the proof + public signals. Per field, three modes:

| Field | Reveal | Hide | Prove-without-revealing (ZK twist) |
|---|---|---|---|
| **PPP** portrait | show the image; proof binds `hash(image)` to `R` | omit it | (identity-binding variants) |
| **CCC** course | show the course | omit it | predicate on `ccc` (extend circuit) |
| **XXX** teacher | name the teacher (reveal `xxx`) | omit it | "is a real lineage teacher" — already guaranteed by `issuer_attested`, no reveal needed |
| **DDD** date | show the exact date | omit it | **`dateOk = (ddd ≥ dateLowerBound)`** — prove the cert is recent/old enough without revealing the date |

`revealF = 1` exposes `valueF == fieldF`; `revealF = 0` forces `valueF = 0`
(hidden). The circuit always re-derives `R` from the private opening and asserts
it equals the public `root`, so every disclosure is provably about the *same
authentic credential*.

Public signals (snarkjs order, outputs first):

```
[ dateOk, root, revealP, revealC, revealX, revealD,
  valueP, valueC, valueX, valueD, dateLowerBound ]
```

### Examples

- **Anonymous proof of skill:** reveal `CCC`, hide `PPP/XXX/DDD`. "I completed
  this course" — nothing else, not even who taught me or when.
- **Job application:** reveal `PPP, CCC, XXX, DDD` — the full certificate.
- **Still-valid check (gate):** reveal nothing; set `dateLowerBound = now − 1yr`
  and present `dateOk = 1`. "My certificate is less than a year old" without the
  date, the course, the teacher, or my face.
- **Lineage-backed but private:** reveal nothing; the verifier trusts
  `issuer_attested` on the on-chain `Acknowledgment` — "issued by a genuine
  lineage teacher" — while `XXX/CCC/DDD/PPP` all stay secret.

## 4. Verifying

A verifier checks two things:

1. The `root` in the proof's public signals equals the `root` of a real on-chain
   `Acknowledgment` account (and reads `issuer_attested` / `attest_level`).
2. The Groth16 disclosure proof verifies against the `ack_disclose` verifying key
   (`app/acknowledgment/prove.ts` → `verifyDisclosure`, or on-chain via the same
   `groth16-solana` verifier pattern with an `ack_disclose` VK).

If both hold, the verifier trusts the revealed values and proven predicates and
learns nothing else.

## 5. Notes & limits

- **A literal picture can't be both hidden and shown.** Hidden, `PPP` is just a
  commitment; revealed, it's the image whose hash the proof binds to `R`.
- **Extending predicates** (e.g. "CCC is in the accredited catalog", "XXX ∈ a
  named teacher set") means adding Merkle-membership sub-proofs to the circuit —
  for the *teacher set within the lineage*, that is literally
  `lineage_grant.circom`'s inclusion gadget. Kept out of the base circuit to keep
  it small.
- **Trusted setup:** `ack_disclose.circom` needs its own ceremony + verifying
  key, separate from the lineage one (see circuits/README.md). Issuance reuses
  the lineage VK and so needs no new ceremony.
- On the EVM track the off-the-shelf equivalent is **BBS+ / Privado ID**
  (multi-attribute selective disclosure + predicates without hand-written
  circuits).
