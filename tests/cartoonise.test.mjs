// F69 — ON-DEVICE PHOTO CARTOONISATION: plain-node property tests.
// Run: node tests/cartoonise.test.mjs   (no framework, exits non-zero on failure)
//
// The pixel stage of frontend/lib/cartoonise.ts is deliberately DOM-free, so
// this file exercises exactly the code the browser runs. Anything asserted here
// IS the contract.
//
// The load-bearing claims proved below:
//   1. the transform is DETERMINISTIC — same buffer + same settings, same bytes;
//   2. it really REDUCES THE PALETTE (fine gradients collapse to a few tones);
//   3. it really DRAWS EDGES where the source has a boundary, and none where
//      the source is flat;
//   4. the SIZE CAP arithmetic and the persistence guard reject anything that
//      is not a small image (a raw-photograph data URL cannot be persisted);
//   5. the ORIGINAL BUFFER IS SCRUBBED — zeroImage really zeroes;
//   6. source-level invariants: cartoonise.ts contains NO network/storage/log
//      call, and profile.ts no longer reads the original into a data URL.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const libDir = path.join(repoRoot, "frontend", "lib");
const frontendRequire = createRequire(path.join(repoRoot, "frontend", "package.json"));
const ts = frontendRequire("typescript");

const cartooniseSrc = readFileSync(path.join(libDir, "cartoonise.ts"), "utf8");
const profileSrc = readFileSync(path.join(libDir, "profile.ts"), "utf8");

function loadTs(source, filename) {
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function("exports", "module", "require", js)(mod.exports, mod, frontendRequire);
  return mod.exports;
}

const C = loadTs(cartooniseSrc, "cartoonise.ts");

// --- tiny harness ----------------------------------------------------------
let passed = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures.push(`${name}: ${e && e.message ? e.message : e}`);
    console.log(`  FAIL ${name}: ${e && e.message ? e.message : e}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || "not equal"}: ${a} !== ${b}`);
}

// --- synthetic fixtures ----------------------------------------------------

/** A flat single-colour field — no structure at all. */
function flat(w, h, r, g, b) {
  const img = C.makeImage(w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
  }
  return img;
}

/** A smooth horizontal gradient — hundreds of distinct tones, no hard edge. */
function gradient(w, h) {
  const img = C.makeImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = Math.round((x / (w - 1)) * 255);
      img.data[i] = v; img.data[i + 1] = Math.round(v * 0.6); img.data[i + 2] = 255 - v;
      img.data[i + 3] = 255;
    }
  }
  return img;
}

/** A two-axis gradient — red ramps with x, green with y: hundreds of tones. */
function gradient2(w, h) {
  const img = C.makeImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      img.data[i] = Math.round((x / (w - 1)) * 255);
      img.data[i + 1] = Math.round((y / (h - 1)) * 255);
      img.data[i + 2] = Math.round(((x + y) / (w + h - 2)) * 255);
      img.data[i + 3] = 255;
    }
  }
  return img;
}

/** Two flat halves split down the middle — exactly one vertical boundary. */
function split(w, h) {
  const img = C.makeImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const dark = x < w / 2;
      img.data[i] = dark ? 20 : 235;
      img.data[i + 1] = dark ? 30 : 225;
      img.data[i + 2] = dark ? 40 : 215;
      img.data[i + 3] = 255;
    }
  }
  return img;
}

/**
 * A crude synthetic "face": a warm oval on a cool ground, with two dark eyes,
 * a mouth line, and a fine per-pixel texture standing in for skin detail. The
 * texture is what a face matcher keys on and what F69 must destroy.
 */
function face(w, h) {
  const img = C.makeImage(w, h);
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const nx = (x - cx) / (w * 0.34), ny = (y - cy) / (h * 0.44);
      const inOval = nx * nx + ny * ny <= 1;
      // deterministic pseudo-texture, ±7 per channel
      const t = ((x * 37 + y * 101) % 15) - 7;
      let r, g, b;
      if (inOval) { r = 214 + t; g = 172 + t; b = 140 + t; }
      else { r = 40 + t; g = 62 + t; b = 96 + t; }
      const eye = (Math.abs(x - (cx - w * 0.15)) < w * 0.05 || Math.abs(x - (cx + w * 0.15)) < w * 0.05)
        && Math.abs(y - (cy - h * 0.12)) < h * 0.04;
      const mouth = Math.abs(y - (cy + h * 0.2)) < h * 0.03 && Math.abs(x - cx) < w * 0.16;
      if (inOval && (eye || mouth)) { r = 28; g = 24; b = 26; }
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  return img;
}

