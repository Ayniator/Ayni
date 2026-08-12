// F69 (Epic 9) — ON-DEVICE PHOTO CARTOONISATION.
//
// Two jobs, and the second one is the one that matters:
//
//   1. Turn a chosen photograph into a stylised avatar that a fellow member
//      still recognises but that defeats naive face-recognition matching.
//   2. Guarantee the ORIGINAL photograph never persists — not in localStorage,
//      not in IndexedDB, not in a log, not on a wire. It exists only as a
//      transient in-memory buffer for the few milliseconds it takes to build
//      the cartoon, and is explicitly scrubbed afterwards.
//
// Everything here is pure client-side Canvas 2D + arithmetic. NO network call,
// NO new dependency, NO downloaded ML model (a model download would break the
// no-network rule and dwarf the app). The effect is achieved with classical
// image processing: saturation lift → edge-preserving (bilateral-ish) smoothing
// → Sobel ink lines → mild pre-quantisation → median-cut palette reduction.
//
// HONESTY (see docs/avatars.md): this destroys fine texture and blunts landmark
// precision, which is what off-the-shelf face matchers key on. It is NOT a
// proof of unlinkability against a determined adversary who already holds the
// original photograph. Do not sell it as one.
//
// The pixel stage is deliberately DOM-free and deterministic (only +,-,*,/ and
// Math.round on IEEE-754 doubles — no Math.exp, no randomness, no time, no
// hash-order dependence), so `tests/cartoonise.test.mjs` exercises exactly the
// code the browser runs, and the same photo + same settings always yields the
// same pixels on every device.

// ---------------------------------------------------------------------------
// Caps (documented in docs/avatars.md — keep the two in sync)
// ---------------------------------------------------------------------------

/** Default (and recommended) output edge length, in pixels. Square. */
export const MAX_AVATAR_PX = 128;
/** Hard ceiling on the output edge length. Requests above this are clamped. */
export const HARD_MAX_AVATAR_PX = 256;
/** Floor the size-cap ladder will not shrink below. */
export const MIN_AVATAR_PX = 48;
/** Hard ceiling on the encoded data-URL, in bytes (48 KiB). */
export const MAX_AVATAR_BYTES = 48 * 1024;

// ---------------------------------------------------------------------------
// Pixel types
// ---------------------------------------------------------------------------

/**
 * A plain RGBA raster. Structurally compatible with the DOM `ImageData` so a
 * browser can hand one straight in, but it carries no DOM dependency, so node
 * can construct one from a synthetic buffer.
 */
export interface RGBAImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export interface CartooniseSettings {
  /** Bumped whenever the pipeline changes shape; part of an avatar's recipe. */
  version: string;
  /** Colour lift applied before quantisation (1 = untouched). */
  saturation: number;
  /** Bilateral-ish smoothing radius, in pixels. */
  smoothRadius: number;
  /** How many smoothing passes (each pass flattens more). */
  smoothPasses: number;
  /** Colour tolerance of the smoothing; larger = flatter, less edge-preserving. */
  colourSigma: number;
  /** Mild pre-quantisation levels per channel (2..32). */
  levels: number;
  /** Final palette size after median-cut reduction (0 disables). */
  paletteSize: number;
  /** Sobel magnitude above which a pixel becomes an ink line (0..255). */
  edgeThreshold: number;
  /** How dark the ink line is drawn (0 = none, 1 = black). */
  edgeDarkness: number;
  /** Ink line width in pixels (1 or 2). */
  edgeThickness: number;
}

export type CartoonStyle = "ink" | "soft" | "poster";

/**
 * The three presets. `ink` is the default: strongest abstraction, boldest
 * lines, smallest palette — the one that best serves F69's privacy goal while
 * staying recognisable at 48 px.
 */
