<div align="center">

<img src="../images/AHA.png" alt="AHA — Ancestral Humanity Anonymous" width="220" />

# Ayni

**สมาคมสมาชิกแบบนิรนามที่ปกครองตนเองบน Solana — soulbound, เป็นส่วนตัวด้วย ZK, ไร้เจ้าของ**

เฟรมเวิร์กแบบเปิดสำหรับ DAO สมาชิกภาพของสมาคม พร้อมการลงคะแนนนิรนามแบบ zero-knowledge
และเครดิทรับรองสายลำดับ (lineage) ที่เปิดเผยได้ตามต้องการ

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](../LICENSE)
[![Anchor](https://img.shields.io/badge/Anchor-0.31.1-512BD4)](https://www.anchor-lang.com/)
[![Solana](https://img.shields.io/badge/Solana-2.x-14F195)](https://solana.com/)
[![Circom](https://img.shields.io/badge/Circom-2.1-orange)](https://docs.circom.io/)
[![Status](https://img.shields.io/badge/status-research%2Fpre--audit-yellow)](../BACKLOG.md)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#-การมีส่วนร่วม)

🌍 [Other languages](README.md) · [English](../README.md)

</div>

---

## Ayni คืออะไร?

Ayni คือการนำไปใช้งานบน Solana ของ **องค์กรปกครองตนเองแบบกระจายศูนย์ (DAO) ที่นิรนาม** —
เดิมออกแบบมาเพื่อตอบโจทย์ความต้องการของ **AHA (Ancestral Humanity Anonymous)** แต่เปิดให้
องค์กรใดก็ได้ใช้งาน โดยแก่นแท้แล้วมันคือเทมเพลตที่เป็นกลางต่อบล็อกเชน (chain-agnostic) สำหรับ
สมาคมระดับโลก ซึ่งจำลองตามความสำเร็จที่พิสูจน์มาแล้วกว่าศตวรรษของ **ธรรมเนียม AA / 12 ขั้นตอน
(12-step)** มันมอบวิธีสำเร็จรูปให้กลุ่มใดก็ตามในการ **รับสมาชิก ถือคลังทรัพย์ ตัดสินใจด้วย
มโนธรรมหมู่ และกู้คืนจากกุญแจที่สูญหาย** — ขณะที่สมาชิกทุกคนยังคง **นิรนามโดยปริยาย** ผ่าน
zero-knowledge proof

- **มันทำอะไร** — ดำเนินสมาคมสมาชิกบนเชน: สมาชิกภาพรายปีแบบ soulbound, การลงคะแนนแบบ
  นิรนามหนึ่งสมาชิกหนึ่งเสียง, คลังทรัพย์ที่รับเฉพาะการบริจาค และ Council 7 ที่นั่งพร้อมการกู้คืน
  กุญแจแบบ 4-of-7 — ไม่มีเจ้าของ ไม่มีกุญแจแอดมิน
- **เหมาะกับใคร** — สมาคม กลุ่มช่วยเหลือซึ่งกันและกัน ชุมชนนิรนาม DAO ที่ต้องการ *ความเป็นส่วนหนึ่ง*
  แทนการเก็งกำไร และทุกคนที่ต้องการ **ความเป็นส่วนตัวที่แท้จริง** สำหรับสมาชิก
- **ใช้งานอย่างไร** — fork เทมเพลต ตั้ง Council เปิด Circle และให้สมาชิกเข้าร่วมในรูปของ commitment
  ที่เป็นส่วนตัว ดูได้ที่ [เริ่มต้นใช้งานอย่างรวดเร็ว](#-เริ่มต้นใช้งานอย่างรวดเร็ว)

> *Ayni* (ภาษาเกชัว): การตอบแทนซึ่งกันและกันอันศักดิ์สิทธิ์ของการให้และการรับ — การช่วยเหลือตนเอง
> หนึ่งสมาชิกหนึ่งเสียง ไม่มีเจ้าของส่วนกลาง

---

## ✨ คุณสมบัติ

- 🪪 **สมาชิกภาพแบบ Soulbound** — รายปี โอนไม่ได้ ความเป็นส่วนหนึ่งได้มาจากการกระทำและการต่ออายุ
  ไม่ใช่การซื้อขาย
- 🕶️ **นิรนามโดยปริยาย** — สมาชิกคือ commitment ที่เป็นส่วนตัวในชุด Merkle ไม่ใช่กระเป๋าเงินที่มองเห็นได้
  การลงคะแนนและเครดิทรับรองเป็นแบบ zero-knowledge ตัวตนถูกเปิดเผยตามความสมัครใจเท่านั้น
- 🗳️ **การลงคะแนนด้วยมโนธรรมหมู่** — หนึ่งสมาชิกหนึ่งเสียง ลงคะแนนแบบนิรนาม (ไม่มีระบบ
  plutocracy ที่ถ่วงน้ำหนักด้วยโทเคน) พร้อม nullifier ต่อข้อเสนอเพื่อป้องกันการลงคะแนนซ้ำ
- 🏛️ **ไม่มีเจ้าของ ไม่มีกุญแจแอดมิน** — Council 7 ที่นั่ง *คือ* อำนาจ และกระทำการได้เฉพาะแบบ **4-of-7**
- 🔑 **การกู้คืนกุญแจที่รอดพ้นการสูญหาย** — หมุนเปลี่ยนที่นั่ง หรือย้ายทุกอย่างของกระเป๋าเงินที่สูญหาย
  ไปยังกระเป๋าใหม่ ภายใต้หน้าต่างคัดค้านที่ที่นั่งซื่อสัตย์เพียงที่นั่งเดียวก็สะดุดได้
- 🌱 **Circle ที่ fork ได้** — กลุ่มใดก็ตามตั้ง Circle ใหม่ที่มีการปกครองเหมือนกันได้ World Service Circle
  ประสานงานวัสดุที่ใช้ร่วมกัน แต่ไม่ได้ปกครอง
- 📜 **เครดิทรับรองแบบเปิดเผยตามต้องการ** — ใบรับรองหลักสูตร/การเริ่มเข้า ("ใคร หลักสูตรอะไร
  สอนโดยใคร เมื่อใด") เปิดเผย *ทีละช่อง* แบบ zero-knowledge

---

## 💡 ทุกอย่างประกอบกันอย่างไร

อ่านมันเหมือนต้นไม้ — ผู้คนคือเรือนยอดที่อยู่ด้านบน Circle คือกิ่งก้าน และ World Service Circle
คือลำต้นและรากที่ฐาน:

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

- **สมาชิก (เรือนยอด)** — แต่ละคนเข้าร่วมชุดสมาชิกของ Circle ในรูป commitment แบบนิรนาม และ
  กระทำการผ่าน proof ไม่จำเป็นต้องเปิดเผยกระเป๋าเงิน หนึ่งสมาชิกหนึ่งเสียง
- **Circle (กิ่งก้าน)** — กลุ่มท้องถิ่นที่ปกครองตนเอง แต่ละกลุ่มมี Council 7 ที่นั่ง คลังทรัพย์ และการ
  ลงคะแนนของตนเอง โดย fork มาจากเทมเพลต
- **World Service Circle (ลำต้น/ราก)** — ถือเทมเพลตและเอกสารที่ใช้ร่วมกัน และประสานงานการสร้าง
  Circle แต่ **ไม่** ลบล้างมโนธรรมหมู่ของกลุ่มท้องถิ่น ความเชื่อมโยงนี้เป็น *การเชื่อมแบบสหพันธ์
  (federation link)* ไม่ใช่สายการบังคับบัญชา

## 🎩 ใครทำอะไร — Council 7 ที่นั่ง

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

- **ไม่มีกุญแจแอดมิน** ทุกการกระทำที่มีสิทธิพิเศษคือหน้าที่ของที่นั่งใน Council หรือข้อเสนอแบบ 4-of-7
- **ผู้รับใช้รับใช้ สมาชิกตัดสินใจ** หน้าที่ประจำถูกมอบหมายให้ที่นั่งและเพิกถอนได้ด้วยการหมุนเปลี่ยน
  Council ส่วนทิศทางถูกกำหนดด้วยการลงคะแนนของสมาชิก

---

## 📖 การใช้งานและตัวอย่าง

การตัดสินใจสี่ประเภทที่ Ayni รองรับ และแต่ละประเภทอยู่ที่ไหน:

| การตัดสินใจ | ใครลงคะแนน | กลไก |
|---|---|---|
| **เรื่องท้องถิ่น** (กิจการของ Circle เอง) | สมาชิกของ Circle นั้น | การลงคะแนนสมาชิกแบบ ZK นิรนาม |
| **กฎบัตรของ foundation** (เช่น "12 ขั้นตอน") | กุญแจระดับ foundation เท่านั้น | การลงคะแนนของสมาชิก/Council ใน World Service |
| **ข้อความที่ใช้ร่วมกัน** (เช่น Preamble ที่แนะนำ) | **ทุก** Circle + foundation | การลงคะแนนรวมทั่วทั้งสหพันธ์ |
| **การกู้คืน / คลังทรัพย์** | Council 7 ที่นั่ง | ข้อเสนอ 4-of-7 + หน้าต่างคัดค้าน |

แนวทางปฏิบัติที่ลงมือทำได้และคัดลอกวางได้สำหรับทั้งหมดนี้อยู่ใน **[IMPLEMENTATION.md](../IMPLEMENTATION.md)**

<div align="center">
  <img src="../images/BluePrint.png" alt="Ayni — blueprint" width="880" />
</div>

---

## 🚀 เริ่มต้นใช้งานอย่างรวดเร็ว

> สิ่งที่ต้องมีก่อน: **Rust**, **Solana/Agave CLI 2.x**, **Anchor 0.31.1**, **Node 20+** และ (สำหรับ proof)
> **circom 2.1** + **snarkjs**

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

เท่านี้คือการรันครั้งแรกทั้งหมด เทสต์จะตั้ง Circle ขึ้นมา ออกสมาชิกภาพแบบนิรนาม รันการกู้คืน 4-of-7
และตรวจสอบ proof การลงคะแนน Groth16 จริงบนเชน (และปฏิเสธ nullifier ที่ถูกเล่นซ้ำ)

หากต้องการตั้งสมาคมของคุณเองและรันการลงคะแนนทั้งสี่ประเภท ให้ทำตาม
**[IMPLEMENTATION.md](../IMPLEMENTATION.md)** ทีละขั้นตอน

---

## 🗺️ แผนงาน

- [x] วงจรชีวิตสมาชิกภาพแบบ soulbound + Council 7 ที่นั่ง (4-of-7)
- [x] การลงคะแนนสมาชิกแบบ ZK นิรนาม (Groth16 round-trip จริง บนเชน)
- [x] การมอบสายลำดับ (lineage) แบบ ZK + การรับทราบแบบเปิดเผยตามต้องการ
- [x] การกู้คืนกุญแจ: การหมุนเปลี่ยนที่นั่ง + การย้ายกระเป๋าเงินพร้อมหน้าต่างคัดค้าน
- [x] การตรวจสอบความปลอดภัย + การแก้ไขระดับ critical/high (ดู [SECURITY_REVIEW.md](../SECURITY_REVIEW.md))
- [ ] การรวมการลงคะแนนทั่วทั้งสหพันธ์ (ข้าม Circle)
- [ ] พิธี trusted-setup แบบหลายฝ่ายสำหรับใช้งานจริง (แทนกุญแจ dev)
- [ ] การลงคะแนนที่ต้านการบีบบังคับ (แบบ MACI)
- [ ] การ mint แบบ soulbound ด้วย Token-2022 ที่ต่อเชื่อมครบวงจร
- [ ] การตรวจสอบจากภายนอก

แบ็คล็อกฉบับเต็ม: [BACKLOG.md](../BACKLOG.md)

---

## 🧭 แผนที่ repo

| Path | เนื้อหา |
|---|---|
| `PROJECT.md` | โมเดล AHA ที่เป็นกลางต่อบล็อกเชน (*อะไร* และ *ทำไม*) |
| `IMPLEMENTATION.md` | runbook ทีละขั้นตอน: foundation → Circle แรก → การลงคะแนนสี่ประเภท |
| `programs/ayni/` | โปรแกรม Anchor — สมาชิกภาพ, Council, การลงคะแนน ZK และสายลำดับ |
| `circuits/` | วงจร Circom: การลงคะแนนสมาชิก, การมอบสายลำดับ, การรับทราบ |
| `docs/` | เจาะลึก: resilience, คลังทรัพย์, การลงคะแนน, sybil, สายลำดับ ZK, การรับทราบ |
| `app/` | ตัวช่วยสร้าง proof แบบ TypeScript (Merkle tree, การสร้าง proof) |
| `SECURITY_REVIEW.md` | การตรวจสอบแนวคิด + ความปลอดภัยล่าสุด และการแก้ไขที่นำมาใช้ |

---

## 🤝 การมีส่วนร่วม

ยินดีรับการมีส่วนร่วม — issue, PR และโดยเฉพาะการรีวิวด้านการเข้ารหัส (cryptography)

1. Fork และแตกแบรนช์จาก `solana` (แบรนช์เริ่มต้น; เชนอื่นอยู่ที่ `ethereum`, `avalanche`)
2. `anchor build && anchor test` ต้องผ่าน
3. เปิด PR ที่อธิบายการเปลี่ยนแปลงและผลกระทบด้านความปลอดภัยของมัน

จุดเริ่มต้นที่ดีถูกติดป้ายว่า **`good first issue`** จงดีต่อกัน — ดู
[CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md)

**หัวข้อ GitHub ที่แนะนำ:** `solana` · `anchor` · `zero-knowledge` · `zk-snarks` · `circom` ·
`dao` · `governance` · `soulbound` · `privacy` · `anonymous-voting` · `groth16`

---

## ⚠️ สถานะและความปลอดภัย

งานวิจัย / **ก่อนการตรวจสอบ (pre-audit)** ชั้น anonymity ของ ZK และการกู้คืน 4-of-7 ถูกนำมาใช้และ
ทดสอบบน localnet แล้ว **อย่าใช้ในการใช้งานจริง** หากไม่มีพิธี trusted-setup แบบหลายฝ่ายจริงและ
การตรวจสอบจากภายนอก การรีวิวล่าสุดและการแก้ไขที่นำมาใช้: [SECURITY_REVIEW.md](../SECURITY_REVIEW.md)

## 📄 ใบอนุญาต

[GNU AGPL-3.0](../LICENSE) © ผู้มีส่วนร่วมของ Ayni / AHA การใช้งานผ่านเครือข่ายถือเป็นการแจกจ่าย:
หากคุณรัน Ayni ที่ดัดแปลงแล้วเป็นบริการ คุณต้องเปิดเผยซอร์สโค้ดของคุณภายใต้ใบอนุญาตเดียวกัน

---

<div align="center">

หากโมเดลของ Ayni เรื่อง **สมาคมที่นิรนามและไร้เจ้าของ** สอดคล้องกับคุณ ⭐ **กดดาวให้ repo**
เพื่อติดตามต่อ — มันช่วยให้คนอื่นพบมัน

</div>

<div align="center">
  <img src="../images/Model.png" alt="AHA / Ayni — the full model" width="920" />
</div>
