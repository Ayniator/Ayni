// Epic 6 / F62 — the stone-mark (symbolic avatar).
//
// A member's avatar is the digitized stone-mark from the Cavern Ceremony: a
// personal sign drawn inside an equilateral triangle. A MARK, not a face — a
// symbol, so that even the widest audience ("all members") stays
// anonymity-compatible. There is no photograph, ever.
//
// PRIVACY INVARIANT (F62). The mark is drawn on the member's own device, from
// the member's own hand, and is never derived from — nor stored beside — any
// biometric input. There is no camera path here, no file read, no upload, no
// network call anywhere in this module or in components/StoneMark.tsx. The only
// way a mark leaves the device is as the member's OWN avatar payload, on
// exactly the terms the photo avatar already has: stored locally under
// `aha:profile` / `aha:stonemark`, and disclosed only through Epic 5 (sealed
// under the avatar element key, revealed to the tier the member chose). The
// stroke geometry itself is never persisted or transmitted — only the rendered
// raster leaves this component, so the mark cannot be replayed as a signature
// dynamic (timing, pressure, velocity are all discarded at export).
//
// AUDIENCE: the stone-mark is disclosed ONLY under Epic 5's rules. Who may see
// it is the on-chain VisibilityPolicy.avatar tier (see lib/visibility.ts,
// getVisibility/mayView), enforced on the READ path by the trust page — never
// here, and never by default. This module only stores the owner's OWN mark on
// their OWN device and offers a neutral silhouette for the not-disclosed case.
//
// HIDDEN LOOKS LIKE A BARE PAGE (Epic 5): when a viewer isn't entitled to see a
// mark, the fallback is a plain empty triangle outline — the NEUTRAL_SILHOUETTE
// below. Never a lock icon, never a "hidden" badge: absence, not a padlock.
//
// Everything above the "canvas rendering" section is pure geometry/encoding with
// no DOM dependency, so tests/stonemark.test.mjs can exercise it under plain
// node. See docs/stonemark.md.

const KEY = "aha:stonemark";

/** A stable, tiny "not disclosed" placeholder: a bare equilateral-triangle
 *  outline on transparent ground. Deliberately NOT a lock — hidden must read as
 *  an empty page, per Epic 5. Handbuilt SVG so it needs no canvas/DOM and is
 *  safe to use during SSR. 96px box, centered triangle. */
export const NEUTRAL_SILHOUETTE: string = (() => {
  // apex up, equilateral, inset within a 96×96 box
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">` +
    `<polygon points="48,10 86,80 10,80" fill="none" stroke="#8a8a8a" ` +
    `stroke-width="3" stroke-linejoin="round" opacity="0.5"/>` +
    `</svg>`;
  // encodeURIComponent keeps this valid in both light/dark and avoids base64 bulk
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
})();

// ---------------------------------------------------------------------------
// Geometry — unit space
//
// A mark is a list of strokes; a stroke is a polyline of points in NORMALISED
// unit space ([0,1] × [0,1], y down), plus a normalised width (a fraction of
// the box edge). Nothing is stored in device pixels, so the same mark renders
// identically at 64px, 128px or 256px — which is what makes the export
// deterministic rather than a resample of whatever the screen happened to be.
// ---------------------------------------------------------------------------

export interface Pt {
  x: number;
  y: number;
}

export interface StoneStroke {
  /** Line width as a fraction of the box edge (see clampStrokeWidth). */
  w: number;
  /** Polyline in unit space. Every point is inside the triangle. */
  pts: Pt[];
}

/** The triangle is inset from the box edge by this fraction, so a thick stroke
 *  laid on the boundary is not shaved off by the canvas edge. */
export const TRIANGLE_INSET = 0.08;

/** Cheap by construction: a mark cannot grow without bound. Excess strokes are
 *  refused (the member must undo), and over-long strokes are decimated. */
export const MAX_STROKES = 96;
export const MAX_POINTS_PER_STROKE = 512;

/** Points closer together than this (in unit space) add nothing a human eye can
 *  see, and cost bytes and render time. Dropped at commit time. */
