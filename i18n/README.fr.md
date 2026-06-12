<div align="center">

<img src="../images/AHA.png" alt="AHA — Ancestral Humanity Anonymous" width="220" />

# Ayni

**Des fraternités d'adhésion autogérées et anonymes sur Solana — incessibles, privées par ZK, sans propriétaire.**

Cadre ouvert pour des DAO d'adhésion fraternelle, avec vote anonyme à divulgation nulle de connaissance
(zero-knowledge) et attestations de lignée à divulgation sélective.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](../LICENSE)
[![Anchor](https://img.shields.io/badge/Anchor-0.31.1-512BD4)](https://www.anchor-lang.com/)
[![Solana](https://img.shields.io/badge/Solana-2.x-14F195)](https://solana.com/)
[![Circom](https://img.shields.io/badge/Circom-2.1-orange)](https://docs.circom.io/)
[![Status](https://img.shields.io/badge/status-research%2Fpre--audit-yellow)](../BACKLOG.md)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#-contribuer)

🌍 [Other languages](README.md) · [English](../README.md)

</div>

---

## Qu'est-ce qu'Ayni ?

Ayni est l'implémentation Solana d'une **organisation autonome décentralisée (DAO) anonyme** — conçue
à l'origine pour répondre aux besoins d'**AHA (Ancestral Humanity Anonymous)**, mais ouverte à toute
organisation. Elle est par essence un modèle indépendant de toute blockchain, destiné à des fraternités
mondiales, inspiré du succès centenaire des **traditions des AA / programme en 12 étapes**. Elle offre à
tout groupe une manière prête à l'emploi d'**accueillir des membres, tenir une trésorerie, décider par
conscience collective et récupérer des clés perdues** — tandis que chaque membre demeure **anonyme par
défaut** grâce aux preuves à divulgation nulle de connaissance.

- **Ce qu'il fait** — fait fonctionner une fraternité d'adhésion sur la chaîne : adhésions annuelles
  incessibles, vote anonyme « un membre, une voix », une trésorerie alimentée uniquement par les dons,
  et un Conseil de 7 sièges avec récupération de clés à 4 sur 7 — sans propriétaire, sans clé
  d'administration.
- **À qui il s'adresse** — fraternités, groupes d'entraide, communautés anonymes, DAO qui recherchent
  l'*appartenance* plutôt que la spéculation, et quiconque a besoin d'une **vraie confidentialité** pour
  ses membres.
- **Comment l'utiliser** — forkez le modèle, installez un Conseil, ouvrez un Cercle, et les membres
  rejoignent sous forme d'engagements (commitments) privés. Voir [Démarrage rapide](#-démarrage-rapide).

> *Ayni* (quechua) : la réciprocité sacrée du don et du contre-don — l'autonomie, une voix par membre,
> aucun propriétaire central.

---

## ✨ Fonctionnalités

- 🪪 **Adhésion incessible (soulbound)** — annuelle, non transférable. L'appartenance se mérite et se
  renouvelle, elle ne s'achète ni ne se vend.
- 🕶️ **Anonyme par défaut** — un membre est un engagement privé dans un ensemble de Merkle, pas un
  portefeuille visible. Le vote et les attestations sont à divulgation nulle ; l'identité n'est révélée
  que par choix.
- 🗳️ **Vote par conscience collective** — un membre, une voix, exprimée anonymement (pas de ploutocratie
  pondérée par jetons), avec un nullifier par proposition empêchant le double vote.
- 🏛️ **Sans propriétaire ni clé d'administration** — le Conseil de 7 sièges *est* l'autorité et n'agit
  qu'à **4 sur 7**.
- 🔑 **Récupération de clés résistante à la perte** — faire tourner un siège ou migrer tous les actifs
  d'un portefeuille perdu vers un nouveau, derrière une fenêtre de contestation qu'un seul siège honnête
  peut déclencher.
- 🌱 **Cercles forkables** — tout groupe lance un nouveau Cercle avec une gouvernance identique ; le
  World Service Circle coordonne le matériel partagé, il ne commande pas.
- 📜 **Attestations à divulgation sélective** — certificats de cours / d'initiation (« qui, quel cours,
  enseigné par qui, quand ») ouverts *champ par champ* en divulgation nulle.

---

## 💡 Comment tout s'articule

Lisez-le comme un arbre — les personnes forment la canopée en haut, les Cercles sont les branches,
et le World Service Circle est le tronc et les racines, à la base :

```
 member member member      member member member      member member member     ← les membres
 (anon) (anon) (anon)      (anon) (anon) (anon)      (anon) (anon) (anon)         (anonymes,
    \      |      /          \      |      /          \      |      /              un membre,
     ┌─────┬─────┐            ┌─────┬─────┐            ┌─────┬─────┐               une voix)
     │   Cusco   │            │  Lisbon   │            │  Bangkok  │
     │ Council 7 │            │ Council 7 │            │ Council 7 │   …        ← Cercles : les
     └─────┴─────┘            └─────┴─────┘            └─────┴─────┘               branches
           └────────────────────────┬────────────────────────┘
                                    │   every Circle is forked from one shared template
                     ┌───────────────┴───────────────┐
                     │     WORLD SERVICE CIRCLE       │   ← le tronc / la racine (« fondation ») :
                     │   12 Steps · Preamble · docs   │      détient le modèle partagé + un
                     │    7-seat Council · 4-of-7     │      Conseil (4/7) qui coordonne
                     └───────────────────────────────┘      mais ne gouverne PAS
```

- **Les membres (la canopée)** — chacun rejoint l'ensemble des membres d'un Cercle sous forme
  d'engagement anonyme et agit par des preuves ; jamais besoin d'exposer un portefeuille. Un membre, une
  voix.
- **Les Cercles (les branches)** — groupes locaux autonomes, chacun avec son propre Conseil de 7 sièges,
  sa trésorerie et ses votes ; forkés depuis le modèle.
- **Le World Service Circle (le tronc / la racine)** — détient le modèle et les documents partagés
  et coordonne la création des Cercles, mais ne **prime pas** sur la conscience collective locale. Le
  lien est un *lien de fédération*, pas une chaîne de commandement.

## 🎩 Qui fait quoi — le Conseil de 7 sièges

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

- **Aucune clé d'administration.** Toute action privilégiée est un devoir d'un siège du Conseil ou une
  proposition à 4 sur 7.
- **Les servants servent, les membres décident.** Les tâches courantes sont déléguées à un siège et
  révocables par rotation du Conseil ; la direction est fixée par le vote des membres.

---

## 📖 Utilisation & exemples

Les quatre types de décision pris en charge par Ayni, et où chacun se situe :

| Décision | Qui vote | Mécanisme |
|---|---|---|
| **Affaire locale** (les affaires propres d'un Cercle) | les membres de ce Cercle | vote de membre anonyme (ZK) |
| **Charte de la fondation** (p. ex. les « 12 Étapes ») | seules les clés de niveau fondation | vote des membres/du Conseil du World Service |
| **Texte partagé** (p. ex. le Préambule suggéré) | **tous** les Cercles + la fondation | vote agrégé à l'échelle de la fédération |
| **Récupération / trésorerie** | le Conseil de 7 sièges | proposition 4/7 + fenêtre de contestation |

Des procédures détaillées, prêtes à copier-coller, pour tout cela se trouvent dans
**[IMPLEMENTATION.md](../IMPLEMENTATION.md)**.

<div align="center">
  <img src="../images/BluePrint.png" alt="Ayni — blueprint" width="880" />
</div>

---

## 🚀 Démarrage rapide

> Prérequis : **Rust**, **Solana/Agave CLI 2.x**, **Anchor 0.31.1**, **Node 20+**, et (pour les preuves)
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

Voilà tout le premier lancement. Les tests créent un Cercle, émettent des adhésions anonymes, exécutent
une récupération à 4 sur 7, et vérifient une vraie preuve de vote Groth16 on-chain (et rejettent un
nullifier rejoué).

Pour mettre en place votre propre fraternité et exécuter les quatre types de vote, suivez pas à pas
**[IMPLEMENTATION.md](../IMPLEMENTATION.md)**.

---

## 🗺️ Feuille de route

- [x] Cycle de vie d'adhésion incessible + Conseil de 7 sièges (4/7)
- [x] Vote de membre anonyme par ZK (vrai aller-retour Groth16, on-chain)
- [x] Octrois de lignée par ZK + attestations à divulgation sélective
- [x] Récupération de clés : rotation de siège + migration de portefeuille avec fenêtre de contestation
- [x] Revue de sécurité + corrections critiques/élevées (voir [SECURITY_REVIEW.md](../SECURITY_REVIEW.md))
- [ ] Vote agrégé à l'échelle de la fédération (inter-Cercles)
- [ ] Cérémonie de configuration de confiance multipartite pour la production (remplacer les clés de dév)
- [ ] Vote résistant à la coercition (façon MACI)
- [ ] Mint soulbound Token-2022 câblé de bout en bout
- [ ] Audit externe

Backlog complet : [BACKLOG.md](../BACKLOG.md).

---

## 🧭 Carte du dépôt

| Chemin | Contenu |
|---|---|
| `PROJECT.md` | Le modèle AHA indépendant de la chaîne (le *quoi* et le *pourquoi*). |
| `IMPLEMENTATION.md` | Guide pas à pas : fondation → premier Cercle → les quatre votes. |
| `programs/ayni/` | Le programme Anchor — adhésions, Conseil, vote ZK & lignée. |
| `circuits/` | Circuits Circom : vote de membre, octrois de lignée, attestations. |
| `docs/` | Approfondissements : résilience, trésorerie, vote, anti-sybil, lignée ZK, attestations. |
| `app/` | Utilitaires de preuve TypeScript (arbres de Merkle, génération de preuves). |
| `SECURITY_REVIEW.md` | Dernière revue concept + sécurité et corrections appliquées. |

---

## 🤝 Contribuer

Les contributions sont bienvenues — issues, PR, et tout particulièrement la relecture de la cryptographie.

1. Forkez et créez une branche depuis `solana` (la branche par défaut ; les autres chaînes vivent sur
   `ethereum`, `avalanche`).
2. `anchor build && anchor test` doivent réussir.
3. Ouvrez une PR décrivant le changement et son impact sur la sécurité.

De bons points de départ sont étiquetés **`good first issue`**. Soyez bienveillants les uns envers les
autres — voir [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md).

**Sujets (topics) GitHub suggérés :** `solana` · `anchor` · `zero-knowledge` · `zk-snarks` · `circom` ·
`dao` · `governance` · `soulbound` · `privacy` · `anonymous-voting` · `groth16`

---

## ⚠️ Statut & sécurité

Recherche / **pré-audit**. La couche d'anonymat ZK et la récupération 4/7 sont implémentées et testées
sur localnet. **Ne pas utiliser en production** sans une vraie cérémonie de configuration de confiance
multipartite et un audit externe. Dernière revue et corrections appliquées :
[SECURITY_REVIEW.md](../SECURITY_REVIEW.md).

## 📄 Licence

[GNU AGPL-3.0](../LICENSE) © les contributeurs d'Ayni / AHA. L'usage en réseau vaut distribution : si
vous exploitez une version modifiée d'Ayni en tant que service, vous devez partager votre code source
sous la même licence.

---

<div align="center">

Si le modèle d'Ayni — une **fraternité anonyme et sans propriétaire** — vous parle, ⭐ **mettez une
étoile au dépôt** pour suivre le projet ; cela aide les autres à le trouver.

</div>

<div align="center">
  <img src="../images/Model.png" alt="AHA / Ayni — the full model" width="920" />
</div>