export const CARTOON_STYLES: Record<CartoonStyle, CartooniseSettings> = {
  ink: {
    version: "f69.1",
    saturation: 1.15,
    smoothRadius: 2,
    smoothPasses: 2,
    colourSigma: 36,
    levels: 16,
    paletteSize: 14,
    edgeThreshold: 40,
    edgeDarkness: 0.85,
    edgeThickness: 1,
  },
  soft: {
    version: "f69.1",
    saturation: 1.1,
    smoothRadius: 2,
    smoothPasses: 1,
    colourSigma: 30,
    levels: 20,
    paletteSize: 22,
    edgeThreshold: 34,
    edgeDarkness: 0.55,
    edgeThickness: 1,
  },
  poster: {
    version: "f69.1",
    saturation: 1.3,
    smoothRadius: 3,
    smoothPasses: 3,
    colourSigma: 48,
    levels: 12,
    paletteSize: 8,
    edgeThreshold: 22,
    edgeDarkness: 1,
    edgeThickness: 2,
  },
};

export const DEFAULT_CARTOON_STYLE: CartoonStyle = "ink";

export function settingsForStyle(style: CartoonStyle = DEFAULT_CARTOON_STYLE): CartooniseSettings {
  return { ...(CARTOON_STYLES[style] ?? CARTOON_STYLES[DEFAULT_CARTOON_STYLE]) };
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

export function makeImage(width: number, height: number): RGBAImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function cloneImage(img: RGBAImage): RGBAImage {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}

/**
 * Overwrite a raster's bytes with zeroes. This is the explicit release of the
 * ORIGINAL photograph's pixels — the buffer is not merely dereferenced and left
 * to the GC, it is scrubbed, so a later heap read cannot recover the face.
 */
export function zeroImage(img: RGBAImage | null | undefined): void {
  if (img && img.data) img.data.fill(0);
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** Clamp a requested output size into [MIN_AVATAR_PX, HARD_MAX_AVATAR_PX]. */
export function clampAvatarPx(px: number): number {
  if (!Number.isFinite(px)) return MAX_AVATAR_PX;
  const n = Math.round(px);
  if (n < MIN_AVATAR_PX) return MIN_AVATAR_PX;
  if (n > HARD_MAX_AVATAR_PX) return HARD_MAX_AVATAR_PX;
  return n;
}

/** Decoded byte length of a data URL (not the string length). */
export function dataUrlBytes(url: string): number {
  const comma = url.indexOf(",");
  if (comma < 0) return 0;
  const body = url.slice(comma + 1);
  if (!/;base64/i.test(url.slice(0, comma))) return body.length;
  let pad = 0;
  if (body.endsWith("==")) pad = 2;
  else if (body.endsWith("=")) pad = 1;
  return Math.max(0, Math.floor((body.length * 3) / 4) - pad);
}

/**
 * The persistence guard. An avatar may only ever be a small `image/webp` or
 * `image/png` data URL (what this module emits, and what the Epic-6 stone-mark
 * emits) or a remote https URL that is by definition not a local photograph.
 * A full-size photo data URL — the thing F69 forbids — fails on the byte cap.
 */
export function isSafeAvatarValue(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (/^https:\/\//i.test(value)) return true;
  // Deliberately no image/svg+xml: an SVG data URL is a script-bearing
  // document, and nothing in this app needs one for an avatar.
  const m = /^data:image\/(?:webp|png|jpeg);base64,/i.exec(value);
  if (!m) return false;
  return dataUrlBytes(value) <= MAX_AVATAR_BYTES;
}

/** Pick the smallest candidate encoding; ties resolve to the earliest. */
export function smallestEncoding(candidates: string[]): string {
  let best = "";
  let bestBytes = Infinity;
  for (const c of candidates) {
    if (!c) continue;
    const n = dataUrlBytes(c);
    if (n < bestBytes) {
      best = c;
      bestBytes = n;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Stage 1 — saturation lift
// ---------------------------------------------------------------------------

/** Push colours away from their own luma. In place; returns the same image. */
export function boostSaturation(img: RGBAImage, factor: number): RGBAImage {
  if (factor === 1) return img;
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    // Integer-weighted luma keeps this exactly reproducible.
    const y = (r * 77 + g * 150 + b * 29) / 256;
    d[i] = clampByte(Math.round(y + (r - y) * factor));
    d[i + 1] = clampByte(Math.round(y + (g - y) * factor));
    d[i + 2] = clampByte(Math.round(y + (b - y) * factor));
  }
  return img;
}

// ---------------------------------------------------------------------------
// Stage 2 — bilateral-ish edge-preserving smoothing
// ---------------------------------------------------------------------------

/**
 * A bilateral filter without the exponentials: the spatial and range weights
 * are rational functions, so every operation is +,-,*,/ on doubles and the
 * output is bit-identical on every platform. Flat regions collapse to a single
 * tone (that is what makes the result read as "drawn") while strong colour
 * boundaries survive to carry the likeness.
 *
 * Returns a NEW image; the source is left untouched.
 */
export function bilateralSmooth(img: RGBAImage, radius: number, colourSigma: number): RGBAImage {
  const { width: w, height: h, data: src } = img;
  const out = makeImage(w, h);
  const dst = out.data;
  const r = Math.max(0, Math.round(radius));
  const sig2 = Math.max(1, colourSigma * colourSigma);
  const r2 = Math.max(1, r * r);

  // Precomputed rational spatial kernel: 1 / (1 + d2/r2).
  const kw = 2 * r + 1;
  const spatial = new Float64Array(kw * kw);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      spatial[(dy + r) * kw + (dx + r)] = 1 / (1 + (dx * dx + dy * dy) / r2);
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ci = (y * w + x) * 4;
      const cr = src[ci], cg = src[ci + 1], cb = src[ci + 2];
      let sr = 0, sg = 0, sb = 0, sw = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const ni = (yy * w + xx) * 4;
          const nr = src[ni], ng = src[ni + 1], nb = src[ni + 2];
          const dr = nr - cr, dg = ng - cg, db = nb - cb;
          const dist2 = dr * dr + dg * dg + db * db;
          const weight = spatial[(dy + r) * kw + (dx + r)] / (1 + dist2 / sig2);
          sr += nr * weight;
          sg += ng * weight;
          sb += nb * weight;
          sw += weight;
        }
      }
      dst[ci] = clampByte(Math.round(sr / sw));
      dst[ci + 1] = clampByte(Math.round(sg / sw));
      dst[ci + 2] = clampByte(Math.round(sb / sw));
      dst[ci + 3] = 255;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stage 3 — Sobel ink lines
// ---------------------------------------------------------------------------

/** Integer-weighted luma plane (one byte per pixel). */
export function lumaPlane(img: RGBAImage): Uint8ClampedArray {
  const { width: w, height: h, data: d } = img;
  const out = new Uint8ClampedArray(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    out[p] = clampByte(Math.round((d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) / 256));
  }
  return out;
}

/**
 * Sobel gradient magnitude thresholded into a binary ink mask (0 or 255).
 * The border is never inked — a 1px frame around every avatar would be noise.
 */
export function sobelEdges(img: RGBAImage, threshold: number, thickness = 1): Uint8ClampedArray {
  const { width: w, height: h } = img;
  const luma = lumaPlane(img);
  const mask = new Uint8ClampedArray(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const tl = luma[p - w - 1], tc = luma[p - w], tr = luma[p - w + 1];
      const ml = luma[p - 1], mr = luma[p + 1];
      const bl = luma[p + w - 1], bc = luma[p + w], br = luma[p + w + 1];
      const gx = tl + 2 * ml + bl - (tr + 2 * mr + br);
      const gy = tl + 2 * tc + tr - (bl + 2 * bc + br);
      // |gx| + |gy| — an L1 magnitude, exact in integers, no sqrt.
      const mag = (gx < 0 ? -gx : gx) + (gy < 0 ? -gy : gy);
      if (mag >= threshold * 2) mask[p] = 255;
    }
  }
  if (thickness > 1) return dilateMask(mask, w, h, Math.min(2, Math.round(thickness)) - 1);
  return mask;
}

/** 4-neighbour dilation, `steps` times. Pure; returns a new mask. */
export function dilateMask(mask: Uint8ClampedArray, w: number, h: number, steps: number): Uint8ClampedArray {
  let cur = mask;
  for (let s = 0; s < steps; s++) {
    const next = new Uint8ClampedArray(cur);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        if (cur[p]) continue;
        if (cur[p - 1] || cur[p + 1] || cur[p - w] || cur[p + w]) next[p] = 255;
      }
    }
    cur = next;
  }
  return cur;
}

/** Multiply the ink mask into the image. In place; returns the same image. */
export function applyEdges(img: RGBAImage, mask: Uint8ClampedArray, darkness: number): RGBAImage {
  const d = img.data;
  const keep = 1 - Math.max(0, Math.min(1, darkness));
  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    if (!mask[p]) continue;
    d[i] = clampByte(Math.round(d[i] * keep));
    d[i + 1] = clampByte(Math.round(d[i + 1] * keep));
    d[i + 2] = clampByte(Math.round(d[i + 2] * keep));
  }
  return img;
}

