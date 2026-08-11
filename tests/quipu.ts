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

  it("maps steps to the alchemical sequence (provisional boundaries)", () => {
    assert.equal(stageOf(1), "nigredo");
    assert.equal(stageOf(2), "nigredo");
    assert.equal(stageOf(5), "albedo");
    assert.equal(stageOf(8), "citrinitas");
    assert.equal(stageOf(9), "citrinitas");
    assert.equal(stageOf(12), "rubedo");
    // the whole 1..=12 range yields a colour, none undefined
    for (let s = 1; s <= 12; s++) assert.isString(colourOf(s).hex);
  });
});
