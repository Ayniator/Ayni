<div align="center">

<img src="../images/AHA.png" alt="AHA — Ancestral Humanity Anonymous" width="220" />

# Ayni

**Confraternite di iscritti anonime e autogovernate su Solana — soulbound, ZK-private, senza proprietario.**

Framework aperto per DAO di iscrizione a confraternite, con voto anonimo a conoscenza zero e
credenziali di lignaggio divulgabili in modo selettivo.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](../LICENSE)
[![Anchor](https://img.shields.io/badge/Anchor-0.31.1-512BD4)](https://www.anchor-lang.com/)
[![Solana](https://img.shields.io/badge/Solana-2.x-14F195)](https://solana.com/)
[![Circom](https://img.shields.io/badge/Circom-2.1-orange)](https://docs.circom.io/)
[![Status](https://img.shields.io/badge/status-research%2Fpre--audit-yellow)](../BACKLOG.md)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#-come-contribuire)

🌍 [Other languages](README.md) · [English](../README.md)

</div>

---

## Cos'è Ayni?

Ayni è l'implementazione su Solana di una **Organizzazione Autonoma Decentralizzata (DAO) anonima** —
originariamente progettata per soddisfare le esigenze di **AHA (Ancestral Humanity Anonymous)**, ma
aperta a qualsiasi organizzazione. Nella sua essenza è un modello indipendente dalla blockchain per
confraternite mondiali, ispirato al successo secolare delle **tradizioni AA / dei 12 passi**. Offre a
qualsiasi gruppo un modo pronto all'uso per **ammettere membri, gestire una tesoreria, decidere per
coscienza di gruppo e recuperare da chiavi perse** — mentre ogni membro resta **anonimo per
impostazione predefinita** grazie alle prove a conoscenza zero.

- **Cosa fa** — gestisce on-chain una confraternita di iscritti: iscrizioni annuali soulbound,
  voto anonimo un-membro-un-voto, una tesoreria a sole donazioni e un Consiglio di 7 seggi con
  recupero delle chiavi 4-su-7 — nessun proprietario, nessuna chiave di amministrazione.
- **Per chi è** — confraternite, gruppi di mutuo aiuto, comunità anonime, DAO che vogliono
  *appartenenza* invece di speculazione, e chiunque abbia bisogno di **vera privacy** per i propri
  membri.
- **Come usarlo** — fai il fork del modello, insedia un Consiglio, apri un Circle e i membri si
  uniscono come impegni privati. Vedi [Avvio rapido](#-avvio-rapido).

> *Ayni* (Quechua): la sacra reciprocità del dare e del ricevere — l'auto-sostegno, un membro una
> voce, nessun proprietario centrale.

---

## ✨ Funzionalità

- 🪪 **Iscrizione soulbound** — annuale, non trasferibile. L'appartenenza si guadagna e si rinnova,
  non si compra né si vende.
- 🕶️ **Anonimo per impostazione predefinita** — un membro è un impegno privato in un insieme Merkle,
  non un wallet visibile. Voto e credenziali sono a conoscenza zero; l'identità viene rivelata solo
  per scelta.
- 🗳️ **Voto per coscienza di gruppo** — un membro, un voto, espresso in forma anonima (nessuna
  plutocrazia ponderata sui token), con un nullifier per proposta che impedisce i doppi voti.
- 🏛️ **Nessun proprietario, nessuna chiave di amministrazione** — il Consiglio di 7 seggi *è*
  l'autorità e agisce solo con **4-su-7**.
- 🔑 **Recupero delle chiavi che sopravvive alla perdita** — ruota un seggio o migra ogni artefatto di
  un wallet perso verso uno nuovo, dietro una finestra di contestazione che qualsiasi singolo seggio
  onesto può attivare.
- 🌱 **Circle forkabili** — qualsiasi gruppo avvia un nuovo Circle con governance identica; il World
  Service Circle coordina il materiale condiviso, non governa.
- 📜 **Credenziali a divulgazione selettiva** — certificati di corso/iniziazione ("chi, quale corso,
  insegnato da chi, quando") aperti *campo per campo* a conoscenza zero.

---

## 💡 Come si incastra tutto

Leggilo come un albero — le persone sono la chioma in alto, i Circle sono i
rami, e il World Service Circle è il tronco e le radici alla base:

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

- **Membri (la chioma)** — ciascuno si unisce all'insieme dei membri di un Circle come impegno
  anonimo e agisce attraverso prove; non deve mai esporre un wallet. Un membro, un voto.
- **Circle (i rami)** — gruppi locali autonomi, ciascuno con il proprio Consiglio di 7 seggi,
  tesoreria e voti; forkati dal modello.
- **World Service Circle (il tronco/radice)** — custodisce il modello condiviso e i documenti e
  coordina la creazione dei Circle, ma **non** scavalca la coscienza di gruppo locale. Il legame è un
  *legame di federazione*, non una catena di comando.

## 🎩 Chi fa cosa — il Consiglio di 7 seggi

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

- **Nessuna chiave di amministrazione.** Ogni azione privilegiata è un dovere di un seggio del
  Consiglio o una proposta 4-su-7.
- **I servitori servono, i membri decidono.** I doveri di routine sono delegati a un seggio e
  revocabili tramite rotazione del Consiglio; la direzione è stabilita dal voto dei membri.

---

## 📖 Utilizzo ed esempi

I quattro tipi di decisione che Ayni supporta, e dove risiede ciascuno:

| Decisione | Chi vota | Meccanismo |
|---|---|---|
| **Questione locale** (gli affari di un singolo Circle) | i membri di quel Circle | voto anonimo ZK dei membri |
| **Carta della fondazione** (es. i "12 passi") | solo le chiavi a livello di fondazione | voto dei membri/Consiglio del World Service |
| **Testo condiviso** (es. il Preambolo suggerito) | **tutti** i Circle + la fondazione | voto aggregato a livello di federazione |
| **Recupero / tesoreria** | il Consiglio di 7 seggi | proposta 4-su-7 + finestra di contestazione |

Procedure dettagliate, pronte da copiare e incollare, per tutte queste si trovano in
**[IMPLEMENTATION.md](../IMPLEMENTATION.md)**.

<div align="center">
  <img src="../images/BluePrint.png" alt="Ayni — blueprint" width="880" />
</div>

---

## 🚀 Avvio rapido

> Prerequisiti: **Rust**, **Solana/Agave CLI 2.x**, **Anchor 0.31.1**, **Node 20+** e (per le prove)
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

Questo è l'intero primo avvio. I test allestiscono un Circle, emettono iscrizioni anonime, eseguono
un recupero 4-su-7 e verificano on-chain una vera prova di voto Groth16 (e rifiutano un nullifier
riproposto).

Per allestire la tua confraternita ed eseguire tutti e quattro i tipi di voto, segui passo passo
**[IMPLEMENTATION.md](../IMPLEMENTATION.md)**.

---

## 🗺️ Tabella di marcia

- [x] Ciclo di vita dell'iscrizione soulbound + Consiglio di 7 seggi (4-su-7)
- [x] Voto anonimo ZK dei membri (vero round-trip Groth16, on-chain)
- [x] Concessioni di lignaggio ZK + riconoscimenti a divulgazione selettiva
- [x] Recupero delle chiavi: rotazione dei seggi + migrazione del wallet con finestra di contestazione
- [x] Revisione di sicurezza + correzioni critiche/alte (vedi [SECURITY_REVIEW.md](../SECURITY_REVIEW.md))
- [ ] Aggregazione del voto a livello di federazione (cross-Circle)
- [ ] Cerimonia di trusted-setup multi-parte in produzione (sostituire le chiavi di sviluppo)
- [ ] Voto resistente alla coercizione (in stile MACI)
- [ ] Mint soulbound Token-2022 collegato end-to-end
- [ ] Audit esterno

Backlog completo: [BACKLOG.md](../BACKLOG.md).

---

## 🧭 Mappa del repository

| Percorso | Contenuti |
|---|---|
| `PROJECT.md` | Il modello AHA indipendente dalla blockchain (il *cosa* e il *perché*). |
| `IMPLEMENTATION.md` | Runbook passo passo: fondazione → primo Circle → i quattro voti. |
| `programs/ayni/` | Il programma Anchor — iscrizioni, Consiglio, voto ZK e lignaggio. |
| `circuits/` | Circuiti Circom: voto dei membri, concessioni di lignaggio, riconoscimenti. |
| `docs/` | Approfondimenti: resilienza, tesoreria, voto, sybil, lignaggio ZK, riconoscimenti. |
| `app/` | Helper di proving in TypeScript (alberi Merkle, generazione delle prove). |
| `SECURITY_REVIEW.md` | Ultima revisione del concetto + sicurezza e le correzioni applicate. |

---

## 🤝 Come contribuire

I contributi sono benvenuti — issue, PR e, soprattutto, revisione della crittografia.

1. Fai il fork e crea un branch da `solana` (il branch predefinito; le altre blockchain risiedono su `ethereum`, `avalanche`).
2. `anchor build && anchor test` deve passare.
3. Apri una PR che descriva la modifica e il suo impatto sulla sicurezza.

Buoni punti di partenza sono etichettati **`good first issue`**. Siate eccellenti gli uni con gli
altri — vedi [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md).

**Topic GitHub suggeriti:** `solana` · `anchor` · `zero-knowledge` · `zk-snarks` · `circom` ·
`dao` · `governance` · `soulbound` · `privacy` · `anonymous-voting` · `groth16`

---

## ⚠️ Stato e sicurezza

Ricerca / **pre-audit**. Il livello di anonimato ZK e il recupero 4-su-7 sono implementati e testati
su localnet. **Non usare in produzione** senza una vera cerimonia di trusted-setup multi-parte e un
audit esterno. Ultima revisione e correzioni applicate: [SECURITY_REVIEW.md](../SECURITY_REVIEW.md).

## 📄 Licenza

[GNU AGPL-3.0](../LICENSE) © i contributori di Ayni / AHA. L'uso in rete è distribuzione: se gestisci
una versione modificata di Ayni come servizio, devi condividerne il sorgente sotto la stessa licenza.

---

<div align="center">

Se il modello di Ayni di **confraternita anonima e senza proprietario** risuona con te, ⭐ **metti una
stella al repository** per seguirne gli sviluppi — aiuta gli altri a trovarlo.

</div>

<div align="center">
  <img src="../images/Model.png" alt="AHA / Ayni — the full model" width="920" />
</div>