// ---------------------------------------------------------------------------
// Stage 4 — posterisation and palette reduction
// ---------------------------------------------------------------------------

/**
 * Snap every channel onto `levels` evenly spaced values. Used here as a mild
 * pre-quantiser that bounds the colour histogram median-cut then works on —
 * deliberately mild, because snapping channels independently at a low level
 * count drags hues around and turns skin green.
 * In place; returns the same image.
 */
export function posterise(img: RGBAImage, levels: number): RGBAImage {
  const n = Math.max(2, Math.min(32, Math.round(levels)));
  const step = 255 / (n - 1);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = clampByte(Math.round(Math.round(d[i] / step) * step));
    d[i + 1] = clampByte(Math.round(Math.round(d[i + 1] / step) * step));
    d[i + 2] = clampByte(Math.round(Math.round(d[i + 2] / step) * step));
    d[i + 3] = 255;
  }
  return img;
}

/** The distinct RGB triples present in an image, as `r<<16|g<<8|b` keys. */
export function paletteOf(img: RGBAImage): number[] {
  const seen = new Set<number>();
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
  return Array.from(seen).sort((a, b) => a - b);
}

/**
 * Median cut: choose a `k`-colour palette that covers the image's colour cube.
 *
 * Frequency-ranked palettes (keep the k commonest colours) look wrong on faces
 * — background and skin dominate the histogram, so small dark features such as
 * eyes get merged into the cheek and the likeness dies. Median cut instead
 * splits the cube on its widest axis, so an outlying cluster keeps a box of its
 * own and the eyes survive.
 *
 * Deterministic throughout: the histogram is materialised into a key-sorted
 * array before any splitting, box selection breaks ties on the lowest index,
 * and the returned palette is sorted by colour key.
 */
