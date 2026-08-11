// The Quipu (Trust Platform Epic 3) — cord colours + Inca-style knot-dates.
//
// A quipu is the member's knotted-cord record: one pendant cord per completed
// step of the twelve, coloured by the step's alchemical stage, with the
// completion date encoded as knot clusters. This module holds the two pieces of
// logic the physical cord and the digital rendering (Epic 4) share: which
// colour a step wears, and how a date becomes (and un-becomes) knots.
//
// NON-COMPARATIVE BY DESIGN (Traditions T11/T12): there is deliberately no
// "progress", no fraction, no "N of 12", no total, no comparison anywhere in this module.
// A member either has a cord for a step or does not — binary and personal.
// The newcomer wears the bare necklace cord: a beginning, not an absence.

export const FIRST_STEP = 1;
export const LAST_STEP = 12;

// --- alchemical colours ----------------------------------------------------
//
// The stage BOUNDARIES are FINAL (settled by ElectaZ, v0.2) — five stages, not
// four, and the moral inventory (step 4) stays in the nigredo where it belongs
// (the encounter with the shadow, the putrefaction — not the whitening), and
// step 5 becomes cauda pavonis on its own: the peacock's tail, the iridescence
// at the end of the blackening, the first sign the work is alive. Step 5 is the
// only step whose defining feature is being witnessed by another, the hinge the
// program turns on — it earns its own colour.
//
//   nigredo        steps 1–4    iron-tannate black       (solid)
//   cauda pavonis  step  5      indigo·cochineal·weld ply (iridescent)
//   albedo         steps 6–7    undyed scoured wool        (solid)
//   citrinitas     steps 8–9    weld yellow                (solid)
//   rubedo         steps 10–12  madder red                 (solid)
//
// The HEX VALUES remain provisional — deliberately. A cord is a physical
// object worn for life; the render exists to depict it, so the hex must
// ultimately be sampled from the DYED YARN, never chosen on a monitor. The
// values below are the EDITORIAL REFERENCE VALUES from the Emerald
// correspondence table (docs/emerald-table.md, 2026-08-11) — researched
// approximations of the settled dyes on mordanted wool. Dye-sampled or
// fellowship-ratified values supersede them; the sampling protocol lives in
// docs/quipu.md. When the yarn is sampled, change ONLY the hex/stops in
// STAGE_PAINT (and the table) — the boundaries, the renderer, and everything
// else stay put.

export type AlchemicalStage = "nigredo" | "cauda_pavonis" | "albedo" | "citrinitas" | "rubedo";

/** How a cord is painted. Solid stages are a flat stroke; cauda pavonis is
 *  iridescent (a three-strand ply of indigo, cochineal and weld — iridescence
 *  cannot come from a single dip), so it needs a gradient, not one hex. */
export type StagePaint =
  | { kind: "solid"; hex: string }
  | { kind: "iridescent"; stops: string[] };

export interface StepColour {
  stage: AlchemicalStage;
  /** Human name of the stage's colour. */
  name: string;
  paint: StagePaint;
}

/** The stage a step belongs to. Boundaries are FINAL. */
export function stageOf(step: number): AlchemicalStage {
  if (step <= 4) return "nigredo";
  if (step === 5) return "cauda_pavonis";
  if (step <= 7) return "albedo";
  if (step <= 9) return "citrinitas";
  return "rubedo";
}

