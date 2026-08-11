"use client";

// The rendered quipu (Trust Platform Epic 4) — the member's necklace as it
// hangs: a main cord with one pendant per completed step, coloured by the step's
// alchemical stage, each carrying its completion date as Inca-style knot
// clusters. A newcomer with no cords wears the bare necklace cord — a beginning,
// not an absence.
//
// DELIBERATELY NOT HERE (Traditions T11/T12, and the Epic 4 spec): no fraction,
// no "N of 12", no percentage, no progress bar, no star, no score, no count.
// The necklace shows the cords that exist, in step order — nothing summed,
// nothing compared. This is asserted at the DOM level by the Sentinel checklist.

import { Cord, colourOf, hangCords, toKnots, knotDateLabel, COLOURS_ARE_PROVISIONAL } from "../lib/quipu";

export default function QuipuNecklace({ cords, height = 150 }: { cords: Cord[]; height?: number }) {
  const hung = hangCords(cords);

  // Layout: a horizontal main cord; pendants drop from evenly spaced anchors.
  const padX = 18;
  const topY = 20;
  const width = Math.max(220, padX * 2 + Math.max(1, hung.length) * 34);
  const mainY = topY;
  const cordLen = height - topY - 24;

  return (
    <figure style={{ margin: 0 }} aria-label="Quipu necklace">
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img"
        aria-label={hung.length === 0 ? "A bare necklace cord — a beginning" : `${hung.length} cords`}>
        {/* the main cord */}
        <line x1={padX} y1={mainY} x2={width - padX} y2={mainY} stroke="var(--muted, #8a8578)" strokeWidth={3} strokeLinecap="round" />

        {hung.length === 0 && (
          <text x={width / 2} y={height / 2} textAnchor="middle" fontSize="12" fill="var(--muted, #8a8578)">
            a bare cord — a beginning
          </text>
        )}

        {hung.map((c, i) => {
          const x = padX + 16 + i * 34;
          const col = colourOf(c.step);
          const knots = toKnots(c.completedAt).clusters;
          const knotGap = cordLen / 8;
          return (
            <g key={c.step}>
              <line x1={x} y1={mainY} x2={x} y2={mainY + cordLen} stroke={col.hex} strokeWidth={4} strokeLinecap="round">
                <title>{`Step ${c.step} — ${col.name} (${col.stage}) — ${knotDateLabel(toKnots(c.completedAt))}`}</title>
              </line>
              {/* the date, as knot clusters down the pendant */}
              {knots.map((d, k) => {
                const cy = mainY + (k + 1) * knotGap;
                // a digit d is a cluster of d knots; 0 is a plain gap (no knot)
                return Array.from({ length: d }).map((_, j) => (
                  <circle key={`${k}-${j}`} cx={x} cy={cy - j * 2.4} r={1.7} fill={col.hex} stroke="var(--bg, #fff)" strokeWidth={0.4} />
                ));
              })}
              {/* the step numeral sits at the cord foot — the ONLY number, and it
                  names WHICH step, never how many of twelve */}
              <text x={x} y={mainY + cordLen + 12} textAnchor="middle" fontSize="9" fill="var(--muted, #8a8578)">{c.step}</text>
            </g>
          );
        })}
      </svg>
      {COLOURS_ARE_PROVISIONAL && hung.length > 0 && (
        <figcaption style={{ fontSize: 11, color: "var(--muted, #8a8578)", marginTop: 2 }}>
          Colours provisional — pending the Emerald correspondence table.
        </figcaption>
      )}
    </figure>
  );
}