export function medianCutPalette(img: RGBAImage, k: number): number[] {
  const d = img.data;
  const counts = new Map<number, number>();
  for (let i = 0; i < d.length; i += 4) {
    const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  // Sorting by key first makes everything downstream independent of Map order.
  const entries = Array.from(counts.entries()).sort((a, b) => a[0] - b[0]);
  if (k <= 0 || entries.length <= k) return entries.map((e) => e[0]).sort((a, b) => a - b);

  type Box = { items: [number, number][]; extent: number; axis: number };
  const measure = (items: [number, number][]): { extent: number; axis: number } => {
    let lo = [255, 255, 255];
    let hi = [0, 0, 0];
    for (const [key] of items) {
      const c = [(key >> 16) & 255, (key >> 8) & 255, key & 255];
      for (let a = 0; a < 3; a++) {
        if (c[a] < lo[a]) lo[a] = c[a];
        if (c[a] > hi[a]) hi[a] = c[a];
      }
    }
    // Perceptual-ish axis weights, so a green split beats a blue one.
    const w = [1.0, 1.2, 0.8];
    let axis = 0;
    let best = -1;
    for (let a = 0; a < 3; a++) {
      const r = (hi[a] - lo[a]) * w[a];
      if (r > best) {
        best = r;
        axis = a;
      }
    }
    return { extent: best, axis };
  };

  const mk = (items: [number, number][]): Box => ({ items, ...measure(items) });
  let boxes: Box[] = [mk(entries)];
  while (boxes.length < k) {
    let pick = -1;
    let bestExtent = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].items.length > 1 && boxes[i].extent > bestExtent) {
        bestExtent = boxes[i].extent;
        pick = i;
      }
    }
    if (pick < 0) break; // every box is a single colour
    const box = boxes[pick];
    const shift = box.axis === 0 ? 16 : box.axis === 1 ? 8 : 0;
    const sorted = box.items
      .slice()
      .sort((a, b) => (((a[0] >> shift) & 255) - ((b[0] >> shift) & 255)) || (a[0] - b[0]));
    // Split at the MIDPOINT of the axis range, not at the population median.
    // A median split would put the cut inside whichever cluster dominates the
    // pixel count — on a portrait that is skin and background, and a small dark
    // cluster (pupils, nostrils, a dark garment) would never get a box of its
    // own. Midpoint splitting isolates outliers, which is what keeps a face
    // readable. Falls back to the median when the midpoint leaves a half empty.
    const at = (e: [number, number]) => (e[0] >> shift) & 255;
    const lo = at(sorted[0]);
    const hi = at(sorted[sorted.length - 1]);
    const mid = (lo + hi) / 2;
    let cut = 0;
    while (cut < sorted.length && at(sorted[cut]) <= mid) cut++;
    if (cut === 0 || cut === sorted.length) {
      const total = sorted.reduce((s, e) => s + e[1], 0);
      let acc = 0;
      cut = 1;
      for (let i = 0; i < sorted.length - 1; i++) {
        acc += sorted[i][1];
        if (acc * 2 >= total) {
          cut = i + 1;
          break;
        }
        cut = i + 2;
      }
    }
    boxes = boxes.slice(0, pick).concat([mk(sorted.slice(0, cut)), mk(sorted.slice(cut))], boxes.slice(pick + 1));
  }

  const palette = boxes.map((box) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (const [key, count] of box.items) {
      r += ((key >> 16) & 255) * count;
      g += ((key >> 8) & 255) * count;
      b += (key & 255) * count;
      n += count;
    }
    return (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n);
  });
  return Array.from(new Set(palette)).sort((a, b) => a - b);
}

