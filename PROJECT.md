# AHA — Ancestral Humanity Anonymous

*Worldwide, chain-agnostic decentralized organisation — World Service
Circle + its Circles*

AHA — **Ancestral Humanity Anonymous** — is a worldwide, chain-agnostic
decentralized fellowship for shamanic practice, modeled on the structure
and traditions of 12-step fellowships (AA). Membership is a
**non-transferable, yearly token** — not a tradeable coin — so the
organisation runs on *group conscience* and *one member, one voice*,
never on capital.

**Anonymity is foundational** (the *Anonymous* in AHA): membership,
voting, and shamanic levels are designed to be provable in
zero-knowledge — a member can prove what they are entitled to without
revealing who they are.

> **Organisation vs. implementation.** **AHA** — *Ancestral Humanity
> Anonymous* — is the **worldwide, chain-agnostic decentralized
> organisation**: the fellowship itself, its Traditions, roles, and
> rules, independent of any blockchain. **Ayni** is the name of the
> **Solana implementation** — the on-chain protocol and codebase that
> realizes AHA. "Ayni" (Andean: sacred reciprocity) reflects the
> gift-economy, self-supporting nature of the fellowship. Keep the two
> separable: AHA can be implemented on another chain (or several at once)
> without changing the AHA definition.

---

## 1. What it is

A network of autonomous **Circles** united under a top-level **World
Service Circle**. Each Circle is self-governing, self-supporting, and
forks from the same template in minutes. Members hold a yearly
membership token that grants them the right to donate, propose, vote,
and have their progress recognized.

This is a *fellowship*, not a startup. The token confers **voice and
belonging, not equity or profit.**

---

## 2. Design principles (mapped to the Traditions)

| Tradition / fellowship value | Design decision |
|---|---|
| Group conscience; one member, one vote (T2) | Membership token is **non-transferable / soulbound** — no vote-buying, no whales |
| Principles before personalities; anonymity (T12) | No speculative, tradeable coin; pseudonymous wallets |
| Each group autonomous (T4) | Every Circle is its own governance unit; forks freely |
| Fully self-supporting; decline outside money (T7) | Treasury funded by member donations only; donation *is* the membership renewal |
| Trusted servants, not officers (T2) | 3 rotating service roles, granted for a term and revocable |
| Unity under one service structure (T1, T9) | World Service Circle coordinates but does not rule the Circles |

---

## 3. Core entities

- **World Service Circle** — the root. Holds the template, coordinates
  shared material/documentation, and holds governing authority over
  Circle creation. Does **not** override local group conscience.
- **Circle** — an autonomous local group. Has its own members,
  treasury, votes, and three servants. Forked from the template.
- **Member** — holds a yearly, non-transferable membership token.
  Rights: donate, propose, vote, accrue progress attestations.
- **Servants** (3 per Circle, rotating service positions):
  - **Treasurer** — co-signer on the Circle treasury; stewards donations.
  - **Secretary** — records, documentation, proposal hygiene.
  - **Rhythm Keeper** — keeps the cadence of meetings/ceremonies and
    the group's tempo.

---

## 4. Capabilities

1. **Membership** — mint a yearly token by donating; renews annually;
   expires if not renewed. Soulbound (cannot be sold or transferred).
2. **Donate** — to one's own Circle treasury (and optionally up to
   World Service); self-support only.
3. **Propose** — any member raises an idea, or a change to shared
   material or documentation. May be raised anonymously.
4. **Vote** — one member, one vote on proposals (group conscience),
   castable anonymously and coercion-resistantly.
5. **Track shamanic progress** — milestones/levels recorded as
   non-transferable credentials; a permanent, member-owned record of the
   path, disclosable in zero-knowledge.
6. **Fork a Circle** — spin up a new Circle with identical governance
   from the template ("Summon a Circle").
7. **Prove without revealing** — prove membership, voting eligibility, or
   level held in zero-knowledge; reveal identity only by choice.

---

## 5. Privacy & anonymity (zero-knowledge)

The *Anonymous* in AHA is a hard requirement. A soulbound NFT is public
by default, so true anonymity means **not holding a visible token at
all** — instead a member is a private commitment in a membership set and
every action is a zero-knowledge proof. Design for **selective
disclosure**: a member can stay fully anonymous (voting, holding a
level) or choose to reveal (e.g. a servant accountable as treasurer).

| What stays hidden | Primitive | Tooling |
|---|---|---|
| Which member you are | Anonymous group membership + nullifiers | **Semaphore** (EF / PSE) |
| How you voted (anti-coercion, anti-buying) | Coercion-resistant voting | **MACI** |
| Your level / progress | ZK verifiable credentials, selective disclosure | **Privado ID** (ex-Polygon ID / Iden3), **BBS+** |
| The lineage of a level grant | Issuer-anonymous credential chain (see below) | Privado ID + custom (delegatable anonymous credentials) |