export const SIMPLIFY_MIN_DIST = 0.006;

/** Stroke width bounds, as a fraction of the box edge. At the 256px drawing
 *  resolution that is roughly 2px … 20px, default 6px. */
export const STROKE_W_MIN = 0.008;
export const STROKE_W_MAX = 0.078;
export const STROKE_W_DEFAULT = 0.0235;

export function clampStrokeWidth(w: number): number {
  if (!Number.isFinite(w)) return STROKE_W_DEFAULT;
  return Math.min(STROKE_W_MAX, Math.max(STROKE_W_MIN, w));
}

/** The three vertices of the apex-up equilateral triangle inscribed in the unit
 *  box, in order apex → right → left. */
export function triangleVertices(inset: number = TRIANGLE_INSET): [Pt, Pt, Pt] {
  const w = 1 - inset * 2;
  const h = (Math.sqrt(3) / 2) * w;
  const yTop = (1 - h) / 2;
  return [
    { x: 0.5, y: yTop },
    { x: 0.5 + w / 2, y: yTop + h },
    { x: 0.5 - w / 2, y: yTop + h },
  ];
}

const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;

/** Is a unit-space point inside (or exactly on) the triangle? */
export function insideTriangle(p: Pt, inset: number = TRIANGLE_INSET): boolean {
  const [a, b, c] = triangleVertices(inset);
  const d1 = cross(b.x - a.x, b.y - a.y, p.x - a.x, p.y - a.y);
  const d2 = cross(c.x - b.x, c.y - b.y, p.x - b.x, p.y - b.y);
  const d3 = cross(a.x - c.x, a.y - c.y, p.x - c.x, p.y - c.y);
  const neg = d1 < -1e-9 || d2 < -1e-9 || d3 < -1e-9;
  const pos = d1 > 1e-9 || d2 > 1e-9 || d3 > 1e-9;
  return !(neg && pos);
}

function closestOnSegment(p: Pt, a: Pt, b: Pt): Pt {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return { x: a.x, y: a.y };
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = Math.min(1, Math.max(0, t));
  return { x: a.x + t * vx, y: a.y + t * vy };
}

/** Nearest point of the triangle to `p`: `p` itself when it is already inside,
 *  otherwise its projection onto the nearest edge. The canvas also clips, but
 *  clamping means no geometry outside the stone is ever recorded — the triangle
 *  is a hard bound on the mark, not just a mask over it. */