/**
 * Snap every pixel to its nearest palette entry (squared RGB distance, ties to
 * the lower index). In place; returns the same image.
 */
export function mapToPalette(img: RGBAImage, palette: number[]): RGBAImage {
  if (palette.length === 0) return img;
  const d = img.data;
  const pr = new Int32Array(palette.length);
  const pg = new Int32Array(palette.length);
  const pb = new Int32Array(palette.length);
  for (let j = 0; j < palette.length; j++) {
    pr[j] = (palette[j] >> 16) & 255;
    pg[j] = (palette[j] >> 8) & 255;
    pb[j] = palette[j] & 255;
  }
  // Memoise per source colour — a pre-quantised avatar has few distinct inputs.
  const remap = new Map<number, number>();
  for (let i = 0; i < d.length; i += 4) {
    const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    let hit = remap.get(key);
    if (hit === undefined) {
      const r = (key >> 16) & 255, g = (key >> 8) & 255, b = key & 255;
      let bestJ = 0;
      let bestD = Infinity;
      for (let j = 0; j < palette.length; j++) {
        const dr = r - pr[j], dg = g - pg[j], db = b - pb[j];
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestD) {
          bestD = dist;
          bestJ = j;
        }
      }
      hit = palette[bestJ];
      remap.set(key, hit);
    }
    d[i] = (hit >> 16) & 255;
    d[i + 1] = (hit >> 8) & 255;
    d[i + 2] = hit & 255;
  }
  return img;
}

