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
// PROVISIONAL MAPPING. The alchemical sequence (nigredo → albedo → citrinitas
// → rubedo) is fixed; the exact step boundaries and the precise colour values
// must be confirmed against the **Emerald correspondence table** (Epic 3
// "Depends on: Emerald correspondence table — needs the color column
// confirmed"). That table is not yet in the repo. The stage boundaries below
// follow the epic's own text ("nigredo black (Steps 1–2), albedo white (middle
// steps), citrinitas yellow (≈8–9), rubedo red (10–12)"); the hex values are
// placeholders chosen to read correctly in both themes. When the table lands,
// change ONLY this block — nothing else depends on the specific values.

export type AlchemicalStage = "nigredo" | "albedo" | "citrinitas" | "rubedo";

export interface StepColour {
  stage: AlchemicalStage;
  /** Human name of the stage's colour. */
  name: string;
  /** Placeholder hex — REPLACE from the Emerald table. */
  hex: string;
}

/** The stage a step belongs to (provisional boundaries — see note above). */
export function stageOf(step: number): AlchemicalStage {
  if (step <= 2) return "nigredo";
  if (step <= 7) return "albedo";
  if (step <= 9) return "citrinitas";
  return "rubedo";
}

const STAGE_COLOUR: Record<AlchemicalStage, StepColour> = {
  nigredo: { stage: "nigredo", name: "black", hex: "#1a1a1a" },
  albedo: { stage: "albedo", name: "white", hex: "#f2f0ea" },
  citrinitas: { stage: "citrinitas", name: "yellow", hex: "#e6b800" },
  rubedo: { stage: "rubedo", name: "red", hex: "#a01818" },
};

/** The cord colour for a step (1..=12). Provisional until the Emerald table. */
export function colourOf(step: number): StepColour {
  return STAGE_COLOUR[stageOf(step)];
}

/** True while the Emerald table is unconfirmed — the UI shows a quiet note. */
export const COLOURS_ARE_PROVISIONAL = true;

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