const STAGE_PAINT: Record<AlchemicalStage, StepColour> = {
  // Editorial reference hexes (docs/emerald-table.md) — dye samples supersede.
  // Iron-gall black on wool: warm charcoal, never absolute black.
  nigredo: { stage: "nigredo", name: "iron-tannate black", paint: { kind: "solid", hex: "#26211d" } },
  cauda_pavonis: {
    stage: "cauda_pavonis",
    name: "peacock's tail (indigo·cochineal·weld)",
    // Mid-vat indigo · cochineal crimson (cool, alum) · weld gold, wrapping
    // back to indigo. The weld stop equals the citrinitas hex (same dyepot);
    // the cochineal stop is deliberately NOT the rubedo madder — two reds,
    // two dyes, and they must read differently.
    paint: { kind: "iridescent", stops: ["#31507c", "#a02440", "#d8b52c", "#31507c"] },
  },
  // Scoured, unbleached fleece: warm ivory — wool, not paper.
  albedo: { stage: "albedo", name: "undyed scoured wool", paint: { kind: "solid", hex: "#ece5d4" } },
  // Weld (luteolin) on alum: the clearest lightfast natural yellow.
  citrinitas: { stage: "citrinitas", name: "weld yellow", paint: { kind: "solid", hex: "#d8b52c" } },
  // Madder (alizarin) on alum: warm brick red, orange-leaning.
  rubedo: { stage: "rubedo", name: "madder red", paint: { kind: "solid", hex: "#a6402c" } },
};

/** The cord colour for a step (1..=12). Boundaries final; hexes provisional. */
export function colourOf(step: number): StepColour {
  return STAGE_PAINT[stageOf(step)];
}

/** A single representative hex for a stage (for knots, legends, swatches).
 *  Solid stages return their hex; the iridescent stage returns its lead stop. */
export function repHex(c: StepColour): string {
  return c.paint.kind === "solid" ? c.paint.hex : c.paint.stops[0];
}

/** Boundaries are final and ship now. The hex values are the editorial
 *  reference values from docs/emerald-table.md (2026-08-11) — still
 *  provisional until physical dye samples or a fellowship vote replace them,
 *  per the protocol in docs/quipu.md. */
export const HEXES_ARE_PROVISIONAL = true;

// --- knot-dates (Inca quipu positional knots) -------------------------------
//
// A date is encoded as three pendant clusters — year, month, day — read top to
// bottom. Each cluster is the decimal digits of the number, most-significant
// nearest the main cord, exactly as an Inca quipu encodes base-10 positional
// values: a digit d is a cluster of d knots (and 0 is an empty gap on the
// cord). The year is encoded modulo 100 (the fellowship's dates need no
// century), so every date is at most 2 + 2 + 2 = 6 clusters. This is the scheme
// the one-page reading guide in docs/quipu.md teaches.

export interface KnotDate {
  /** Digit clusters, main-cord end first: [y10, y1, m10, m1, d10, d1]. */
  clusters: number[];
}

/** Encode a unix seconds timestamp as knot-date clusters (UTC). */
export function toKnots(unixSeconds: number): KnotDate {
  const d = new Date(unixSeconds * 1000);
  const yy = d.getUTCFullYear() % 100;
  const mm = d.getUTCMonth() + 1;
  const dd = d.getUTCDate();
  const digits = (n: number) => [Math.floor(n / 10), n % 10];
  return { clusters: [...digits(yy), ...digits(mm), ...digits(dd)] };
}

/** Read knot-date clusters back to {year20xx, month, day}. Inverse of toKnots. */
export function fromKnots(k: KnotDate): { year: number; month: number; day: number } {
  const [y10, y1, m10, m1, d10, d1] = k.clusters;
  return { year: 2000 + y10 * 10 + y1, month: m10 * 10 + m1, day: d10 * 10 + d1 };
}

/** A short human label for a knot-date (for tooltips / the reading guide). */
export function knotDateLabel(k: KnotDate): string {
  const { year, month, day } = fromKnots(k);
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

// --- the cord model (fed by the on-chain QuipuCord accounts) ----------------

export interface Cord {
  step: number; // 1..=12
  completedAt: number; // unix seconds
  sponsor: string; // tying sponsor's commitment (hex) — shown only per visibility rules
}

/** Order a member's cords as they hang: step order, top to bottom. Never
 *  summed, never compared — just the cords that exist, in sequence. */
export function hangCords(cords: Cord[]): Cord[] {
  return [...cords].sort((a, b) => a.step - b.step);
}
