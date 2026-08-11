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

Five stages, walked as the twelve steps are walked. The **boundaries are final**
(settled v0.2) and ship now; only the exact **hex values** stay provisional, for
the reason given below.

| Steps | Stage | Cords | Dye | Paint |
|---|---|---|---|---|
| 1–4 | nigredo | 4 | iron-tannate black | solid |
| 5 | **cauda pavonis** | 1 | indigo · cochineal · weld (3-strand ply) | **iridescent** |
| 6–7 | albedo | 2 | undyed scoured wool | solid |
| 8–9 | citrinitas | 2 | weld yellow | solid |
| 10–12 | rubedo | 3 | madder red | solid |

Two boundaries differ from the epic's earlier hedged text, both deliberate:

- **The moral inventory (step 4) stays in the nigredo.** In Jungian terms the
  inventory is the encounter with the shadow, the putrefaction — the blackening,
  not the whitening. The necklace stays dark for four cords. (The earlier text
  started albedo at step 3, which would have whitened the inventory; that
  inverts the operation.)
- **Step 5 is cauda pavonis on its own** — the peacock's tail, the iridescence
  at the end of the blackening, the first sign the work is alive. Step 5 is the
  only step whose defining feature is being *witnessed by another person*, the
  hinge the whole program turns on. It earns its own colour, and that colour is
  iridescent — hence a three-strand ply, not a single dip, and a gradient in the
  render rather than a flat stroke (`StagePaint = solid | iridescent` in
  `frontend/lib/quipu.ts`).

A pleasing accident: the four solid stages land exactly on the four classic
natural-dye families.

### The hex values — sampled from yarn, not chosen on a monitor

The hexes remain provisional **on purpose**, not for lack of a table. A cord is
a physical object a member wears for life; the render exists to *depict* it, so
the colour must be taken from the dyed yarn — choose the hex from the yarn, never
the yarn from the hex. The values in `STAGE_PAINT` today are the **editorial
reference values** from the Emerald correspondence table
(`docs/emerald-table.md`, 2026-08-11) — researched approximations of the
settled dyes on mordanted wool, per step and stage, with sources.
`HEXES_ARE_PROVISIONAL` stays true until real samples (or a fellowship vote)
replace them, and that flag now covers **only** the hexes (the boundaries are
done).

**Excluded, hard constraint:** turmeric and safflower — however good the first
dip looks, they fade to nothing in a couple of years, disqualifying for an object
worn for life.

**Sampling protocol (the one remaining physical task):** dye five sample cords
(the four solids + the cauda ply); photograph all five in one frame in
north-facing daylight against a grey card; shoot RAW; white-balance off the card;
sample a 20×20-pixel average from each cord. Put those five values (four hexes +
the cauda's strand stops) into `STAGE_PAINT` — nothing else changes.

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
- ✅ Stage **boundaries** final (five stages incl. cauda pavonis).
- 🟡 Colour **hex values** editorial — the Emerald correspondence table now
  lives in `docs/emerald-table.md` (the historical tablet never had a colour
  column, so the fellowship wrote its own): editorial reference values
  (2026-08-11), loaded into `STAGE_PAINT`. Dye-sampled or fellowship-ratified
  values supersede them; the sampling protocol above still applies (the only
  remaining physical task).
- ⬜ The rendered necklace on the member page is **Epic 4** (the Quipu Page).
