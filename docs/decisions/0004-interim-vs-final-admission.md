# ADR 0004 — Interim vs. final admission

## Status

**Accepted** — ship a named-sponsor pilot now, build the anonymous ZK form in
parallel, cut over on a stated trigger. The **F31 open-membership
reconciliation** below remains open.

## Context

The fellowship's admission doctrine (E1) is: **every member enters through two
existing members** — a *parrain* (any member) and a second attestation from one
of the seven trusted servants. The anonymous end-state (E2) is that this vouching
happens under ZK, so the sponsor edge is never a public record.

What is actually shipped is a **pilot**, and it is honest to say the pilot is not
yet the doctrine:

- The **named two-sponsor form** is the target pilot (E1 v0.2: parrain +
  trusted-servant). Its on-chain pieces are being assembled (`F50`
  `attest_admission`, `F51` provisional membership split, `F52` sponsor UI).
- The **E2 anonymous attestation** machinery is built (ZK membership/vouch
  proofs, Poseidon commitments) but not yet wired as the admission path — and it
  cannot be private end-to-end until the relayer (ADR 0005) stops the prover from
  paying, and thus naming, itself.
- Cross-cutting this, `F31` shipped a **permissionless open-membership** marker
  (`set_open_membership`, PDA `["openjoin", circle]`): zero-vouch self-admission.
  That is the **direct opposite** of "two existing members." Both cannot be the
  shipped admission model.

## Decision

1. **Interim (now):** the **named** two-sponsor pilot (parrain + one trusted
   servant), with the sponsor edge acknowledged as public and pilot-only.
2. **Final (target):** the same two-sponsor semantics performed under E2 ZK
   attestation, with the relayer breaking the fee-payer link, so admission leaves
   no public who-vouched-for-whom record.
3. **Cutover trigger:** move from interim to final when (a) E2 attestation is the
   live `issue_membership` gate, and (b) the E10 relayer (F55) is submitting
   proofs so the prover is not the fee-payer. Until both hold, the named pilot
   stays.

## Consequences

- **F31 reconciliation is unresolved and owned here.** Open membership and
  two-sponsor admission cannot both be the doctrine. Direction: treat
  permissionless open-join as a **non-default, per-Circle opt-out** for contexts
  that explicitly want it (e.g. a fully public meeting), never the fellowship's
  admission model — and document `docs/sybil.md`'s conflation of
  "authority-gated issuance" with "social vouching" as a defect to fix. The final
  policy switch belongs to the Circles, but the *default* must be the two-sponsor
  form. This paragraph is the standing reconciliation until F50–F52 land it in
  code.
- The pilot's public sponsor edge is a known privacy cost, bounded to the pilot
  window and superseded by the final form (see ADR 0001, ADR 0005).
- No admission model is "final" until the cutover trigger is met; documentation
  and UI must not describe the anonymous form as shipped while the named pilot is
  live.
