import { test, expect, type Browser } from "@playwright/test";
import {
  seedLang,
  gotoWithLang,
  bodyText,
  findRawKeys,
  watchForErrors,
  expectNoPageErrors,
} from "./helpers";

/**
 * The real i18n regression test.
 *
 * `tests/sentinel/i18n-key-check.sh` proves a key EXISTS in a dictionary. It
 * cannot prove the dictionary is reached, that the value is non-empty, or that
 * anything on screen actually changed language. The Circle Administration
 * incident passed that check while rendering `admin.config.add` to every member
 * in every one of the 19 locales.
 *
 * So this spec renders real pages in real locales and asserts three things:
 *   (a) no raw key is visible;
 *   (b) the rendering genuinely CHANGED from English — both the shared nav
 *       chrome and the page body — which is the only positive proof that the
 *       locale was applied rather than silently falling back;
 *   (c) Arabic lays out right-to-left.
 */

/**
 * A representative slice of the 19 shipped locales, chosen for coverage of the
 * things that break differently:
 *   fr — Latin script, the most complete non-English dictionary
 *   th — no inter-word spaces; catches naive whitespace/truncation assumptions
 *   ar — right-to-left; the only locale in lib/i18n.ts's RTL set
 *   qu — Runa Simi, the newest and least-covered dictionary, so the likeliest
 *        to regress to English fallback without anyone noticing
 */
const LOCALES = ["fr", "th", "ar", "qu"] as const;

/** Routes verified to be fully translated in every locale above. */
const I18N_ROUTES = ["/", "/twelve-steps", "/reflections", "/me"] as const;

const RTL_LOCALES = new Set(["ar"]);

interface Snapshot {
  body: string;
  nav: string;
  h1: string;
  dir: string;
}

async function snapshot(browser: Browser, lang: string, route: string): Promise<Snapshot> {
  const context = await browser.newContext();
  await seedLang(context, lang);
  const page = await context.newPage();
  const diag = watchForErrors(page);
  try {
    const resp = await gotoWithLang(page, route, lang);
    expect(resp!.status(), `HTTP status for ${lang} ${route}`).toBe(200);
    // Let the post-locale re-render settle before sampling text.
    await page.locator("h1").first().waitFor({ state: "visible" });
    const snap = await page.evaluate(() => ({
      body: document.body.innerText,
      nav: document.querySelector("header.nav nav")?.textContent ?? "",
      h1: document.querySelector("h1")?.textContent ?? "",
      dir: document.documentElement.dir,
    }));
    expectNoPageErrors(diag, `${lang} ${route}`);
    return {
      body: snap.body.replace(/\s+/g, " ").trim(),
      nav: snap.nav.replace(/\s+/g, " ").trim(),
      h1: snap.h1.replace(/\s+/g, " ").trim(),
      dir: snap.dir,
    };
  } finally {
    await context.close();
  }
}

test.describe("i18n rendering", () => {
  // English baseline for each route, captured once per worker.
  const english: Record<string, Snapshot> = {};

  test.beforeAll(async ({ browser }) => {
    for (const route of I18N_ROUTES) {
      english[route] = await snapshot(browser, "en", route);
    }
  });

  test("English baseline is itself sane", async () => {
    for (const route of I18N_ROUTES) {
      const en = english[route];
      expect(findRawKeys(en.body), `en ${route} rendered raw i18n key(s)`).toEqual([]);
      expect(en.h1.length, `en ${route} has an empty <h1>`).toBeGreaterThan(0);
      expect(en.dir, `en ${route} should be left-to-right`).toBe("ltr");
    }
  });

  for (const lang of LOCALES) {
    test.describe(`locale: ${lang}`, () => {
      for (const route of I18N_ROUTES) {
        test(`${route} is translated and key-clean`, async ({ browser }) => {
          const snap = await snapshot(browser, lang, route);
          const en = english[route];

          // (a) no raw key leaked to the screen in this locale
          expect(
            findRawKeys(snap.body),
            `${lang} ${route} rendered raw i18n key(s) — a lookup fell through to its key name`,
          ).toEqual([]);

          // the page still has a real heading in this locale
          expect(snap.h1.length, `${lang} ${route} rendered an empty <h1>`).toBeGreaterThan(0);

          // (b) proof the locale was actually applied.
          //
          // The nav is shared chrome present on every route and translated in
          // every shipped locale, so it is the strictest available signal: if
          // the nav still reads English, the locale never took effect at all.
          expect(
            snap.nav,
            `${lang} ${route}: the nav still renders the English strings — the locale was not applied`,
          ).not.toBe(en.nav);

          // ...and the page BODY changed too, so this is a real translation and
          // not just a translated shell around an English page.
          expect(
            snap.body,
            `${lang} ${route}: the page body is byte-identical to the English rendering — the body fell back to English`,
          ).not.toBe(en.body);

          // (c) direction
          const expectedDir = RTL_LOCALES.has(lang) ? "rtl" : "ltr";
          expect(snap.dir, `${lang} ${route}: wrong text direction`).toBe(expectedDir);
        });
      }
    });
  }

  test("ar lays out right-to-left across the whole document", async ({ browser }) => {
    const context = await browser.newContext();
    await seedLang(context, "ar");
    const page = await context.newPage();
    try {
      await gotoWithLang(page, "/", "ar");
      const doc = await page.evaluate(() => ({
        dir: document.documentElement.dir,
        lang: document.documentElement.lang,
        computed: getComputedStyle(document.documentElement).direction,
      }));
      expect(doc.dir, "documentElement.dir").toBe("rtl");
      expect(doc.lang, "documentElement.lang").toBe("ar");
      // dir="rtl" is inert if a stylesheet forces `direction: ltr`.
      expect(doc.computed, "computed direction on <html>").toBe("rtl");
    } finally {
      await context.close();
    }
  });

  test("the language switcher offers every shipped locale and persists the choice", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const select = page.locator("select.lang-select");
    await expect(select).toBeVisible();

    const codes = await select.locator("option").evaluateAll((opts) =>
      opts.map((o) => (o as HTMLOptionElement).value),
    );
    // lib/i18n.ts ships 19 locales; the switcher must expose all of them.
    expect(codes.length, "language switcher option count").toBe(19);
    expect(codes, "language switcher is missing a locale").toEqual(
      expect.arrayContaining(["en", "fr", "th", "ar", "qu"]),
    );

    // Driving the real control (not localStorage) proves the switcher is wired.
    await select.selectOption("fr");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    expect(
      await page.evaluate(() => localStorage.getItem("aha:lang")),
      "the chosen language was not persisted",
    ).toBe("fr");

    // ...and it survives a reload.
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  });
});