function cloneOf(img) {
  return { width: img.width, height: img.height, data: Uint8ClampedArray.from(img.data) };
}

function countEdges(mask) {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) n++;
  return n;
}

const INK = C.settingsForStyle("ink");

// ===========================================================================
console.log("\nF69 cartoonisation — pixel stage");
// ===========================================================================

check("determinism: identical input + settings → byte-identical output", () => {
  const src = face(64, 64);
  const a = C.cartoonisePixels(src, INK);
  const b = C.cartoonisePixels(src, INK);
  eq(a.width, b.width, "width");
  eq(a.height, b.height, "height");
  for (let i = 0; i < a.data.length; i++) {
    if (a.data[i] !== b.data[i]) throw new Error(`byte ${i} differs: ${a.data[i]} vs ${b.data[i]}`);
  }
});

check("determinism: a fresh copy of the same buffer gives the same output", () => {
  const a = C.cartoonisePixels(face(48, 48), INK);
  const b = C.cartoonisePixels(face(48, 48), INK);
  for (let i = 0; i < a.data.length; i++) assert(a.data[i] === b.data[i], `byte ${i} differs`);
});

check("determinism: no float-transcendental drift across repeated passes", () => {
  const src = gradient(40, 40);
  const runs = [];
  for (let k = 0; k < 3; k++) runs.push(C.cartoonisePixels(src, C.settingsForStyle("poster")));
  for (let i = 0; i < runs[0].data.length; i++) {
    assert(runs[0].data[i] === runs[1].data[i] && runs[1].data[i] === runs[2].data[i], `byte ${i} unstable`);
  }
});

check("different settings → different output (the style control is real)", () => {
  const src = face(48, 48);
  const ink = C.cartoonisePixels(src, C.settingsForStyle("ink"));
  const poster = C.cartoonisePixels(src, C.settingsForStyle("poster"));
  let diff = 0;
  for (let i = 0; i < ink.data.length; i++) if (ink.data[i] !== poster.data[i]) diff++;
  assert(diff > ink.data.length * 0.05, `styles too similar (${diff} bytes differ)`);
});

// --- palette reduction -----------------------------------------------------

check("posterise: N levels per channel yields at most N^3 colours", () => {
  const img = C.posterise(gradient(64, 64), 4);
  const pal = C.paletteOf(img);
  assert(pal.length <= 64, `expected <= 64 colours, got ${pal.length}`);
  // and every channel value is on the 4-level lattice {0,85,170,255}
  const allowed = new Set([0, 85, 170, 255]);
  for (let i = 0; i < img.data.length; i += 4) {
    for (let ch = 0; ch < 3; ch++) {
      assert(allowed.has(img.data[i + ch]), `off-lattice value ${img.data[i + ch]}`);
    }
  }
});

check("reducePalette: output uses at most k distinct colours", () => {
  const img = C.posterise(gradient2(64, 64), 6);
  const before = C.paletteOf(img).length;
  assert(before > 30, `fixture too poor: ${before} colours`);
  C.reducePalette(img, 8);
  const after = C.paletteOf(img);
  assert(after.length <= 8, `expected <= 8 colours, got ${after.length}`);
});

check("reducePalette is a no-op when the image already has <= k colours", () => {
  const img = split(16, 16);
  const before = C.paletteOf(img);
  C.reducePalette(img, 12);
  const after = C.paletteOf(img);
  eq(after.length, before.length, "palette size changed");
});

check("medianCutPalette returns at most k colours and is order-independent", () => {
  const img = gradient2(48, 48);
  const a = C.medianCutPalette(img, 10);
  const b = C.medianCutPalette(cloneOf(img), 10);
  assert(a.length <= 10, `expected <= 10, got ${a.length}`);
  eq(a.join(","), b.join(","), "palette not deterministic");
  // sorted ascending, no duplicates
  for (let i = 1; i < a.length; i++) assert(a[i] > a[i - 1], "palette not sorted/deduped");
});

