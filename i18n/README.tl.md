<div align="center">

<img src="../images/AHA.png" alt="AHA — Ancestral Humanity Anonymous" width="220" />

# Ayni

**Mga kapatirang miyembro na anonymous at namumuno sa sarili sa Solana — soulbound, ZK-private, walang may-ari.**

Bukas na balangkas para sa mga membership DAO ng kapatiran na may zero-knowledge na anonymous na pagboto at mga lineage credential na mapipiling ihayag.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](../LICENSE)
[![Anchor](https://img.shields.io/badge/Anchor-0.31.1-512BD4)](https://www.anchor-lang.com/)
[![Solana](https://img.shields.io/badge/Solana-2.x-14F195)](https://solana.com/)
[![Circom](https://img.shields.io/badge/Circom-2.1-orange)](https://docs.circom.io/)
[![Status](https://img.shields.io/badge/status-research%2Fpre--audit-yellow)](../BACKLOG.md)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#-pag-aambag)

🌍 [Other languages](README.md) · [English](../README.md)

</div>

---

## Ano ang Ayni?

Ang Ayni ay ang pagpapatupad sa Solana ng isang **anonymous na Decentralised Autonomous Organisation (DAO)** — orihinal na dinisenyo upang matugunan ang mga pangangailangan ng **AHA (Ancestral Humanity Anonymous)**, ngunit bukas sa anumang organisasyon. Sa kaibuturan nito, ito ay isang chain-agnostic na template para sa mga pandaigdigang kapatiran, hinubog sa modelo ng siglo-nang-napatunayang tagumpay ng **AA / 12-step na tradisyon**. Nagbibigay ito sa anumang grupo ng handa-nang paraan upang **tumanggap ng mga miyembro, magtaglay ng treasury, magpasya sa pamamagitan ng group conscience, at makabawi mula sa mga nawalang susi** — habang ang bawat miyembro ay nananatiling **anonymous bilang default** sa pamamagitan ng zero-knowledge proofs.

- **Ano ang ginagawa nito** — nagpapatakbo ng membership na kapatiran on-chain: soulbound na taunang membership, anonymous na isang-miyembro-isang-boto, isang donation-only na treasury, at isang 7-upuang Council na may 4-of-7 na key recovery — walang may-ari, walang admin key.
- **Para kanino ito** — mga kapatiran, mga grupo ng mutual-aid, mga anonymous na komunidad, mga DAO na gustong magkaroon ng *pagiging kabilang* sa halip na ispekulasyon, at sinumang nangangailangan ng **tunay na privacy** para sa mga miyembro.
- **Paano ito gamitin** — i-fork ang template, maglagay ng Council, magbukas ng isang Circle, at sumasali ang mga miyembro bilang mga private na commitment. Tingnan ang [Quick start](#-mabilis-na-pagsisimula).

> *Ayni* (Quechua): ang sagradong reciprocity ng pagbibigay at pagtanggap — pagtulong-sa-sarili, isang miyembro isang boses, walang sentral na may-ari.

---

## ✨ Mga Tampok

- 🪪 **Soulbound na membership** — taunan, hindi-mailipat. Ang pagiging kabilang ay pinagsisikapan at binabago, hindi kailanman binibili o ipinagbibili.
- 🕶️ **Anonymous bilang default** — ang isang miyembro ay isang private na commitment sa isang Merkle set, hindi isang nakikitang wallet. Ang pagboto at mga credential ay zero-knowledge; ang pagkakakilanlan ay inihahayag lamang sa pamamagitan ng pagpili.
- 🗳️ **Group-conscience na pagboto** — isang miyembro, isang boto, ibinubto nang anonymous (walang token-weighted na plutocracy), na may per-proposal na nullifier na pumipigil sa dobleng-boto.
- 🏛️ **Walang may-ari, walang admin key** — ang 7-upuang Council *mismo* ang awtoridad at kumikilos lamang sa pamamagitan ng **4-of-7**.
- 🔑 **Key recovery na nakakaligtas sa pagkawala** — magpalit ng isang upuan o ilipat ang bawat artifact ng isang nawalang wallet sa isang bago, sa likod ng isang contest window na maaaring i-trigger ng sinumang isang tapat na upuan.
- 🌱 **Mga Circle na maaaring i-fork** — anumang grupo ay maaaring magsimula ng bagong Circle na may magkaparehong pamamahala; ang World Service Circle ay nag-uugnay ng nakabahaging materyal, hindi ito namumuno.
- 📜 **Mga selective-disclosure na credential** — mga sertipiko ng kurso/inisasyon ("sino, anong kurso, tinuruan ng sino, kailan") na binubuksan *patlang-patlang* sa zero-knowledge.

---

## 💡 Paano ito nagkakaugnay

Basahin ito tulad ng isang puno — ang mga tao ay ang canopy sa itaas, ang mga Circle ay ang mga sanga, at ang World Service Circle ay ang puno at mga ugat sa pundasyon:

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

- **Mga miyembro (ang canopy)** — bawat isa ay sumasali sa member set ng isang Circle bilang isang anonymous na commitment at kumikilos sa pamamagitan ng proofs; hindi kailanman kailangang ilantad ang isang wallet. Isang miyembro, isang boto.
- **Mga Circle (ang mga sanga)** — mga awtonomong lokal na grupo, bawat isa ay may sariling 7-upuang Council, treasury, at mga boto; na-fork mula sa template.
- **World Service Circle (ang puno/ugat)** — nagtataglay ng nakabahaging template at mga dokumento at nag-uugnay sa paglikha ng Circle, ngunit **hindi** pinapawalang-bisa ang lokal na group conscience. Ang ugnayan ay isang *federation link*, hindi isang chain of command.

## 🎩 Sino ang gumagawa ng ano — ang 7-upuang Council

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

- **Walang admin key.** Ang bawat privileged na aksyon ay isang tungkulin ng upuan sa Council o isang 4-of-7 na proposal.
- **Naglilingkod ang mga servant, nagpapasya ang mga miyembro.** Ang mga rutinang tungkulin ay itinatalaga sa isang upuan at maaaring bawiin sa pamamagitan ng pag-ikot ng Council; ang direksyon ay itinatakda ng boto ng miyembro.

---

## 📖 Paggamit at mga halimbawa

Ang apat na uri ng desisyon na sinusuportahan ng Ayni, at kung saan nakatira ang bawat isa:

| Desisyon | Sino ang bumoboto | Mekanismo |
|---|---|---|
| **Lokal na usapin** (sariling negosyo ng isang Circle) | mga miyembro ng Circle na iyon | anonymous na ZK member vote |
| **Foundation charter** (hal. ang "12 Steps") | mga key sa antas-pundasyon lamang | World Service member/Council vote |
| **Nakabahaging teksto** (hal. ang iminungkahing Preamble) | **lahat** ng Circle + pundasyon | federation-wide na pinagsama-samang boto |
| **Recovery / treasury** | ang 7-upuang Council | 4-of-7 na proposal + contest window |

Ang mga ginawang, kopya-paste-able na walkthrough para sa lahat ng ito ay nasa **[IMPLEMENTATION.md](../IMPLEMENTATION.md)**.

<div align="center">
  <img src="../images/BluePrint.png" alt="Ayni — blueprint" width="880" />
</div>

---

## 🚀 Mabilis na pagsisimula

> Mga kinakailangan: **Rust**, **Solana/Agave CLI 2.x**, **Anchor 0.31.1**, **Node 20+**, at (para sa proofs) **circom 2.1** + **snarkjs**.

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

Iyon ang buong unang-pagtakbo. Ang mga test ay nagtatayo ng isang Circle, nag-isyu ng mga anonymous na membership, nagpapatakbo ng isang 4-of-7 na recovery, at nagbe-verify ng tunay na Groth16 na vote proof on-chain (at tinatanggihan ang isang inulit na nullifier).

Upang itayo ang iyong sariling kapatiran at patakbuhin ang lahat ng apat na uri ng boto, sundan ang **[IMPLEMENTATION.md](../IMPLEMENTATION.md)** hakbang-hakbang.

---

## 🗺️ Roadmap

- [x] Soulbound na membership lifecycle + 7-upuang Council (4-of-7)
- [x] Anonymous na ZK member voting (tunay na Groth16 round-trip, on-chain)
- [x] ZK lineage grants + selective-disclosure na acknowledgments
- [x] Key recovery: pag-ikot ng upuan + wallet migration na may contest window
- [x] Security review + critical/high na mga ayos (tingnan ang [SECURITY_REVIEW.md](../SECURITY_REVIEW.md))
- [ ] Federation-wide (cross-Circle) na voting aggregation
- [ ] Production na multi-party trusted-setup ceremony (palitan ang dev keys)
- [ ] Coercion-resistant na pagboto (MACI-style)
- [ ] Token-2022 na soulbound mint na nakakabit end-to-end
- [ ] External na audit

Buong backlog: [BACKLOG.md](../BACKLOG.md).

---

## 🧭 Mapa ng repo

| Path | Mga Nilalaman |
|---|---|
| `PROJECT.md` | Ang chain-agnostic na AHA na modelo (ang *ano* at *bakit*). |
| `IMPLEMENTATION.md` | Hakbang-hakbang na runbook: pundasyon → unang Circle → ang apat na boto. |
| `programs/ayni/` | Ang Anchor na programa — mga membership, Council, ZK voting at lineage. |
| `circuits/` | Mga Circom circuit: member voting, lineage grants, acknowledgments. |
| `docs/` | Malalalim na pagtalakay: resilience, treasury, voting, sybil, ZK lineage, acknowledgments. |
| `app/` | Mga TypeScript proving helper (Merkle trees, proof generation). |
| `SECURITY_REVIEW.md` | Pinakahuling konsepto + security review at ang mga ayos na inilapat. |

---

## 🤝 Pag-aambag

Malugod na tinatanggap ang mga ambag — mga issue, PR, at pagsusuri lalo na ng cryptography.

1. I-fork at mag-branch mula sa `solana` (ang default na branch; ang ibang chain ay nasa `ethereum`, `avalanche`).
2. Dapat pumasa ang `anchor build && anchor test`.
3. Magbukas ng PR na naglalarawan sa pagbabago at sa security impact nito.

Ang magandang lugar upang magsimula ay may label na **`good first issue`**. Maging mahusay sa isa't isa — tingnan ang [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md).

**Mga iminungkahing GitHub topic:** `solana` · `anchor` · `zero-knowledge` · `zk-snarks` · `circom` · `dao` · `governance` · `soulbound` · `privacy` · `anonymous-voting` · `groth16`

---

## ⚠️ Status at seguridad

Research / **pre-audit**. Ang ZK anonymity layer at ang 4-of-7 na recovery ay naipatupad at nasubok sa localnet. **Huwag gamitin sa produksyon** nang walang tunay na multi-party trusted-setup ceremony at isang external na audit. Pinakahuling review at mga inilapat na ayos: [SECURITY_REVIEW.md](../SECURITY_REVIEW.md).

## 📄 Lisensya

[GNU AGPL-3.0](../LICENSE) © ang mga nag-ambag sa Ayni / AHA. Ang paggamit sa network ay distribusyon: kung magpapatakbo ka ng binagong Ayni bilang isang serbisyo, dapat mong ibahagi ang iyong source sa ilalim ng parehong lisensya.

---

<div align="center">

Kung ang modelo ng Ayni ng **anonymous, walang-may-ari na kapatiran** ay tumutugma sa iyo, ⭐ **i-star ang repo** upang masundan — tumutulong ito sa iba na makita ito.

</div>

<div align="center">
  <img src="../images/Model.png" alt="AHA / Ayni — the full model" width="920" />
</div>
