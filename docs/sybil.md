# Ayni — sybil resistance (anonymous proof-of-personhood)

Anonymity + one-member-one-vote + permissionless can't all hold without
**proof-of-unique-personhood**. Without it, one human mints many anonymous
commitments → many votes. Ayni closes this *while keeping anonymity* — through
a layered stack, not one mechanism. There is no external authority anywhere in
it: the Council IS the authority, and every gate below is a member or a seat.

## The stack, layer by layer

1. **Two-sponsor admission (E1, amended v0.2 — the standing model, ADR 0007).**
   The **parrain** — any member in good standing who has met the newcomer —
   attests (`programs/ayni/src/instructions/attest_admission.rs`; one
   attestation per newcomer, the PDA is the refusal of a second). The newcomer
   enters *provisionally* (`issue_provisional_membership.rs`): their commitment
   is NOT in the MemberTree, so every members-only proof fails by construction.
   A **trusted servant** (any of the 7 Council seats, a different person than
   the parrain) co-attests via `confirm_admission.rs`, which alone inserts the
   commitment into the votable set. Forging an admission requires a member in
   good standing AND an elected seat. This is the fellowship's humanity check:
   bots do not attend ceremonies.
2. **The anonymous parrain form (Epic 2, `attest_admission_zk.rs`).** The same
   Attestation A as a Groth16 proof that *some* member of the tree attests —
   naming no one. Nullifier = `Poseidon(secret, newcomer)`, so one member
   cannot attest twice for the same newcomer even across both forms; the
   shared `["attest", circle, newcomer]` PDA caps every newcomer at one
   parrain total. The sponsor edge never comes into being on chain.
3. **Anonymous proof-of-personhood (F5 — the durable one-human bound).** When
   `circle.require_personhood` is on, either admission path consumes a
   one-per-human `PersonhoodCredential`. This is the only *cryptographic*
   one-human-one-membership guarantee in the stack, and the only correct tool
   for cross-Circle uniqueness (e.g. "one faucet grant per human"), because
   commitments are deliberately unlinkable across Circles (Tradition 12).
4. **Open membership (F31 — BOOTSTRAP MODE ONLY, per ADR 0007).** Zero-vouch
   self-admission via `set_open_membership.rs`, legitimate only for a
   brand-new Circle with no members yet able to sponsor; switched off once
   sponsorship is sustainable. When two-sponsor is enabled, `issue_membership`
   refuses outright (`TwoSponsorRequired`) — two-sponsor wins over an open
   marker. (The pre-E1 default — Scribe-Secretary seat-gated
   `issue_membership.rs` — remains the legacy path for Circles that have
   enabled neither marker: a *service-role* gate that records the rolls, not
   sponsorship.)

## What each layer does and does NOT prevent — honestly

- **Layers 1–2 are key-level, not person-level.** The distinct-persons rule in
  `confirm_admission.rs` compares *keys* (the seat wallet must not be a key of
  the parrain's membership); one human controlling two keypairs still passes.
  There is no on-chain person primitive — the docstring there says so plainly.
  Layer 3 is the structural backstop.
- **Anonymous attestation downgrades the distinct-persons rule** from
  program-enforced to circle-visible (there is no parrain identity to compare;
  the confirming seat is public and the other six watch) — documented in
  `attest_admission_zk.rs`.
- **"In good standing" means "in the member tree"** — the tree is append-only,
  so an expired-but-never-revoked member can still produce an anonymous
  attestation (same snapshot semantics member voting accepts; tightening is F54).
- **Layer 4 prevents nothing.** A bootstrap Circle with personhood off has no
  sybil floor at all; pair bootstrap with `require_personhood` (ADR 0007).

## How the cryptographic gate works

- A Circle sets `personhood_root` via `set_personhood` — the Merkle root of a
  **unique-human set**: a **World ID** group root, or a Circle's own vouching set.
- `prove_personhood` verifies (reusing `member_vote.circom` / `VERIFYING_KEY_VOTE`)
  that the human is in `personhood_root`, with the **Circle-scoped external
  nullifier** `field_from_pubkey(circle)`. It mints a `PersonhoodCredential` whose
  PDA is seeded by the nullifier — so a second attempt by the same human fails.
- `issue_membership` / `issue_provisional_membership` **consume** the credential
  (`used = true`). One human → one credential → one membership.

Circle-scoping the external nullifier means the **same human produces a different
nullifier in each Circle** — they can join multiple Circles, and the credentials
can't be linked across Circles.

## Why not Civic Pass?

Identity/uniqueness checks that reveal *who you are* conflict with AA anonymity.
Anonymous proof-of-personhood (World ID-style) gives **uniqueness without
identity** — the right trade. Civic Pass can still be used as the *source* set
feeding `personhood_root` if it exposes only an anonymous uniqueness signal.

## Notes

- Reuses the member-vote circuit and VK (same inclusion + nullifier shape) — no
  extra ceremony.
- Anonymous attestations and `prove_personhood` must go through a relayer, or
  the fee-payer wallet links itself to the proof (ADR 0005; F55).
- Personhood default is **off** (`require_personhood = false`); enable per
  Circle once a personhood source is chosen.
