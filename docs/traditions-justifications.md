# Traditions justifications (Sentinel Layer D)

Sentinel's prime directive treats anything that "ranks members" as CRITICAL, and
its Layer D sweep flags any member-facing `score`/`rating`/`rank`/`karma`/`tier`/
`badge`/`count`-shaped field. Each such hit "must be justified in the report or
fails the round." This file is the standing justification for the deliberate,
Traditions-compatible exceptions. Anything **not** listed here is a real finding.

## `ProgressToken` — milestone chips (F27) — JUSTIFIED

`state.rs ProgressToken { milestone: u32 }`, PDA `["progress", circle, member,
milestone]`, issued by a Council seat.

These are **AA-style milestone chips** (30 / 90 / 365 days), and the sobriety
chip is the canonical, ninety-year-old, Tradition-compatible practice they model.
Why this is not the rejected "ranking algorithm applied to people":

- **Binary and personal.** You reached a milestone or you did not — there is no
  position relative to anyone else, no ordering of members against each other.
  This is the same shape the quipu (E3) uses, and the backlog's own Traditions
  Audit passes "Quipu milestones — binary, personal, non-comparative."
- **Never summed, never a leaderboard.** No total, no count-of-members, no
  ranking is derived from chips anywhere (`frontend/lib/peers.ts listProgressTokens`
  returns them unsummed; the UI renders them as individual badges, never a tally).
- **A celebration, not a grade.** The chip marks the member's own journey; it
  confers no privilege, vote weight, or standing.

**Residual, honestly:** the chip is currently **public on-chain** (keyed by the
anonymous commitment, but readable). Making it disclosable per the member's own
choice is **Epic 5** (per-element visibility) — until then a chip is visible to
anyone who reads the chain. That is a visibility limitation, not a ranking one.

## `Membership.level` — shamanic lineage attainment — JUSTIFIED

`state.rs Membership { level: u8 }`, raised only by `grant_level` along a ZK-
verified lineage.

`level` is a **credential** (a teaching/initiation attainment), not a social
score. PROJECT.md states the intent directly: "level held in zero-knowledge;
reveal identity only by choice." Why it is not a member ranking:

- It records a **lineage fact** ("this holder was granted level N by a teacher of
  level ≥ N"), the way a certification records a qualification — orthogonal to
  worth or standing in the fellowship.
- It is designed for **selective disclosure**: the member proves the level they
  need without revealing who they are (the `grant_level` / `ack_disclose`
  machinery), rather than displaying a rank on a page.
- It gates **capability where a real prerequisite exists** (a teacher must
  out-rank what they grant), not social precedence.

**Residual, honestly:** like the chip, `level` currently sits **public** on the
`Membership` account. The privacy-correct end state is that a member proves the
level a context requires (ZK) and never publishes the number — the disclosure
layer is **Epic 5 / the existing `ack_disclose` path**. Until visibility is wired,
`level` is publicly readable.

## What is NOT justified (and must stay absent)

Per the backlog's Traditions Audit, these remain **rejected** and must never
appear as a member-facing field: karma / reputation / rating **scores**, any
ranking algorithm over people, follower/like counts, verification **tiers**, or a
leaderboard. The Sentinel sweep enforces the field-name half of this; the human
Traditions review enforces the rest.
