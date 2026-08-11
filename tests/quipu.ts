import { assert } from "chai";
import { toKnots, fromKnots, knotDateLabel, stageOf, colourOf } from "../frontend/lib/quipu";

// Epic 3/4 — the knot-date codec and colour mapping are pure functions; test
// them headless (no validator). The codec must round-trip and the reading guide
// in docs/quipu.md must match the encoding.
describe("quipu — knot-date codec + colours", () => {
  const at = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 1000;

  it("encodes a date as [y10,y1,m10,m1,d10,d1] clusters (the guide's scheme)", () => {
    // 2026-03-21 → year 26, month 03, day 21
    assert.deepEqual(toKnots(at(2026, 3, 21)).clusters, [2, 6, 0, 3, 2, 1]);
  });

  it("round-trips encode → decode for a range of dates", () => {
    for (const [y, m, d] of [[2026, 1, 1], [2026, 3, 21], [2030, 12, 31], [2099, 10, 9]] as const) {
      const back = fromKnots(toKnots(at(y, m, d)));
      assert.deepEqual(back, { year: y, month: m, day: d }, `${y}-${m}-${d}`);
    }
  });

  it("labels a knot-date as YYYY-MM-DD", () => {
    assert.equal(knotDateLabel(toKnots(at(2026, 3, 21))), "2026-03-21");
    assert.equal(knotDateLabel(toKnots(at(2027, 1, 5))), "2027-01-05");
  });

  it("maps steps to the five alchemical stages (final boundaries)", () => {
    // nigredo 1–4 (the moral inventory at step 4 stays in the blackening)
    assert.equal(stageOf(1), "nigredo");
    assert.equal(stageOf(4), "nigredo");
    // cauda pavonis 5 — the peacock's tail, on its own
    assert.equal(stageOf(5), "cauda_pavonis");
    // albedo 6–7, citrinitas 8–9, rubedo 10–12
    assert.equal(stageOf(6), "albedo");
    assert.equal(stageOf(7), "albedo");
    assert.equal(stageOf(8), "citrinitas");
    assert.equal(stageOf(9), "citrinitas");
    assert.equal(stageOf(12), "rubedo");
  });

  it("paints every step; step 5 is iridescent, the rest solid", () => {
    for (let s = 1; s <= 12; s++) {
      const paint = colourOf(s).paint;
      if (s === 5) {
        assert.equal(paint.kind, "iridescent");
        if (paint.kind === "iridescent") assert.isAtLeast(paint.stops.length, 2);
      } else {
        assert.equal(paint.kind, "solid");
        if (paint.kind === "solid") assert.match(paint.hex, /^#[0-9a-fA-F]{6}$/);
      }
    }
  });
});