/** Convenience: median-cut to `k` colours and snap. In place. */
export function reducePalette(img: RGBAImage, k: number): RGBAImage {
  if (k <= 0) return img;
  return mapToPalette(img, medianCutPalette(img, k));
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

/**
 * The whole transform, DOM-free and deterministic.
 *
 * Returns a NEW raster. The caller keeps ownership of `src` and is expected to
 * `zeroImage(src)` immediately afterwards — `src` is the original photograph.
 */
export function cartoonisePixels(src: RGBAImage, settings: CartooniseSettings): RGBAImage {
  let work = cloneImage(src);
  boostSaturation(work, settings.saturation);
  for (let pass = 0; pass < Math.max(1, settings.smoothPasses); pass++) {
    const next = bilateralSmooth(work, settings.smoothRadius, settings.colourSigma);
    zeroImage(work); // each intermediate still resembles the face — scrub it
    work = next;
  }
  // Lines come from the smoothed image, so they follow real structure rather
  // than sensor noise; they are applied last so quantisation cannot fade them.
  const mask = sobelEdges(work, settings.edgeThreshold, settings.edgeThickness);
  posterise(work, settings.levels); // mild pre-quantise: bounds the histogram
  reducePalette(work, settings.paletteSize); // median cut: the cartoon flatness
  applyEdges(work, mask, settings.edgeDarkness);
  const d = work.data;
  for (let i = 3; i < d.length; i += 4) d[i] = 255; // fully opaque
  return work;
}

/** Box-average 2×2 downscale (exact integer mean). Used by the size ladder. */
export function halveImage(img: RGBAImage): RGBAImage {
  const w = Math.max(1, img.width >> 1);
  const h = Math.max(1, img.height >> 1);
  const out = makeImage(w, h);
  const s = img.data, d = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const a = ((y * 2) * img.width + x * 2) * 4;
      const b = a + 4;
      const c = a + img.width * 4;
      const e = c + 4;
      for (let ch = 0; ch < 3; ch++) {
        d[o + ch] = clampByte(Math.round((s[a + ch] + s[b + ch] + s[c + ch] + s[e + ch]) / 4));
      }
      d[o + 3] = 255;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The DOM stage — where the ORIGINAL is briefly touched, and scrubbed
// ---------------------------------------------------------------------------
//
// Invariants enforced below, in order:
//   * the original is decoded straight from the Blob (createImageBitmap), so no
//     base64 or data-URL copy of it is ever created;
//   * the fallback path uses an object URL that is revoked in `finally`, and
//     the <img> is never appended to the document;
//   * the canvas that briefly holds the original is cleared and resized to 0×0
//     so its backing store is dropped;
//   * the decoded pixels live in ONE Uint8ClampedArray, which is zero-filled
//     before this function returns, on the success path AND on the throw path;
//   * nothing here calls console.*, fetch, XHR, sendBeacon, localStorage,
//     sessionStorage or indexedDB. Grep this file: there are no such calls.

export interface CartooniseOptions {
  /** Output edge length; clamped to [48, 256]. Default 128. */
  maxPx?: number;
  /** Named preset. Ignored when `settings` is given. */
  style?: CartoonStyle;
  /** Explicit settings — the exact recipe, for reproducibility. */
  settings?: CartooniseSettings;
}

function requireCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  if (typeof document === "undefined") throw new Error("cartoonise requires a browser");
  const canvas = document.createElement("canvas"); // detached — never in the DOM
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas unavailable");
  return { canvas, ctx };
}

function releaseCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D | null): void {
  try {
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
  } catch {
    /* nothing to clear */
  }
  canvas.width = 0;
  canvas.height = 0;
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("not an image"));
    el.src = url;
  });
}

/**
 * Decode `file` into a square RGBA buffer of `px`×`px`, centre-cropped (cover).
 * This is the ONLY place the original photograph is materialised.
 */