export function clampToTriangle(p: Pt, inset: number = TRIANGLE_INSET): Pt {
  if (insideTriangle(p, inset)) return { x: p.x, y: p.y };
  const [a, b, c] = triangleVertices(inset);
  let best: Pt | null = null;
  let bestD = Infinity;
  for (const [s, e] of [[a, b], [b, c], [c, a]] as [Pt, Pt][]) {
    const q = closestOnSegment(p, s, e);
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return best!;
}

/** Drop points that are visually redundant, always keeping the first and last.
 *  Then decimate to MAX_POINTS_PER_STROKE if a very long drag survived. */
export function simplifyStroke(pts: Pt[], minDist: number = SIMPLIFY_MIN_DIST): Pt[] {
  if (pts.length <= 2) return pts.slice();
  const out: Pt[] = [pts[0]];
  const min2 = minDist * minDist;
  for (let i = 1; i < pts.length - 1; i++) {
    const last = out[out.length - 1];
    const d = (pts[i].x - last.x) ** 2 + (pts[i].y - last.y) ** 2;
    if (d >= min2) out.push(pts[i]);
  }
  out.push(pts[pts.length - 1]);
  if (out.length <= MAX_POINTS_PER_STROKE) return out;
  const step = out.length / (MAX_POINTS_PER_STROKE - 1);
  const thinned: Pt[] = [];
  for (let i = 0; i < MAX_POINTS_PER_STROKE - 1; i++) thinned.push(out[Math.floor(i * step)]);
  thinned.push(out[out.length - 1]);
  return thinned;
}

// ---------------------------------------------------------------------------
// Export encoding and the size cap
// ---------------------------------------------------------------------------

/** Drawing resolution and the export box. The mark is re-rendered from its
 *  stroke geometry at the export size — it is never a downscale of the screen
 *  canvas, so the result does not depend on the device pixel ratio. */
export const STONE_DRAW_PX = 256;
export const STONE_MARK_EXPORT_PX = 128;

/** HARD CAP on a stored stone-mark, measured as the UTF-8 byte length of the
 *  whole data URL — that is exactly what localStorage holds and what an Epic 5
 *  avatar payload has to carry. 24 KiB. Line art at 128px lands at 1–4 KiB, so
 *  the cap is ~6× headroom and only bites on pathological scribbling; the
 *  ladder below then trades resolution for bytes rather than failing.
 *  Documented in docs/stonemark.md. */
export const STONE_MARK_MAX_BYTES = 24 * 1024;

export interface ExportStep {
  px: number;
  type: "image/png" | "image/webp";
  quality?: number;
}

/** Tried in order; the first candidate at or under the cap wins. PNG first
 *  because flat line art compresses losslessly and stays crisp. */
export const STONE_MARK_LADDER: readonly ExportStep[] = [
  { px: STONE_MARK_EXPORT_PX, type: "image/png" },
  { px: STONE_MARK_EXPORT_PX, type: "image/webp", quality: 0.92 },
  { px: 96, type: "image/webp", quality: 0.85 },
  { px: 64, type: "image/webp", quality: 0.8 },
];

/** UTF-8 byte length of a string, without TextEncoder (works everywhere). */
export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++; // surrogate pair
    } else n += 3;
  }
  return n;
}

/** The stored/transmitted size of a data URL: the whole string, in bytes. */
export function dataUrlByteLength(dataUrl: string): number {
  return utf8Length(dataUrl);
}

/** Decoded payload size of a base64 data URL, in bytes (0 if not base64). */
export function dataUrlPayloadBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return 0;
  if (!/;base64/i.test(dataUrl.slice(0, comma))) return 0;
  const body = dataUrl.slice(comma + 1).replace(/=+$/, "");
  return Math.floor((body.length * 3) / 4);
}

/** First candidate within the cap; if none fits, the smallest one (so a save
 *  never silently fails). Returns undefined only for an empty list. */
export function pickWithinCap(
  candidates: string[],
  max: number = STONE_MARK_MAX_BYTES
): string | undefined {
  let smallest: string | undefined;
  let smallestBytes = Infinity;
  for (const c of candidates) {
    if (!c) continue;
    const n = dataUrlByteLength(c);
    if (n <= max) return c;
    if (n < smallestBytes) {
      smallestBytes = n;
      smallest = c;
    }
  }
  return smallest;
}

/** Guard for anything about to be written to the profile as a stone-mark: a
 *  raster data URL, base64, within the cap. Rejects SVG (it can carry script)
 *  and anything else that could ride in on the avatar slot. */
export function isStoneMarkDataUrl(value: unknown, max: number = STONE_MARK_MAX_BYTES): boolean {
  if (typeof value !== "string") return false;
  const m = /^data:image\/(png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!m) return false;
  return dataUrlByteLength(value) <= max;
}

// ---------------------------------------------------------------------------
// Canvas rendering
//
// Takes a 2D context and paints a mark from its geometry. Deterministic for a
// given (strokes, size, palette): no time, no randomness, no theme lookup — two
// members with the same strokes get the same pixels, and the mark looks the
// same in light and dark, on this device and on the viewer's.
// ---------------------------------------------------------------------------

/** Fixed palette. NOT theme-derived: the mark is a carved stone token, and it
 *  must render identically for whoever is entitled to see it. */
export const STONE_GROUND = "#efeae1";
export const STONE_INK = "#211d18";
export const STONE_FRAME = "#b6a992";

export interface RenderOpts {
  ground?: string | null;
  ink?: string;
  frame?: string | null;
  inset?: number;
}