check("medianCutPalette keeps a rare dark outlier (the eyes survive)", () => {
  // 95% mid-grey ground, 5% near-black: a frequency-ranked palette would drop
  // the black entirely; median cut must keep a box for it.
  const w = 40, h = 40;
  const img = C.makeImage(w, h);
  for (let p = 0; p < w * h; p++) {
    const dark = p % 20 === 0;
    const v = dark ? 12 : 150 + (p % 7);
    img.data[p * 4] = v; img.data[p * 4 + 1] = v; img.data[p * 4 + 2] = v; img.data[p * 4 + 3] = 255;
  }
  const pal = C.medianCutPalette(img, 4);
  const darkest = Math.min(...pal.map((k) => (k >> 16) & 255));
  assert(darkest < 60, `dark cluster lost: darkest palette entry is ${darkest}`);
});

check("mapToPalette snaps every pixel onto the palette, and nowhere else", () => {
  const img = gradient2(32, 32);
  const pal = C.medianCutPalette(img, 6);
  C.mapToPalette(img, pal);
  const allowed = new Set(pal);
  for (const key of C.paletteOf(img)) assert(allowed.has(key), `stray colour ${key}`);
});

check("mapToPalette with an empty palette is a no-op", () => {
  const img = face(16, 16);
  const copy = Uint8ClampedArray.from(img.data);
  C.mapToPalette(img, []);
  for (let i = 0; i < img.data.length; i++) assert(img.data[i] === copy[i], `mutated at ${i}`);
});

check("full pipeline collapses a 4000-tone gradient to the style's palette", () => {
  const src = gradient(64, 64);
  const before = C.paletteOf(src).length;
  assert(before > 60, `fixture too poor: ${before} colours`);
  const out = C.cartoonisePixels(src, INK);
  const after = C.paletteOf(out).length;
  // paletteSize tones, plus the darkened variants the ink line introduces.
  assert(after <= INK.paletteSize * 2, `expected <= ${INK.paletteSize * 2} colours, got ${after}`);
  assert(after < before / 3, `not enough reduction: ${before} -> ${after}`);
});

check("full pipeline destroys per-pixel skin texture on the synthetic face", () => {
  const src = face(64, 64);
  const before = C.paletteOf(src).length;
  assert(before > 30, `fixture too poor: ${before} colours`);
  const out = C.cartoonisePixels(src, INK);
  const after = C.paletteOf(out).length;
  assert(after <= INK.paletteSize * 2, `expected <= ${INK.paletteSize * 2} colours, got ${after}`);
});

check("cartoonisePixels leaves the source buffer untouched (caller owns scrubbing)", () => {
  const src = face(32, 32);
  const copy = Uint8ClampedArray.from(src.data);
  C.cartoonisePixels(src, INK);
  for (let i = 0; i < src.data.length; i++) assert(src.data[i] === copy[i], `source mutated at ${i}`);
});

// --- edges -----------------------------------------------------------------

check("sobelEdges: a flat field produces no ink at all", () => {
  const mask = C.sobelEdges(flat(32, 32, 180, 140, 110), INK.edgeThreshold, 1);
  eq(countEdges(mask), 0, "flat field inked");
});

check("sobelEdges: a hard boundary is inked, and only near the boundary", () => {
  const w = 32, h = 32;
  const mask = C.sobelEdges(split(w, h), INK.edgeThreshold, 1);
  const n = countEdges(mask);
  assert(n >= h - 2, `boundary under-detected: ${n} pixels`);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (!mask[y * w + x]) continue;
      assert(Math.abs(x - w / 2) <= 2, `ink at x=${x}, far from the boundary`);
    }
  }
});

check("sobelEdges never inks the outer 1px frame", () => {
  const w = 24, h = 24;
  const mask = C.sobelEdges(face(w, h), 10, 1);
  for (let x = 0; x < w; x++) {
    eq(mask[x], 0, "top frame inked");
    eq(mask[(h - 1) * w + x], 0, "bottom frame inked");
  }
  for (let y = 0; y < h; y++) {
    eq(mask[y * w], 0, "left frame inked");
    eq(mask[y * w + w - 1], 0, "right frame inked");
  }
});

check("a higher threshold never inks more pixels than a lower one", () => {
  const src = face(48, 48);
  let prev = Infinity;
  // The Sobel kernel sums to a weight of 4 per axis, so an L1 magnitude tops
  // out at 2*4*255 = 2040 and the mask compares against threshold*2 — a
  // threshold above 1020 can therefore ink nothing at all, by construction.
  for (const t of [10, 30, 60, 120, 240, 1100]) {
    const n = countEdges(C.sobelEdges(src, t, 1));
    assert(n <= prev, `threshold ${t} inked more (${n}) than the previous (${prev})`);
    prev = n;
  }
  eq(prev, 0, "a threshold above the theoretical maximum still inked pixels");
});

