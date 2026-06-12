<div align="center">

<img src="images/AHA.png" alt="AHA — Ancestral Humanity Anonymous" width="220" />

# Ayni

**Self-governing, anonymous membership fellowships on Solana — soulbound, ZK-private, owner-less.**

Open framework for fellowship membership DAOs with zero-knowledge anonymous voting and
selectively-disclosable lineage credentials.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![Anchor](https://img.shields.io/badge/Anchor-0.31.1-512BD4)](https://www.anchor-lang.com/)
[![Solana](https://img.shields.io/badge/Solana-2.x-14F195)](https://solana.com/)
[![Circom](https://img.shields.io/badge/Circom-2.1-orange)](https://docs.circom.io/)
[![Status](https://img.shields.io/badge/status-research%2Fpre--audit-yellow)](BACKLOG.md)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#-contributing)

</div>

---

## What is Ayni?

Ayni is the Solana implementation of an **anonymous Decentralised Autonomous Organisation (DAO)** —
originally designed to meet the needs of **AHA (Ancestral Humanity Anonymous)**, but open to any
organisation. At its essence it is a chain-agnostic template for worldwide fellowships, modeled on
the century-proven success of the **AA / 12-step traditions**. It gives any group a ready-made way to
**admit members, hold a treasury, decide by group conscience, and recover from lost keys** — while
every member stays **anonymous by default** through zero-knowledge proofs.

- **What it does** — runs a membership fellowship on-chain: soulbound yearly memberships,
  anonymous one-member-one-vote, a donation-only treasury, and a 7-seat Council with 4-of-7 key
  recovery — no owner, no admin key.
- **Who it's for** — fellowships, mutual-aid groups, anonymous communities, DAOs that want
  *belonging* instead of speculation, and anyone who needs **real privacy** for members.
- **How to use it** — fork the template, seat a Council, open a Circle, and members join as private
  commitments. See [Quick start](#-quick-start).

> *Ayni* (Quechua): the sacred reciprocity of giving and receiving — self-support, one member one
> voice, no central owner.

---

## ✨ Features

- 🪪 **Soulbound membership** — yearly, non-transferable. Belonging is earned and renewed, never
  bought or sold.
- 🕶️ **Anonymous by default** — a member is a private commitment in a Merkle set, not a visible
  wallet. Voting and credentials are zero-knowledge; identity is revealed only by choice.
- 🗳️ **Group-conscience voting** — one member, one vote, cast anonymously (no token-weighted
  plutocracy), with a per-proposal nullifier preventing double-votes.
- 🏛️ **No owner, no admin key** — the 7-seat Council *is* the authority and acts only by **4-of-7**.
- 🔑 **Key recovery that survives loss** — rotate a seat or migrate every artifact of a lost wallet
  to a new one, behind a contest window any single honest seat can trip.
- 🌱 **Forkable Circles** — any group spins up a new Circle with identical governance; the World
  Service Circle coordinates shared material, it doesn't rule.
- 📜 **Selective-disclosure credentials** — course/initiation certificates ("who, what course,
  taught by whom, when") opened *field by field* in zero-knowledge.

---

## 💡 How it fits together

Read it like a tree — the people are the canopy at the top, the Circles are the
branches, and the World Service Circle is the trunk and roots at the base:

```
 member member member      member member member      member member member     ← the members
 (anon) (anon) (anon)      (anon) (anon) (anon)      (anon) (anon) (anon)         (anonymous,
    \      |      /          \      |      /          \      |      /              one member,
     ┌─────┬─────┐            ┌─────┬─────┐            ┌─────┬─────┐               one vote)
     │   Cusco   │            │  Lisbon   │            │  Bangkok  │
     │ Council 7 │            │ Council 7 │            │ Council 7 │   …        ← Circles: the
     └─────┴─────┘            └─────┴─────┘            └─────┴─────┘               branches
           └────────────────────────┬────────────────────────┘
                                    │   every Circle is forked from one shared template
                     ┌───────────────┴───────────────┐
                     │     WORLD SERVICE CIRCLE       │   ← the trunk / root ("foundation"):
                     │   12 Steps · Preamble · docs   │      holds the shared template + a
                     │    7-seat Council · 4-of-7     │      Council (4/7) that coordinates
                     └───────────────────────────────┘      but does NOT govern
```

- **Members (the canopy)** — each joins a Circle's member set as an anonymous commitment and acts
  through proofs; never needs to expose a wallet. One member, one vote.
- **Circles (the branches)** — autonomous local groups, each with its own 7-seat Council, treasury,
  and votes; forked from the template.
- **World Service Circle (the trunk/root)** — holds the shared template and documents and coordinates
  Circle creation, but does **not** override local group conscience. The link is a *federation link*,
  not a chain of command.

## 🎩 Who does what — the 7-seat Council

```
                          THE COUNCIL  (7 seats · acts by 4-of-7 · IS the authority)
   ┌──────────────────────── 3 functional servants ────────────────────────┐
   │                                                                        │
   │   TREASURER          SECRETARY            RHYTHM KEEPER                 │
   │   stewards the       admits members,      keeps the cadence of         │
   │   treasury &         records & docs,      meetings/ceremonies;         │
   │   soulbound mint     proposal hygiene     the reference / lead seat    │
   │                                                                        │
   └────────────────────────────────────────────────────────────────────────┘
   ┌──────────────────────── 4 elders of the directions ───────────────────┐
   │                                                                        │
   │   ELDER NORTH      ELDER EAST       ELDER SOUTH       ELDER WEST        │
   │   no daily duty — their role is quorum & resilience, so recovery       │
   │   never depends on the three busy servants alone (medicine wheel)      │
   │                                                                        │
   └────────────────────────────────────────────────────────────────────────┘

   MEMBERS  ──one-member-one-vote (anonymous, ZK)──▶  group-conscience decisions
            the Council serves and recovers; the membership decides direction
```

- **No admin key.** Every privileged action is a Council seat duty or a 4-of-7 proposal.
- **Servants serve, members decide.** Routine duties are delegated to a seat and revocable by
  Council rotation; direction is set by member vote.

---

## 📖 Usage & examples

The four kinds of decision Ayni supports, and where each lives:

| Decision | Who votes | Mechanism |
|---|---|---|
| **Local matter** (a Circle's own business) | that Circle's members | anonymous ZK member vote |
| **Foundation charter** (e.g. the "12 Steps") | foundation-level keys only | World Service member/Council vote |
| **Shared text** (e.g. the suggested Preamble) | **all** Circles + foundation | federation-wide aggregated vote |
| **Recovery / treasury** | the 7-seat Council | 4-of-7 proposal + contest window |

Worked, copy-pasteable walkthroughs for all of these are in **[IMPLEMENTATION.md](IMPLEMENTATION.md)**.

<div align="center">
  <img src="images/BluePrint.png" alt="Ayni — blueprint" width="880" />
</div>

---

## 🚀 Quick start

> Prereqs: **Rust**, **Solana/Agave CLI 2.x**, **Anchor 0.31.1**, **Node 20+**, and (for proofs)
> **circom 2.1** + **snarkjs**.

```bash
# 1. clone
git clone https://github.com/Ayniator/Ayni.git && cd Ayni

# 2. install JS deps (proving helpers + tests)
npm install

# 3. build the on-chain program
anchor build

# 4. run the test suite (localnet: memberships, 4-of-7 recovery, a real ZK vote round-trip)
anchor test
```

That's the whole first-run. The tests stand up a Circle, issue anonymous memberships, run a 4-of-7
recovery, and verify a real Groth16 vote proof on-chain (and reject a replayed nullifier).

To stand up your own fellowship and run all four kinds of vote, follow
**[IMPLEMENTATION.md](IMPLEMENTATION.md)** step by step.

---

## 🗺️ Roadmap

- [x] Soulbound membership lifecycle + 7-seat Council (4-of-7)
- [x] Anonymous ZK member voting (real Groth16 round-trip, on-chain)
- [x] ZK lineage grants + selective-disclosure acknowledgments
- [x] Key recovery: seat rotation + wallet migration with contest window
- [x] Security review + critical/high fixes (see [SECURITY_REVIEW.md](SECURITY_REVIEW.md))
- [ ] Federation-wide (cross-Circle) voting aggregation
- [ ] Production multi-party trusted-setup ceremony (replace dev keys)
- [ ] Coercion-resistant voting (MACI-style)
- [ ] Token-2022 soulbound mint wired end-to-end
- [ ] External audit

Full backlog: [BACKLOG.md](BACKLOG.md).

---

## 🧭 Repo map

| Path | Contents |
|---|---|
| `PROJECT.md` | The chain-agnostic AHA model (the *what* and *why*). |
| `IMPLEMENTATION.md` | Step-by-step runbook: foundation → first Circle → the four votes. |
| `programs/ayni/` | The Anchor program — memberships, Council, ZK voting & lineage. |
| `circuits/` | Circom circuits: member voting, lineage grants, acknowledgments. |
| `docs/` | Deep dives: resilience, treasury, voting, sybil, ZK lineage, acknowledgments. |
| `app/` | TypeScript proving helpers (Merkle trees, proof generation). |
| `SECURITY_REVIEW.md` | Latest concept + security review and the fixes applied. |

---

## 🤝 Contributing

Contributions are welcome — issues, PRs, and review of the cryptography especially.

1. Fork and branch from `solana` (the default branch; other chains live on `ethereum`, `avalanche`).
2. `anchor build && anchor test` must pass.
3. Open a PR describing the change and its security impact.

Good places to start are labeled **`good first issue`**. Be excellent to each other — see
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

**Suggested GitHub topics:** `solana` · `anchor` · `zero-knowledge` · `zk-snarks` · `circom` ·
`dao` · `governance` · `soulbound` · `privacy` · `anonymous-voting` · `groth16`

---

## ⚠️ Status & security

Research / **pre-audit**. The ZK anonymity layer and 4-of-7 recovery are implemented and tested on
localnet. **Do not use in production** without a real multi-party trusted-setup ceremony and an
external audit. Latest review and applied fixes: [SECURITY_REVIEW.md](SECURITY_REVIEW.md).

## 📄 License

[GNU AGPL-3.0](LICENSE) © the Ayni / AHA contributors. Network use is distribution: if you run a
modified Ayni as a service, you must share your source under the same license.

---

<div align="center">

If Ayni's model of **anonymous, owner-less fellowship** resonates with you, ⭐ **star the repo** to
follow along — it helps others find it.

</div>

<div align="center">
  <img src="images/Model.png" alt="AHA / Ayni — the full model" width="920" />
</div>