function tracePath(ctx: CanvasRenderingContext2D, size: number, inset: number) {
  const [a, b, c] = triangleVertices(inset);
  ctx.beginPath();
  ctx.moveTo(a.x * size, a.y * size);
  ctx.lineTo(b.x * size, b.y * size);
  ctx.lineTo(c.x * size, c.y * size);
  ctx.closePath();
}

/** Paint `strokes` into a size×size box. Clears first, so it is safe to call on
 *  every change (the whole mark is re-rendered — that is what makes undo and
 *  clear trivially correct, with no layer stack to keep in sync). */
export function renderStoneMark(
  ctx: CanvasRenderingContext2D,
  size: number,
  strokes: StoneStroke[],
  opts: RenderOpts = {}
): void {
  const ground = opts.ground === undefined ? STONE_GROUND : opts.ground;
  const ink = opts.ink ?? STONE_INK;
  const frame = opts.frame === undefined ? STONE_FRAME : opts.frame;
  const inset = opts.inset ?? TRIANGLE_INSET;

  ctx.clearRect(0, 0, size, size);
  if (ground) {
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, size, size);
  }

  ctx.save();
  tracePath(ctx, size, inset);
  ctx.clip(); // ink stays inside the stone
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = ink;
  for (const s of strokes) {
    if (!s.pts.length) continue;
    ctx.lineWidth = Math.max(1, clampStrokeWidth(s.w) * size);
    ctx.beginPath();
    if (s.pts.length === 1) {
      // a tap is a dot: a zero-length round-capped segment
      ctx.moveTo(s.pts[0].x * size, s.pts[0].y * size);
      ctx.lineTo(s.pts[0].x * size, s.pts[0].y * size);
    } else {
      ctx.moveTo(s.pts[0].x * size, s.pts[0].y * size);
      for (let i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i].x * size, s.pts[i].y * size);
    }
    ctx.stroke();
  }
  ctx.restore();

  if (frame) {
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(1, size * 0.012);
    ctx.strokeStyle = frame;
    tracePath(ctx, size, inset);
    ctx.stroke();
    ctx.restore();
  }
}

/** Render a mark off-screen and encode it, walking STONE_MARK_LADDER until the
 *  result fits STONE_MARK_MAX_BYTES. Browser-only (needs a canvas). */
export function encodeStoneMark(
  strokes: StoneStroke[],
  max: number = STONE_MARK_MAX_BYTES
): string | undefined {
  if (typeof document === "undefined") return undefined;
  const candidates: string[] = [];
  for (const step of STONE_MARK_LADDER) {
    const c = document.createElement("canvas");
    c.width = step.px;
    c.height = step.px;
    const ctx = c.getContext("2d");
    if (!ctx) continue;
    renderStoneMark(ctx, step.px, strokes);
    let url: string;
    try {
      url = c.toDataURL(step.type, step.quality);
    } catch {
      continue;
    }
    // A browser without webp encoding silently hands back a PNG; that is fine,
    // it is still a candidate — it just may not be smaller.
    if (dataUrlByteLength(url) <= max) return url;
    candidates.push(url);
  }
  return pickWithinCap(candidates, max);
}

// ---------------------------------------------------------------------------
// Per-device storage (the mark never goes anywhere else on its own)
// ---------------------------------------------------------------------------

/** The connected member's own saved stone-mark (a small PNG data URL), or
 *  undefined if they've never drawn one. Per-device, like profile.ts. */
export function getStoneMark(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return localStorage.getItem(KEY) || undefined;
}

/** Persist the member's own stone-mark. Pass an empty string / undefined to
 *  clear it. Fires "aha:stonemark" so open ProfileCards can refresh. Anything
 *  that is not a valid, within-cap raster mark is refused rather than stored. */
export function setStoneMark(dataUrl?: string): void {
  if (typeof window === "undefined") return;
  if (dataUrl) {
    if (!isStoneMarkDataUrl(dataUrl)) return;
    localStorage.setItem(KEY, dataUrl);
  } else localStorage.removeItem(KEY);
  window.dispatchEvent(new Event("aha:stonemark"));
}