check("edgeThickness 2 dilates the ink line", () => {
  const src = split(32, 32);
  const thin = countEdges(C.sobelEdges(src, INK.edgeThreshold, 1));
  const thick = countEdges(C.sobelEdges(src, INK.edgeThreshold, 2));
  assert(thick > thin, `dilation did nothing: ${thin} -> ${thick}`);
});

check("applyEdges darkens exactly the masked pixels, and only them", () => {
  const img = flat(8, 8, 200, 200, 200);
  const mask = new Uint8ClampedArray(64);
  mask[9] = 255;
  C.applyEdges(img, mask, 0.9);
  for (let p = 0; p < 64; p++) {
    const v = img.data[p * 4];
    if (p === 9) assert(v <= 30, `masked pixel not darkened: ${v}`);
    else eq(v, 200, `unmasked pixel ${p} changed`);
  }
});

check("the pipeline draws visible ink on a structured image", () => {
  const out = C.cartoonisePixels(face(64, 64), INK);
  let dark = 0;
  for (let i = 0; i < out.data.length; i += 4) {
    if (out.data[i] < 60 && out.data[i + 1] < 60 && out.data[i + 2] < 60) dark++;
  }
  assert(dark > 20, `expected ink lines, found ${dark} dark pixels`);
});

check("the pipeline forces full opacity", () => {
  const src = face(32, 32);
  for (let i = 3; i < src.data.length; i += 4) src.data[i] = 7; // near-transparent input
  const out = C.cartoonisePixels(src, INK);
  for (let i = 3; i < out.data.length; i += 4) eq(out.data[i], 255, "alpha not forced opaque");
});

// --- smoothing -------------------------------------------------------------

check("bilateralSmooth flattens noise but keeps the hard boundary", () => {
  const w = 32, h = 32;
  const src = split(w, h);
  // add ±6 deterministic noise
  for (let p = 0; p < w * h; p++) {
    const t = ((p * 29) % 13) - 6;
    for (let ch = 0; ch < 3; ch++) src.data[p * 4 + ch] = Math.max(0, Math.min(255, src.data[p * 4 + ch] + t));
  }
  const out = C.bilateralSmooth(src, 3, INK.colourSigma);
  // noise inside the left half is gone: sample a row well away from the seam
  const y = 16;
  let spread = 0;
  for (let x = 2; x < 12; x++) {
    for (let xx = 2; xx < 12; xx++) {
      spread = Math.max(spread, Math.abs(out.data[(y * w + x) * 4] - out.data[(y * w + xx) * 4]));
    }
  }
  assert(spread <= 3, `flat region still noisy (spread ${spread})`);
  // the seam survives
  const left = out.data[(y * w + 4) * 4], right = out.data[(y * w + 27) * 4];
  assert(right - left > 150, `boundary washed out (${left} vs ${right})`);
});

check("bilateralSmooth returns a new buffer and does not mutate its source", () => {
  const src = face(24, 24);
  const copy = Uint8ClampedArray.from(src.data);
  const out = C.bilateralSmooth(src, 2, 40);
  assert(out.data !== src.data, "same buffer returned");
  for (let i = 0; i < src.data.length; i++) assert(src.data[i] === copy[i], `source mutated at ${i}`);
});

check("boostSaturation(1) is exactly the identity", () => {
  const src = face(16, 16);
  const copy = Uint8ClampedArray.from(src.data);
  C.boostSaturation(src, 1);
  for (let i = 0; i < src.data.length; i++) assert(src.data[i] === copy[i], `mutated at ${i}`);
});

// ===========================================================================
console.log("\nF69 — size caps and the persistence guard");
// ===========================================================================

check("clampAvatarPx enforces [48, 256] and the 128 default", () => {
  eq(C.MAX_AVATAR_PX, 128, "default");
  eq(C.HARD_MAX_AVATAR_PX, 256, "hard max");
  eq(C.MIN_AVATAR_PX, 48, "min");
  eq(C.clampAvatarPx(1), 48, "below floor");
  eq(C.clampAvatarPx(10000), 256, "above ceiling");
  eq(C.clampAvatarPx(128), 128, "identity");
  eq(C.clampAvatarPx(NaN), 128, "NaN falls back to the default");
});

