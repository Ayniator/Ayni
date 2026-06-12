<div align="center">

<img src="../images/AHA.png" alt="AHA — Ancestral Humanity Anonymous" width="220" />

# Ayni

**Solana 위에서 자율적으로 운영되는, 익명의 멤버십 펠로우십 — 양도 불가(soulbound), 영지식 기반 프라이버시, 소유자 없는 구조.**

영지식 익명 투표와 선택적으로 공개 가능한 계보 자격 증명을 갖춘 펠로우십 멤버십 DAO를 위한 오픈 프레임워크.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](../LICENSE)
[![Anchor](https://img.shields.io/badge/Anchor-0.31.1-512BD4)](https://www.anchor-lang.com/)
[![Solana](https://img.shields.io/badge/Solana-2.x-14F195)](https://solana.com/)
[![Circom](https://img.shields.io/badge/Circom-2.1-orange)](https://docs.circom.io/)
[![Status](https://img.shields.io/badge/status-research%2Fpre--audit-yellow)](../BACKLOG.md)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#-기여하기)

🌍 [Other languages](README.md) · [English](../README.md)

</div>

---

## Ayni란 무엇인가?

Ayni는 **익명 탈중앙화 자율 조직(DAO)**의 Solana 구현체입니다 — 본래 **AHA(Ancestral Humanity Anonymous)**의 필요를 충족하기 위해 설계되었지만, 어떤 조직에도 열려 있습니다. 본질적으로는 한 세기 동안 검증된 **AA / 12단계 전통**의 성공을 본떠 만든, 전 세계 펠로우십을 위한 체인 비종속(chain-agnostic) 템플릿입니다. 어떤 그룹이든 **멤버를 받아들이고, 공동 자금을 보유하며, 그룹 양심에 따라 결정하고, 잃어버린 키를 복구하는** 즉시 사용 가능한 방법을 제공합니다 — 모든 멤버는 영지식 증명을 통해 **기본적으로 익명**으로 유지됩니다.

- **무엇을 하는가** — 멤버십 펠로우십을 온체인으로 운영합니다: 양도 불가(soulbound)한 연간 멤버십, 익명의 1인 1표, 기부 전용 공동 자금, 그리고 7석으로 구성되어 7명 중 4명(4-of-7)의 키 복구를 수행하는 협의회(Council) — 소유자도, 관리자 키도 없습니다.
- **누구를 위한 것인가** — 펠로우십, 상호부조 그룹, 익명 커뮤니티, 투기 대신 *소속감*을 원하는 DAO, 그리고 멤버를 위한 **진짜 프라이버시**가 필요한 모든 이를 위한 것입니다.
- **어떻게 사용하는가** — 템플릿을 포크하고, 협의회를 구성하고, 서클(Circle)을 열면, 멤버들은 비공개 커밋먼트(commitment)로 참여합니다. [빠른 시작](#-빠른-시작)을 참고하세요.

> *Ayni* (케추아어): 주고받음의 신성한 호혜 — 자립, 1인 1표, 중앙 소유자 없음.

---

## ✨ 주요 기능

- 🪪 **양도 불가(soulbound) 멤버십** — 연간 단위이며 이전이 불가능합니다. 소속은 얻고 갱신하는 것이지, 사고팔 수 없습니다.
- 🕶️ **기본 익명** — 멤버는 가시적인 지갑이 아니라 머클(Merkle) 집합 안의 비공개 커밋먼트입니다. 투표와 자격 증명은 영지식이며, 신원은 본인의 선택에 의해서만 공개됩니다.
- 🗳️ **그룹 양심 투표** — 1인 1표를 익명으로 행사하며(토큰 가중치 기반 금권정치 없음), 제안별 널리파이어(nullifier)로 이중 투표를 방지합니다.
- 🏛️ **소유자도 관리자 키도 없음** — 7석 협의회가 *곧* 권위이며, 오직 **7명 중 4명(4-of-7)**으로만 행동합니다.
- 🔑 **분실에도 견디는 키 복구** — 정직한 단 한 명의 석(seat)이라도 발동할 수 있는 이의제기 기간(contest window)을 거쳐, 한 석을 교체하거나 잃어버린 지갑의 모든 산출물을 새 지갑으로 이전합니다.
- 🌱 **포크 가능한 서클** — 어떤 그룹이든 동일한 거버넌스로 새 서클을 만들 수 있으며, World Service Circle은 공유 자료를 조율할 뿐 지배하지 않습니다.
- 📜 **선택적 공개 자격 증명** — 과정/입문 인증서("누가, 무슨 과정을, 누구에게 배웠고, 언제")를 영지식으로 *항목별로* 공개합니다.

---

## 💡 어떻게 맞물리는가

나무처럼 읽으세요 — 사람들은 맨 위의 우듬지이고, 서클들은 가지이며, World Service Circle은 밑동의 줄기이자 뿌리입니다:

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

- **멤버(우듬지)** — 각자 서클의 멤버 집합에 익명 커밋먼트로 참여하고 증명을 통해 행동하며, 지갑을 결코 노출할 필요가 없습니다. 1인 1표.
- **서클(가지)** — 자율적인 지역 그룹으로, 각자 고유한 7석 협의회, 공동 자금, 투표를 가지며 템플릿에서 포크됩니다.
- **World Service Circle(줄기/뿌리)** — 공유 템플릿과 문서를 보유하고 서클 생성을 조율하지만, 지역 그룹 양심을 **무시하지 않습니다**. 이 연결은 명령 계통이 아니라 *연방(federation) 링크*입니다.

## 🎩 누가 무엇을 하는가 — 7석 협의회

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

- **관리자 키 없음.** 모든 특권 행위는 협의회 석의 직무이거나 7명 중 4명(4-of-7) 제안입니다.
- **봉사자는 봉사하고, 멤버는 결정한다.** 일상 직무는 한 석에 위임되며 협의회 교체로 회수 가능합니다. 방향은 멤버 투표로 정해집니다.

---

## 📖 사용법 & 예시

Ayni가 지원하는 네 가지 결정 유형과 각각이 어디에 속하는지:

| 결정 | 누가 투표하는가 | 메커니즘 |
|---|---|---|
| **지역 사안** (한 서클 자체의 일) | 해당 서클의 멤버들 | 익명 ZK 멤버 투표 |
| **재단 헌장** (예: "12단계") | 재단 수준의 키만 | World Service 멤버/협의회 투표 |
| **공유 텍스트** (예: 권고되는 Preamble) | **모든** 서클 + 재단 | 연방 전체 집계 투표 |
| **복구 / 자금** | 7석 협의회 | 7명 중 4명(4-of-7) 제안 + 이의제기 기간 |

이 모두에 대한, 복사해 붙여넣을 수 있는 실제 작동 가이드는 **[IMPLEMENTATION.md](../IMPLEMENTATION.md)**에 있습니다.

<div align="center">
  <img src="../images/BluePrint.png" alt="Ayni — blueprint" width="880" />
</div>

---

## 🚀 빠른 시작

> 사전 요구사항: **Rust**, **Solana/Agave CLI 2.x**, **Anchor 0.31.1**, **Node 20+**, 그리고 (증명을 위해) **circom 2.1** + **snarkjs**.

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

이것이 첫 실행의 전부입니다. 테스트는 서클을 세우고, 익명 멤버십을 발급하고, 7명 중 4명(4-of-7) 복구를 실행하며, 온체인에서 실제 Groth16 투표 증명을 검증합니다(그리고 재사용된 널리파이어는 거부합니다).

자신만의 펠로우십을 세우고 네 가지 투표를 모두 실행하려면 **[IMPLEMENTATION.md](../IMPLEMENTATION.md)**를 단계별로 따라 하세요.

---

## 🗺️ 로드맵

- [x] 양도 불가(soulbound) 멤버십 라이프사이클 + 7석 협의회(4-of-7)
- [x] 익명 ZK 멤버 투표(실제 Groth16 라운드트립, 온체인)
- [x] ZK 계보 부여 + 선택적 공개 확인(acknowledgment)
- [x] 키 복구: 이의제기 기간을 갖춘 석 교체 + 지갑 이전
- [x] 보안 검토 + 심각/중대 결함 수정([SECURITY_REVIEW.md](../SECURITY_REVIEW.md) 참고)
- [ ] 연방 전체(서클 간) 투표 집계
- [ ] 프로덕션용 다자간 신뢰 설정(trusted-setup) 의식(개발용 키 대체)
- [ ] 강압 저항 투표(MACI 방식)
- [ ] Token-2022 양도 불가(soulbound) 발행 종단 간 연결
- [ ] 외부 감사

전체 백로그: [BACKLOG.md](../BACKLOG.md).

---

## 🧭 저장소 지도

| 경로 | 내용 |
|---|---|
| `PROJECT.md` | 체인 비종속 AHA 모델(*무엇*과 *왜*). |
| `IMPLEMENTATION.md` | 단계별 실행 가이드: 재단 → 첫 서클 → 네 가지 투표. |
| `programs/ayni/` | Anchor 프로그램 — 멤버십, 협의회, ZK 투표 & 계보. |
| `circuits/` | Circom 회로: 멤버 투표, 계보 부여, 확인(acknowledgment). |
| `docs/` | 심층 자료: 회복력, 자금, 투표, 시빌(sybil), ZK 계보, 확인. |
| `app/` | TypeScript 증명 헬퍼(머클 트리, 증명 생성). |
| `SECURITY_REVIEW.md` | 최신 컨셉 + 보안 검토와 적용된 수정 사항. |

---

## 🤝 기여하기

기여를 환영합니다 — 특히 이슈, PR, 그리고 암호학에 대한 검토를 환영합니다.

1. `solana`에서 포크하고 브랜치를 만드세요(기본 브랜치이며, 다른 체인은 `ethereum`, `avalanche`에 있습니다).
2. `anchor build && anchor test`가 통과해야 합니다.
3. 변경 내용과 그 보안 영향을 설명하는 PR을 여세요.

**`good first issue`**로 표시된 곳이 시작하기 좋은 지점입니다. 서로에게 훌륭하게 대하세요 — [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md)를 참고하세요.

**권장 GitHub 토픽:** `solana` · `anchor` · `zero-knowledge` · `zk-snarks` · `circom` · `dao` · `governance` · `soulbound` · `privacy` · `anonymous-voting` · `groth16`

---

## ⚠️ 상태 & 보안

연구 / **감사 이전(pre-audit)** 단계입니다. ZK 익명성 계층과 7명 중 4명(4-of-7) 복구는 구현되어 localnet에서 테스트되었습니다. 실제 다자간 신뢰 설정(trusted-setup) 의식과 외부 감사 없이는 **프로덕션에서 사용하지 마세요**. 최신 검토와 적용된 수정 사항: [SECURITY_REVIEW.md](../SECURITY_REVIEW.md).

## 📄 라이선스

[GNU AGPL-3.0](../LICENSE) © Ayni / AHA 기여자들. 네트워크 사용은 배포에 해당합니다: 수정된 Ayni를 서비스로 운영한다면, 동일한 라이선스로 소스를 공개해야 합니다.

---

<div align="center">

**익명의, 소유자 없는 펠로우십**이라는 Ayni의 모델이 공감된다면, ⭐ **저장소에 별을 눌러** 함께해 주세요 — 다른 이들이 이 프로젝트를 발견하는 데 도움이 됩니다.

</div>

<div align="center">
  <img src="../images/Model.png" alt="AHA / Ayni — the full model" width="920" />
</div>
