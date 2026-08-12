import { test, expect } from "@playwright/test";
import {
  ROUTES,
  findRawKeys,
  watchForErrors,
  expectNoPageErrors,
  isExpectedHost,
} from "./helpers";

/**
 * Route smoke test: every page a member can reach must actually RENDER.
 *
 * The four things asserted per route are the four ways a page can be broken
 * while every static check still passes:
 *   1. it 404s / 500s                        -> status assertion
 *   2. it renders blank or headless          -> non-empty <h1> assertion
 *   3. it renders raw i18n keys              -> RAW_KEY_RE assertion
 *   4. a component throws and renders nothing-> pageerror / console assertion
 */

test.describe("route smoke", () => {
  for (const route of ROUTES) {
    test(`${route} renders`, async ({ page }) => {
      const diag = watchForErrors(page);

      const resp = await page.goto(route, { waitUntil: "networkidle" });

      // 1. the route is served
      expect(resp, `no response for ${route}`).not.toBeNull();
      expect(resp!.status(), `HTTP status for ${route}`).toBe(200);

      // 2. the page has a real heading. An empty or missing <h1> is what a
      //    blank page looks like from the outside.
      const h1 = page.locator("h1").first();
      await expect(h1, `${route} has no <h1>`).toBeVisible();
      const heading = (await h1.innerText()).trim();
      expect(heading.length, `${route} rendered an empty <h1>`).toBeGreaterThan(0);

      // 3. THE key assertion. `translate()` falls back to returning the key
      //    itself, so a broken namespace renders as literal text like
      //    "admin.config.add". Static key checks cannot see this.
      const text = await page.evaluate(() => document.body.innerText);
      const rawKeys = findRawKeys(text);
      expect(
        rawKeys,
        `${route} rendered raw i18n key(s) as visible text — a dictionary lookup fell through to its key name`,
      ).toEqual([]);

      // 3b. the body is not just chrome around nothing
      expect(text.trim().length, `${route} rendered almost no text`).toBeGreaterThan(50);

      // 4. nothing threw
      expectNoPageErrors(diag, route);
    });
  }
});

test.describe("chrome", () => {
  test("nav and footer render on every route without raw keys", async ({ page }) => {
    const diag = watchForErrors(page);
    await page.goto("/", { waitUntil: "networkidle" });

    const nav = page.locator("header.nav");
    await expect(nav).toBeVisible();

    // The nav is the single most reused component in the app; if its
    // dictionary breaks, it breaks on all 15 routes at once.
    const navText = await nav.innerText();
    expect(findRawKeys(navText), "nav rendered raw i18n key(s)").toEqual([]);
    expect(navText.trim().length).toBeGreaterThan(0);

    // Every top-level nav destination must be a real link, not a dead label.
    const links = nav.locator("nav a");
    expect(await links.count(), "nav has no links").toBeGreaterThan(5);

    expectNoPageErrors(diag, "/");
  });

  test("no third-party requests on page load", async ({ page, baseURL }) => {
    // FINDING (open at time of writing, reported not fixed — this suite owns no
    // app code):
    //
    //   frontend/components/WalletProviders.tsx:7 imports
    //   "@solana/wallet-adapter-react-ui/styles.css", whose FIRST line is
    //     @import url('https://fonts.googleapis.com/css2?family=DM+Sans:...')
    //   and WalletProviders wraps the whole tree in app/layout.tsx. So EVERY
    //   page of AHA contacts fonts.googleapis.com and then fonts.gstatic.com,
    //   handing Google the member's IP, User-Agent and a Referer naming the
    //   page — /recovery and /settings-security included.
    //
    //   (One of the DM Sans subset URLs Google returns also 404s, which is how
    //   this was found. That part is Google's CDN, not the app.)
    //
    // The fix is one line — self-host the font, or drop the stylesheet import
    // and keep the app's own font stack — but it is app code, so it is reported
    // rather than applied. This test stays red until then, deliberately.
    const baseHost = new URL(baseURL!).hostname;
    const foreign = new Set<string>();
    page.on("request", (req) => {
      const host = new URL(req.url()).hostname;
      if (!isExpectedHost(host, baseHost)) foreign.add(`${host} (${req.resourceType()})`);
    });

    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    expect(
      [...foreign].sort(),
      "the app contacted a third-party host on page load — this leaks the member's IP, User-Agent and the page they are on",
    ).toEqual([]);
  });

  test("an unknown route does not 200", async ({ page }) => {
    // Guards against a catch-all that silently swallows typos and renders an
    // empty shell — which would make the 200 assertions above meaningless.
    const resp = await page.goto("/this-route-does-not-exist-e2e", {
      waitUntil: "domcontentloaded",
    });
    expect(resp!.status(), "unknown route should not report success").not.toBe(200);
  });
});