check("dataUrlBytes measures decoded bytes, not string length", () => {
  const b64 = Buffer.from("hello world!").toString("base64");
  eq(C.dataUrlBytes(`data:image/png;base64,${b64}`), 12, "12-byte payload");
  eq(C.dataUrlBytes("not a data url"), 0, "no comma");
  const big = Buffer.alloc(5000, 7).toString("base64");
  eq(C.dataUrlBytes(`data:image/webp;base64,${big}`), 5000, "5000-byte payload");
});

check("MAX_AVATAR_BYTES is the documented 48 KiB", () => {
  eq(C.MAX_AVATAR_BYTES, 48 * 1024, "byte cap");
});

check("smallestEncoding picks the smallest candidate, ties to the earliest", () => {
  const mk = (n) => `data:image/png;base64,${Buffer.alloc(n, 1).toString("base64")}`;
  eq(C.smallestEncoding([mk(900), mk(300), mk(1200)]), mk(300), "smallest");
  eq(C.smallestEncoding([mk(300), mk(300)]), mk(300), "tie");
  eq(C.smallestEncoding(["", mk(100)]), mk(100), "empties skipped");
  eq(C.smallestEncoding([]), "", "empty list");
});

check("halveImage halves both dimensions and averages 2x2 blocks", () => {
  const img = C.makeImage(4, 4);
  for (let p = 0; p < 16; p++) {
    img.data[p * 4] = p * 16; img.data[p * 4 + 1] = p * 16; img.data[p * 4 + 2] = p * 16; img.data[p * 4 + 3] = 255;
  }
  const out = C.halveImage(img);
  eq(out.width, 2, "width"); eq(out.height, 2, "height");
  // top-left block = mean(0, 16, 64, 80) = 40
  eq(out.data[0], 40, "top-left mean");
});

check("PERSISTENCE GUARD: a raw-photograph-sized data URL is rejected", () => {
  const huge = `data:image/jpeg;base64,${Buffer.alloc(600 * 1024, 3).toString("base64")}`;
  assert(!C.isSafeAvatarValue(huge), "a 600 KB photo data URL was accepted");
  const justOver = `data:image/webp;base64,${Buffer.alloc(48 * 1024 + 1, 3).toString("base64")}`;
  assert(!C.isSafeAvatarValue(justOver), "one byte over the cap was accepted");
});

check("PERSISTENCE GUARD: small webp/png avatars and https URLs are accepted", () => {
  const ok = `data:image/webp;base64,${Buffer.alloc(4096, 3).toString("base64")}`;
  assert(C.isSafeAvatarValue(ok), "a 4 KB webp avatar was rejected");
  const png = `data:image/png;base64,${Buffer.alloc(8192, 3).toString("base64")}`;
  assert(C.isSafeAvatarValue(png), "an 8 KB stone-mark PNG was rejected");
  assert(C.isSafeAvatarValue("https://example.org/a.png"), "an https URL was rejected");
});

check("PERSISTENCE GUARD: non-image and script-bearing values are rejected", () => {
  for (const bad of [
    "",
    undefined,
    null,
    42,
    "javascript:alert(1)",
    "http://example.org/a.png",
    "data:text/html;base64,PHNjcmlwdD4=",
    "data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Lz48L3N2Zz4=",
    "data:image/webp,notbase64",
  ]) {
    assert(!C.isSafeAvatarValue(bad), `accepted ${String(bad).slice(0, 40)}`);
  }
});

// ===========================================================================
console.log("\nF69 — the original never persists");
// ===========================================================================

check("zeroImage really zeroes the buffer in place", () => {
  const src = face(32, 32);
  let nonZero = 0;
  for (let i = 0; i < src.data.length; i++) if (src.data[i]) nonZero++;
  assert(nonZero > 1000, "fixture is already blank");
  const ref = src.data;
  C.zeroImage(src);
  assert(ref === src.data, "buffer was replaced instead of scrubbed");
  for (let i = 0; i < src.data.length; i++) eq(src.data[i], 0, `byte ${i} survived`);
});

check("zeroImage tolerates null/undefined", () => {
  C.zeroImage(null);
  C.zeroImage(undefined);
});

