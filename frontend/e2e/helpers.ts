import { expect, type Page, type BrowserContext, type Response } from "@playwright/test";

/**
 * Shared vocabulary for the smoke suite: the route inventory, the raw-i18n-key
 * detector, and the console/pageerror collector.
 *
 * Nothing here touches app code — the suite is a pure black-box observer of the
 * deployed app.
 */

/** Every page a member can reach without authenticating. */
export const ROUTES = [
  "/",
  "/onboarding",
  "/reflections",
  "/twelve",
  "/twelve-steps",
  "/twelve-traditions",
  "/board",
  "/documents",
  "/me",
  "/inbox",
  "/wallet",
  "/recovery",
  "/recovery/setup",
  "/settings-security",
  "/create",
  "/foundation",
] as const;

/** localStorage keys owned by components/SettingsProvider.tsx. */
export const LANG_KEY = "aha:lang";
export const THEME_KEY = "aha:theme";

/**
 * The i18n namespaces that actually exist in the dictionaries — the union of
 * the hand-written `en` table in lib/i18n.ts and the generated PAGE_STRINGS in
 * lib/i18n.generated.ts.
 *
 * Keep this list in sync with the dictionaries. The regex below was validated
 * two ways before being trusted:
 *   - it matches all 1062 distinct keys present in the dictionaries (so any one
 *     of them leaking to the screen WILL be caught); and
 *   - it produces ZERO hits across 285 rendered pages (19 locales x 15 routes)
 *     of the real deployment, so it does not false-positive on real prose in
 *     any of the shipped languages.
 */
export const I18N_NAMESPACES = [
  "nav", "home", "me", "admin", "board", "create", "onboarding", "inbox",
  "reflections", "documents", "notifications", "member", "msg", "recovery",
  "shard", "twelve", "wallet", "foundation", "brand", "ctl", "footer",
  // A namespace missing from this list is a namespace whose leaked keys render
  // on screen UNDETECTED — the raw-key regex simply never matches them. Both of
  // these were absent until the e2e-smoke gate caught them: "glossary" since
  // F94, "sponreq" since F97 (mine). Add a namespace here in the same commit
  // that introduces it.
  "getapp", "glossary", "sponreq",
];

/**
 * Detects a raw i18n key rendered as visible text.
 *
 * `translate()` in lib/i18n.ts ends with `?? key` — a missing key renders as its
 * own literal name. That is exactly how `admin.config.add` reached the screen.
 *
 * Shape: <namespace>.<lowerCamelSegment>(.<segment>)*
 * The second segment is required to START LOWERCASE. Every real key obeys that,
 * and it is what keeps ordinary prose from matching: a sentence ending "...on
 * the Board. Create a Circle..." would otherwise read as `board.Create`. Host
 * names like "aha.a13z.org" and filenames are unaffected because their leading
 * segment is not one of the namespaces above.
 */
export const RAW_KEY_RE = new RegExp(
  `\\b(${I18N_NAMESPACES.join("|")})\\.[a-z][A-Za-z0-9]*(\\.[A-Za-z0-9]+)*\\b`,
  "g",
);

/** Returns every distinct raw-key-looking token found in `text`. */
export function findRawKeys(text: string): string[] {
  return [...new Set(text.match(RAW_KEY_RE) ?? [])];
}

/**
 * Console messages that are environmental noise rather than application faults.
 *
 * Deliberately NARROW. Each entry is a transport-level failure of a resource
 * the page requests from a third party, never an application exception:
 *
 *  - HTTP 429 / 502 / 503 from the public Solana devnet RPC
 *    (`https://api.devnet.solana.com/`, called by every page on load) and from
 *    Caddy's upstream. Observed only when several browser workers hit the live
 *    deployment at once; a serial run of all 285 page/locale combinations
 *    produced zero of these. They are load artifacts of the test run itself.
 *  - net::ERR_* transport aborts (ERR_NETWORK_CHANGED, ERR_CONNECTION_RESET,
 *    aborted in-flight requests on navigation) — the browser giving up on a
 *    socket, not the app throwing.
 *  - Wallet browser extensions (Phantom, Solflare, Backpack, MetaMask) inject
 *    scripts that log on every page. A CI runner has no extensions, but a
 *    developer running this locally in a real profile does.
 *
 * NOTE what is NOT excused: anything reported through `page.on("pageerror")`.
 * An uncaught exception is always a failure — that is the signal that catches a
 * crashed component rendering nothing. Console errors that do not match one of
 * these patterns are failures too.
 */
