<div align="center">

<img src="../images/AHA.png" alt="AHA — Ancestral Humanity Anonymous" width="220" />

# Ayni

**Solana 上で自律統治される、匿名のメンバーシップ・フェローシップ — ソウルバウンド、ZK プライバシー、オーナーレス。**

ゼロ知識による匿名投票と、選択的に開示可能な系譜クレデンシャルを備えた、フェローシップ・メンバーシップ DAO のためのオープンフレームワーク。

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](../LICENSE)
[![Anchor](https://img.shields.io/badge/Anchor-0.31.1-512BD4)](https://www.anchor-lang.com/)
[![Solana](https://img.shields.io/badge/Solana-2.x-14F195)](https://solana.com/)
[![Circom](https://img.shields.io/badge/Circom-2.1-orange)](https://docs.circom.io/)
[![Status](https://img.shields.io/badge/status-research%2Fpre--audit-yellow)](../BACKLOG.md)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#-貢献する)

🌍 [Other languages](README.md) · [English](../README.md)

</div>

---

## Ayni とは?

Ayni は、**匿名の分散型自律組織(DAO）** を Solana 上で実装したものです。もともとは **AHA(Ancestral Humanity Anonymous）** のニーズを満たすために設計されましたが、あらゆる組織に開かれています。その本質は、**AA / 12 ステップの伝統**という一世紀にわたって実証されてきた成功にならった、世界中のフェローシップのためのチェーン非依存のテンプレートです。これは、あらゆるグループに対して、**メンバーを受け入れ、共同の財産(トレジャリー)を保持し、グループの良心によって決定し、失われた鍵から復旧する**ための既製の手段を提供します。その間、すべてのメンバーはゼロ知識証明によって**デフォルトで匿名**のままでいられます。

- **何をするのか** — メンバーシップ・フェローシップをオンチェーンで運営します。ソウルバウンドの年次メンバーシップ、匿名の「1 メンバー 1 票」、寄付のみで成り立つトレジャリー、そして 4-of-7 の鍵復旧を備えた 7 席の評議会(Council) — オーナーも管理者鍵も存在しません。
- **誰のためのものか** — フェローシップ、相互扶助グループ、匿名コミュニティ、投機ではなく*帰属*を求める DAO、そしてメンバーのために**真のプライバシー**を必要とするすべての人。
- **どう使うのか** — テンプレートをフォークし、評議会の席を据え、サークルを開設すれば、メンバーはプライベートなコミットメントとして参加します。[クイックスタート](#-クイックスタート)を参照してください。

> *Ayni*(ケチュア語):与えることと受け取ることの神聖な互恵性 — 自助、1 メンバー 1 声、中央のオーナーは存在しない。

---

## ✨ 特徴

- 🪪 **ソウルバウンド・メンバーシップ** — 年次で譲渡不可。帰属は獲得し更新するものであり、決して売買されない。
- 🕶️ **デフォルトで匿名** — メンバーは Merkle セット内のプライベートなコミットメントであり、可視のウォレットではない。投票とクレデンシャルはゼロ知識であり、身元は選択によってのみ明かされる。
- 🗳️ **グループの良心による投票** — 1 メンバー 1 票を匿名で投じる(トークン重み付けの金権政治ではない)。提案ごとの nullifier が二重投票を防ぐ。
- 🏛️ **オーナーなし、管理者鍵なし** — 7 席の評議会(Council)*こそが*権威であり、**4-of-7** によってのみ行動する。
- 🔑 **喪失に耐える鍵復旧** — 席をローテーションするか、失われたウォレットのあらゆるアーティファクトを新しいウォレットへ移行する。これは、誠実な席が 1 つでもあれば発動できる異議申し立て期間の背後で行われる。
- 🌱 **フォーク可能なサークル** — どのグループも同一のガバナンスで新しいサークルを立ち上げられる。World Service Circle は共有素材を調整するが、支配はしない。
- 📜 **選択的開示クレデンシャル** — コース/イニシエーション証明書(「誰が、どのコースを、誰に教わり、いつ」)を、ゼロ知識で*フィールドごとに*開示する。

---

## 💡 どのように噛み合うのか

これを 1 本の木のように読んでください — 人々は最上部の樹冠、サークルは枝、そして World Service Circle は根元の幹と根です:

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

- **メンバー(樹冠)** — 各メンバーはサークルのメンバーセットに匿名のコミットメントとして参加し、証明を通じて行動する。ウォレットを露出させる必要は決してない。1 メンバー 1 票。
- **サークル(枝)** — 自律的なローカルグループ。それぞれが独自の 7 席の評議会、トレジャリー、投票を持ち、テンプレートからフォークされる。
- **World Service Circle(幹/根)** — 共有テンプレートとドキュメントを保持し、サークルの作成を調整するが、ローカルグループの良心を**覆さない**。そのつながりは*連邦的なリンク*であって、指揮命令系統ではない。

## 🎩 誰が何をするか — 7 席の評議会(Council)

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

- **管理者鍵はない。** すべての特権的なアクションは、評議会の席の職務か、4-of-7 の提案である。
- **奉仕者は奉仕し、メンバーは決定する。** 日常的な職務は席に委任され、評議会のローテーションによって取り消し可能である。方向性はメンバーの投票によって定められる。

---

## 📖 使い方と例

Ayni がサポートする 4 種類の決定と、それぞれがどこに存在するか:

| 決定 | 誰が投票するか | 仕組み |
|---|---|---|
| **ローカルな事案**(サークル自身の業務) | そのサークルのメンバー | 匿名 ZK メンバー投票 |
| **財団の憲章**(例:「12 ステップ」) | 財団レベルの鍵のみ | World Service のメンバー/評議会投票 |
| **共有テキスト**(例:推奨される Preamble) | **すべての**サークル + 財団 | 連邦全体で集約された投票 |
| **復旧 / トレジャリー** | 7 席の評議会 | 4-of-7 提案 + 異議申し立て期間 |

これらすべてについて、コピー&ペースト可能な実践的なウォークスルーは **[IMPLEMENTATION.md](../IMPLEMENTATION.md)** にあります。

<div align="center">
  <img src="../images/BluePrint.png" alt="Ayni — blueprint" width="880" />
</div>

---

## 🚀 クイックスタート

> 前提条件:**Rust**、**Solana/Agave CLI 2.x**、**Anchor 0.31.1**、**Node 20+**、そして(証明のために)**circom 2.1** + **snarkjs**。

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

これで初回実行はすべて完了です。テストはサークルを立ち上げ、匿名のメンバーシップを発行し、4-of-7 の復旧を実行し、本物の Groth16 投票証明をオンチェーンで検証します(そして再生された nullifier を拒否します)。

自分自身のフェローシップを立ち上げ、4 種類の投票すべてを実行するには、**[IMPLEMENTATION.md](../IMPLEMENTATION.md)** をステップごとに進めてください。

---

## 🗺️ ロードマップ

- [x] ソウルバウンド・メンバーシップのライフサイクル + 7 席の評議会(4-of-7)
- [x] 匿名 ZK メンバー投票(本物の Groth16 ラウンドトリップ、オンチェーン)
- [x] ZK 系譜グラント + 選択的開示の承認(acknowledgments)
- [x] 鍵復旧:席のローテーション + 異議申し立て期間付きのウォレット移行
- [x] セキュリティレビュー + critical/high の修正([SECURITY_REVIEW.md](../SECURITY_REVIEW.md) を参照)
- [ ] 連邦全体(サークル横断)の投票集約
- [ ] 本番向けのマルチパーティ・トラステッドセットアップ・セレモニー(開発用鍵の置き換え)
- [ ] 強制耐性のある投票(MACI スタイル)
- [ ] Token-2022 ソウルバウンド・ミントのエンドツーエンド配線
- [ ] 外部監査

完全なバックログ:[BACKLOG.md](../BACKLOG.md)。

---

## 🧭 リポジトリマップ

| パス | 内容 |
|---|---|
| `PROJECT.md` | チェーン非依存の AHA モデル(*何を*そして*なぜ*)。 |
| `IMPLEMENTATION.md` | ステップごとのランブック:財団 → 最初のサークル → 4 つの投票。 |
| `programs/ayni/` | Anchor プログラム — メンバーシップ、評議会、ZK 投票と系譜。 |
| `circuits/` | Circom 回路:メンバー投票、系譜グラント、承認。 |
| `docs/` | 詳細解説:レジリエンス、トレジャリー、投票、シビル、ZK 系譜、承認。 |
| `app/` | TypeScript の証明ヘルパー(Merkle ツリー、証明生成)。 |
| `SECURITY_REVIEW.md` | 最新のコンセプト + セキュリティレビューと適用された修正。 |

---

## 🤝 貢献する

貢献を歓迎します — issue、PR、そして特に暗号技術のレビューを。

1. `solana`(デフォルトブランチ。他のチェーンは `ethereum`、`avalanche` にあります)からフォークしてブランチを作成します。
2. `anchor build && anchor test` が通ること。
3. 変更とそのセキュリティ上の影響を説明する PR を開きます。

最初の一歩におすすめなのは **`good first issue`** とラベル付けされたものです。互いに素晴らしくありましょう — [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) を参照してください。

**推奨される GitHub トピック:** `solana` · `anchor` · `zero-knowledge` · `zk-snarks` · `circom` · `dao` · `governance` · `soulbound` · `privacy` · `anonymous-voting` · `groth16`

---

## ⚠️ ステータスとセキュリティ

リサーチ / **監査前(pre-audit)**。ZK 匿名レイヤーと 4-of-7 復旧は実装され、localnet 上でテストされています。本物のマルチパーティ・トラステッドセットアップ・セレモニーと外部監査なしに、**本番環境では使用しないでください**。最新のレビューと適用された修正:[SECURITY_REVIEW.md](../SECURITY_REVIEW.md)。

## 📄 ライセンス

[GNU AGPL-3.0](../LICENSE) © Ayni / AHA の貢献者たち。ネットワーク利用は配布にあたります:改変した Ayni をサービスとして運用する場合、同じライセンスの下でソースを共有しなければなりません。

---

<div align="center">

Ayni の**匿名でオーナーレスなフェローシップ**というモデルがあなたの心に響くなら、⭐ **リポジトリにスターを付けて**追いかけてください — それは他の人がこれを見つける助けになります。

</div>

<div align="center">
  <img src="../images/Model.png" alt="AHA / Ayni — the full model" width="920" />
</div>
