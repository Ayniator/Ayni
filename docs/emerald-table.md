# The Emerald correspondence table — steps, stages, dyes, hexes

The historical Emerald Tablet carries no colour column — that honesty stands
(see `docs/quipu.md`). This table is the fellowship's **own** correspondence:
the twelve steps laid against the five alchemical stages settled in v0.2, the
traditional dye each stage wears, and one reference hex per step. The stage
boundaries are final and match `stageOf()` in `frontend/lib/quipu.ts` exactly;
the hexes are **editorial** — researched approximations of the settled dyes on
wool, good enough to render honestly today, standing only until yarn is
sampled or the fellowship ratifies its own values.

Within a stage the cords come from **one dyepot**, so the hex repeats within a
stage by design — a stage is a dye lot, not a gradient. Step 5 alone is a
three-strand ply and takes stops, not a single hex.

## The table

| Step | Stage | Correspondence | Dye | Hex |
|---|---|---|---|---|
| 1 | nigredo | The admission — prima materia; the work begins in the dark | iron-tannate black | `#26211d` |
| 2 | nigredo | Coming to believe — a light sensed inside the blackening, not yet seen | iron-tannate black | `#26211d` |
| 3 | nigredo | The decision, the surrender — solutio, the old will dissolved | iron-tannate black | `#26211d` |
| 4 | nigredo | The moral inventory — the encounter with the shadow; putrefactio, the deepest black | iron-tannate black | `#26211d` |
| 5 | cauda pavonis | The admission witnessed by another — the peacock's tail, the first sign the work is alive | indigo · cochineal · weld (3-strand ply) | stops `#31507c` · `#a02440` · `#d8b52c` |
| 6 | albedo | Entirely ready — ablutio, the washing begins | undyed scoured wool | `#ece5d4` |
| 7 | albedo | Humbly asked — the whitening completed; humility as purification | undyed scoured wool | `#ece5d4` |
| 8 | citrinitas | The list and the willingness — the dawning; the yellowing toward the sun | weld yellow | `#d8b52c` |
| 9 | citrinitas | Amends made — the solar work carried out into the world | weld yellow | `#d8b52c` |
| 10 | rubedo | Continued inventory — the reddening; the work made daily practice | madder red | `#a6402c` |
| 11 | rubedo | Prayer and meditation — coniunctio; conscious contact | madder red | `#a6402c` |
| 12 | rubedo | The awakening carried to others — the stone that tinges; multiplicatio | madder red | `#a6402c` |

## Sources and rationale — which tradition each hex approximates

Every value approximates the settled dye **on mordanted wool in daylight**, not
a screen ideal. Natural dyes never reach the extremes a monitor can — no
absolute black, no pure white, no neon — and the hexes respect that.

- **Iron-tannate black — `#26211d`.** Tannin (oak gall or logwood) struck with
  ferrous sulphate: the iron-gall tradition. On wool it is a warm, very dark
  charcoal with a brown undertone — never `#000000`. The value sits just off
  pure black so the four nigredo cords read as fibre, not void, against a dark
  theme.
- **Indigo (cauda strand) — `#31507c`.** Woad/indigo vat blue at moderate
  depth (two to three dips): a muted, grey-blue mid-tone, not a saturated
  royal blue. Also the ply's lead stop, hence `repHex()` for step 5.
- **Cochineal (cauda strand) — `#a02440`.** Carminic acid on alum: a cool,
  blue-leaning crimson. Deliberately distinct from madder — the necklace
  carries two reds from two different dyes, and they must read differently.
- **Weld (citrinitas, and cauda strand) — `#d8b52c`.** Reseda luteola
  (luteolin) on alum: the clearest **lightfast** natural yellow, which is why
  it is the yellow here at all — turmeric and safflower are excluded as
  fugitive (hard constraint, `docs/quipu.md`). The cauda ply's yellow strand
  and the citrinitas cords come from the same dyepot, so they share one hex by
  design.
- **Undyed scoured wool (albedo) — `#ece5d4`.** No dye: fleece with the
  lanolin scoured out, unbleached. A warm ivory — natural wool white is never
  `#ffffff`, and the albedo should look like wool, not like paper.
- **Madder (rubedo) — `#a6402c`.** Rubia tinctorum (alizarin) on alum: the
  warm brick-to-Turkey red, orange-leaning where cochineal is blue-leaning.

## Status

**Editorial reference values (2026-08-11) — dye-sampled or fellowship-ratified
values supersede these; the protocol in docs/quipu.md §(dye sampling) still
applies.** These hexes were chosen from the dye literature, not from yarn;
`HEXES_ARE_PROVISIONAL` in `frontend/lib/quipu.ts` stays `true` until the five
sample cords are dyed, photographed, and sampled per that protocol — at which
point the measured values replace these in `STAGE_PAINT` and in this table, and
the flag flips.