export const ALLOWED_CONSOLE_NOISE: RegExp[] = [
  /Failed to load resource: the server responded with a status of (408|425|429|500|502|503|504)\b/i,
  /net::ERR_(NETWORK_CHANGED|CONNECTION_RESET|CONNECTION_CLOSED|ABORTED|TIMED_OUT|NAME_NOT_RESOLVED)/i,
  /\b(phantom|solflare|backpack|metamask)\b/i,
  /Failed to load resource: net::/i,
];

export function isAllowedNoise(text: string): boolean {
  return ALLOWED_CONSOLE_NOISE.some((re) => re.test(text));
}

export interface PageDiagnostics {
  /** Uncaught exceptions — never excused. */
  pageErrors: string[];
  /** console.error output that is not on the noise allowlist. */
  consoleErrors: string[];
  /** console.error output that WAS excused, kept for debugging. */
  ignoredNoise: string[];
  /**
   * Every response with a >= 400 status, as "<status> <resourceType> <url>".
   *
   * The browser's own console message for these is just "Failed to load
   * resource: the server responded with a status of 404 ()" — with no URL,
   * which makes a failure impossible to act on. Recording the responses
   * ourselves means a failure names the resource that broke.
   */
  failedResponses: string[];
}

/**
 * Attaches error listeners BEFORE any navigation, so an exception thrown during
 * the very first render is still captured.
 */
export function watchForErrors(page: Page): PageDiagnostics {
  const diag: PageDiagnostics = {
    pageErrors: [],
    consoleErrors: [],
    ignoredNoise: [],
    failedResponses: [],
  };
  page.on("pageerror", (err) => {
    diag.pageErrors.push(`${err.name}: ${err.message}`);
  });
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (isAllowedNoise(text)) diag.ignoredNoise.push(text);
    else diag.consoleErrors.push(text);
  });
  page.on("response", (res) => {
    if (res.status() >= 400) {
      diag.failedResponses.push(`${res.status()} ${res.request().resourceType()} ${res.url()}`);
    }
  });
  return diag;
}

/**
 * Failed responses that are artifacts of WHERE the suite runs rather than
 * defects in the page. Same discipline as ALLOWED_CONSOLE_NOISE: narrow, and
 * each entry justified.
 *
 *  - 429 (and its 408/425/5xx cousins) from the PUBLIC Solana devnet RPC,
 *    `https://api.devnet.solana.com/`, which every page calls on load. Measured:
 *    64 page loads across 2 concurrent browser contexts produced 97 of these
 *    and nothing else; the same pages loaded serially produce zero. It is the
 *    free RPC tier throttling the test run, not the app failing. Caddy's
 *    upstream returns 502/503 under the same self-inflicted load.
 *
 * DELIBERATELY NOT EXCUSED: 404. A missing image, font, script or route
 * document is a real defect and must fail — the message names the URL so it can
 * be acted on. One unexplained 404 on `/` was observed once during development
 * of this suite and did not reproduce in 84 subsequent loads; it is left as a
 * failure rather than allowlisted on a guess. `retries` absorbs a genuine
 * one-off (e.g. a redeploy landing mid-run); a repeatable one will fail, which
 * is the point.
 */