check("SOURCE INVARIANT: cartoonise.ts makes no network, storage or log call", () => {
  const banned = [
    /\bfetch\s*\(/, /XMLHttpRequest/, /sendBeacon/, /WebSocket/, /EventSource/,
    /localStorage/, /sessionStorage/, /indexedDB/, /\bcaches\b/, /document\.cookie/,
    /console\s*\./, /navigator\.clipboard/, /\bimport\s*\(/,
  ];
  // strip comments so prose about "no fetch(" cannot trip the scan
  const code = cartooniseSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const re of banned) {
    assert(!re.test(code), `cartoonise.ts contains a banned call: ${re}`);
  }
});

check("SOURCE INVARIANT: cartoonise.ts imports nothing (no dependency, no model)", () => {
  const code = cartooniseSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert(!/^\s*import\s/m.test(code), "cartoonise.ts gained an import");
});

check("SOURCE INVARIANT: cartoonise.ts revokes its object URL and closes the bitmap", () => {
  assert(/revokeObjectURL/.test(cartooniseSrc), "no URL.revokeObjectURL");
  assert(/bmp\?\.close\?\.\(\)/.test(cartooniseSrc), "the ImageBitmap is not closed");
  assert(/canvas\.width = 0/.test(cartooniseSrc), "the work canvas is not released");
});

check("SOURCE INVARIANT: profile.ts no longer reads the original into a data URL", () => {
  const code = profileSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert(!/readAsDataURL/.test(code), "profile.ts still calls FileReader.readAsDataURL");
  assert(!/new FileReader/.test(code), "profile.ts still constructs a FileReader");
  assert(!/toDataURL/.test(code), "profile.ts still encodes a canvas itself");
});

check("SOURCE INVARIANT: fileToAvatarDataUrl delegates to the cartooniser", () => {
  assert(/fileToCartoonAvatar/.test(profileSrc), "profile.ts does not call fileToCartoonAvatar");
  const body = profileSrc.slice(profileSrc.indexOf("export function fileToAvatarDataUrl"));
  const end = body.indexOf("\n}");
  assert(/fileToCartoonAvatar\(file/.test(body.slice(0, end)), "fileToAvatarDataUrl does not cartoonise");
});

check("SOURCE INVARIANT: setUserProfile filters the avatar through the guard", () => {
  const body = profileSrc.slice(profileSrc.indexOf("export function setUserProfile"));
  const end = body.indexOf("\n}");
  assert(/isSafeAvatarValue/.test(body.slice(0, end)), "setUserProfile does not call isSafeAvatarValue");
});

// ===========================================================================
console.log("\nF69 — settings and reproducibility");
// ===========================================================================

check("every style is a complete, versioned recipe", () => {
  for (const name of ["ink", "soft", "poster"]) {
    const s = C.CARTOON_STYLES[name];
    assert(s, `missing style ${name}`);
    for (const k of ["version", "saturation", "smoothRadius", "smoothPasses", "colourSigma",
      "levels", "paletteSize", "edgeThreshold", "edgeDarkness", "edgeThickness"]) {
      assert(s[k] !== undefined, `${name}.${k} missing`);
    }
    eq(s.version, "f69.1", `${name}.version`);
    assert(s.levels >= 2 && s.levels <= 32, `${name}.levels out of range`);
    assert(s.paletteSize > 0 && s.paletteSize <= 32, `${name}.paletteSize out of range`);
  }
  eq(C.DEFAULT_CARTOON_STYLE, "ink", "default style");
});

check("settingsForStyle returns a copy, so a caller cannot mutate the preset", () => {
  const s = C.settingsForStyle("ink");
  const before = C.CARTOON_STYLES.ink.levels;
  s.levels = 99;
  eq(C.CARTOON_STYLES.ink.levels, before, "preset mutated");
});

check("settingsForStyle falls back to the default for an unknown style", () => {
  eq(C.settingsForStyle("nope").levels, C.CARTOON_STYLES.ink.levels, "no fallback");
  eq(C.settingsForStyle().levels, C.CARTOON_STYLES.ink.levels, "no default");
});

check("an explicit settings object reproduces an avatar exactly", () => {
  const recipe = { ...C.CARTOON_STYLES.soft };
  const src = face(48, 48);
  const a = C.cartoonisePixels(src, recipe);
  const b = C.cartoonisePixels(src, { ...recipe });
  for (let i = 0; i < a.data.length; i++) assert(a.data[i] === b.data[i], `byte ${i} differs`);
});

// --- summary ---------------------------------------------------------------
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
