// F62 — the stone-mark canvas: plain-node tests for the DOM-free half.
// Run: node tests/stonemark.test.mjs   (no framework, exits non-zero on failure)
//
// Covered: equilateral-triangle geometry, the inside/clamp bound (nothing is
// ever recorded outside the stone), stroke simplification, the data-URL size
// accounting and the export cap ladder, and the storage guard that keeps
// anything but a small raster out of the avatar slot.
//
// The module under test is TypeScript (frontend/lib/stonemark.ts), so it is
// transpiled on the fly with the frontend's own `typescript` and evaluated as
// CJS — same pattern as tests/recovery-keys.test.mjs.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const frontendRequire = createRequire(path.join(repoRoot, "frontend", "package.json"));
const ts = frontendRequire("typescript");

const srcPath = path.join(repoRoot, "frontend", "lib", "stonemark.ts");
const src = readFileSync(srcPath, "utf8");
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
const mod = { exports: {} };
new Function("module", "exports", "require", js)(mod, mod.exports, frontendRequire);
const S = mod.exports;

let failures = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

// --- 1. the form is a real equilateral triangle, apex up, inside the box ----

test("triangleVertices is equilateral, apex up, and fits the unit box", () => {
  const [apex, right, left] = S.triangleVertices();
  const a = dist(apex, right), b = dist(right, left), c = dist(left, apex);
  assert.ok(near(a, b, 1e-12) && near(b, c, 1e-12), `sides differ: ${a} ${b} ${c}`);
  assert.ok(apex.y < right.y && near(right.y, left.y), "apex must be above a level base");
  assert.ok(near(apex.x, 0.5), "apex is centred");
  for (const p of [apex, right, left]) {
    assert.ok(p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1, `vertex outside unit box: ${JSON.stringify(p)}`);
  }
  // the inset keeps a thick stroke off the canvas edge
  assert.ok(left.x > 0.05 && right.x < 0.95 && apex.y > 0.05);
});

// --- 2. the triangle is a BOUND, not a mask -------------------------------

test("insideTriangle accepts the centroid and the vertices, rejects the corners", () => {
  const [a, b, c] = S.triangleVertices();
  const centroid = { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 };
  assert.equal(S.insideTriangle(centroid), true);
  for (const v of [a, b, c]) assert.equal(S.insideTriangle(v), true, "vertices count as inside");
  for (const corner of [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]) {
    assert.equal(S.insideTriangle(corner), false, `box corner ${JSON.stringify(corner)} must be outside`);
  }
  // just above the apex and just below the base are outside
  assert.equal(S.insideTriangle({ x: 0.5, y: a.y - 0.02 }), false);
  assert.equal(S.insideTriangle({ x: 0.5, y: b.y + 0.02 }), false);
});

test("clampToTriangle is the identity inside and the nearest boundary point outside", () => {
  const [a, b, c] = S.triangleVertices();
  const centroid = { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 };
  const same = S.clampToTriangle(centroid);
  assert.ok(near(same.x, centroid.x) && near(same.y, centroid.y), "inside points are untouched");

  const outside = [
    { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0.5, y: -0.5 }, { x: 0.5, y: 1.4 },
    { x: -3, y: 0.5 }, { x: 4, y: 0.2 }, { x: 0.05, y: 0.5 },
  ];
  for (const p of outside) {
    const q = S.clampToTriangle(p);
    assert.equal(S.insideTriangle(q), true, `clamp landed outside for ${JSON.stringify(p)}`);
    // no point of the triangle is nearer than the clamp: sample the boundary
    const dq = dist(p, q);
    for (const [s, e] of [[a, b], [b, c], [c, a]]) {
      for (let t = 0; t <= 1; t += 0.01) {
        const m = { x: s.x + (e.x - s.x) * t, y: s.y + (e.y - s.y) * t };
        assert.ok(dist(p, m) >= dq - 1e-9, `found a nearer boundary point for ${JSON.stringify(p)}`);
      }
    }
  }
});

test("every clamped point of a wild gesture stays inside the stone", () => {
  // a deterministic pseudo-random sweep well outside the box
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 4000; i++) {
    const p = { x: rnd() * 4 - 1.5, y: rnd() * 4 - 1.5 };
    assert.equal(S.insideTriangle(S.clampToTriangle(p)), true);
  }
});

// --- 3. simplification: cheap marks, same shape ----------------------------

test("simplifyStroke drops redundant samples but keeps both endpoints", () => {
  const pts = [];
  for (let i = 0; i <= 200; i++) pts.push({ x: 0.2 + i * 0.001, y: 0.6 });
  const out = S.simplifyStroke(pts, 0.01);
  assert.ok(out.length < pts.length, "should shrink");
  assert.deepEqual(out[0], pts[0]);
  assert.deepEqual(out[out.length - 1], pts[pts.length - 1]);
  for (let i = 1; i < out.length - 1; i++) {
    assert.ok(dist(out[i], out[i - 1]) >= 0.01 - 1e-9, "kept points respect the min distance");
  }
});