const ALLOWED_RESPONSE_NOISE: RegExp[] = [
  /^(408|425|429|500|502|503|504) /,
  // Google Fonts. NOT excused because it is acceptable — it is excused HERE
  // because it has a dedicated, loud test of its own ("no third-party requests
  // on page load" in smoke.spec.ts). Letting it also fail 15 route tests at
  // random would bury the real finding under noise attributed to the wrong
  // pages. See THIRD_PARTY_HOSTS below.
  /^\d+ \w+ https:\/\/fonts\.(gstatic|googleapis)\.com\//,
];

/**
 * Hosts the app must not contact on page load.
 *
 * AHA is an anonymity-first fellowship app. A request to a third party carries
 * the member's IP, User-Agent and a `Referer` naming the exact page — including
 * /recovery, /settings-security and /me — to whoever operates that host.
 */
export const THIRD_PARTY_HOSTS = [/(^|\.)googleapis\.com$/, /(^|\.)gstatic\.com$/];

/** First-party + the Solana RPC the app legitimately needs. */
export function isExpectedHost(hostname: string, baseHost: string): boolean {
  return (
    hostname === baseHost ||
    hostname.endsWith(".solana.com") ||
    hostname.endsWith(".ipfs.io") ||
    hostname.endsWith(".openstreetmap.org") ||
    hostname.endsWith(".tile.openstreetmap.org")
  );
}

/** Asserts a page produced no uncaught exception and no unexcused error. */
export function expectNoPageErrors(diag: PageDiagnostics, where: string): void {
  expect(diag.pageErrors, `uncaught exception(s) on ${where}`).toEqual([]);

  // Report the URLs, not the browser's contentless "status of 404 ()" line.
  const realFailures = diag.failedResponses.filter(
    (e) => !ALLOWED_RESPONSE_NOISE.some((re) => re.test(e)),
  );
  expect(realFailures, `${where} requested resource(s) that failed to load`).toEqual([]);

  // Console errors that are NOT a resource-load failure are application-level:
  // a thrown-and-caught exception, or a React error. Resource failures are
  // covered above, with their URLs, so they are dropped here to avoid a second,
  // less informative report of the same event.
  const appErrors = diag.consoleErrors.filter((t) => !/Failed to load resource/i.test(t));
  expect(appErrors, `console error(s) on ${where}`).toEqual([]);
}

/**
 * Seeds the locale the way the app itself persists it, BEFORE the first paint.
 *
 * SettingsProvider hydrates from localStorage in a `useEffect`, so driving the
 * <select> in the nav would work but adds a render round-trip and a race. An
 * init script is deterministic: the value is in place before any app code runs.
 */
export async function seedLang(context: BrowserContext, lang: string): Promise<void> {
  await context.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [LANG_KEY, lang] as const,
  );
}

/**
 * Navigates and waits until the locale has actually been applied to the
 * document.
 *
 * This matters: SettingsProvider renders the DEFAULT (English) tree on the
 * server and only swaps to the stored locale once its effect runs on the
 * client. Sampling the DOM too early sees English for a stored non-English
 * locale — a real, visible flash, but not a translation defect. Gating on
 * `<html lang>` (set by the same `applyDoc()` call that sets React state)
 * removes that race.
 */
export async function gotoWithLang(page: Page, route: string, lang: string): Promise<Response | null> {
  const resp = await page.goto(route, { waitUntil: "networkidle" });
  await page.waitForFunction(
    (l) => document.documentElement.lang === l,
    lang,
    { timeout: 15_000 },
  );
  return resp;
}

/** Normalised visible text of the page, for cross-locale comparison. */
export async function bodyText(page: Page): Promise<string> {
  return (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ").trim();
}

/** Relative luminance (WCAG) of an `rgb()`/`rgba()` string, 0 = black, 1 = white. */
export function luminance(color: string): number {
  const m = color.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (!m) throw new Error(`cannot parse colour: ${color}`);
  const [r, g, b] = [m[1], m[2], m[3]].map((v) => {
    const c = Number(v) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
