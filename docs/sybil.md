# Ayni — sybil resistance (anonymous proof-of-personhood)

Anonymity + one-member-one-vote + permissionless can't all hold without
**proof-of-unique-personhood**. Without it, one human mints many anonymous
commitments → many votes. Ayni closes this *while keeping anonymity*.

## Two layers

1. **Social vouching (always on).** `issue_membership` is gated by the Circle
   `authority` (a trusted servant). A human admits a human — the real-world AA
   mechanism, and the natural reading of Tradition 3 (only a desire is required,
   but someone still admits you). Cheap, trust-based.
2. **Anonymous proof-of-personhood (optional, cryptographic).** When
   `circle.require_personhood` is on, a member must present a one-per-human
   `PersonhoodCredential` to join. This gives **one human → one membership per
   Circle** without revealing identity.

## How the cryptographic gate works

- A Circle sets `personhood_root` via `set_personhood` — the Merkle root of a
  **unique-human set**: a **World ID** group root, or a Circle's own vouching set.
- `prove_personhood` verifies (reusing `member_vote.circom` / `VERIFYING_KEY_VOTE`)
  that the human is in `personhood_root`, with the **Circle-scoped external
  nullifier** `field_from_pubkey(circle)`. It mints a `PersonhoodCredential` whose
  PDA is seeded by the nullifier — so a second attempt by the same human fails.
- `issue_membership` **consumes** the credential (`used = true`). One human → one
  credential → one membership.

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
- A relayer pays for `prove_personhood`, so the human's wallet isn't linked.
- Default is **off** (`require_personhood = false`); enable per Circle once a
  personhood source is chosen.