test("simplifyStroke leaves short strokes alone and caps very long ones", () => {
  const dot = [{ x: 0.5, y: 0.5 }];
  assert.deepEqual(S.simplifyStroke(dot), dot);
  const two = [{ x: 0.4, y: 0.5 }, { x: 0.6, y: 0.5 }];
  assert.deepEqual(S.simplifyStroke(two), two);

  const long = [];
  for (let i = 0; i < 5000; i++) long.push({ x: 0.2 + (i % 500) * 0.001, y: 0.3 + i * 0.00008 });
  const capped = S.simplifyStroke(long, 0);
  assert.ok(capped.length <= S.MAX_POINTS_PER_STROKE, `got ${capped.length}`);
  assert.deepEqual(capped[capped.length - 1], long[long.length - 1]);
});

test("clampStrokeWidth keeps the stroke inside its bounds", () => {
  assert.equal(S.clampStrokeWidth(-5), S.STROKE_W_MIN);
  assert.equal(S.clampStrokeWidth(99), S.STROKE_W_MAX);
  assert.equal(S.clampStrokeWidth(NaN), S.STROKE_W_DEFAULT);
  assert.equal(S.clampStrokeWidth(S.STROKE_W_DEFAULT), S.STROKE_W_DEFAULT);
  assert.ok(S.STROKE_W_MIN < S.STROKE_W_DEFAULT && S.STROKE_W_DEFAULT < S.STROKE_W_MAX);
});

// --- 4. the size cap -------------------------------------------------------

test("utf8Length counts bytes, not UTF-16 code units", () => {
  assert.equal(S.utf8Length(""), 0);
  assert.equal(S.utf8Length("abc"), 3);
  assert.equal(S.utf8Length("é"), 2);
  assert.equal(S.utf8Length("字"), 3);
  assert.equal(S.utf8Length("🜃"), 4);
  const sample = "data:image/png;base64,AAAA — 字🜃";
  assert.equal(S.utf8Length(sample), Buffer.byteLength(sample, "utf8"));
});

test("dataUrlByteLength measures the stored string; dataUrlPayloadBytes the raster", () => {
  const url = "data:image/png;base64,AAECAwQFBgc="; // 8 payload bytes
  assert.equal(S.dataUrlByteLength(url), url.length);
  assert.equal(S.dataUrlPayloadBytes(url), 8);
  assert.equal(S.dataUrlPayloadBytes("data:image/svg+xml,%3Csvg/%3E"), 0, "non-base64 has no raster payload");
  assert.equal(S.dataUrlPayloadBytes("nonsense"), 0);
});

test("the documented cap is 24 KiB and the ladder only ever shrinks", () => {
  assert.equal(S.STONE_MARK_MAX_BYTES, 24 * 1024);
  assert.equal(S.STONE_MARK_EXPORT_PX, 128);
  const px = S.STONE_MARK_LADDER.map((s) => s.px);
  for (let i = 1; i < px.length; i++) assert.ok(px[i] <= px[i - 1], "ladder must not grow");
  assert.equal(px[0], S.STONE_MARK_EXPORT_PX, "the first rung is the nominal export size");
  for (const step of S.STONE_MARK_LADDER) {
    assert.ok(["image/png", "image/webp"].includes(step.type), "raster formats only — never SVG");
  }
});

test("pickWithinCap takes the first fit, else the smallest, else nothing", () => {
  const big = "data:image/png;base64," + "A".repeat(200);
  const mid = "data:image/png;base64," + "A".repeat(100);
  const small = "data:image/png;base64," + "A".repeat(40);
  assert.equal(S.pickWithinCap([big, mid, small], 150), mid, "first candidate at or under the cap");
  assert.equal(S.pickWithinCap([big, mid, small], 10), small, "no fit ⇒ the smallest, never a failure");
  assert.equal(S.pickWithinCap([], 10), undefined);
  assert.equal(S.pickWithinCap([big], 10_000), big);
});

// --- 5. the storage guard --------------------------------------------------

test("isStoneMarkDataUrl admits small PNG/WebP and refuses everything else", () => {
  assert.equal(S.isStoneMarkDataUrl("data:image/png;base64,AAECAwQFBgc="), true);
  assert.equal(S.isStoneMarkDataUrl("data:image/webp;base64,AAECAwQ="), true);

  // SVG can carry script — it must never ride in on the avatar slot
  assert.equal(S.isStoneMarkDataUrl(S.NEUTRAL_SILHOUETTE), false);
  assert.equal(S.isStoneMarkDataUrl("data:image/svg+xml;base64,AAA="), false);
  assert.equal(S.isStoneMarkDataUrl("data:text/html;base64,AAA="), false);
  assert.equal(S.isStoneMarkDataUrl("javascript:alert(1)"), false);
  assert.equal(S.isStoneMarkDataUrl("https://example.com/face.jpg"), false);
  assert.equal(S.isStoneMarkDataUrl("data:image/png;base64,not base64!"), false);
  assert.equal(S.isStoneMarkDataUrl(undefined), false);
  assert.equal(S.isStoneMarkDataUrl(12345), false);

  // and the cap is enforced at the door, not only at export
  const oversize = "data:image/png;base64," + "A".repeat(S.STONE_MARK_MAX_BYTES);
  assert.equal(S.isStoneMarkDataUrl(oversize), false);
});

