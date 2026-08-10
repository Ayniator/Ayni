# Ayni — the Quipu (Trust Platform Epic 3)

A knotted-cord milestone record: **one pendant cord per completed step of the
twelve**, coloured by the step's alchemical stage, with the completion date
encoded as Inca-style knot clusters. A mystery worn in public — legible only to
taught hands — which suits Tradition 11 (attraction, not promotion).

> **Non-comparative by design.** The quipu has no score, no fraction, no
> "N of 12", no total, no progress bar — anywhere, on-chain or on-screen. A
> member either has a cord for a step or does not: binary and personal, nothing
> to compare or game (T11, T12). The newcomer wears the **bare necklace cord** —
> presented as a beginning, not an absence.

## The three layers

| Layer | Where | What |
|---|---|---|
| The cord record | on-chain: `QuipuCord`, `tie_quipu_cord` | which step, when, tied by which sponsor (all anonymous — commitments, not names) |
| Colour + knot logic | `frontend/lib/quipu.ts` | the step→colour mapping and the date↔knots codec |
| The rendering | Epic 4 (the Quipu Page) | draws the cords as they hang — never a number |

## On-chain: one cord, tied by the sponsor

`tie_quipu_cord(step)` records a single completed step. The rite is the
sponsor's closing act — **the sponsor ties the knot, not the wearer** — so the
instruction is signed by the member's designated **wing** (their `WingPeer`
sponsor bond), never by the member themselves:

- `step` must be `1..=12` (`InvalidStep` otherwise).
- The signer must hold a key of the sponsor's membership, in good standing
  (`expires_at > now`).
- The sponsor must be the member's active wing, and cannot be the member
  (`SelfAttestation` / `NotParrain`).
- One cord per `(member, step)`: the PDA `["quipu", circle, member, step]` — its
  `init` collision is the refusal of a second.

The account stores only `member`, `step`, `sponsor` (all membership
commitments), and `completed_at`. **The colour is not stored** — it is derived
from `step` off-chain, so the mapping can be finalised without a chain change.

## Colours — the alchemical sequence

The stages are fixed: **nigredo → albedo → citrinitas → rubedo** (black →
white → yellow → red), the classical alchemical opus, walked as the twelve
steps are walked.

> **⚠ Provisional — needs the Emerald correspondence table.** The exact step
> boundaries and the precise colour values must be confirmed against the
> **Emerald correspondence table** (Epic 3: *"Depends on: Emerald correspondence
> table — needs the color column confirmed"*). That table is **not yet in the
> repo.** The mapping below follows the epic's own text and is implemented in
> `frontend/lib/quipu.ts`; when the table lands, change **only** the colour
> block there — nothing else depends on the specific values.

| Steps | Stage | Colour (provisional) |
|---|---|---|
| 1–2 | nigredo | black |
| 3–7 | albedo | white |
| 8–9 | citrinitas | yellow |
| 10–12 | rubedo | red |

The one column that is genuinely blocked on the Emerald table is the **exact
colour value** (and any per-step distinction within a stage); the sequence and
the rough boundaries above are the epic's own and are safe to ship provisionally.

## Reading knot-dates (the one-page guide)

Each cord carries its completion date as **three pendant clusters — year,
month, day — read top to bottom**, in the Inca positional style: a digit *d* is
a cluster of *d* knots, and *0* is a plain gap on the cord. The most significant
digit hangs nearest the main cord.

```
main cord ═══╤═══╤═══╤═══╤═══╤═══
             │   │   │   │   │   └─ day  ones
             │   │   │   │   └───── day  tens
             │   │   │   └───────── month ones
             │   │   └───────────── month tens
             │   └───────────────── year ones   (of the year mod 100)
             └───────────────────── year tens
```

So a cord tied on **2026-03-21** reads, top to bottom: `2 6 · 0 3 · 2 1` —
year `26`, month `03`, day `21`. The year is kept modulo 100 (the fellowship's
dates need no century), so every date is at most six clusters.

`frontend/lib/quipu.ts` implements this exactly: `toKnots(unix)` produces the
six clusters `[y10, y1, m10, m1, d10, d1]` and `fromKnots(...)` reads them back —
a member can verify their own cords against the guide, and the renderer (Epic 4)
draws real knots from the same data.

## Traditions check

- **T11 (attraction, not promotion):** a record legible only to taught hands; a
  mystery worn, not advertised.
- **T12 (principles before personalities):** binary and personal; nothing summed,
  ranked, or compared. The bare cord makes a newcomer's necklace and an elder's
  necklace equal in kind.
- The sponsor ties the knot: the milestone is witnessed within the human
  sponsor bond, not issued by an authority as a grade.

## Status

- ✅ On-chain cord record (`QuipuCord` / `tie_quipu_cord`), sponsor-gated,
  one-per-step, 1..=12.
- ✅ Colour + knot-date logic (`frontend/lib/quipu.ts`), with the codec fully
  specified and tested.
- 🟡 Colour **values** provisional — awaiting the Emerald correspondence table
  (the only external dependency).
- ⬜ The rendered necklace on the member page is **Epic 4** (the Quipu Page).
