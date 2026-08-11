# ADR 0006 — Software stewardship

## Status

**Accepted** — Ayni is stewarded as a commons, never operated as a company or
sold as a product. Several sub-items named below are still **open**.

## Context

Traditions 6–9 forbid the fellowship from owning property, running an enterprise,
or being organized as anything that could be bought, captured, or turned to
profit. Applied to software, that means Ayni must never become a company's
product, a token sale, or one owner's asset.

What already points the right way, verified in-repo:

- **Licence:** `LICENSE` is **AGPL-3.0** — the strongest copyleft, so any hosted
  fork must publish its source; no one can quietly close it.
- **`CODE_OF_CONDUCT.md`** and **`SECURITY.md`** exist — the social and
  vulnerability-handling norms are written down.
- **Governance already trends multi-party:** treasury-wallet changes require a
  real SPL multisig (`F29`, enforced on-chain via `TreasuryNotMultisig`), and
  federation seat rotation / Circle closure is a 4-of-7 Council vote (`F34`).

What is **not** yet true:

- **The service-committee model is unwritten.** There is no document describing
  who maintains the software, how maintainers rotate, or how decisions are made —
  the human stewardship structure that Traditions 8/9 imply.
- **The program upgrade authority is a single keypair** (`F45`). One person can
  today push a new program version. This is a loader setting, not something the
  program can enforce on itself, so fixing it is a migration to a multisig / MPC
  authority, not a code change.
- **The trusted setup was single-contributor** (`F44`): all shipped verifying
  keys come from a one-person ceremony — a trust weakness and a mainnet blocker.

## Decision

- **Ratify:** Ayni is a **commons**, licensed AGPL-3.0, never incorporated as a
  product or company, never token-funded. Funding is self-supporting donations
  (E0 treasury), held in common under multisig.
- **Name the open sub-items** as required stewardship work, not optional:
  1. Write the **service-committee / maintainer-rotation** model (rotating,
     removable stewards; no permanent owner).
  2. Move the **program upgrade authority to a multisig / MPC** (`F45`).
  3. Complete a **multi-party trusted-setup ceremony** (`F44`).

## Consequences

- Until (2) and (3) land, the deployment has a **custodial single point of
  control** at the upgrade authority and a single-trust root in the setup. These
  are **mainnet gates**: mainnet must not launch with a single-key upgrade
  authority or a single-contributor VK.
- AGPL-3.0 is a deliberate, load-bearing choice; relicensing to anything more
  permissive would reopen this ADR and is presumptively rejected.
- The stewardship model, once written, governs *people*; the multisig/MPC
  migration governs *keys*. Both are needed — copyleft alone does not prevent
  capture of a running deployment.
