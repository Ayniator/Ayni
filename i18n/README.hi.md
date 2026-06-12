<div align="center">

<img src="../images/AHA.png" alt="AHA — Ancestral Humanity Anonymous" width="220" />

# Ayni

**Solana पर स्वशासित, गुमनाम सदस्यता-आधारित संगति — soulbound, ZK-निजी, स्वामी-रहित।**

शून्य-ज्ञान (zero-knowledge) गुमनाम मतदान और चयनात्मक रूप से प्रकट की जा सकने वाली वंश-पहचान
प्रमाणपत्रों के साथ संगति-सदस्यता DAO के लिए खुला ढाँचा।

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](../LICENSE)
[![Anchor](https://img.shields.io/badge/Anchor-0.31.1-512BD4)](https://www.anchor-lang.com/)
[![Solana](https://img.shields.io/badge/Solana-2.x-14F195)](https://solana.com/)
[![Circom](https://img.shields.io/badge/Circom-2.1-orange)](https://docs.circom.io/)
[![Status](https://img.shields.io/badge/status-research%2Fpre--audit-yellow)](../BACKLOG.md)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#-योगदान)

🌍 [Other languages](README.md) · [English](../README.md)

</div>

---

## Ayni क्या है?

Ayni एक **गुमनाम विकेन्द्रीकृत स्वायत्त संगठन (DAO)** का Solana कार्यान्वयन है — जिसे मूल रूप से
**AHA (Ancestral Humanity Anonymous)** की आवश्यकताओं को पूरा करने के लिए डिज़ाइन किया गया था, परंतु यह
किसी भी संगठन के लिए खुला है। मूल रूप में यह विश्वव्यापी संगतियों के लिए एक श्रृंखला-निरपेक्ष
(chain-agnostic) टेम्पलेट है, जो **AA / 12-चरण परंपराओं** की सदी-भर प्रमाणित सफलता पर आधारित है। यह
किसी भी समूह को **सदस्यों को शामिल करने, एक कोष रखने, सामूहिक अंतःकरण द्वारा निर्णय लेने, और खोई हुई
कुंजियों से उबरने** का एक तैयार तरीका देता है — जबकि हर सदस्य शून्य-ज्ञान प्रमाणों के माध्यम से
**डिफ़ॉल्ट रूप से गुमनाम** रहता है।

- **यह क्या करता है** — ऑन-चेन एक सदस्यता संगति चलाता है: soulbound वार्षिक सदस्यताएँ, गुमनाम
  एक-सदस्य-एक-वोट, केवल-दान वाला कोष, और 4-में-से-7 कुंजी-पुनर्प्राप्ति वाली 7-सीटों की Council —
  कोई स्वामी नहीं, कोई admin कुंजी नहीं।
- **यह किसके लिए है** — संगतियाँ, पारस्परिक-सहायता समूह, गुमनाम समुदाय, वे DAO जो सट्टेबाज़ी के बजाय
  *अपनेपन* को चाहते हैं, और हर वह व्यक्ति जिसे अपने सदस्यों के लिए **वास्तविक निजता** चाहिए।
- **इसका उपयोग कैसे करें** — टेम्पलेट को fork करें, एक Council बैठाएँ, एक Circle खोलें, और सदस्य
  निजी प्रतिबद्धताओं के रूप में शामिल हों। देखें [त्वरित शुरुआत](#-त्वरित-शुरुआत)।

> *Ayni* (क्वेचुआ): देने और पाने की पवित्र पारस्परिकता — आत्म-समर्थन, एक सदस्य एक स्वर, कोई केंद्रीय
> स्वामी नहीं।

---

## ✨ विशेषताएँ

- 🪪 **Soulbound सदस्यता** — वार्षिक, अहस्तांतरणीय। अपनापन अर्जित और नवीनीकृत किया जाता है, कभी खरीदा
  या बेचा नहीं जाता।
- 🕶️ **डिफ़ॉल्ट रूप से गुमनाम** — एक सदस्य एक Merkle समुच्चय में एक निजी प्रतिबद्धता है, कोई दृश्य
  wallet नहीं। मतदान और प्रमाणपत्र शून्य-ज्ञान वाले हैं; पहचान केवल चुनाव से ही प्रकट होती है।
- 🗳️ **सामूहिक-अंतःकरण मतदान** — एक सदस्य, एक वोट, गुमनाम रूप से डाला गया (कोई token-भारित
  धनिकतंत्र नहीं), जिसमें प्रत्येक प्रस्ताव के लिए एक nullifier दोहरे-मतदान को रोकता है।
- 🏛️ **कोई स्वामी नहीं, कोई admin कुंजी नहीं** — 7-सीटों वाली Council *ही* प्राधिकरण है और केवल
  **4-में-से-7** द्वारा कार्य करती है।
- 🔑 **खोने पर भी टिकने वाली कुंजी-पुनर्प्राप्ति** — एक सीट घुमाएँ या किसी खोए wallet की हर कलाकृति
  को एक नए में स्थानांतरित करें, एक विरोध-अवधि के पीछे जिसे कोई एक भी ईमानदार सीट सक्रिय कर सकती है।
- 🌱 **Fork-योग्य Circles** — कोई भी समूह समान शासन वाला एक नया Circle खड़ा कर सकता है; World Service
  Circle साझा सामग्री का समन्वय करता है, वह शासन नहीं करता।
- 📜 **चयनात्मक-प्रकटीकरण प्रमाणपत्र** — पाठ्यक्रम/दीक्षा प्रमाणपत्र ("कौन, कौन-सा पाठ्यक्रम, किसके
  द्वारा सिखाया गया, कब") जिन्हें शून्य-ज्ञान में *क्षेत्र-दर-क्षेत्र* खोला जाता है।

---

## 💡 यह सब कैसे जुड़ता है

इसे एक पेड़ की तरह पढ़ें — लोग ऊपर की छतरी हैं, Circles शाखाएँ हैं, और World Service Circle आधार पर
तना और जड़ें हैं:

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

- **सदस्य (छतरी)** — प्रत्येक एक Circle के सदस्य-समुच्चय में एक गुमनाम प्रतिबद्धता के रूप में शामिल
  होता है और प्रमाणों के माध्यम से कार्य करता है; कभी किसी wallet को उजागर करने की आवश्यकता नहीं।
  एक सदस्य, एक वोट।
- **Circles (शाखाएँ)** — स्वायत्त स्थानीय समूह, प्रत्येक की अपनी 7-सीटों वाली Council, कोष, और वोट;
  टेम्पलेट से fork किए गए।
- **World Service Circle (तना/जड़)** — साझा टेम्पलेट और दस्तावेज़ रखता है और Circle निर्माण का समन्वय
  करता है, परंतु स्थानीय समूह-अंतःकरण को **रद्द नहीं** करता। यह कड़ी एक *महासंघ कड़ी* है, आदेश की
  श्रृंखला नहीं।

## 🎩 कौन क्या करता है — 7-सीटों वाली Council

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

- **कोई admin कुंजी नहीं।** हर विशेषाधिकार-प्राप्त कार्य या तो एक Council सीट का कर्तव्य है या एक
  4-में-से-7 प्रस्ताव।
- **सेवक सेवा करते हैं, सदस्य निर्णय लेते हैं।** नियमित कर्तव्य एक सीट को सौंपे जाते हैं और Council
  रोटेशन द्वारा वापस लिए जा सकते हैं; दिशा सदस्य-वोट द्वारा तय होती है।

---

## 📖 उपयोग और उदाहरण

Ayni जिन चार प्रकार के निर्णयों का समर्थन करता है, और प्रत्येक कहाँ रहता है:

| निर्णय | कौन वोट करता है | तंत्र |
|---|---|---|
| **स्थानीय मामला** (किसी Circle का अपना काम) | उस Circle के सदस्य | गुमनाम ZK सदस्य वोट |
| **फ़ाउंडेशन चार्टर** (जैसे "12 Steps") | केवल फ़ाउंडेशन-स्तर की कुंजियाँ | World Service सदस्य/Council वोट |
| **साझा पाठ** (जैसे सुझाई गई Preamble) | **सभी** Circles + फ़ाउंडेशन | महासंघ-व्यापी समेकित वोट |
| **पुनर्प्राप्ति / कोष** | 7-सीटों वाली Council | 4-में-से-7 प्रस्ताव + विरोध-अवधि |

इन सब के लिए विस्तृत, कॉपी-पेस्ट योग्य चरण-दर-चरण मार्गदर्शिकाएँ **[IMPLEMENTATION.md](../IMPLEMENTATION.md)**
में हैं।

<div align="center">
  <img src="../images/BluePrint.png" alt="Ayni — blueprint" width="880" />
</div>

---

## 🚀 त्वरित शुरुआत

> पूर्वापेक्षाएँ: **Rust**, **Solana/Agave CLI 2.x**, **Anchor 0.31.1**, **Node 20+**, और (प्रमाणों
> के लिए) **circom 2.1** + **snarkjs**।

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

बस यही पूरा पहला-रन है। परीक्षण एक Circle खड़ा करते हैं, गुमनाम सदस्यताएँ जारी करते हैं, एक
4-में-से-7 पुनर्प्राप्ति चलाते हैं, और ऑन-चेन एक वास्तविक Groth16 वोट प्रमाण सत्यापित करते हैं (और एक
दोहराए गए nullifier को अस्वीकार करते हैं)।

अपनी स्वयं की संगति खड़ी करने और चारों प्रकार के वोट चलाने के लिए, चरण-दर-चरण
**[IMPLEMENTATION.md](../IMPLEMENTATION.md)** का अनुसरण करें।

---

## 🗺️ रोडमैप

- [x] Soulbound सदस्यता जीवनचक्र + 7-सीटों वाली Council (4-में-से-7)
- [x] गुमनाम ZK सदस्य मतदान (वास्तविक Groth16 राउंड-ट्रिप, ऑन-चेन)
- [x] ZK वंश अनुदान + चयनात्मक-प्रकटीकरण स्वीकृतियाँ
- [x] कुंजी-पुनर्प्राप्ति: सीट रोटेशन + विरोध-अवधि के साथ wallet स्थानांतरण
- [x] सुरक्षा समीक्षा + critical/high सुधार (देखें [SECURITY_REVIEW.md](../SECURITY_REVIEW.md))
- [ ] महासंघ-व्यापी (cross-Circle) मतदान समेकन
- [ ] उत्पादन बहु-पक्षीय trusted-setup समारोह (dev कुंजियों को बदलें)
- [ ] दबाव-प्रतिरोधी मतदान (MACI-शैली)
- [ ] Token-2022 soulbound mint को एंड-टू-एंड जोड़ना
- [ ] बाहरी ऑडिट

पूरा बैकलॉग: [BACKLOG.md](../BACKLOG.md)।

---

## 🧭 रिपॉज़िटरी मानचित्र

| पथ | सामग्री |
|---|---|
| `PROJECT.md` | श्रृंखला-निरपेक्ष AHA मॉडल (*क्या* और *क्यों*)। |
| `IMPLEMENTATION.md` | चरण-दर-चरण रनबुक: फ़ाउंडेशन → पहला Circle → चार वोट। |
| `programs/ayni/` | Anchor प्रोग्राम — सदस्यताएँ, Council, ZK मतदान और वंश। |
| `circuits/` | Circom सर्किट: सदस्य मतदान, वंश अनुदान, स्वीकृतियाँ। |
| `docs/` | गहन विवरण: लचीलापन, कोष, मतदान, sybil, ZK वंश, स्वीकृतियाँ। |
| `app/` | TypeScript proving helpers (Merkle trees, proof generation)। |
| `SECURITY_REVIEW.md` | नवीनतम अवधारणा + सुरक्षा समीक्षा और लागू किए गए सुधार। |

---

## 🤝 योगदान

योगदान का स्वागत है — विशेष रूप से issues, PRs, और क्रिप्टोग्राफ़ी की समीक्षा।

1. `solana` से fork और branch करें (डिफ़ॉल्ट branch; अन्य श्रृंखलाएँ `ethereum`, `avalanche` पर रहती हैं)।
2. `anchor build && anchor test` पास होना चाहिए।
3. परिवर्तन और उसके सुरक्षा-प्रभाव का वर्णन करते हुए एक PR खोलें।

शुरू करने के लिए अच्छी जगहें **`good first issue`** से चिह्नित हैं। एक-दूसरे के साथ उत्कृष्ट बनें —
देखें [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md)।

**सुझाए गए GitHub विषय:** `solana` · `anchor` · `zero-knowledge` · `zk-snarks` · `circom` ·
`dao` · `governance` · `soulbound` · `privacy` · `anonymous-voting` · `groth16`

---

## ⚠️ स्थिति और सुरक्षा

शोध / **पूर्व-ऑडिट**। ZK गुमनामी परत और 4-में-से-7 पुनर्प्राप्ति कार्यान्वित हैं और localnet पर परीक्षित
हैं। एक वास्तविक बहु-पक्षीय trusted-setup समारोह और एक बाहरी ऑडिट के बिना **उत्पादन में उपयोग न करें**।
नवीनतम समीक्षा और लागू किए गए सुधार: [SECURITY_REVIEW.md](../SECURITY_REVIEW.md)।

## 📄 लाइसेंस

[GNU AGPL-3.0](../LICENSE) © Ayni / AHA योगदानकर्ता। नेटवर्क उपयोग वितरण है: यदि आप एक संशोधित Ayni को
एक सेवा के रूप में चलाते हैं, तो आपको अपना स्रोत समान लाइसेंस के अंतर्गत साझा करना होगा।

---

<div align="center">

यदि Ayni का **गुमनाम, स्वामी-रहित संगति** का मॉडल आपके साथ प्रतिध्वनित होता है, तो साथ चलने के लिए
⭐ **रिपॉज़िटरी को star करें** — यह दूसरों को इसे खोजने में मदद करता है।

</div>

<div align="center">
  <img src="../images/Model.png" alt="AHA / Ayni — the full model" width="920" />
</div>
