# Avatars — on-device cartoonisation (F69)

**Status:** shipped. **Code:** `frontend/lib/cartoonise.ts` (transform + caps),
`frontend/lib/profile.ts` (the `fileToAvatarDataUrl` entry point and the
persistence guard). **Tests:** `node tests/cartoonise.test.mjs`.

An AHA member has three ways to have a face in the app:

| route | what it is | biometric content |
| --- | --- | --- |
| Jazzicon (`components/Identicon.tsx`) | deterministic geometry from an address | none |
| stone-mark (F62, `components/StoneMark.tsx`) | a sign the member draws | none |
| **photo (F69, this document)** | a photograph, cartoonised on the device | reduced, **not zero** |

The stone-mark is the anonymity-preserving default and the one the UI presents
first. This page is about the third route: what happens when a member does
choose a photograph.

---

## 1. The invariant: the original photograph never persists

This is the part of F69 that matters, and it is stated as a contract rather
than an aspiration.

### What the code did before

`fileToAvatarDataUrl` (F33) did this:

1. `new FileReader().readAsDataURL(file)` — materialised the **entire
   full-resolution photograph** as a base64 string in JS memory;
2. assigned that string to `img.src`, handing a full-resolution copy to the
   browser's image decoder and its internal cache;
3. drew the decoded image into a canvas scaled so the long edge was ≤ 128 px;
4. returned `canvas.toDataURL("image/webp", 0.85)`.

Two separate problems:

- **In memory**, a full-resolution copy of the photograph existed as a string
  and as a decoded bitmap, with no explicit release of either.
- **In storage**, what every caller then wrote to `localStorage["aha:profile"]`
  was **a real photograph of a real face**, merely resized. Downscaling to
  128 px is not a privacy transform: a 128 px face crop is comfortably enough
  for off-the-shelf face recognition, and it is exactly what F69 called out
  ("F33 today stores the resized original").

### What the code does now

`fileToAvatarDataUrl` delegates to `fileToCartoonAvatar` in
`lib/cartoonise.ts`, which:

