<div align="center">

<img src="../images/AHA.png" alt="AHA — Ancestral Humanity Anonymous" width="220" />

# Ayni

**Comunități de membri auto-guvernate și anonime pe Solana — soulbound, private prin ZK, fără proprietar.**

Cadru deschis pentru DAO-uri de membri ai unei comunități, cu vot anonim cu cunoaștere zero și
acreditări de filiație care pot fi dezvăluite selectiv.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](../LICENSE)
[![Anchor](https://img.shields.io/badge/Anchor-0.31.1-512BD4)](https://www.anchor-lang.com/)
[![Solana](https://img.shields.io/badge/Solana-2.x-14F195)](https://solana.com/)
[![Circom](https://img.shields.io/badge/Circom-2.1-orange)](https://docs.circom.io/)
[![Status](https://img.shields.io/badge/status-research%2Fpre--audit-yellow)](../BACKLOG.md)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#-contribuții)

🌍 [Other languages](README.md) · [English](../README.md)

</div>

---

## Ce este Ayni?

Ayni este implementarea pe Solana a unei **Organizații Autonome Descentralizate (DAO) anonime** —
proiectată inițial pentru a răspunde nevoilor **AHA (Ancestral Humanity Anonymous)**, dar deschisă
oricărei organizații. În esența sa, este un șablon agnostic față de blockchain pentru comunități la
nivel mondial, modelat după succesul dovedit de un secol al **tradițiilor AA / cei 12 pași**. Oferă
oricărui grup o modalitate gata de utilizare pentru a **admite membri, deține o trezorerie, decide
prin conștiința de grup și recupera chei pierdute** — în timp ce fiecare membru rămâne **anonim în
mod implicit** prin dovezi cu cunoaștere zero.

- **Ce face** — administrează o comunitate de membri pe blockchain: apartenențe anuale soulbound,
  un vot anonim per membru, o trezorerie alimentată doar prin donații și un Consiliu cu 7 locuri cu
  recuperare de chei 4-din-7 — fără proprietar, fără cheie de administrator.
- **Pentru cine este** — comunități, grupuri de ajutor reciproc, comunități anonime, DAO-uri care
  doresc *apartenență* în loc de speculație, și oricine are nevoie de **confidențialitate reală**
  pentru membri.
- **Cum se folosește** — clonează șablonul, instalează un Consiliu, deschide un Cerc, iar membrii se
  alătură ca angajamente private. Vezi [Pornire rapidă](#-pornire-rapidă).

> *Ayni* (Quechua): reciprocitatea sacră a dăruirii și primirii — autosusținere, un membru o
> voce, fără proprietar central.

---

## ✨ Caracteristici

- 🪪 **Apartenență soulbound** — anuală, netransferabilă. Apartenența se câștigă și se reînnoiește,
  nu se cumpără și nu se vinde niciodată.
- 🕶️ **Anonim în mod implicit** — un membru este un angajament privat într-un set Merkle, nu un
  portofel vizibil. Votul și acreditările sunt cu cunoaștere zero; identitatea este dezvăluită doar
  prin alegere.
- 🗳️ **Vot prin conștiința de grup** — un membru, un vot, exprimat anonim (fără plutocrație
  ponderată prin tokenuri), cu un nullifier per propunere care previne voturile duble.
- 🏛️ **Fără proprietar, fără cheie de administrator** — Consiliul cu 7 locuri *este* autoritatea și
  acționează doar prin **4-din-7**.
- 🔑 **Recuperare de chei care supraviețuiește pierderii** — rotește un loc sau migrează fiecare
  artefact al unui portofel pierdut către unul nou, în spatele unei ferestre de contestare pe care
  orice loc onest singur o poate declanșa.
- 🌱 **Cercuri care pot fi clonate** — orice grup pornește un nou Cerc cu o guvernanță identică;
  Cercul de Serviciu Mondial coordonează materialul comun, nu îl conduce.
- 📜 **Acreditări cu dezvăluire selectivă** — certificate de curs/inițiere ("cine, ce curs, predat
  de cine, când") deschise *câmp cu câmp* în cunoaștere zero.

---

## 💡 Cum se îmbină totul

Citește-l ca pe un copac — oamenii sunt coroana din vârf, Cercurile sunt
ramurile, iar Cercul de Serviciu Mondial este trunchiul și rădăcinile de la bază:

```
 member member member      member member member      member member member     ← membrii
 (anon) (anon) (anon)      (anon) (anon) (anon)      (anon) (anon) (anon)         (anonimi,
    \      |      /          \      |      /          \      |      /              un membru,
     ┌─────┬─────┐            ┌─────┬─────┐            ┌─────┬─────┐               un vot)
     │   Cusco   │            │  Lisbon   │            │  Bangkok  │
     │ Council 7 │            │ Council 7 │            │ Council 7 │   …        ← Cercuri:
     └─────┴─────┘            └─────┴─────┘            └─────┴─────┘               ramurile
           └────────────────────────┬────────────────────────┘
                                    │   fiecare Cerc e clonat dintr-un șablon comun
                     ┌───────────────┴───────────────┐
                     │     WORLD SERVICE CIRCLE       │   ← trunchiul / rădăcina ("fundația"):
                     │   12 Steps · Preamble · docs   │      deține șablonul comun + un
                     │    7-seat Council · 4-of-7     │      Consiliu (4/7) care coordonează
                     └───────────────────────────────┘      dar NU guvernează
```

- **Membri (coroana)** — fiecare se alătură setului de membri al unui Cerc ca angajament anonim și
  acționează prin dovezi; nu este nevoie niciodată să își expună un portofel. Un membru, un vot.
- **Cercuri (ramurile)** — grupuri locale autonome, fiecare cu propriul Consiliu cu 7 locuri,
  trezorerie și voturi; clonate din șablon.
- **Cercul de Serviciu Mondial (trunchiul/rădăcina)** — deține șablonul comun și documentele și
  coordonează crearea Cercurilor, dar **nu** anulează conștiința de grup locală. Legătura este o
  *legătură de federație*, nu un lanț de comandă.

## 🎩 Cine ce face — Consiliul cu 7 locuri

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

- **Fără cheie de administrator.** Fiecare acțiune privilegiată este o îndatorire a unui loc din
  Consiliu sau o propunere 4-din-7.
- **Servitorii servesc, membrii decid.** Îndatoririle de rutină sunt delegate unui loc și revocabile
  prin rotația Consiliului; direcția este stabilită prin votul membrilor.

---

## 📖 Utilizare și exemple

Cele patru tipuri de decizie pe care le susține Ayni, și unde se află fiecare:

| Decizie | Cine votează | Mecanism |
|---|---|---|
| **Chestiune locală** (afacerea proprie a unui Cerc) | membrii acelui Cerc | vot anonim ZK al membrilor |
| **Carta fundației** (de ex. "cei 12 pași") | doar chei la nivel de fundație | vot al membrilor/Consiliului de Serviciu Mondial |
| **Text comun** (de ex. Preambulul sugerat) | **toate** Cercurile + fundația | vot agregat la nivel de federație |
| **Recuperare / trezorerie** | Consiliul cu 7 locuri | propunere 4-din-7 + fereastră de contestare |

Parcurgeri funcționale, gata de copiat, pentru toate acestea se găsesc în **[IMPLEMENTATION.md](../IMPLEMENTATION.md)**.

<div align="center">
  <img src="../images/BluePrint.png" alt="Ayni — blueprint" width="880" />
</div>

---

## 🚀 Pornire rapidă

> Cerințe prealabile: **Rust**, **Solana/Agave CLI 2.x**, **Anchor 0.31.1**, **Node 20+**, și (pentru
> dovezi) **circom 2.1** + **snarkjs**.

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

Aceasta este toată prima rulare. Testele instalează un Cerc, emit apartenențe anonime, rulează o
recuperare 4-din-7 și verifică o dovadă de vot Groth16 reală pe blockchain (și resping un nullifier
reluat).

Pentru a instala propria comunitate și a rula toate cele patru tipuri de vot, urmărește pas cu pas
**[IMPLEMENTATION.md](../IMPLEMENTATION.md)**.

---

## 🗺️ Plan de dezvoltare

- [x] Ciclul de viață al apartenenței soulbound + Consiliu cu 7 locuri (4-din-7)
- [x] Vot anonim ZK al membrilor (round-trip Groth16 real, pe blockchain)
- [x] Acordări de filiație ZK + confirmări cu dezvăluire selectivă
- [x] Recuperare de chei: rotația locurilor + migrarea portofelului cu fereastră de contestare
- [x] Revizuire de securitate + corecții critice/majore (vezi [SECURITY_REVIEW.md](../SECURITY_REVIEW.md))
- [ ] Agregarea voturilor la nivel de federație (între Cercuri)
- [ ] Ceremonie de configurare de încredere multi-parte pentru producție (înlocuirea cheilor de dezvoltare)
- [ ] Vot rezistent la coerciție (stil MACI)
- [ ] Mint soulbound Token-2022 conectat cap la cap
- [ ] Audit extern

Backlog complet: [BACKLOG.md](../BACKLOG.md).

---

## 🧭 Harta depozitului

| Cale | Conținut |
|---|---|
| `PROJECT.md` | Modelul AHA agnostic față de blockchain (*ce*-ul și *de ce*-ul). |
| `IMPLEMENTATION.md` | Ghid pas cu pas: fundație → primul Cerc → cele patru voturi. |
| `programs/ayni/` | Programul Anchor — apartenențe, Consiliu, vot ZK și filiație. |
| `circuits/` | Circuite Circom: votul membrilor, acordări de filiație, confirmări. |
| `docs/` | Aprofundări: reziliență, trezorerie, vot, sybil, filiație ZK, confirmări. |
| `app/` | Asistenți de dovedire în TypeScript (arbori Merkle, generare de dovezi). |
| `SECURITY_REVIEW.md` | Cea mai recentă revizuire de concept + securitate și corecțiile aplicate. |

---

## 🤝 Contribuții

Contribuțiile sunt binevenite — probleme, PR-uri și revizuirea criptografiei în special.

1. Fork și ramificare din `solana` (ramura implicită; alte blockchain-uri se află pe `ethereum`, `avalanche`).
2. `anchor build && anchor test` trebuie să treacă.
3. Deschide un PR care descrie modificarea și impactul ei asupra securității.

Locuri bune de început sunt etichetate **`good first issue`**. Fiți minunați unii cu alții — vezi
[CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md).

**Subiecte GitHub sugerate:** `solana` · `anchor` · `zero-knowledge` · `zk-snarks` · `circom` ·
`dao` · `governance` · `soulbound` · `privacy` · `anonymous-voting` · `groth16`

---

## ⚠️ Stare și securitate

Cercetare / **pre-audit**. Stratul de anonimat ZK și recuperarea 4-din-7 sunt implementate și testate
pe localnet. **A nu se utiliza în producție** fără o ceremonie reală de configurare de încredere
multi-parte și un audit extern. Cea mai recentă revizuire și corecțiile aplicate:
[SECURITY_REVIEW.md](../SECURITY_REVIEW.md).

## 📄 Licență

[GNU AGPL-3.0](../LICENSE) © contribuitorii Ayni / AHA. Utilizarea în rețea este distribuție: dacă
rulezi un Ayni modificat ca serviciu, trebuie să-ți partajezi codul sursă sub aceeași licență.

---

<div align="center">

Dacă modelul Ayni de **comunitate anonimă, fără proprietar** rezonează cu tine, ⭐ **dă o stea
depozitului** pentru a urmări evoluția — îi ajută pe alții să-l găsească.

</div>

<div align="center">
  <img src="../images/Model.png" alt="AHA / Ayni — the full model" width="920" />
</div>
