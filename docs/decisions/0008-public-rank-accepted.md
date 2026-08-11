# ADR 0008 — Public level and milestone chips are accepted

## Status

**Accepted — explicit user waiver, 2026-08-11.** Per CLAUDE.md's non-regression
rule ("a CRITICAL finding … means the round FAILS … or get an explicit written
waiver from the user"), this ADR **is the written waiver of record** for
Sentinel finding R7, citing the user's instruction of 2026-08-11.

## Context

**What is public:**

- `Membership.level` (`programs/ayni/src/state.rs:63-64`) — "Highest shamanic
  level attained", a `u8` on every public `Membership` account, raised only by
  `grant_level` along a ZK-verified lineage.
- `ProgressToken` (`state.rs:408-422`) — milestone chips (30 / 90 / 365 days),
  PDA `["progress", circle, member, milestone]`, seat-attested, one per
  (member, milestone), enumerable by anyone reading the chain.

**What Sentinel R7 claimed:** round 1 (`reports/sentinel/NRR-2026-08-10-1.md`)
flagged both as a public, orderable, per-member quantity — members orderable by
level and by chip count — a possible contradiction of E4's "no ratings, no
verification tiers, nothing comparative", MEDIUM pending written justification.
Round 2 (`NRR-2026-08-10-2.md`) escalated to CRITICAL when no justification
existed. Between rounds 2 and 4, `docs/traditions-justifications.md` supplied
the justification and the F61 retrofit stopped rendering `level` on `/me` and
the admin list, but both fields remain public on chain, and the E4 backlog row
still carried "stop rendering `level` on member surfaces" as remaining work.

## Decision

The user has ruled: **this is normal, accepted product behaviour, and NOT a
contradiction of E4's "nothing comparative."** A fellowship shows lineage
levels and milestone chips the way AA shows sobriety chips — visible tokens of
the path, not a ranking system. That third parties *could* sort members by
level or chip count does not make the fields a ranking: nothing in the product
computes, displays, or acts on such an ordering, and the fields confer no vote
weight, privilege, or standing. `Membership.level` being publicly enumerable
and `ProgressToken` chips being publicly orderable are accepted as-is.

The comparative-surface concern (Sentinel R7, escalating since round 1) is
**waived**.

## Consequences

- The E4 remaining-work item **"stop rendering `level` on member surfaces" is
  dropped.** Surfaces MAY render level and chips; the F61 removal was not
  wrong, but it is no longer required work and may be reversed as a product
  choice.
- **Sentinel must no longer escalate R7.** The finding is **closed-by-waiver**;
  future rounds cite this ADR instead of re-flagging `Membership.level` or
  `ProgressToken`. `docs/traditions-justifications.md` remains the standing
  Traditions rationale for both fields and is unaffected.
- The waiver is **scoped to these two existing fields.** Anything NEW that adds
  a comparative surface — a score, a tally over people, a leaderboard, any
  fresh orderable per-member quantity — still needs its own review; the
  "rejected" list in `docs/traditions-justifications.md` stands unchanged.
- Epic 5 selective disclosure (per-element visibility) remains available as a
  member choice for these fields, but is no longer a *precondition* for their
  existence being acceptable.
