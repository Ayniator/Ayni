<div align="center">

<img src="../images/AHA.png" alt="AHA — Ancestral Humanity Anonymous" width="220" />

# Ayni

**Hermandades de membresía anónimas y autogobernadas en Solana — soulbound, privadas con ZK, sin dueño.**

Marco abierto para DAOs de membresía de hermandades con votación anónima de conocimiento cero y
credenciales de linaje divulgables de forma selectiva.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](../LICENSE)
[![Anchor](https://img.shields.io/badge/Anchor-0.31.1-512BD4)](https://www.anchor-lang.com/)
[![Solana](https://img.shields.io/badge/Solana-2.x-14F195)](https://solana.com/)
[![Circom](https://img.shields.io/badge/Circom-2.1-orange)](https://docs.circom.io/)
[![Status](https://img.shields.io/badge/status-research%2Fpre--audit-yellow)](../BACKLOG.md)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#-contribuir)

🌍 [Other languages](README.md) · [English](../README.md)

</div>

---

## ¿Qué es Ayni?

Ayni es la implementación en Solana de una **Organización Autónoma Descentralizada (DAO) anónima** —
diseñada originalmente para satisfacer las necesidades de **AHA (Ancestral Humanity Anonymous)**, pero
abierta a cualquier organización. En su esencia es una plantilla agnóstica de cadena para hermandades
mundiales, inspirada en el éxito centenario de las **tradiciones de AA / 12 pasos**. Le da a cualquier
grupo una forma lista para usar de **admitir miembros, mantener una tesorería, decidir por conciencia
de grupo y recuperarse de la pérdida de llaves** — mientras cada miembro permanece **anónimo por
defecto** mediante pruebas de conocimiento cero.

- **Qué hace** — opera una hermandad de membresía on-chain: membresías anuales soulbound,
  un-miembro-un-voto anónimo, una tesorería de solo donaciones, y un Consejo de 7 asientos con
  recuperación de llaves 4-de-7 — sin dueño, sin llave de administrador.
- **Para quién es** — hermandades, grupos de ayuda mutua, comunidades anónimas, DAOs que buscan
  *pertenencia* en vez de especulación, y cualquiera que necesite **privacidad real** para sus miembros.
- **Cómo usarlo** — bifurca la plantilla, conforma un Consejo, abre un Círculo, y los miembros se unen
  como compromisos privados. Ver [Inicio rápido](#-inicio-rápido).

> *Ayni* (Quechua): la reciprocidad sagrada de dar y recibir — auto-sostenimiento, un miembro una
> voz, sin dueño central.

---

## ✨ Características

- 🪪 **Membresía soulbound** — anual, no transferible. La pertenencia se gana y se renueva, nunca
  se compra ni se vende.
- 🕶️ **Anónimo por defecto** — un miembro es un compromiso privado en un conjunto Merkle, no una
  billetera visible. La votación y las credenciales son de conocimiento cero; la identidad se revela
  solo por elección propia.
- 🗳️ **Votación por conciencia de grupo** — un miembro, un voto, emitido anónimamente (sin
  plutocracia ponderada por tokens), con un nulificador por propuesta que impide los votos dobles.
- 🏛️ **Sin dueño, sin llave de administrador** — el Consejo de 7 asientos *es* la autoridad y actúa
  solo por **4-de-7**.
- 🔑 **Recuperación de llaves que sobrevive a la pérdida** — rota un asiento o migra cada artefacto de
  una billetera perdida a una nueva, tras una ventana de impugnación que cualquier asiento honesto
  puede activar por sí solo.
- 🌱 **Círculos bifurcables** — cualquier grupo levanta un nuevo Círculo con gobernanza idéntica; el
  Círculo de Servicio Mundial coordina el material compartido, no gobierna.
- 📜 **Credenciales de divulgación selectiva** — certificados de curso/iniciación ("quién, qué curso,
  enseñado por quién, cuándo") abiertos *campo por campo* en conocimiento cero.

---

## 💡 Cómo encaja todo

Léelo como un árbol — las personas son la copa en lo alto, los Círculos son las
ramas, y el Círculo de Servicio Mundial es el tronco y las raíces en la base:

```
 member member member      member member member      member member member     ← los miembros
 (anon) (anon) (anon)      (anon) (anon) (anon)      (anon) (anon) (anon)         (anónimos,
    \      |      /          \      |      /          \      |      /              un miembro,
     ┌─────┬─────┐            ┌─────┬─────┐            ┌─────┬─────┐               un voto)
     │   Cusco   │            │  Lisbon   │            │  Bangkok  │
     │ Council 7 │            │ Council 7 │            │ Council 7 │   …        ← Círculos: las
     └─────┴─────┘            └─────┴─────┘            └─────┴─────┘               ramas
           └────────────────────────┬────────────────────────┘
                                    │   cada Círculo se bifurca de una plantilla compartida
                     ┌───────────────┴───────────────┐
                     │     WORLD SERVICE CIRCLE       │   ← el tronco / raíz ("fundación"):
                     │   12 Steps · Preamble · docs   │      mantiene la plantilla compartida + un
                     │    7-seat Council · 4-of-7     │      Consejo (4/7) que coordina
                     └───────────────────────────────┘      pero NO gobierna
```

- **Miembros (la copa)** — cada uno se une al conjunto de miembros de un Círculo como un compromiso
  anónimo y actúa mediante pruebas; nunca necesita exponer una billetera. Un miembro, un voto.
- **Círculos (las ramas)** — grupos locales autónomos, cada uno con su propio Consejo de 7 asientos,
  tesorería y votos; bifurcados de la plantilla.
- **Círculo de Servicio Mundial (el tronco/raíz)** — mantiene la plantilla y los documentos
  compartidos y coordina la creación de Círculos, pero **no** anula la conciencia de grupo local. El
  vínculo es un *enlace de federación*, no una cadena de mando.

## 🎩 Quién hace qué — el Consejo de 7 asientos

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

- **Sin llave de administrador.** Cada acción privilegiada es un deber de asiento del Consejo o una
  propuesta 4-de-7.
- **Los servidores sirven, los miembros deciden.** Los deberes rutinarios se delegan a un asiento y
  son revocables mediante la rotación del Consejo; la dirección la fija el voto de los miembros.

---

## 📖 Uso y ejemplos

Los cuatro tipos de decisión que Ayni admite, y dónde vive cada uno:

| Decisión | Quién vota | Mecanismo |
|---|---|---|
| **Asunto local** (negocios propios de un Círculo) | los miembros de ese Círculo | voto de miembro ZK anónimo |
| **Carta fundacional** (p. ej. los "12 Pasos") | solo llaves a nivel de fundación | voto de miembro/Consejo del Servicio Mundial |
| **Texto compartido** (p. ej. el Preámbulo sugerido) | **todos** los Círculos + la fundación | voto agregado a nivel de federación |
| **Recuperación / tesorería** | el Consejo de 7 asientos | propuesta 4-de-7 + ventana de impugnación |

Recorridos trabajados y copiables para todos estos están en **[IMPLEMENTATION.md](../IMPLEMENTATION.md)**.

<div align="center">
  <img src="../images/BluePrint.png" alt="Ayni — blueprint" width="880" />
</div>

---

## 🚀 Inicio rápido

> Requisitos previos: **Rust**, **Solana/Agave CLI 2.x**, **Anchor 0.31.1**, **Node 20+**, y (para
> pruebas) **circom 2.1** + **snarkjs**.

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

Esa es toda la primera ejecución. Las pruebas levantan un Círculo, emiten membresías anónimas,
ejecutan una recuperación 4-de-7, y verifican una prueba de voto Groth16 real on-chain (y rechazan un
nulificador reproducido).

Para levantar tu propia hermandad y ejecutar los cuatro tipos de voto, sigue
**[IMPLEMENTATION.md](../IMPLEMENTATION.md)** paso a paso.

---

## 🗺️ Hoja de ruta

- [x] Ciclo de vida de membresía soulbound + Consejo de 7 asientos (4-de-7)
- [x] Votación anónima de miembros ZK (ida y vuelta Groth16 real, on-chain)
- [x] Concesiones de linaje ZK + reconocimientos de divulgación selectiva
- [x] Recuperación de llaves: rotación de asiento + migración de billetera con ventana de impugnación
- [x] Revisión de seguridad + correcciones críticas/altas (ver [SECURITY_REVIEW.md](../SECURITY_REVIEW.md))
- [ ] Agregación de votación a nivel de federación (entre Círculos)
- [ ] Ceremonia de configuración confiable multipartita de producción (reemplazar las llaves de desarrollo)
- [ ] Votación resistente a la coerción (estilo MACI)
- [ ] Mint soulbound Token-2022 cableado de extremo a extremo
- [ ] Auditoría externa

Backlog completo: [BACKLOG.md](../BACKLOG.md).

---

## 🧭 Mapa del repositorio

| Ruta | Contenido |
|---|---|
| `PROJECT.md` | El modelo AHA agnóstico de cadena (el *qué* y el *por qué*). |
| `IMPLEMENTATION.md` | Runbook paso a paso: fundación → primer Círculo → los cuatro votos. |
| `programs/ayni/` | El programa Anchor — membresías, Consejo, votación ZK y linaje. |
| `circuits/` | Circuitos Circom: votación de miembros, concesiones de linaje, reconocimientos. |
| `docs/` | Análisis profundos: resiliencia, tesorería, votación, sybil, linaje ZK, reconocimientos. |
| `app/` | Ayudantes de prueba en TypeScript (árboles Merkle, generación de pruebas). |
| `SECURITY_REVIEW.md` | La revisión más reciente de concepto + seguridad y las correcciones aplicadas. |

---

## 🤝 Contribuir

Las contribuciones son bienvenidas — issues, PRs, y revisión de la criptografía especialmente.

1. Bifurca y crea una rama desde `solana` (la rama por defecto; otras cadenas viven en `ethereum`, `avalanche`).
2. `anchor build && anchor test` debe pasar.
3. Abre un PR describiendo el cambio y su impacto en la seguridad.

Buenos lugares para empezar están etiquetados como **`good first issue`**. Sean excelentes unos con
otros — ver [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md).

**Temas de GitHub sugeridos:** `solana` · `anchor` · `zero-knowledge` · `zk-snarks` · `circom` ·
`dao` · `governance` · `soulbound` · `privacy` · `anonymous-voting` · `groth16`

---

## ⚠️ Estado y seguridad

Investigación / **pre-auditoría**. La capa de anonimato ZK y la recuperación 4-de-7 están
implementadas y probadas en localnet. **No usar en producción** sin una ceremonia de configuración
confiable multipartita real y una auditoría externa. Revisión más reciente y correcciones aplicadas:
[SECURITY_REVIEW.md](../SECURITY_REVIEW.md).

## 📄 Licencia

[GNU AGPL-3.0](../LICENSE) © los contribuyentes de Ayni / AHA. El uso en red es distribución: si
ejecutas un Ayni modificado como servicio, debes compartir tu código fuente bajo la misma licencia.

---

<div align="center">

Si el modelo de Ayni de **hermandad anónima y sin dueño** resuena contigo, ⭐ **dale una estrella al
repositorio** para seguirlo — ayuda a que otros lo encuentren.

</div>

<div align="center">
  <img src="../images/Model.png" alt="AHA / Ayni — the full model" width="920" />
</div>
