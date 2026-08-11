# ADR 0007 — Open membership vs. two-sponsor admission

## Status

**Accepted** (user decision, 2026-08-11) — **two-sponsor admission (E1, amended
v0.2) is the standing admission model.** F31 open membership is demoted to an
explicit **bootstrap mode**. This closes the F31 reconciliation that ADR 0004
left open.

## Context

ADR 0004 named the conflict and left it open: `F31` shipped a permissionless
open-membership marker (`set_open_membership`, PDA `["openjoin", circle]`) —
zero-vouch self-admission, the direct opposite of E1's "every member enters
through two existing members." Since then the E1 pilot has actually landed
(`F50` `attest_admission`, `F51` provisional membership, `F52` sponsor UI), so
the question is no longer hypothetical: a Circle can now be configured both ways
at once, and the program has to pick a winner.

**What the code enforces today** (verified in
`programs/ayni/src/instructions/`):

- `set_two_sponsor_admission.rs` — any Council seat toggles a
  `TwoSponsorAdmission` marker (PDA `["twosponsor", circle]`). When required,
  admission is the pair `attest_admission` → `issue_provisional_membership` →
  `confirm_admission` (parrain = any member in good standing; co-attestation =
  one of the 7 trusted servants; distinct persons, key-level).
- `set_open_membership.rs` — any Council seat toggles an `OpenMembership`
  marker (PDA `["openjoin", circle]`). When open, `issue_membership` skips the
  Scribe-Secretary check and anyone may self-admit.
- `issue_membership.rs` — the `two_sponsor` policy account is **required and
  seed-bound** (`init_if_needed`, default off), so it cannot be omitted to
  dodge the rule; the very first check is
  `require!(!two_sponsor.required, TwoSponsorRequired)`. The open-membership
  marker is read only after that.
- **The two toggles are independent and CAN both be on simultaneously** —
  neither setter reads the other's PDA, so the contradictory marker pair is
  representable on chain. **Two-sponsor wins**: with `required = true`,
  `issue_membership` fails unconditionally (open marker or not), and admission
  goes through the provisional flow, which itself requires
  `policy.required == true` (`issue_provisional_membership.rs`). The open
  marker is silently dead while two-sponsor is on.

## Decision

1. **Two-sponsor admission is the standing model.** E1 v0.2 — a named (or
   anonymous, per ADR 0004's E2 cutover) parrain attestation plus a
   trusted-servant co-attestation, with provisional membership in between — is
   the fellowship's admission doctrine, per-Circle opt-in today, the default
   direction always.
2. **F31 open membership is BOOTSTRAP MODE, explicitly.** Zero-vouch
   self-admission is legitimate for exactly one situation: a brand-new pilot
   Circle that does not yet have members able to sponsor. It is expected to be
   switched off (`set_open_membership(false)` and two-sponsor on) once the
   Circle can sustain sponsorship. It is never the admission model of an
   established Circle, and documentation/UI must present it as bootstrap, not
   as a peer of two-sponsor admission.

## Consequences

- ADR 0004's "F31 reconciliation" paragraph is superseded by this ADR;
  `docs/sybil.md` is rewritten to match (its "authority-gated issuance =
  social vouching" conflation, flagged there, is fixed).
- **Residual gap (small follow-up, not implemented here):** there is no
  program-level guard refusing the contradictory marker state — a seat can set
  `open = true` while two-sponsor is required (or enable two-sponsor over a
  live open marker) and the conflict is resolved only implicitly, by check
  order inside `issue_membership`. A guard in `set_open_membership` (refuse
  `open = true` while `TwoSponsorAdmission.required`) would make the
  precedence explicit on chain rather than emergent.
- **Residual gap:** bootstrap mode is policy, not code — nothing sunsets the
  open marker or bounds it (e.g. by `member_count`). The switch-off is a group
  conscience act; a Circle that forgets stays zero-vouch.
- A bootstrap Circle with `open = true` and `require_personhood = false` (the
  default) has **no sybil floor at all** during bootstrap. Enabling F5
  personhood for bootstrap Circles is the recommended pairing.
- BACKLOG rows `F31` (open-membership marker, flagged ⚠ there for exactly this
  conflict) and `F50`/`F51`/`F52` (the E1 pilot) are the owning work items;
  this ADR is the reconciliation those rows point at.
