# The stone-mark

Epic 6, F62. `frontend/lib/stonemark.ts`, `frontend/components/StoneMark.tsx`,
the profile card on `/me`, the `.stone-*` rules in `frontend/app/globals.css`,
tests in `tests/stonemark.test.mjs`.

## 1. Why it exists

Until F62 there was exactly one way to put a picture on a member profile:
`fileToAvatarDataUrl` in `lib/profile.ts` — pick a file, get a resized image.
In practice that means a photograph, and in practice a photograph of a member is
a photograph of a face.

That is the wrong default for this fellowship. Everything else in the platform
is built so that a member can be *known* without being *identified*: the
identity commitment, the nullifier, the per-element visibility tiers. An avatar
that is a face undoes all of it in one upload — and it undoes it precisely at
the widest audience tier ("all members"), which is the tier a member is most
likely to pick because it feels friendly.

The stone-mark is the other option. The member draws a personal sign — a sigil —
inside an equilateral triangle, the AHA form. It carries recognition (this is
*my* mark, I would know it anywhere) without carrying biometrics. It is the
digitised version of the mark carved at the Cavern Ceremony.

Photo upload stays. It is just no longer the only path, and no longer the
implied one: `/me` now offers the two side by side with neither preselected.

## 2. The privacy invariant

> **The drawn mark never leaves the device except as the member's own avatar
> data, and nothing about it is derived from or stored alongside biometric
> data.**

Concretely, and enforceable by reading the two source files:

- **No biometric input path exists.** `lib/stonemark.ts` and
  `components/StoneMark.tsx` contain no `getUserMedia`, no `FileReader`, no
  file input, no camera, no image decode. The only input is the member's own
  pointer moving on their own canvas. `tests/stonemark.test.mjs` asserts the
  absence of `fetch(`, `XMLHttpRequest`, `WebSocket`, `getUserMedia`,
  `FileReader`, `navigator.`, `sendBeacon` in the library — a regression gate,
  not a comment.
- **No network path exists.** Nothing in the component or the library sends
  anything anywhere. The mark reaches the outside world only by being written
  to the profile avatar slot, where it takes the *existing* Epic 5 route:
  sealed under the avatar element key (`lib/visibilityCrypto.ts`,
  `ELEMENT_AVATAR`) and disclosed only to the tier the member chose in
  "Who can see you". F62 adds no new egress.
- **The stroke dynamics are discarded.** Timing, velocity, pressure, tilt and
  pointer type are never recorded. A stroke is committed as bare geometry
  (`{ w, pts[] }`), and even that is thrown away at save time: only the rendered
  raster is stored. So the mark cannot be replayed as a handwriting dynamic,
  which is itself a biometric.
- **Nothing is stored beside a biometric.** The mark lives in `aha:stonemark`
  (and, as the active avatar, in `aha:profile`). No structure links it to a
  photo, a face descriptor, or any measurement of a body.
- **The mark is not a fingerprint of the member.** It is chosen, not measured.
  A member who wants a new identity draws a new mark; a member cannot draw a
  new face.

### Note on the photo path (F69's problem, not F62's)

Reported, not fixed here, because `lib/profile.ts` is not F62's file:

`fileToAvatarDataUrl` decodes the chosen file in-page, downscales it to 128px on
its long edge and stores **only** the downscaled WebP — the full-resolution
original is never written to `localStorage` or anywhere else. That much is
sound. What remains is that the stored 128px image is still a photograph of a
face, and once it is sealed under the Epic 5 avatar key it is a face that the
chosen tier can open and keep. Whether the photo path should exist at all, or
should pass through a cartoonising/abstraction step first, belongs to F69 (a
`lib/cartoonise.ts` and a `components/AvatarPicker.tsx` were landing in the tree
while F62 was written).

## 3. What the member sees

A canvas showing an apex-up equilateral triangle inset in a square — the carving
stone. Drawing works with mouse, pen and touch (pointer events, `touch-action:
none`, pointer capture, so a finger drag draws instead of scrolling the page).

- **Stroke** — a slider from `STROKE_W_MIN` to `STROKE_W_MAX` (0.008 … 0.078 of
  the box edge, ≈2px … 20px at the 256px drawing resolution), with a
  true-to-scale dot preview.
- **Undo** — removes the last committed stroke.
- **Clear** — removes all of them.
- **Save stone-mark** — writes the encoded mark into the avatar slot.
- A live byte count against the cap, so the member can see what the mark costs.

Ink stays inside the triangle. Not by masking: points outside the triangle are
never recorded. When the pointer crosses the edge the stroke is terminated *on*
the edge (`clampToTriangle` projects onto the nearest side) and a fresh stroke
begins if the pointer comes back in. The canvas also clips, but the clip is the
second line of defence; the geometry itself is bounded.

## 4. Rendering and determinism

