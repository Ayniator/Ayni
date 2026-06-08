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
| Trusted servants, not officers (T2) | A **7-seat Council** per Circle — 3 named servants + 4 elders — rotating by **4-of-7** group conscience |
| Resilience; no single point of failure | A lost key never strands a Circle: the Council can, by **4-of-7**, rotate a seat or **definitively migrate every artifact** from a lost wallet to a new one |
| Unity under one service structure (T1, T9) | World Service Circle coordinates but does not rule the Circles |

---

## 3. Core entities

- **World Service Circle** — the root. Holds the template, coordinates
  shared material/documentation, and holds governing authority over
  Circle creation. Does **not** override local group conscience.
- **Circle** — an autonomous local group. Has its own members,
  treasury, votes, and a 7-seat Council. Forked from the template.
- **Member** — holds a yearly, non-transferable membership token.
  Rights: donate, propose, vote, accrue progress attestations.
- **Council** — **7 seats** per Circle (and at the World Service
  Circle), the body of trusted servants that acts by **4-of-7** vote to
  rotate seats and recover lost keys. Three seats are named functional
  servants; the other four are elders:
  - **Treasurer** — co-signer on the Circle treasury; stewards donations.
  - **Secretary** — records, documentation, proposal hygiene.
  - **Rhythm Keeper** — keeps the cadence of meetings/ceremonies and
    the group's tempo.
  - **Elders** (×4) — hold no day-to-day duty; their role is quorum and
    resilience, so recovery never depends on the three busy servants alone.

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
8. **Recover a lost key** — the 7-seat Council, by **4-of-7**, rotates a
   Council seat or **definitively migrates all of a wallet's artifacts**
   (seats, membership, levels) from a lost key to a new one — at the
   World Service level and, independently, within each local Circle.

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

## 6. Resilience & key recovery

Keys get lost; people get locked out. A fellowship must survive that
without a central admin and without stranding a member's standing or a
Circle's treasury. The rule:

> **No single key is a single point of failure. A 4-of-7 Council can
> definitively migrate every artifact from one wallet to another.**

**The 7-seat Council.** Each Circle — and the World Service Circle —
is governed by a Council of **7 seats** with a **threshold of 4**. Seven,
not three, so that a quorum survives several simultaneous losses and no
faction of three can act alone. The three named servants occupy three
seats; four elders fill the rest purely for quorum and resilience.

**Two recovery actions, each 4-of-7:**

1. **Rotate a seat** — replace the wallet in a Council seat (a servant
   lost their key, or a term ended). Four of the other seats approve.
2. **Migrate a wallet** — `walletA → walletB`, *definitively, with all
   artifacts*: every Council seat held by `walletA`, the member's
   membership, and their shamanic levels are rebound to `walletB`. Four
   seats approve the migration; then each artifact is rebound under that
   single authorization.

**Scope by level.** Every Circle — foundational or local — has the *same*
recovery toolkit (member self-recovery, member co-sign, Council 4-of-7
with time-lock + contest). They differ only in **scope** and
**recommended parameters**:

- **Foundational — the World Service Circle.** Recovers World-Service
  seats and the shared root of authority; it also custodies the **lineage
  genesis key** (kept in an MPC / governance multisig, never one wallet).
  Highest stakes ⇒ a **long contest window** (e.g. 14–30 days) and elders
  drawn from distinct trust domains.
- **Local — an offspring Circle.** Recovers its own seats and members,
  **autonomously** — it never needs World Service to recover a local key
  (Tradition 4). Lower stakes ⇒ a **shorter window** (e.g. 3–7 days) is
  reasonable.

Per-level recovery options are tabulated in `docs/resilience.md`.

**Safeguards against collusion.** Recovery is **social**, so it is only
as honest as the Council: 4 colluding seats could otherwise seize a
wallet's artifacts. Two safeguards are built in:

- **Time-lock on migration.** A `MigrateWallet` does not execute the
  instant it reaches 4-of-7 — it becomes executable only after a
  per-Circle **contest window** (e.g. 7 days). Seat rotation, which is
  reversible, executes immediately; irreversible wallet migration waits.
- **Any-seat contest.** During the window, **any single Council seat**
  can cancel a pending migration. One honest seat is enough to halt a
  suspicious recovery; the migration must then be re-proposed. This
  deliberately favours **safety over liveness** — a contested migration
  stays blocked while the dispute is resolved off-chain (and the honest
  seats can rotate out colluders in the meantime).
- **Member co-signature / self-recovery.** A member may bind up to **two
  guardian keys** — backup keys they alone control, distinct from their
  everyday wallet — and opt into **require-co-sign**. Either guardian can
  act (1-of-2), so losing one guardian still leaves recovery possible.
  With the policy on, *no Council majority, even all 7 colluding, can
  migrate that member's standing without one of their keys*: they are
  collusion-proof, at the cost that losing **every** key makes the
  membership unrecoverable (the member chooses this availability-vs-safety
  trade). A member who still holds any key can also **self-migrate** their
  own membership with no Council vote and no time-lock. The Council-only
  path remains for members who may lose all keys.

Remaining mitigations are operational: elders drawn from distinct trust
domains. Treasury and governance-token recovery for funds held in
Squads/Realms use those tools' own m-of-n recovery, which the Council
mirrors.

---

## 7. Architecture — two tracks

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

## 8. Federation model

```
World Service Circle (root: template + shared docs + 7-seat Council)
 ├── Circle: <name>   → members · treasury · 7-seat Council (4/7) · votes
 ├── Circle: <name>   → ... same structure, autonomous ...
 └── Circle: <new fork via "Summon a Circle">
```

The root coordinates and holds shared material; each Circle decides its
own affairs by group conscience. New Circles inherit the full template.

---

## 9. Non-goals

- **Not** a tradeable or speculative token. No liquidity, no price, no market.
- **Not** profit-distributing. Treasury serves the fellowship's purpose only.
- **Not** top-down. World Service coordinates; it does not govern local conscience.

---

## 10. Open decisions

- [ ] Chain: **leaning EVM (Base/Gnosis)** for the ZK stack — confirm vs Solana.
- [ ] Council size for small Circles: enforce 7/4 everywhere, or allow a smaller m/n until a Circle grows (with 7/4 the default and target)?
- [x] Recovery safeguards: **time-lock + any-seat contest + member co-signature/self-recovery** (decided; implemented).
- [ ] Harden seat rotation against the "purge before migration" attack: time-lock RotateSeat, or freeze rotations while a migration is pending?
- [ ] Anonymity baseline: anonymous-by-default (Semaphore membership set) vs visible soulbound token with optional ZK.
- [ ] Lineage proofs: off-the-shelf trusted-issuer VCs (Privado ID) vs full issuer-anonymous delegatable credentials (custom).
- [ ] Relayer / account-abstraction strategy to prevent metadata deanonymization.
- [ ] Membership renewal: on-chain expiry program vs annual reissue/revoke.
- [ ] Donation model: fixed yearly amount, pay-what-you-can, or $0 + tip.
- [ ] Progress schema: what shamanic milestones are recorded, and who attests them.
- [ ] Cross-Circle voting: can World Service propose changes binding on all Circles, or only suggest?
- [ ] Off-chain mirror: how meetings/material/docs link to on-chain proposals.
