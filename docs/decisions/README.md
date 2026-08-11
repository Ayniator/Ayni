# Architecture Decision Records

Governance and policy decisions for Ayni (AHA on Solana), one file per decision
in the standard ADR shape (Context / Decision / Status / Consequences). These
land the six **E10 / F70** open decisions. Four ratify what shipped code already
decided; two set a direction on genuinely open questions.

An ADR that says "implement something" spawns an F-number; these ADRs record the
*decision*, and the linked F-numbers own the *work*.

| # | Decision | Status | Owns / links |
|---|----------|--------|--------------|
| [0001](0001-chain-and-scope.md) | Chain, and scope-of-chain | Accepted (chain) · Open (scope) | Solana `3ogteUFY…DspHCw`; scope-reduction target → E7 `F63` |
| [0002](0002-quantum-resistance.md) | Quantum resistance | Accepted (defer w/ trigger) | Ed25519 + BN254; no `ProofAnchor` seam yet |
| [0003](0003-phone-number-registration.md) | No phone-number registration | Accepted | wallet-signature auth only; zero phone path |
| [0004](0004-interim-vs-final-admission.md) | Interim vs. final admission | Accepted · F31 reconciliation open | named pilot now → E2 ZK; `F50`/`F51`/`F52`, `F31` |
| [0005](0005-faucet-vs-relayer.md) | Faucet vs. relayer | Accepted (hybrid) | `F35` faucet (shipped) + `F55` relayer (unbuilt) |
| [0006](0006-software-stewardship.md) | Software stewardship | Accepted · sub-items open | AGPL-3.0; `F45` upgrade-authority multisig, `F44` ceremony |

## Which were genuinely open?

- **Genuinely undecided before this set:** 0002 (quantum resistance) — nothing
  written, no migration path. This ADR sets an exposure statement + trigger.
- **The open half of a mostly-settled question:** 0001 (scope-of-chain) and the
  0004 F31 reconciliation.
- **Ratifications of de-facto decisions in shipped code:** 0003 (no phone),
  0005 (hybrid faucet/relayer), 0006 (commons/AGPL), and the chain half of 0001.
