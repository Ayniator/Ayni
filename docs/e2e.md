# End-to-end smoke suite

Playwright suite that renders the real AHA / Ayni pages in a real browser and
asserts on **what a member actually sees**.

- Suite: `frontend/e2e/`
- Config: `frontend/playwright.config.ts`
- Sentinel gate: `tests/sentinel/e2e-smoke-check.sh`

---

## Why it exists

Every i18n regression caught so far was caught by a **static** key-existence
check, `tests/sentinel/i18n-key-check.sh`. That check proves a string exists in
a dictionary. It cannot see:

- a blank page,
- a raw i18n key rendered on screen,
- a component that threw and rendered nothing,
- a page body that never left English.

The Circle Administration incident is the worked example: **244 `admin.*` keys
resolved to nothing and rendered as the literal text `admin.config.add` across
the whole console, in all 19 languages**, while the static check reported every
key present and PASSED. `translate()` in `frontend/lib/i18n.ts` ends with

```ts
return DICT[lang]?.[key] ?? PAGE_STRINGS[lang]?.[key] ?? en[key] ?? PAGE_STRINGS.en?.[key] ?? key;
```

— a missing key renders as its own name. This suite is the layer that sees that.

`tests/sentinel/checklist.yaml` has recorded this gap since round 1 ("Playwright
… none of that exists in this repo"). This closes it.

---

## What it runs against

**A deployed build. Never `next dev`.**

This repo's node is **18**; Next 16 requires **>= 20**, so `next build` and
`next dev` cannot run here at all. The suite therefore targets a running
deployment:

| | |
|---|---|
| default target | `https://aha.a13z.org:8443` (Caddy, `frontend-caddy-1`) |
| override | `E2E_BASE_URL` |
| container alternative | the `frontend-frontend-1` container serves the app on port 3000 |

Caddy serves a certificate this host does not trust, so the config sets
`ignoreHTTPSErrors: true`.

> **The deployed build can lag the working tree.** A failure that does not
> reproduce against the source usually means the deployment needs redeploying —
> itself worth knowing. The gate prints the source version it compared against.

---

## Running it

```bash
cd frontend
npm install
npx playwright install --with-deps chromium   # needs root; see below
npm run test:e2e
```

Or through the Sentinel gate, from the repo root:

```bash
bash tests/sentinel/e2e-smoke-check.sh
```

### Environment variables

| variable | default | meaning |
|---|---|---|
| `E2E_BASE_URL` | `https://aha.a13z.org:8443` | target deployment |
| `E2E_WORKERS` | `2` | parallel browser workers — see *Concurrency* |
| `E2E_RETRIES` | `1` | retries; set `0` to see raw flakiness |
| `E2E_DOCKER` | `0` | run the suite inside the official Playwright image |
| `E2E_OPTIONAL` | `0` | gate only: downgrade *unavailable* to a warning |
| `PW_IMAGE` | derived from the installed Playwright, e.g. `mcr.microsoft.com/playwright:v1.61.1-noble` | image for docker mode |

The image tag **must** match the installed Playwright — each release pins a
browser revision and the image ships only the browsers its own version expects.
The gate reads the version out of `frontend/node_modules/playwright/package.json`
rather than hard-coding it, so a dependency bump cannot silently desync the two.

### Concurrency — keep it low

Every page calls the **public Solana devnet RPC**, `https://api.devnet.solana.com/`,
on load. Measured on this deployment:

- 64 page loads across **2** concurrent contexts → **97** HTTP 429s from that RPC
  and nothing else;
- the same pages loaded **serially** → **zero**.

Six workers additionally provoked 502s from Caddy's upstream. Those look like
application errors but are pure load artifacts of the test run, so the default
is two workers and the status codes are allowlisted (see
`ALLOWED_RESPONSE_NOISE` in `e2e/helpers.ts`). Raise `E2E_WORKERS` only against
a target that can take it.

---

## Installing the browser

`npx playwright install chromium` (downloading the binary) needs **no root**.
Making it *launch* does — the binary needs system libraries.

**If you have root:**

```bash
npx playwright install --with-deps chromium
```

**If you do not** (the case on this host), run the suite in the official image,
which ships the browser and its libraries:

```bash
docker run --rm --network host \
  -v "$PWD/frontend":/w -w /w \
  -e HOME=/tmp -e E2E_BASE_URL=https://aha.a13z.org:8443 \
  --user "$(id -u):$(id -g)" \
  mcr.microsoft.com/playwright:v1.61.1-noble npx playwright test
```

`E2E_DOCKER=1 bash tests/sentinel/e2e-smoke-check.sh` takes that path
automatically, and the gate falls back to it on its own if the host browser
will not launch.

### What a CI runner needs

Either the official image above, or a runner with **node >= 18** plus these
packages (what `--with-deps` installs on Ubuntu noble):

```
libatk1.0-0t64 libatk-bridge2.0-0t64 libatspi2.0-0t64 libxcomposite1
libxdamage1 libxfixes3 libxrandr2 libxi6 libxrender1 libxtst6
libasound2t64 libgbm1 libnss3 libnspr4 libcups2t64 libxkbcommon0
libpango-1.0-0 libcairo2
```

Plus **network egress** to the target deployment and to `api.devnet.solana.com`.
No display server is needed (headless).

---

## The specs

### `smoke.spec.ts` — every route renders

For each of the 16 routes in `ROUTES` (`e2e/helpers.ts`):

1. responds **HTTP 200**;
2. renders a **non-empty `<h1>`** — an empty or missing heading is what a blank
   page looks like from outside;
3. **no raw i18n key is visible** anywhere in the body text;
4. **no uncaught exception** (`page.on("pageerror")`) and no unexcused console
   error or failed sub-resource.

Plus: the nav renders with links and no raw keys; an unknown route does not
return 200 (so the 200 assertions above mean something); and the third-party
request check described under *Known findings*.

### `i18n.spec.ts` — the real regression test

Locales `fr`, `th`, `ar`, `qu` against `/`, `/twelve-steps`, `/reflections`,
`/me`, each compared to an English baseline captured in the same run:

- **(a)** no raw key visible in that locale;
- **(b)** the rendering genuinely **changed** from English — both the shared nav
  chrome *and* the page body. This is the only positive proof the locale was
  applied rather than silently falling back to English;
- **(c)** `ar` gives `document.documentElement.dir === "rtl"`, and the *computed*
  direction is `rtl` too (a `dir` attribute is inert if CSS forces `ltr`).

Also: the switcher exposes all **19** shipped locales, persists the choice to
`localStorage["aha:lang"]`, and the choice survives a reload.

Why those five locales: `fr` is the most complete non-English dictionary; `th`
has no inter-word spaces (catches whitespace assumptions); `ar` is the only RTL
locale; `qu` (Runa Simi) is the newest and least-covered dictionary, so the most
likely to regress to English unnoticed.

### `twelve.spec.ts` — "The 12"

The nav label links to `/twelve` and reveals a two-item dropdown on **hover**
and on **focus** (keyboard/touch reachability); `/twelve` carries the
`/images/A-H-A.png` emblem and it actually **loads** (`naturalWidth > 0`, not
merely present in the markup); both `/twelve-steps` and `/twelve-traditions`
show exactly **12** non-empty `<ol> <li>` items; and the Step *prose* is
translated in `fr`, not just the chrome around it.

### `dark-mode.spec.ts`

Toggling gives `documentElement.dataset.theme === "dark"`, and — asserting on
**computed colour**, because a class can be present and style nothing — the nav
background is dark (WCAG relative luminance < 0.2), nav links are near-white
(> 0.7), and the page behind is dark too. The choice persists across reload and
navigation, toggles back to light, and text keeps real contrast on the content
pages.

---

## Determinism notes

`SettingsProvider` renders the **English** tree on the server and swaps to the
stored locale only once its `useEffect` runs on the client. Sampling the DOM too
early therefore sees English for a stored non-English locale — a real, visible
flash, but not a translation defect. The suite avoids that race by:

1. seeding `localStorage["aha:lang"]` via `context.addInitScript` **before** the
   first paint, rather than driving the `<select>`; and
2. gating every assertion on `document.documentElement.lang` matching the
   requested locale (`gotoWithLang` in `e2e/helpers.ts`) — set by the same
   `applyDoc()` call that sets React state.

---

## The raw-key detector

`RAW_KEY_RE` in `e2e/helpers.ts` matches
`<namespace>.<lowerCamelSegment>(.<segment>)*` over the namespaces actually
present in the dictionaries. It was validated **both ways** before being
trusted:

- it matches **all 1062** distinct keys in `lib/i18n.ts` + `lib/i18n.generated.ts`,
  so any one of them leaking to the screen is caught; and
- it produced **zero** hits across **285 rendered pages** (19 locales × 15
  routes) of the live deployment, so it does not false-positive on real prose in
  any shipped language.

Requiring the second segment to start **lowercase** is what keeps ordinary prose
out: a sentence ending "…on the Board. Create a Circle…" would otherwise read as
`board.Create`. Hostnames like `aha.a13z.org` are unaffected because their
leading segment is not a namespace.

`tests/sentinel/e2e-smoke-check.sh` cross-checks the namespace list against the
dictionaries on every run, so **adding a namespace to the app without adding it
to the detector fails the gate** rather than silently creating a blind spot.

---

## Known findings

### Open: every page contacts Google Fonts

`frontend/components/WalletProviders.tsx:7` imports
`@solana/wallet-adapter-react-ui/styles.css`, whose **first line** is:

```css
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&display=swap');
```

`WalletProviders` wraps the whole tree in `app/layout.tsx`, so **every page of
AHA** requests `fonts.googleapis.com` and then `fonts.gstatic.com` on load —
handing Google the member's IP, User-Agent and a `Referer` naming the exact
page, `/recovery` and `/settings-security` included, on an app whose whole
premise is anonymity.

This is what the `no third-party requests on page load` test in `smoke.spec.ts`
asserts, and **that test is red on purpose** until the import is dealt with
(self-host the font, or drop the stylesheet and keep the app's own font stack).
It is app code, so the suite reports it rather than fixing it.

Separately, one of the DM Sans subset URLs Google returns
(`…rP2-p2ywxg089UriI5-g4vlH9VoD8CmcqZG40F9JadbnoEwAopwDRUUHvP-6oMc49xLtf0DPCg.woff2`)
genuinely **404s** — confirmed by direct `curl`, with and without a browser
User-Agent and Referer. That part is Google's CDN, not the app; it is how the
dependency was found.

Because that 404 is a third-party fault, `fonts.gstatic.com` /
`fonts.googleapis.com` failures are excluded from the *generic* per-route
resource check — not because they are acceptable, but so one dependency cannot
randomly redden 15 route tests and bury the finding under noise attributed to
the wrong pages. The dedicated test above is the loud, correct report.

---

## Gate behaviour — it never false-passes

`tests/sentinel/e2e-smoke-check.sh` exits **non-zero** with
`e2e unavailable in this environment` when Playwright, a launchable browser, or
the target is missing, and prints exactly what a CI runner needs. It does not
skip quietly.

`E2E_OPTIONAL=1` downgrades **unavailability only** — never a real test failure
— to a warning and exit 0, for environments that genuinely cannot host a
browser. The message then says coverage was **not** verified that round.

Beyond running the suite, the gate also checks statically that:

- all six suite files exist;
- the route inventory has not shrunk below 16 (so a failing page cannot be
  "fixed" by deleting it from `ROUTES`);
- the raw-key detector covers every namespace present in the dictionaries.

Per the Sentinel spec §4, do not weaken any of this to make a round pass —
a relaxed assertion needs a commit note citing the backlog line that authorises
it.
