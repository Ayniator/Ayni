<!-- Machine-assisted translation — please review with a native Lao speaker before trusting. -->
<div align="center">

<img src="../images/AHA.png" alt="AHA — Ancestral Humanity Anonymous" width="220" />

# Ayni

**ກຸ່ມສະມາຊິກທີ່ປົກຄອງຕົນເອງ ແລະ ບໍ່ເປີດເຜີຍຕົວຕົນ ເທິງ Solana — ຜູກກັບຕົວຕົນ (soulbound), ປົກປ້ອງຄວາມເປັນສ່ວນຕົວແບບ ZK, ບໍ່ມີເຈົ້າຂອງ.**

ໂຄງຮ່າງເປີດສຳລັບ DAO ສະມາຊິກພາບຂອງກຸ່ມພະນະມິດ ພ້ອມການລົງຄະແນນແບບບໍ່ເປີດເຜີຍຕົວຕົນດ້ວຍຄວາມຮູ້ສູນ (zero-knowledge) ແລະ ໃບຮັບຮອງສາຍກຳເນີດທີ່ສາມາດເປີດເຜີຍໄດ້ແບບເລືອກສັນ.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](../LICENSE)
[![Anchor](https://img.shields.io/badge/Anchor-0.31.1-512BD4)](https://www.anchor-lang.com/)
[![Solana](https://img.shields.io/badge/Solana-2.x-14F195)](https://solana.com/)
[![Circom](https://img.shields.io/badge/Circom-2.1-orange)](https://docs.circom.io/)
[![Status](https://img.shields.io/badge/status-research%2Fpre--audit-yellow)](../BACKLOG.md)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#-ການມີສ່ວນຮ່ວມ)

🌍 [Other languages](README.md) · [English](../README.md)

</div>

---

## Ayni ແມ່ນຫຍັງ?

Ayni ແມ່ນການນຳໃຊ້ເທິງ Solana ຂອງ **ອົງການປົກຄອງຕົນເອງແບບກະຈາຍສູນທີ່ບໍ່ເປີດເຜີຍຕົວຕົນ (DAO)** —
ໃນເບື້ອງຕົ້ນຖືກອອກແບບເພື່ອຕອບສະໜອງຄວາມຕ້ອງການຂອງ **AHA (Ancestral Humanity Anonymous)** ແຕ່ເປີດໃຫ້ກັບ
ອົງການໃດກໍໄດ້. ໂດຍແກ່ນແທ້ມັນແມ່ນແມ່ແບບທີ່ບໍ່ຂຶ້ນກັບ chain ໃດໜຶ່ງ ສຳລັບກຸ່ມພະນະມິດທົ່ວໂລກ, ໂດຍຍຶດຕາມ
ຄວາມສຳເລັດທີ່ໄດ້ຮັບການພິສູດມາແລ້ວເປັນສະຕະວັດຂອງ **AA / ປະເພນີ 12 ຂັ້ນຕອນ**. ມັນໃຫ້ກຸ່ມໃດໜຶ່ງມີວິທີສຳເລັດຮູບ
ໃນການ **ຮັບສະມາຊິກ, ຖືກອງທຶນ, ຕັດສິນໃຈໂດຍຈິດສຳນຶກຂອງກຸ່ມ, ແລະ ກູ້ຄືນຈາກກະແຈທີ່ສູນເສຍ** — ໃນຂະນະທີ່
ສະມາຊິກທຸກຄົນຍັງຄົງ **ບໍ່ເປີດເຜີຍຕົວຕົນຕາມຄ່າເລີ່ມຕົ້ນ** ຜ່ານການພິສູດແບບຄວາມຮູ້ສູນ.

- **ມັນເຮັດຫຍັງ** — ດຳເນີນກຸ່ມສະມາຊິກພະນະມິດເທິງ chain: ສະມາຊິກພາບລາຍປີແບບ soulbound,
  ການລົງຄະແນນແບບໜຶ່ງສະມາຊິກໜຶ່ງສຽງທີ່ບໍ່ເປີດເຜີຍຕົວຕົນ, ກອງທຶນທີ່ມາຈາກການບໍລິຈາກເທົ່ານັ້ນ, ແລະ Council 7 ບ່ອນນັ່ງ
  ພ້ອມການກູ້ຄືນກະແຈແບບ 4-of-7 — ບໍ່ມີເຈົ້າຂອງ, ບໍ່ມີກະແຈ admin.
- **ມັນເໝາະສຳລັບໃຜ** — ກຸ່ມພະນະມິດ, ກຸ່ມຊ່ວຍເຫຼືອເຊິ່ງກັນແລະກັນ, ຊຸມຊົນທີ່ບໍ່ເປີດເຜີຍຕົວຕົນ, DAO ທີ່ຕ້ອງການ
  *ການເປັນສ່ວນໜຶ່ງ* ແທນທີ່ການເກັງກຳໄລ, ແລະ ໃຜກໍຕາມທີ່ຕ້ອງການ **ຄວາມເປັນສ່ວນຕົວທີ່ແທ້ຈິງ** ໃຫ້ສະມາຊິກ.
- **ວິທີໃຊ້ມັນ** — fork ແມ່ແບບ, ຈັດຕັ້ງ Council, ເປີດ Circle, ແລະ ສະມາຊິກເຂົ້າຮ່ວມເປັນ commitment ສ່ວນຕົວ.
  ເບິ່ງ [ເລີ່ມຕົ້ນໄວ](#-ເລີ່ມຕົ້ນໄວ).

> *Ayni* (ພາສາ Quechua): ການຕອບແທນອັນສັກສິດຂອງການໃຫ້ ແລະ ການຮັບ — ການສະໜັບສະໜູນຕົນເອງ, ໜຶ່ງສະມາຊິກໜຶ່ງ
> ສຽງ, ບໍ່ມີເຈົ້າຂອງສ່ວນກາງ.

---

## ✨ ຄຸນສົມບັດ

- 🪪 **ສະມາຊິກພາບແບບ soulbound** — ລາຍປີ, ໂອນບໍ່ໄດ້. ການເປັນສ່ວນໜຶ່ງແມ່ນໄດ້ມາ ແລະ ຕໍ່ອາຍຸ, ບໍ່ເຄີຍ
  ຊື້ ຫຼື ຂາຍ.
- 🕶️ **ບໍ່ເປີດເຜີຍຕົວຕົນຕາມຄ່າເລີ່ມຕົ້ນ** — ສະມາຊິກແມ່ນ commitment ສ່ວນຕົວໃນຊຸດ Merkle, ບໍ່ແມ່ນ wallet ທີ່ເຫັນໄດ້.
  ການລົງຄະແນນ ແລະ ໃບຮັບຮອງເປັນແບບຄວາມຮູ້ສູນ; ຕົວຕົນຖືກເປີດເຜີຍໂດຍການເລືອກເທົ່ານັ້ນ.
- 🗳️ **ການລົງຄະແນນຕາມຈິດສຳນຶກຂອງກຸ່ມ** — ໜຶ່ງສະມາຊິກ, ໜຶ່ງສຽງ, ລົງແບບບໍ່ເປີດເຜີຍຕົວຕົນ (ບໍ່ມີລະບອບ
  plutocracy ທີ່ຖ່ວງນ້ຳໜັກດ້ວຍ token), ພ້ອມ nullifier ຕໍ່ແຕ່ລະຂໍ້ສະເໜີເພື່ອປ້ອງກັນການລົງຄະແນນຊ້ຳ.
- 🏛️ **ບໍ່ມີເຈົ້າຂອງ, ບໍ່ມີກະແຈ admin** — Council 7 ບ່ອນນັ່ງ *ຄື* ອຳນາດ ແລະ ກະທຳໂດຍ **4-of-7** ເທົ່ານັ້ນ.
- 🔑 **ການກູ້ຄືນກະແຈທີ່ຢູ່ລອດຈາກການສູນເສຍ** — ໝູນວຽນບ່ອນນັ່ງ ຫຼື ຍ້າຍທຸກ artifact ຂອງ wallet ທີ່ສູນເສຍ
  ໄປຫາ wallet ໃໝ່, ຫຼັງໜ້າຕ່າງໂຕ້ແຍ້ງ (contest window) ທີ່ບ່ອນນັ່ງທີ່ຊື່ສັດໃດໜຶ່ງສາມາດກະຕຸ້ນໄດ້.
- 🌱 **Circle ທີ່ fork ໄດ້** — ກຸ່ມໃດໜຶ່ງສ້າງ Circle ໃໝ່ດ້ວຍການປົກຄອງທີ່ຄືກັນ; World Service Circle
  ປະສານງານວັດສະດຸທີ່ໃຊ້ຮ່ວມກັນ, ມັນບໍ່ໄດ້ປົກຄອງ.
- 📜 **ໃບຮັບຮອງເປີດເຜີຍແບບເລືອກສັນ** — ໃບຢັ້ງຢືນຫຼັກສູດ/ການເລີ່ມຮັບ ("ໃຜ, ຫຼັກສູດໃດ,
  ສອນໂດຍໃຜ, ເມື່ອໃດ") ເປີດ *ທີລະຊ່ອງຂໍ້ມູນ* ແບບຄວາມຮູ້ສູນ.

---

## 💡 ມັນປະກອບເຂົ້າກັນແນວໃດ

ອ່ານມັນຄືກັບຕົ້ນໄມ້ — ຜູ້ຄົນແມ່ນເຮືອນຍອດທີ່ຢູ່ເທິງສຸດ, Circle ແມ່ນກິ່ງກ້ານ,
ແລະ World Service Circle ແມ່ນລຳຕົ້ນ ແລະ ຮາກຢູ່ໂຄນ:

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

- **ສະມາຊິກ (ເຮືອນຍອດ)** — ແຕ່ລະຄົນເຂົ້າຮ່ວມຊຸດສະມາຊິກຂອງ Circle ເປັນ commitment ທີ່ບໍ່ເປີດເຜີຍຕົວຕົນ ແລະ ກະທຳ
  ຜ່ານການພິສູດ; ບໍ່ເຄີຍຕ້ອງເປີດເຜີຍ wallet. ໜຶ່ງສະມາຊິກ, ໜຶ່ງສຽງ.
- **Circle (ກິ່ງກ້ານ)** — ກຸ່ມທ້ອງຖິ່ນທີ່ປົກຄອງຕົນເອງ, ແຕ່ລະກຸ່ມມີ Council 7 ບ່ອນນັ່ງຂອງຕົນເອງ, ກອງທຶນ,
  ແລະ ການລົງຄະແນນ; fork ມາຈາກແມ່ແບບ.
- **World Service Circle (ລຳຕົ້ນ/ຮາກ)** — ຖືແມ່ແບບ ແລະ ເອກະສານທີ່ໃຊ້ຮ່ວມກັນ ແລະ ປະສານງານ
  ການສ້າງ Circle, ແຕ່ **ບໍ່** ລົບລ້າງຈິດສຳນຶກຂອງກຸ່ມທ້ອງຖິ່ນ. ການເຊື່ອມໂຍງແມ່ນ *ການເຊື່ອມໂຍງແບບສະຫະພັນ*,
  ບໍ່ແມ່ນສາຍບັງຄັບບັນຊາ.

## 🎩 ໃຜເຮັດຫຍັງ — Council 7 ບ່ອນນັ່ງ

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

- **ບໍ່ມີກະແຈ admin.** ທຸກໆການກະທຳທີ່ມີສິດທິພິເສດແມ່ນໜ້າທີ່ຂອງບ່ອນນັ່ງ Council ຫຼື ຂໍ້ສະເໜີແບບ 4-of-7.
- **ຜູ້ຮັບໃຊ້ຮັບໃຊ້, ສະມາຊິກຕັດສິນໃຈ.** ໜ້າທີ່ປະຈຳວັນຖືກມອບໝາຍໃຫ້ບ່ອນນັ່ງ ແລະ ສາມາດເພີກຖອນໄດ້ໂດຍ
  ການໝູນວຽນ Council; ທິດທາງຖືກກຳນົດໂດຍການລົງຄະແນນຂອງສະມາຊິກ.

---

## 📖 ການນຳໃຊ້ & ຕົວຢ່າງ

ການຕັດສິນໃຈສີ່ປະເພດທີ່ Ayni ຮອງຮັບ, ແລະ ແຕ່ລະປະເພດຢູ່ໃສ:

| ການຕັດສິນໃຈ | ໃຜລົງຄະແນນ | ກົນໄກ |
|---|---|---|
| **ເລື່ອງທ້ອງຖິ່ນ** (ກິດຈະການຂອງ Circle ເອງ) | ສະມາຊິກຂອງ Circle ນັ້ນ | ການລົງຄະແນນສະມາຊິກແບບ ZK ບໍ່ເປີດເຜີຍຕົວຕົນ |
| **ກົດບັດມູນນິທິ** (ເຊັ່ນ "12 Steps") | ກະແຈລະດັບມູນນິທິເທົ່ານັ້ນ | ການລົງຄະແນນສະມາຊິກ/Council ຂອງ World Service |
| **ຂໍ້ຄວາມທີ່ໃຊ້ຮ່ວມກັນ** (ເຊັ່ນ Preamble ທີ່ແນະນຳ) | **ທຸກ** Circle + ມູນນິທິ | ການລົງຄະແນນລວມທົ່ວສະຫະພັນ |
| **ການກູ້ຄືນ / ກອງທຶນ** | Council 7 ບ່ອນນັ່ງ | ຂໍ້ສະເໜີ 4-of-7 + ໜ້າຕ່າງໂຕ້ແຍ້ງ |

ການແນະນຳແບບລະອຽດ, ກັອບປີ້-ວາງໄດ້ສຳລັບທັງໝົດນີ້ຢູ່ໃນ **[IMPLEMENTATION.md](../IMPLEMENTATION.md)**.

<div align="center">
  <img src="../images/BluePrint.png" alt="Ayni — blueprint" width="880" />
</div>

---

## 🚀 ເລີ່ມຕົ້ນໄວ

> ຄວາມຕ້ອງການເບື້ອງຕົ້ນ: **Rust**, **Solana/Agave CLI 2.x**, **Anchor 0.31.1**, **Node 20+**, ແລະ (ສຳລັບການພິສູດ)
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

ນັ້ນແມ່ນການແລ່ນຄັ້ງທຳອິດທັງໝົດ. ການທົດສອບຈະຕັ້ງ Circle ຂຶ້ນ, ອອກສະມາຊິກພາບແບບບໍ່ເປີດເຜີຍຕົວຕົນ, ແລ່ນການກູ້ຄືນ
4-of-7, ແລະ ກວດສອບການພິສູດການລົງຄະແນນ Groth16 ທີ່ແທ້ຈິງເທິງ chain (ແລະ ປະຕິເສດ nullifier ທີ່ຖືກນຳມາໃຊ້ຊ້ຳ).

ເພື່ອຕັ້ງກຸ່ມພະນະມິດຂອງທ່ານເອງ ແລະ ແລ່ນການລົງຄະແນນທັງສີ່ປະເພດ, ໃຫ້ປະຕິບັດຕາມ
**[IMPLEMENTATION.md](../IMPLEMENTATION.md)** ເທື່ອລະຂັ້ນຕອນ.

---

## 🗺️ ແຜນທີ່ເສັ້ນທາງ (Roadmap)

- [x] ວົງຈອນຊີວິດສະມາຊິກພາບແບບ soulbound + Council 7 ບ່ອນນັ່ງ (4-of-7)
- [x] ການລົງຄະແນນສະມາຊິກແບບ ZK ບໍ່ເປີດເຜີຍຕົວຕົນ (Groth16 round-trip ທີ່ແທ້ຈິງ, ເທິງ chain)
- [x] ການມອບສາຍກຳເນີດ ZK + ການຮັບຮູ້ການເປີດເຜີຍແບບເລືອກສັນ
- [x] ການກູ້ຄືນກະແຈ: ການໝູນວຽນບ່ອນນັ່ງ + ການຍ້າຍ wallet ພ້ອມໜ້າຕ່າງໂຕ້ແຍ້ງ
- [x] ການກວດສອບຄວາມປອດໄພ + ການແກ້ໄຂລະດັບ critical/high (ເບິ່ງ [SECURITY_REVIEW.md](../SECURITY_REVIEW.md))
- [ ] ການລວມການລົງຄະແນນທົ່ວສະຫະພັນ (ຂ້າມ Circle)
- [ ] ພິທີ trusted-setup ແບບຫຼາຍຝ່າຍລະດັບການຜະລິດ (ປ່ຽນແທນກະແຈ dev)
- [ ] ການລົງຄະແນນທີ່ຕ້ານທານການບັງຄັບ (ແບບ MACI)
- [ ] Token-2022 soulbound mint ເຊື່ອມຕໍ່ແບບຄົບວົງຈອນ
- [ ] ການກວດສອບພາຍນອກ

backlog ເຕັມ: [BACKLOG.md](../BACKLOG.md).

---

## 🧭 ແຜນທີ່ Repo

| ເສັ້ນທາງ | ເນື້ອໃນ |
|---|---|
| `PROJECT.md` | ໂມເດລ AHA ທີ່ບໍ່ຂຶ້ນກັບ chain (*ຫຍັງ* ແລະ *ເປັນຫຍັງ*). |
| `IMPLEMENTATION.md` | runbook ເທື່ອລະຂັ້ນຕອນ: ມູນນິທິ → Circle ທຳອິດ → ການລົງຄະແນນທັງສີ່. |
| `programs/ayni/` | ໂປຣແກຣມ Anchor — ສະມາຊິກພາບ, Council, ການລົງຄະແນນ ZK & ສາຍກຳເນີດ. |
| `circuits/` | ວົງຈອນ Circom: ການລົງຄະແນນສະມາຊິກ, ການມອບສາຍກຳເນີດ, ການຮັບຮູ້. |
| `docs/` | ການເຈາະເລິກ: ຄວາມຍືດຍຸ່ນ, ກອງທຶນ, ການລົງຄະແນນ, sybil, ສາຍກຳເນີດ ZK, ການຮັບຮູ້. |
| `app/` | ຕົວຊ່ວຍການພິສູດ TypeScript (Merkle trees, ການສ້າງການພິສູດ). |
| `SECURITY_REVIEW.md` | ການກວດສອບແນວຄິດ + ຄວາມປອດໄພລ່າສຸດ ແລະ ການແກ້ໄຂທີ່ນຳໃຊ້. |

---

## 🤝 ການມີສ່ວນຮ່ວມ

ຍິນດີຕ້ອນຮັບການມີສ່ວນຮ່ວມ — issue, PR, ແລະ ການກວດສອບ cryptography ໂດຍສະເພາະ.

1. Fork ແລະ branch ຈາກ `solana` (branch ເລີ່ມຕົ້ນ; chain ອື່ນຢູ່ທີ່ `ethereum`, `avalanche`).
2. `anchor build && anchor test` ຕ້ອງຜ່ານ.
3. ເປີດ PR ທີ່ອະທິບາຍການປ່ຽນແປງ ແລະ ຜົນກະທົບດ້ານຄວາມປອດໄພຂອງມັນ.

ບ່ອນທີ່ດີໃນການເລີ່ມຕົ້ນຖືກຕິດປ້າຍ **`good first issue`**. ໃຫ້ດີຕໍ່ກັນ — ເບິ່ງ
[CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md).

**ຫົວຂໍ້ GitHub ທີ່ແນະນຳ:** `solana` · `anchor` · `zero-knowledge` · `zk-snarks` · `circom` ·
`dao` · `governance` · `soulbound` · `privacy` · `anonymous-voting` · `groth16`

---

## ⚠️ ສະຖານະ & ຄວາມປອດໄພ

ການຄົ້ນຄວ້າ / **ກ່ອນການກວດສອບ (pre-audit)**. ຊັ້ນຄວາມບໍ່ເປີດເຜີຍຕົວຕົນ ZK ແລະ ການກູ້ຄືນ 4-of-7 ໄດ້ຖືກນຳໃຊ້ ແລະ ທົດສອບເທິງ
localnet. **ຢ່າໃຊ້ໃນການຜະລິດ** ໂດຍບໍ່ມີພິທີ trusted-setup ແບບຫຼາຍຝ່າຍທີ່ແທ້ຈິງ ແລະ ການກວດສອບ
ພາຍນອກ. ການກວດສອບລ່າສຸດ ແລະ ການແກ້ໄຂທີ່ນຳໃຊ້: [SECURITY_REVIEW.md](../SECURITY_REVIEW.md).

## 📄 ໃບອະນຸຍາດ

[GNU AGPL-3.0](../LICENSE) © ຜູ້ມີສ່ວນຮ່ວມ Ayni / AHA. ການນຳໃຊ້ຜ່ານເຄືອຂ່າຍຄືການແຈກຢາຍ: ຖ້າທ່ານແລ່ນ
Ayni ທີ່ດັດແປງເປັນບໍລິການ, ທ່ານຕ້ອງແບ່ງປັນ source ຂອງທ່ານພາຍໃຕ້ໃບອະນຸຍາດດຽວກັນ.

---

<div align="center">

ຖ້າໂມເດລ **ກຸ່ມພະນະມິດທີ່ບໍ່ເປີດເຜີຍຕົວຕົນ ແລະ ບໍ່ມີເຈົ້າຂອງ** ຂອງ Ayni ສະທ້ອນກັບທ່ານ, ⭐ **ໃຫ້ດາວ repo**
ເພື່ອຕິດຕາມ — ມັນຊ່ວຍໃຫ້ຄົນອື່ນຄົ້ນພົບມັນ.

</div>

<div align="center">
  <img src="../images/Model.png" alt="AHA / Ayni — the full model" width="920" />
</div>