async function decodeToSquareRGBA(file: Blob, px: number): Promise<RGBAImage> {
  const { canvas, ctx } = requireCanvas(px, px);
  let bmp: ImageBitmap | null = null;
  let objectUrl: string | null = null;
  let el: HTMLImageElement | null = null;
  try {
    let drawable: CanvasImageSource;
    let sw: number;
    let sh: number;
    if (typeof createImageBitmap === "function") {
      // Preferred: no data URL, no object URL, no string copy of the photo.
      bmp = await createImageBitmap(file);
      drawable = bmp;
      sw = bmp.width;
      sh = bmp.height;
    } else {
      objectUrl = URL.createObjectURL(file);
      el = await loadImageElement(objectUrl);
      drawable = el;
      sw = el.naturalWidth || el.width;
      sh = el.naturalHeight || el.height;
    }
    if (!sw || !sh) throw new Error("not an image");

    const side = Math.min(sw, sh);
    const sx = Math.floor((sw - side) / 2);
    const sy = Math.floor((sh - side) / 2);
    ctx.fillStyle = "#ffffff"; // flatten any alpha; avatars are opaque
    ctx.fillRect(0, 0, px, px);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(drawable, sx, sy, side, side, 0, 0, px, px);
    const snapshot = ctx.getImageData(0, 0, px, px); // a COPY, independent of the canvas
    return { width: px, height: px, data: snapshot.data };
  } finally {
    // Release every handle on the original, in every exit path.
    try {
      bmp?.close?.();
    } catch {
      /* older engines lack close() */
    }
    if (el) {
      el.onload = null;
      el.onerror = null;
      el.removeAttribute("src");
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    releaseCanvas(canvas, ctx);
    bmp = null;
    el = null;
  }
}

/** Encode a raster to the smallest data URL under the byte cap. */
function encodeBounded(img: RGBAImage): string {
  let cur = img;
  let best = "";
  for (;;) {
    const { canvas, ctx } = requireCanvas(cur.width, cur.height);
    try {
      // via createImageData rather than `new ImageData(...)`: it avoids the
      // ArrayBuffer/SharedArrayBuffer variance in the DOM typings and works
      // in every engine that has a 2D context at all.
      const frame = ctx.createImageData(cur.width, cur.height);
      frame.data.set(cur.data);
      ctx.putImageData(frame, 0, 0);
      // Flat colour + hard lines compress very differently in WebP and PNG;
      // try both and keep whichever is smaller.
      best = smallestEncoding([
        canvas.toDataURL("image/webp", 0.9),
        canvas.toDataURL("image/webp", 0.75),
        canvas.toDataURL("image/png"),
      ]);
    } finally {
      releaseCanvas(canvas, ctx);
    }
    if (dataUrlBytes(best) <= MAX_AVATAR_BYTES) return best;
    if (cur.width <= MIN_AVATAR_PX) return best; // floor reached; return anyway
    const smaller = halveImage(cur);
    if (cur !== img) zeroImage(cur);
    cur = smaller;
  }
}

/**
 * F69 entry point: a photo File/Blob in, a cartoon avatar data URL out.
 *
 * The original never leaves this function in any form. What is returned is
 * built only from the cartoon raster.
 */
export async function fileToCartoonAvatar(file: Blob, opts: CartooniseOptions = {}): Promise<string> {
  const px = clampAvatarPx(opts.maxPx ?? MAX_AVATAR_PX);
  const settings = opts.settings ?? settingsForStyle(opts.style ?? DEFAULT_CARTOON_STYLE);
  let original: RGBAImage | null = null;
  let cartoon: RGBAImage | null = null;
  try {
    original = await decodeToSquareRGBA(file, px);
    cartoon = cartoonisePixels(original, settings);
    zeroImage(original); // scrub as early as possible, not just in `finally`
    return encodeBounded(cartoon);
  } finally {
    zeroImage(original);
    zeroImage(cartoon);
    original = null;
    cartoon = null;
  }
}
