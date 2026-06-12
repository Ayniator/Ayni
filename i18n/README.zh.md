<div align="center">

<img src="../images/AHA.png" alt="AHA — Ancestral Humanity Anonymous" width="220" />

# Ayni

**Solana 上自治、匿名的会员制互助会——灵魂绑定、零知识隐私、无所有者。**

面向互助会会员 DAO 的开放框架，具备零知识匿名投票与可选择性披露的传承凭证。

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](../LICENSE)
[![Anchor](https://img.shields.io/badge/Anchor-0.31.1-512BD4)](https://www.anchor-lang.com/)
[![Solana](https://img.shields.io/badge/Solana-2.x-14F195)](https://solana.com/)
[![Circom](https://img.shields.io/badge/Circom-2.1-orange)](https://docs.circom.io/)
[![Status](https://img.shields.io/badge/status-research%2Fpre--audit-yellow)](../BACKLOG.md)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#-参与贡献)

🌍 [Other languages](README.md) · [English](../README.md)

</div>

---

## Ayni 是什么？

Ayni 是一个**匿名去中心化自治组织（DAO）**的 Solana 实现——最初是为满足 **AHA（Ancestral Humanity Anonymous）** 的需求而设计，但对任何组织开放。其本质是一个链无关的全球性互助会模板，借鉴了**戒酒互助会 / 12 步传统（AA / 12-step）**历经百年验证的成功经验。它为任何团体提供了一套现成的方式来**吸纳成员、持有金库、依群体良知决策，并从丢失的密钥中恢复**——同时，每位成员通过零知识证明在**默认情况下保持匿名**。

- **它能做什么**——在链上运行一个会员制互助会：灵魂绑定的年度会员资格、匿名的一人一票、仅接受捐赠的金库，以及一个具备 4/7 密钥恢复机制的 7 席议事会（Council）——没有所有者，没有管理员密钥。
- **它面向谁**——互助会、互助团体、匿名社区、追求*归属感*而非投机的 DAO，以及任何需要为成员提供**真正隐私**的人。
- **如何使用它**——复刻（fork）该模板，组建议事会，开设一个圈子（Circle），成员便以私密承诺的形式加入。参见[快速开始](#-快速开始)。

> *Ayni*（克丘亚语）：给予与接受之间神圣的互惠——自我支持、一人一声、无中央所有者。

---

## ✨ 特性

- 🪪 **灵魂绑定的会员资格**——按年度发放、不可转让。归属感是赢得并续期的，绝不可买卖。
- 🕶️ **默认匿名**——一名成员是默克尔（Merkle）集合中的一个私密承诺，而非一个可见的钱包。投票与凭证均为零知识；身份仅在本人选择时才会披露。
- 🗳️ **群体良知投票**——一人一票，匿名投出（无代币加权的金权政治），并通过每个提案专属的废止符（nullifier）防止重复投票。
- 🏛️ **无所有者，无管理员密钥**——7 席的议事会*本身*即权威，且仅以 **4/7** 方式行事。
- 🔑 **可在丢失中存续的密钥恢复**——轮换某一席位，或将丢失钱包的每一项产物迁移至新钱包，整个过程置于一个任何一位诚实席位都可触发的异议窗口之后。
- 🌱 **可复刻的圈子**——任何团体都能以完全相同的治理方式启动一个新圈子；世界服务圈（World Service Circle）协调共享材料，但并不统治。
- 📜 **可选择性披露的凭证**——课程 / 入门证书（"何人、何课程、由谁授课、何时"）以零知识方式*逐字段*开启。

---

## 💡 它如何协同运作

把它当作一棵树来理解——人们是顶端的树冠，各个圈子是枝干，世界服务圈则是基部的主干与根系：

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

- **成员（树冠）**——每人以匿名承诺的形式加入某个圈子的成员集合，并通过证明来行事；从不需要暴露钱包。一人一票。
- **圈子（枝干）**——自治的本地团体，各自拥有自己的 7 席议事会、金库与投票；皆从模板复刻而来。
- **世界服务圈（主干 / 根系）**——持有共享模板与文档，并协调圈子的创建，但**不**凌驾于本地群体良知之上。两者之间是一种*联邦式链接*，而非命令链条。

## 🎩 谁负责什么——7 席议事会

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

- **没有管理员密钥。** 每一项特权操作都是某个议事会席位的职责，或是一项 4/7 提案。
- **服务者服务，成员决策。** 日常职责委托给某个席位，并可通过议事会轮换予以撤销；方向则由成员投票设定。

---

## 📖 用法与示例

Ayni 支持的四类决策，以及各自所在的层级：

| 决策 | 谁来投票 | 机制 |
|---|---|---|
| **本地事务**（某圈子自身的事务） | 该圈子的成员 | 匿名 ZK 成员投票 |
| **基金会章程**（例如"12 步"） | 仅限基金会层级的密钥 | 世界服务成员 / 议事会投票 |
| **共享文本**（例如建议的前言 Preamble） | **所有**圈子 + 基金会 | 全联邦聚合投票 |
| **恢复 / 金库** | 7 席议事会 | 4/7 提案 + 异议窗口 |

上述所有内容的可复制粘贴、完整演练，详见 **[IMPLEMENTATION.md](../IMPLEMENTATION.md)**。

<div align="center">
  <img src="../images/BluePrint.png" alt="Ayni — blueprint" width="880" />
</div>

---

## 🚀 快速开始

> 前置依赖：**Rust**、**Solana/Agave CLI 2.x**、**Anchor 0.31.1**、**Node 20+**，以及（用于证明）**circom 2.1** + **snarkjs**。

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

这就是首次运行的全部内容。测试会搭建一个圈子、签发匿名会员资格、执行一次 4/7 恢复，并在链上验证一个真实的 Groth16 投票证明（同时拒绝一个被重放的废止符）。

要搭建你自己的互助会并运行全部四类投票，请逐步遵循 **[IMPLEMENTATION.md](../IMPLEMENTATION.md)**。

---

## 🗺️ 路线图

- [x] 灵魂绑定的会员资格生命周期 + 7 席议事会（4/7）
- [x] 匿名 ZK 成员投票（真实 Groth16 往返，链上）
- [x] ZK 传承授予 + 可选择性披露的确认
- [x] 密钥恢复：席位轮换 + 带异议窗口的钱包迁移
- [x] 安全审查 + 关键 / 高危修复（参见 [SECURITY_REVIEW.md](../SECURITY_REVIEW.md)）
- [ ] 全联邦（跨圈子）投票聚合
- [ ] 生产级多方可信设置仪式（替换开发密钥）
- [ ] 抗胁迫投票（MACI 风格）
- [ ] Token-2022 灵魂绑定铸造端到端打通
- [ ] 外部审计

完整待办：[BACKLOG.md](../BACKLOG.md)。

---

## 🧭 仓库导览

| 路径 | 内容 |
|---|---|
| `PROJECT.md` | 链无关的 AHA 模型（*是什么*与*为什么*）。 |
| `IMPLEMENTATION.md` | 分步运行手册：基金会 → 第一个圈子 → 四类投票。 |
| `programs/ayni/` | Anchor 程序——会员资格、议事会、ZK 投票与传承。 |
| `circuits/` | Circom 电路：成员投票、传承授予、确认。 |
| `docs/` | 深度文档：韧性、金库、投票、女巫攻击、ZK 传承、确认。 |
| `app/` | TypeScript 证明辅助工具（默克尔树、证明生成）。 |
| `SECURITY_REVIEW.md` | 最新的概念与安全审查及已应用的修复。 |

---

## 🤝 参与贡献

欢迎贡献——尤其欢迎 issue、PR，以及对密码学部分的审阅。

1. 从 `solana` 分支（默认分支；其他链位于 `ethereum`、`avalanche`）复刻并创建分支。
2. `anchor build && anchor test` 必须通过。
3. 提交一个 PR，描述变更及其安全影响。

不错的起步点会被标记为 **`good first issue`**。请彼此以诚相待——参见 [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md)。

**建议的 GitHub 主题标签：** `solana` · `anchor` · `zero-knowledge` · `zk-snarks` · `circom` · `dao` · `governance` · `soulbound` · `privacy` · `anonymous-voting` · `groth16`

---

## ⚠️ 状态与安全

研究阶段 / **审计前**。ZK 匿名层与 4/7 恢复已实现并在 localnet 上测试。在未经真实的多方可信设置仪式与外部审计之前，**请勿在生产环境中使用**。最新审查与已应用的修复：[SECURITY_REVIEW.md](../SECURITY_REVIEW.md)。

## 📄 许可证

[GNU AGPL-3.0](../LICENSE) © Ayni / AHA 贡献者。网络使用即构成分发：如果你将一个修改过的 Ayni 作为服务运行，你必须以相同许可证共享你的源代码。

---

<div align="center">

如果 Ayni 这种**匿名、无所有者的互助会**模型引起了你的共鸣，⭐ **为本仓库点星**以持续关注——这能帮助更多人发现它。

</div>

<div align="center">
  <img src="../images/Model.png" alt="AHA / Ayni — the full model" width="920" />
</div>