1. decodes the `Blob` with **`createImageBitmap(file)`** — no data URL, no
   object URL, no base64 string, no `FileReader` anywhere in the path;
   (the fallback path for engines without `createImageBitmap` uses an object
   URL that is `URL.revokeObjectURL`'d in a `finally`, on the throw path too);
2. draws it once, centre-cropped to a square, into a **detached** canvas that is
   never appended to the document;
3. reads one `ImageData` snapshot out of that canvas, then immediately
   `clearRect`s the canvas and sets it to `0×0` so its backing store is dropped,
   `close()`s the `ImageBitmap`, and drops the `<img>` `src` if one was used;
4. runs the transform, producing a **new** buffer;
5. **zero-fills** the original's buffer (`zeroImage`) — and every intermediate
   smoothing buffer, each of which still resembles the face — before the promise
   resolves. This happens on the success path and again in a `finally`, so it
   also happens when encoding throws;
6. encodes and returns a data URL built **only** from the cartoon raster.

### The guarantee, precisely

> **What is guaranteed:** no code path in this application writes, uploads or
> logs the original photograph, or any downscaled copy of it. The original
> exists only as one transient `Uint8ClampedArray` inside
> `fileToCartoonAvatar`, and that array is explicitly zeroed before the function
> returns. `lib/cartoonise.ts` contains no `fetch`, `XMLHttpRequest`,
> `sendBeacon`, `WebSocket`, `localStorage`, `sessionStorage`, `indexedDB`,
> `document.cookie` or `console.*` call — this is asserted by a test that greps
> the source, so a regression fails the suite rather than shipping quietly.

> **What is *not* guaranteed:** we do not control the operating system. The
> file the member picked still sits on their own disk (that is their copy, and
> deleting it is their choice); the OS file picker, the browser's own decoder,
> and any device backup are outside this code's reach. "Never persists" is a
> statement about *this application*, not about the member's phone.

### How it is enforced, in layers

1. **The only File→avatar function in the app is the cartooniser.**
   `fileToAvatarDataUrl` keeps its old signature, so every caller (`/me`'s
   photo panel, `/onboarding` step 3) is cartoonised without any wiring change,
   and there is no second, "raw" path to fall back to.
2. **Explicit scrubbing**, as described above — buffers are zeroed, not merely
   dereferenced.
3. **A persistence guard on the store.** `setUserProfile` is the only writer of
   the avatar slot and filters its value through `isSafeAvatarValue`: a value is
   accepted only if it is an `image/webp`, `image/png` or `image/jpeg` data URL
   of **≤ 48 KiB decoded**, or an `https:` URL. `image/svg+xml` is deliberately
   refused (an SVG data URL is a script-bearing document). A megabyte-scale
   photograph data URL — the shape a naive "just store the file" regression
   would take — cannot get through.
   Be honest about the limit of this layer: a *small* photo data URL would pass
   the byte cap. The guard is defence-in-depth against gross regressions, not
   the guarantee. The guarantee is layer 1.
4. **Source-level invariants under test** (`tests/cartoonise.test.mjs`):
   `profile.ts` no longer contains `readAsDataURL`, `new FileReader` or
   `toDataURL`; `fileToAvatarDataUrl` calls `fileToCartoonAvatar`;
   `setUserProfile` calls `isSafeAvatarValue`; `cartoonise.ts` imports nothing
   and calls nothing on the banned list.

---

## 2. What the transform actually does

Pure Canvas 2D and arithmetic. **No network call, no new dependency, no
downloaded ML model** — a model download would break the no-network rule and
would be larger than the rest of the app.

Pipeline, in order (`cartoonisePixels`):

1. **Square cover-crop and downscale** to the output size (default 128 px).
   Cropping to a square is right for an avatar (they are all rendered round)
   and it makes the output size deterministic.
2. **Saturation lift** — colours are pushed away from their own luma, so the
   later quantisation lands on distinct, drawing-like hues instead of mud.
3. **Edge-preserving smoothing**, 1–3 passes of a bilateral-style filter. Both
   the spatial and the range weights are *rational* functions (`1/(1+d²/σ²)`)
   rather than Gaussians — no `Math.exp`, so the arithmetic is only `+ - * /`
   and the result is bit-identical on every platform. Flat regions collapse to a
   single tone; strong colour boundaries survive. **This is the step that
   destroys skin texture** — the fine per-pixel detail that face embeddings are
   largely built from.
4. **Sobel ink lines**, computed from the *smoothed* image so they follow real
   structure rather than sensor noise. An L1 gradient magnitude (`|gx|+|gy|`,
   integer-exact, no `sqrt`) is thresholded into a binary mask, optionally
   dilated to 2 px. The outer 1 px frame is never inked.
5. **Mild pre-quantisation** (`posterise`) to bound the colour histogram.
   Deliberately mild — snapping channels independently at a *low* level count
   drags hues around and turns skin green.
6. **Median-cut palette reduction** to 8–22 colours. Frequency-ranked palettes
   ("keep the k commonest colours") look wrong on faces: background and skin
   dominate the histogram, so pupils and nostrils get merged into the cheek and
   the likeness dies. Median cut splits the colour cube on its widest axis and
   splits at the **midpoint of the range**, not the population median, so a
   small dark cluster keeps a box of its own and the eyes survive.
7. **Ink applied last**, so quantisation cannot fade the lines, and alpha forced
   to 255.

### Styles

Three presets in `CARTOON_STYLES`; `ink` is the default.

| style | palette | smoothing | ink | character |
| --- | --- | --- | --- | --- |
| `ink` | 14 | radius 2 × 2 passes | threshold 40, 85 % dark, 1 px | the default: flat, drawn, still clearly a person |
| `soft` | 22 | radius 2 × 1 pass | threshold 34, 55 % dark, 1 px | gentlest; keeps the most likeness |
| `poster` | 8 | radius 3 × 3 passes | threshold 22, 100 % dark, 2 px | most abstract; a silkscreen poster |

Each preset carries a `version` (currently `f69.1`), so a settings object is a
complete, portable recipe.

### Determinism

The same file plus the same settings always produces the same pixels, on every
device: no randomness, no clock, no hash-iteration order (histograms are sorted
by colour key before any decision), no transcendental functions, and every tie
— palette-box selection, nearest-colour matching, encoding choice — breaks to
the lowest index. A member can therefore reproduce their own avatar. Only the
final PNG/WebP *encoding* is browser-dependent; the pixels are not.

---

## 3. Caps

| cap | value | where |
| --- | --- | --- |
| default output size | **128 × 128 px** (square) | `MAX_AVATAR_PX` |
| hard maximum output size | **256 × 256 px** | `HARD_MAX_AVATAR_PX` |
| minimum output size | **48 × 48 px** | `MIN_AVATAR_PX` |
| maximum encoded data URL | **48 KiB decoded** | `MAX_AVATAR_BYTES` |

A requested size outside `[48, 256]` is clamped, not rejected.

Encoding tries WebP at quality 0.9, WebP at 0.75 and PNG, and keeps whichever
is smallest — flat colour with hard lines compresses very differently in the
two formats. If the result still exceeds the byte cap, the image is halved and
the ladder repeats down to the 48 px floor. In practice this never fires: a
128 px cartoon is typically **1–6 KB**, because 8–22 flat colours compress
extremely well. The cap exists so a pathological input cannot fill
`localStorage`, and so the persistence guard has a number to check against.

---

## 4. Honest limits — read this before quoting the privacy property

Over-claiming a privacy property is worse than not having it, so, plainly:

- **This defeats naive face matching.** The smoothing and the 8–22 colour
  palette destroy fine texture and gradient detail, and the palette snap moves
  landmark positions by a pixel or two at avatar scale. Off-the-shelf
  face-recognition pipelines that expect photographic input degrade sharply on
  it, and the 128 px output leaves little to work with in the first place.
- **It is not a proof of anything.** There is no formal unlinkability claim
  here, no threat model with a security parameter, and no bound on an
  adversary's success probability. Unlike the ZK and mixing work elsewhere in
  this codebase, this is a heuristic image transform.
- **It is weak against an adversary who already holds the original.** The
  transform is deterministic and public. Anyone with a candidate photograph can
  run the identical pipeline over it and compare the result to a published
  avatar. If they have your photo, they can confirm it is yours. F69 protects
  against *harvesting* — someone scraping avatars and running face recognition
  to find out who members are — not against *confirmation* by someone who
  already has the photo and the suspicion.
- **Coarse attributes survive, by design.** Hair colour and shape, skin tone,
  glasses, a beard, head pose, clothing colour: all still legible. That is the
  point — the avatar has to be recognisable to the circle. A member who does
  not want those attributes known should draw a **stone-mark** instead. This is
  the honest reason the stone-mark, not the photo, is the recommended route.
- **Re-identification within a small set is easy.** In a circle of a dozen
  people who know each other, a cartoon avatar identifies you completely. That
  is intended. It only resists identification against a large stranger
  population.
- **Nothing here is on chain.** The avatar lives in `localStorage` on one
  device. Who may see it, when it is served through the Epic-5 profile object,
  is governed by `VisibilityPolicy.avatar` — a separate mechanism.

If you are writing member-facing copy, the defensible sentence is: *"your photo
is turned into a drawing on this device — the original is never saved, sent or
logged, and the drawing is much harder for face-recognition software to match."*
Do not write "anonymous", "cannot be identified", or "face-recognition-proof".

---

## 5. API

```ts
// frontend/lib/profile.ts — the app-facing entry point (unchanged signature)
fileToAvatarDataUrl(file: File, maxPx?: number, style?: CartoonStyle): Promise<string>

// frontend/lib/cartoonise.ts
fileToCartoonAvatar(file: Blob, opts?: CartooniseOptions): Promise<string>
cartoonisePixels(src: RGBAImage, settings: CartooniseSettings): RGBAImage  // DOM-free
isSafeAvatarValue(value: unknown): value is string                        // the store guard
zeroImage(img: RGBAImage | null | undefined): void                        // explicit release
CARTOON_STYLES, DEFAULT_CARTOON_STYLE, settingsForStyle(style)
MAX_AVATAR_PX, HARD_MAX_AVATAR_PX, MIN_AVATAR_PX, MAX_AVATAR_BYTES
```

`fileToAvatarDataUrl`'s optional third argument is the hook for a future style
control in the UI; today every caller takes the `ink` default.

## 6. Tests

```
node tests/cartoonise.test.mjs
```

45 assertions, no framework, exits non-zero on failure. They cover
determinism (byte-identical repeats, no drift across passes), palette reduction
(level lattice, k-colour bound, dark-outlier survival), edge behaviour
(no ink on a flat field, ink only at a real boundary, threshold monotonicity,
dilation, no inked frame), smoothing (noise flattened, boundary preserved, no
source mutation), the size-cap and guard arithmetic, `zeroImage` really zeroing,
and the source-level invariants listed in §1.