**Lineage of transmission.** Each shamanic level is a verifiable
credential issued by a holder of that level or higher, in an unbroken
chain anchored at the World Service Circle. A member proves in ZK: *"my
Level-N credential was granted by an authorized lineage-holder, tracing
to the root"* — **without revealing the granting shaman, the
intermediate teachers, or the student.** Only the validity of the
transmission is public. The "prove I hold a credential from a trusted
issuer" part is off-the-shelf (Privado ID); full *issuer-anonymity
within the lineage* (delegatable anonymous credentials / BBS+
accumulators) is custom, research-grade work.

**Metadata caveat.** ZK hides the secret, but the wallet paying gas,
timing, and relayers can re-link a member. **Relayers / account
abstraction** are required so the paying address is not the identity —
this matters as much as the circuits themselves.

---

## 6. Architecture — two tracks

The membership-expiry logic and the role/federation tree are the only
custom pieces; everything else is composed from audited protocols.

### Track A — Solana — **Ayni** (low cost, more custom code)

| Concern | Tool |
|---|---|
| Governance / proposals / voting | **Realms (SPL Governance)** — one Realm per Circle |
| Treasury | **Squads Protocol v4** multisig (treasurer = signer) |
| Membership token | **Token-2022** with `NonTransferable` extension (soulbound) |
| Yearly expiry | **Custom Anchor program** checks an `expiry` timestamp (no Unlock equivalent on Solana) |
| Progress badges | **Solana Attestation Service** or **Metaplex compressed NFTs** (near-free at scale) |
| Servant roles | Squads member permissions + Realms council tokens |
| Federation | World Service Realm holds governing authority over Circle Realms |
| Forking | New Realm per Circle under the shared governance program |

*Strength:* sub-cent fees; trivial to issue tokens/badges to many
members. *Cost:* you write the expiry program and wire roles/federation.

### Track B — EVM (Base / Gnosis Chain — assemble from finished lego)

| Concern | Tool |
|---|---|
| Yearly membership (donate-to-join, expiring) | **Unlock Protocol** (turnkey) |
| Soulbound | Unlock key set non-transferable |
| Roles **and** federation tree | **Hats Protocol** (World Service → Circle → servants in one system) |
| Proposals / voting (gasless) | **Snapshot** (strategy = holds valid membership) |
| Treasury | **Safe** multisig (treasurer gated by Treasurer hat) |
| Progress | **EAS** attestations or Otterspace/POAP badges |
| Forking | "Summon a Circle" script: Hats subtree + Unlock lock + Safe + Snapshot space |

*Strength:* expiry (Unlock) and the role/federation tree (Hats) are
off-the-shelf — least custom code. *Cost:* L2 gas fees (cents, not free).

**Recommendation:** **EVM (Base / Gnosis Chain).** With ZK anonymity as
a hard requirement, the mature anonymous-credential stack (Semaphore,
MACI, Privado ID) is the deciding factor — it is production-grade on EVM.
Solana offers confidential *amounts* (Token-2022) and confidential
compute (Arcium) and on-chain Groth16, but the anonymous-credential layer
would be built from scratch. Cost/throughput favored Solana; anonymity
outweighs it.

---

## 7. Federation model

```
World Service Circle (root: template + shared docs + governing authority)
 ├── Circle: <name>   → members · treasury · 3 servants · votes
 ├── Circle: <name>   → ... same structure, autonomous ...
 └── Circle: <new fork via "Summon a Circle">
```

The root coordinates and holds shared material; each Circle decides its
own affairs by group conscience. New Circles inherit the full template.

---

## 8. Non-goals

- **Not** a tradeable or speculative token. No liquidity, no price, no market.
- **Not** profit-distributing. Treasury serves the fellowship's purpose only.
- **Not** top-down. World Service coordinates; it does not govern local conscience.

---

## 9. Open decisions

- [ ] Chain: **leaning EVM (Base/Gnosis)** for the ZK stack — confirm vs Solana.
- [ ] Anonymity baseline: anonymous-by-default (Semaphore membership set) vs visible soulbound token with optional ZK.
- [ ] Lineage proofs: off-the-shelf trusted-issuer VCs (Privado ID) vs full issuer-anonymous delegatable credentials (custom).
- [ ] Relayer / account-abstraction strategy to prevent metadata deanonymization.
- [ ] Membership renewal: on-chain expiry program vs annual reissue/revoke.
- [ ] Donation model: fixed yearly amount, pay-what-you-can, or $0 + tip.
- [ ] Progress schema: what shamanic milestones are recorded, and who attests them.
- [ ] Cross-Circle voting: can World Service propose changes binding on all Circles, or only suggest?
- [ ] Off-chain mirror: how meetings/material/docs link to on-chain proposals.