test("the neutral silhouette is an outline, not a padlock (Epic 5)", () => {
  assert.ok(S.NEUTRAL_SILHOUETTE.startsWith("data:image/svg+xml,"), "inline, no network fetch");
  const svg = decodeURIComponent(S.NEUTRAL_SILHOUETTE.slice("data:image/svg+xml,".length));
  assert.ok(svg.includes("<polygon"), "a bare triangle");
  assert.ok(!/lock|padlock|<text/i.test(svg), "hidden reads as an empty page, never a lock");
  assert.ok(S.NEUTRAL_SILHOUETTE.length < 512, "tiny");
});

// --- 6. rendering, against a recording stub context ------------------------

function fakeCtx() {
  const ops = [];
  const ctx = {
    ops,
    lineCap: "", lineJoin: "", lineWidth: 0, strokeStyle: "", fillStyle: "",
    clearRect: (...a) => ops.push(["clearRect", ...a]),
    fillRect: (...a) => ops.push(["fillRect", ...a, ctx.fillStyle]),
    save: () => ops.push(["save"]),
    restore: () => ops.push(["restore"]),
    beginPath: () => ops.push(["beginPath"]),
    closePath: () => ops.push(["closePath"]),
    moveTo: (x, y) => ops.push(["moveTo", x, y]),
    lineTo: (x, y) => ops.push(["lineTo", x, y]),
    clip: () => ops.push(["clip"]),
    stroke: () => ops.push(["stroke", ctx.lineWidth, ctx.strokeStyle]),
  };
  return ctx;
}

test("renderStoneMark clears, grounds, clips, then inks — with a balanced stack", () => {
  const ctx = fakeCtx();
  const strokes = [{ w: S.STROKE_W_DEFAULT, pts: [{ x: 0.4, y: 0.6 }, { x: 0.6, y: 0.6 }] }];
  S.renderStoneMark(ctx, 128, strokes);
  const names = ctx.ops.map((o) => o[0]);
  assert.equal(names[0], "clearRect", "a full repaint every time");
  assert.ok(names.indexOf("fillRect") > 0, "the stone ground is painted");
  const clipAt = names.indexOf("clip");
  assert.ok(clipAt > 0, "ink is clipped to the triangle");
  assert.ok(names.lastIndexOf("stroke") > clipAt, "strokes are drawn after the clip");
  assert.equal(
    names.filter((n) => n === "save").length,
    names.filter((n) => n === "restore").length,
    "save/restore must balance — an unbalanced pair grows the canvas state stack"
  );
});

test("renderStoneMark scales geometry and stroke width by the box size", () => {
  const stroke = { w: 0.05, pts: [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.6 }] };
  for (const size of [64, 128, 256]) {
    const ctx = fakeCtx();
    S.renderStoneMark(ctx, size, [stroke]);
    const inked = ctx.ops.filter((o) => o[0] === "stroke");
    assert.ok(inked.length >= 1);
    assert.ok(near(inked[0][1], 0.05 * size, 1e-9), `width should scale with size ${size}`);
    const pts = ctx.ops.filter((o) => o[0] === "lineTo" || o[0] === "moveTo");
    for (const [, x, y] of pts) {
      assert.ok(x >= -1e-9 && x <= size + 1e-9 && y >= -1e-9 && y <= size + 1e-9, "geometry stays in the box");
    }
  }
});

test("renderStoneMark draws a single tap as a dot, not nothing", () => {
  const ctx = fakeCtx();
  S.renderStoneMark(ctx, 128, [{ w: S.STROKE_W_DEFAULT, pts: [{ x: 0.5, y: 0.6 }] }]);
  // triangle frame strokes + the dot's own stroke
  assert.ok(ctx.ops.filter((o) => o[0] === "stroke").length >= 2, "a one-point stroke still marks the stone");
});

// --- 7. no DOM, no network in the pure half --------------------------------

test("lib/stonemark.ts contains no network or camera path", () => {
  for (const forbidden of ["fetch(", "XMLHttpRequest", "WebSocket", "getUserMedia", "FileReader", "navigator.", "sendBeacon"]) {
    assert.ok(!src.includes(forbidden), `stonemark.ts must not reference ${forbidden}`);
  }
});

// --- run -------------------------------------------------------------------

for (const [name, fn] of tests) {
  try {
    fn();
    console.log("  ok   " + name);
  } catch (e) {
    failures++;
    console.error("  FAIL " + name + "\n       " + (e && e.message ? e.message.split("\n")[0] : e));
  }
}
console.log(failures ? `\nFAIL — ${failures}/${tests.length} stone-mark test(s) failed.` : `\nPASS — ${tests.length}/${tests.length} stone-mark tests.`);
process.exit(failures ? 1 : 0);
