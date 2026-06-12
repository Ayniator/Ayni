<div align="center">

<img src="../images/AHA.png" alt="AHA — Ancestral Humanity Anonymous" width="220" />

# Ayni

**Persaudaraan keanggotaan yang anonim dan mengatur dirinya sendiri di Solana — soulbound, privat secara ZK, tanpa pemilik.**

Kerangka kerja terbuka untuk DAO keanggotaan persaudaraan dengan pemungutan suara anonim berbasis zero-knowledge dan kredensial silsilah yang dapat diungkapkan secara selektif.

🌍 [Other languages](README.md) · [English](../README.md)

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](../LICENSE)
[![Anchor](https://img.shields.io/badge/Anchor-0.31.1-512BD4)](https://www.anchor-lang.com/)
[![Solana](https://img.shields.io/badge/Solana-2.x-14F195)](https://solana.com/)
[![Circom](https://img.shields.io/badge/Circom-2.1-orange)](https://docs.circom.io/)
[![Status](https://img.shields.io/badge/status-research%2Fpre--audit-yellow)](../BACKLOG.md)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#-berkontribusi)

</div>

---

## Apa itu Ayni?

Ayni adalah implementasi Solana dari sebuah **Organisasi Otonom Terdesentralisasi (DAO) yang anonim** —
awalnya dirancang untuk memenuhi kebutuhan **AHA (Ancestral Humanity Anonymous)**, tetapi terbuka untuk
organisasi mana pun. Pada intinya, ia adalah templat yang tidak terikat pada rantai (chain-agnostic) untuk
persaudaraan di seluruh dunia, yang dimodelkan berdasarkan keberhasilan **tradisi AA / 12-langkah** yang
telah terbukti selama satu abad. Ia memberi kelompok mana pun cara siap pakai untuk **menerima anggota,
memegang perbendaharaan, memutuskan melalui hati nurani kelompok, dan memulihkan diri dari kunci yang hilang** —
sementara setiap anggota tetap **anonim secara bawaan** melalui bukti zero-knowledge.

- **Apa yang dilakukannya** — menjalankan persaudaraan keanggotaan secara on-chain: keanggotaan tahunan
  soulbound, satu-anggota-satu-suara anonim, perbendaharaan khusus donasi, dan Council beranggotakan 7 kursi
  dengan pemulihan kunci 4-dari-7 — tanpa pemilik, tanpa kunci admin.
- **Untuk siapa** — persaudaraan, kelompok saling bantu, komunitas anonim, DAO yang menginginkan
  *rasa memiliki* alih-alih spekulasi, dan siapa pun yang membutuhkan **privasi sejati** bagi para anggotanya.
- **Cara menggunakannya** — fork templatnya, dudukkan sebuah Council, buka sebuah Circle, dan anggota
  bergabung sebagai komitmen privat. Lihat [Mulai cepat](#-mulai-cepat).

> *Ayni* (Quechua): timbal balik suci antara memberi dan menerima — saling mendukung, satu anggota satu
> suara, tanpa pemilik pusat.

---

## ✨ Fitur

- 🪪 **Keanggotaan soulbound** — tahunan, tidak dapat dipindahtangankan. Rasa memiliki diraih dan diperbarui,
  tidak pernah dibeli atau dijual.
- 🕶️ **Anonim secara bawaan** — seorang anggota adalah komitmen privat dalam himpunan Merkle, bukan dompet
  yang terlihat. Pemungutan suara dan kredensial bersifat zero-knowledge; identitas hanya diungkapkan atas
  pilihan sendiri.
- 🗳️ **Pemungutan suara hati nurani kelompok** — satu anggota, satu suara, diberikan secara anonim (bukan
  plutokrasi berbobot token), dengan nullifier per-proposal yang mencegah suara ganda.
- 🏛️ **Tanpa pemilik, tanpa kunci admin** — Council beranggotakan 7 kursi *adalah* otoritasnya dan bertindak
  hanya melalui **4-dari-7**.
- 🔑 **Pemulihan kunci yang bertahan dari kehilangan** — rotasikan sebuah kursi atau migrasikan setiap artefak
  dari dompet yang hilang ke dompet baru, di balik jendela sanggahan yang dapat dipicu oleh satu kursi jujur
  mana pun.
- 🌱 **Circle yang dapat di-fork** — kelompok mana pun memutar Circle baru dengan tata kelola yang identik;
  World Service Circle mengoordinasikan materi bersama, ia tidak memerintah.
- 📜 **Kredensial pengungkapan selektif** — sertifikat kursus/inisiasi ("siapa, kursus apa, diajarkan oleh
  siapa, kapan") dibuka *bidang demi bidang* secara zero-knowledge.

---

## 💡 Bagaimana semuanya saling terhubung

Bacalah seperti sebuah pohon — orang-orang adalah kanopi di puncak, Circle adalah cabang-cabangnya, dan
World Service Circle adalah batang dan akar di dasarnya:

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

- **Anggota (kanopi)** — masing-masing bergabung dengan himpunan anggota suatu Circle sebagai komitmen anonim
  dan bertindak melalui bukti; tidak pernah perlu mengekspos dompet. Satu anggota, satu suara.
- **Circle (cabang)** — kelompok lokal yang otonom, masing-masing dengan Council 7 kursinya sendiri,
  perbendaharaan, dan pemungutan suara; di-fork dari templat.
- **World Service Circle (batang/akar)** — memegang templat dan dokumen bersama serta mengoordinasikan
  pembuatan Circle, tetapi **tidak** menggantikan hati nurani kelompok lokal. Tautannya adalah *tautan
  federasi*, bukan rantai komando.

## 🎩 Siapa melakukan apa — Council 7 kursi

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

- **Tanpa kunci admin.** Setiap tindakan istimewa adalah tugas kursi Council atau proposal 4-dari-7.
- **Pelayan melayani, anggota memutuskan.** Tugas rutin didelegasikan ke sebuah kursi dan dapat dicabut melalui
  rotasi Council; arah ditetapkan melalui suara anggota.

---

## 📖 Penggunaan & contoh

Empat jenis keputusan yang didukung Ayni, dan di mana masing-masing berada:

| Keputusan | Siapa yang memilih | Mekanisme |
|---|---|---|
| **Urusan lokal** (urusan internal sebuah Circle) | anggota Circle tersebut | suara anggota ZK anonim |
| **Piagam foundation** (mis. "12 Langkah") | hanya kunci tingkat foundation | suara anggota/Council World Service |
| **Teks bersama** (mis. Preamble yang disarankan) | **semua** Circle + foundation | suara teragregasi seluruh federasi |
| **Pemulihan / perbendaharaan** | Council 7 kursi | proposal 4-dari-7 + jendela sanggahan |

Panduan langkah demi langkah yang dapat disalin-tempel untuk semua ini ada di **[IMPLEMENTATION.md](../IMPLEMENTATION.md)**.

<div align="center">
  <img src="../images/BluePrint.png" alt="Ayni — blueprint" width="880" />
</div>

---

## 🚀 Mulai cepat

> Prasyarat: **Rust**, **Solana/Agave CLI 2.x**, **Anchor 0.31.1**, **Node 20+**, dan (untuk bukti)
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

Itulah seluruh proses pertama kali. Pengujian membangun sebuah Circle, menerbitkan keanggotaan anonim,
menjalankan pemulihan 4-dari-7, dan memverifikasi bukti suara Groth16 asli secara on-chain (serta menolak
nullifier yang diputar ulang).

Untuk mendirikan persaudaraan Anda sendiri dan menjalankan keempat jenis suara, ikuti
**[IMPLEMENTATION.md](../IMPLEMENTATION.md)** langkah demi langkah.

---

## 🗺️ Peta jalan

- [x] Siklus hidup keanggotaan soulbound + Council 7 kursi (4-dari-7)
- [x] Pemungutan suara anggota ZK anonim (Groth16 asli round-trip, on-chain)
- [x] Pemberian silsilah ZK + pengakuan pengungkapan selektif
- [x] Pemulihan kunci: rotasi kursi + migrasi dompet dengan jendela sanggahan
- [x] Tinjauan keamanan + perbaikan kritis/tinggi (lihat [SECURITY_REVIEW.md](../SECURITY_REVIEW.md))
- [ ] Agregasi pemungutan suara seluruh federasi (lintas-Circle)
- [ ] Upacara trusted-setup multi-pihak produksi (menggantikan kunci dev)
- [ ] Pemungutan suara tahan-paksaan (gaya MACI)
- [ ] Mint soulbound Token-2022 yang terhubung end-to-end
- [ ] Audit eksternal

Backlog lengkap: [BACKLOG.md](../BACKLOG.md).

---

## 🧭 Peta repo

| Path | Isi |
|---|---|
| `PROJECT.md` | Model AHA yang tidak terikat rantai (*apa* dan *mengapa*). |
| `IMPLEMENTATION.md` | Runbook langkah demi langkah: foundation → Circle pertama → empat suara. |
| `programs/ayni/` | Program Anchor — keanggotaan, Council, pemungutan suara ZK & silsilah. |
| `circuits/` | Sirkuit Circom: pemungutan suara anggota, pemberian silsilah, pengakuan. |
| `docs/` | Pembahasan mendalam: ketahanan, perbendaharaan, pemungutan suara, sybil, silsilah ZK, pengakuan. |
| `app/` | Penolong proving TypeScript (pohon Merkle, pembuatan bukti). |
| `SECURITY_REVIEW.md` | Tinjauan konsep + keamanan terbaru dan perbaikan yang diterapkan. |

---

## 🤝 Berkontribusi

Kontribusi sangat diterima — issue, PR, dan tinjauan terhadap kriptografi khususnya.

1. Fork dan buat branch dari `solana` (branch bawaan; rantai lain ada di `ethereum`, `avalanche`).
2. `anchor build && anchor test` harus lulus.
3. Buka PR yang menjelaskan perubahan dan dampak keamanannya.

Tempat yang baik untuk memulai diberi label **`good first issue`**. Bersikaplah luar biasa terhadap satu sama
lain — lihat [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md).

**Topik GitHub yang disarankan:** `solana` · `anchor` · `zero-knowledge` · `zk-snarks` · `circom` ·
`dao` · `governance` · `soulbound` · `privacy` · `anonymous-voting` · `groth16`

---

## ⚠️ Status & keamanan

Riset / **pra-audit**. Lapisan anonimitas ZK dan pemulihan 4-dari-7 telah diimplementasikan dan diuji di
localnet. **Jangan gunakan di produksi** tanpa upacara trusted-setup multi-pihak asli dan audit eksternal.
Tinjauan terbaru dan perbaikan yang diterapkan: [SECURITY_REVIEW.md](../SECURITY_REVIEW.md).

## 📄 Lisensi

[GNU AGPL-3.0](../LICENSE) © para kontributor Ayni / AHA. Penggunaan jaringan adalah distribusi: jika Anda
menjalankan Ayni yang dimodifikasi sebagai layanan, Anda harus membagikan source Anda di bawah lisensi yang sama.

---

<div align="center">

Jika model **persaudaraan anonim tanpa pemilik** dari Ayni beresonansi dengan Anda, ⭐ **beri bintang pada repo**
untuk mengikuti perkembangannya — ini membantu orang lain menemukannya.

</div>

<div align="center">
  <img src="../images/Model.png" alt="AHA / Ayni — the full model" width="920" />
</div>
