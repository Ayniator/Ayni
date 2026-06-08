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
| **CCC** course | show the course | omit it | **`courseAccredited`** — prove `ccc ∈ catalog` (Merkle) without naming the course |
| **XXX** teacher | name the teacher (reveal `xxx`) | omit it | **`teacherRecognized`** — prove `xxx ∈ recognized-teacher set` (Merkle) without naming the teacher; *or* rely on on-chain `issuer_attested` ("a real lineage teacher") |
| **DDD** date | show the exact date | omit it | **`dateOk = (ddd ≥ dateLowerBound)`** — prove the cert is recent/old enough without revealing the date |

`revealF = 1` exposes `valueF == fieldF`; `revealF = 0` forces `valueF = 0`
(hidden). The circuit always re-derives `R` from the private opening and asserts
it equals the public `root`, so every disclosure is provably about the *same
authentic credential*.

**Predicate extensions** (each has an `enable` flag, so one circuit serves every
combination):
- **Course-in-catalog:** the holder proves `ccc` is a leaf of a public
  `catalogRoot` (accredited courses) without revealing `ccc`. The verifier MUST
  pin `catalogRoot` to the trusted published root.
- **Teacher-in-set:** the holder proves `xxx` is a leaf of a public
  `teacherSetRoot` (recognized teachers) without revealing `xxx`. Same pinning
  requirement. The set is public, so the holder (who knows `xxx`) can build the
  path themselves — unlike the *lineage* tree, which needs the teacher's own
  witness and is therefore attested at issuance instead.

Public signals (snarkjs order, outputs first — 17 total):

```
[ dateOk, courseAccredited, teacherRecognized, root,
  revealP, revealC, revealX, revealD, valueP, valueC, valueX, valueD,
  dateLowerBound, catalogRoot, enableCatalog, teacherSetRoot, enableTeacherSet ]
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
   (`app/acknowledgment/prove.ts` → `verifyDisclosure` off-chain, or on-chain via
   `verify_disclosure`).

If both hold, the verifier trusts the revealed values and proven predicates and
learns nothing else.

### On-chain predicate-gated access (`verify_disclosure`)

For access that must be enforced on-chain (entry to a ceremony, a resource, a
higher circle), the `verify_disclosure` instruction:

1. pins `public_inputs[root]` to an on-chain `Acknowledgment`;
2. enforces a `DisclosureGate` — which predicate outputs must be `1`
   (`require_date_ok` / `require_course_accredited` / `require_teacher_recognized`)
   and, for the set predicates, that the proof's `catalogRoot` / `teacherSetRoot`
   equal the gate's **pinned** expected roots (else a prover could supply a
   self-made set);
3. verifies the Groth16 proof against `VERIFYING_KEY_ACK`;
4. mints an **`AccessPass`** PDA (`seeds = ["access", gate, acknowledgment]`) —
   durable proof of eligibility a downstream program checks by existence.

So a gate like *"holders of a course in the accredited catalog, certificate less
than a year old"* is enforced on-chain while the course, teacher, date, and face
all stay private.

## 5. Notes & limits

- **A literal picture can't be both hidden and shown.** Hidden, `PPP` is just a
  commitment; revealed, it's the image whose hash the proof binds to `R`.
- **Predicate roots are pinned by the verifier.** `courseAccredited` /
  `teacherRecognized` only mean something if the verifier checks the proof's
  `catalogRoot` / `teacherSetRoot` against a *known published* root — otherwise a
  prover supplies a set they made up. `verify_disclosure` enforces this on-chain.
- **Trusted setup:** `ack_disclose.circom` needs its own ceremony + verifying
  key (`verifying_key_ack.rs`), separate from the lineage one (see
  circuits/README.md). Issuance reuses the lineage VK and needs no new ceremony.
- On the EVM track the off-the-shelf equivalent is **BBS+ / Privado ID**
  (multi-attribute selective disclosure + predicates without hand-written
  circuits).