The mark is stored in memory as normalised geometry: strokes of points in unit
space `[0,1]²`, widths as a fraction of the box edge. Rendering multiplies by
whatever size is being drawn.

Two consequences:

1. **Undo and clear are trivially correct.** Every change repaints the whole
   mark from geometry. There is no layer stack and no saved/restored canvas
   state to drift out of sync — the previous implementation kept an unbalanced
   `ctx.save()`/`ctx.restore()` pair across pointer events, which grew the
   canvas state stack whenever a gesture ended without a `pointerup`.
2. **The export is a render, not a resample.** The saved image is produced by
   re-rendering the geometry at the export resolution, so it does not depend on
   the device pixel ratio or the on-screen canvas size. Same strokes ⇒ same
   pixels.

The palette is fixed — `STONE_GROUND #efeae1`, `STONE_INK #211d18`,
`STONE_FRAME #b6a992` — and deliberately **not** theme-derived. A mark is a
carved stone token: it must look the same to whoever is entitled to see it,
whether they are in light or dark mode. (The pre-F62 code picked its ink from
`prefers-color-scheme`, which was doubly wrong: the app's theme lives on
`data-theme` on `<html>`, so the ink did not even follow the app, and a mark
drawn in dark mode was pale ink baked into the exported image.)

## 5. The size cap

**`STONE_MARK_MAX_BYTES = 24 KiB` (24576 bytes), measured as the UTF-8 byte
length of the whole data URL string** — which is exactly what `localStorage`
holds and what an Epic 5 avatar payload has to carry, so it is the number that
actually constrains anything.

Flat line art at 128×128 encodes to roughly 1–4 KiB as PNG, so the cap is about
6× headroom. It only bites on pathological scribbling, and when it does the
export walks a ladder that trades resolution for bytes rather than failing:

| rung | size | format | quality |
| --- | --- | --- | --- |
| 1 | 128px | PNG | lossless |
| 2 | 128px | WebP | 0.92 |
| 3 | 96px | WebP | 0.85 |
| 4 | 64px | WebP | 0.80 |

`encodeStoneMark` returns the first rung at or under the cap; if none fits it
returns the smallest candidate, so a save never silently does nothing. PNG is
first because flat line art compresses losslessly and stays crisp.

Two further bounds keep a mark cheap before encoding ever runs:

- `MAX_STROKES = 96` — further strokes are refused.
- `MAX_POINTS_PER_STROKE = 512`, after `simplifyStroke` drops samples closer
  together than `SIMPLIFY_MIN_DIST = 0.006` of the box edge (endpoints always
  survive), and decimates anything still longer.

`setStoneMark` will not store a value that is not a base64 PNG or WebP data URL
within the cap. SVG is refused outright — it can carry script, and the avatar
slot is rendered into an `<img src>` on other members' trust pages.

## 6. Where it plugs in

`onSave(dataUrl)` hands back a data URL usable **exactly** where the photo
avatar is used today: `/me` writes it to `UserProfile.avatar` (so it overrides
the Jazzicon), and to `aha:stonemark` as the member's own mark. Uploading a
photo clears the drawn mark and vice versa — there is one avatar, chosen by one
of two routes.

`StoneMarkView` renders a saved mark read-only, falling back to
`NEUTRAL_SILHOUETTE`: a bare triangle outline, never a padlock. Per Epic 5,
"you may not see this" and "there is nothing here" must be indistinguishable, so
hidden reads as an empty page.

Who may see the mark is not decided here. It is the on-chain
`VisibilityPolicy.avatar` tier, enforced on the read path (`lib/trustpage.ts`).
This component only lets an owner make their own mark on their own device.

## 7. Tests

`node tests/stonemark.test.mjs` — 17 plain-node tests over the DOM-free half of
`lib/stonemark.ts` (transpiled on the fly, same pattern as
`tests/recovery-keys.test.mjs`):

- equilateral geometry — equal sides, apex up, inside the unit box;
- the inside/clamp bound, including a 4000-point fuzz sweep asserting every
  clamped point lands inside the stone, and a check that no boundary point is
  nearer than the one `clampToTriangle` returned;
- stroke simplification (endpoints preserved, min-distance respected, long
  strokes decimated) and stroke-width clamping;
- UTF-8 and data-URL byte accounting, cross-checked against
  `Buffer.byteLength`;
- the 24 KiB cap, the monotonically shrinking ladder, and `pickWithinCap`'s
  first-fit-then-smallest behaviour;
- the storage guard's refusal of SVG, HTML, `javascript:`, remote URLs,
  malformed base64 and oversize values;
- the neutral silhouette's shape (a triangle, no lock, no text, inline);
- `renderStoneMark` against a recording stub context: full repaint, ground,
  clip-before-ink, geometry and width scaling with the box size, a one-point
  tap rendering as a dot, and a **balanced save/restore stack**;
- the absence of any network or camera reference in the library.
