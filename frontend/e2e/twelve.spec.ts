import { test, expect } from "@playwright/test";
import { findRawKeys, watchForErrors, expectNoPageErrors, seedLang, gotoWithLang } from "./helpers";

/**
 * "The 12" — the nav menu, the /twelve landing page, and the two pages behind
 * it (F90).
 *
 * Written against the CURRENT shape of the feature: the nav label is itself a
 * link to /twelve that reveals a two-item dropdown on hover/focus, and the AHA
 * emblem sits on the /twelve landing page. (An earlier revision put the emblem
 * inside the dropdown and made the label a <button>; if this spec starts
 * failing on the selectors below, check components/Nav.tsx first — the markup
 * moved, which is exactly what this spec is for.)
 *
 * These break quietly: a menu that never opens still looks correct in a
 * screenshot of the nav, and a missing emblem renders as empty space rather
 * than as an error.
 */

// TWO lists, because the nav menu and the /twelve page no longer agree and the
// difference is real rather than a bug in the test.
//
// MENU_DESTINATIONS is what the Resources dropdown offers (renamed from "The
// 12"); Glossary joined it on 2026-08-14. TWELVE_PAGES is the pair that is
// actually "the 12" — twelve numbered items each. Glossary is neither: it has
// no twelve of anything, so the second describe block below (which asserts each
// page has twelve numbered items) still iterates TWELVE_PAGES, not the doors.
//
// RESOLVED 2026-08-16 (was: an open product call): the /twelve hub now offers a
// THIRD door to the Glossary, at the user's request, so the page and the menu
// above it agree — the Glossary is reachable from both. The door set therefore
// equals MENU_DESTINATIONS, in menu order.
const MENU_DESTINATIONS = ["/twelve-steps", "/twelve-traditions", "/glossary"] as const;
const TWELVE_PAGES = ["/twelve-steps", "/twelve-traditions"] as const;

test.describe("The 12 — nav menu", () => {
  test("the label links to /twelve and reveals both destinations", async ({ page }) => {
    const diag = watchForErrors(page);
    await page.goto("/", { waitUntil: "networkidle" });

    const trigger = page.locator("a.nav-menu-btn");
    await expect(trigger, "the 'The 12' entry is missing from the nav").toBeVisible();
    await expect(trigger).toHaveAttribute("href", "/twelve");
    await expect(trigger).toHaveAttribute("aria-haspopup", "true");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    const drop = page.locator(".nav-drop");
    // Closed to begin with: `display: none` until `.is-open`.
    await expect(drop).not.toHaveClass(/is-open/);

    // Opens on hover (pointer) ...
    await trigger.hover();
    await expect(trigger, "hovering did not open the menu").toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(drop).toHaveClass(/is-open/);

    const items = drop.locator("a[role='menuitem']");
    await expect(items, "the menu should offer exactly the MENU_DESTINATIONS entries").toHaveCount(MENU_DESTINATIONS.length);
    const hrefs = await items.evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    expect(hrefs).toEqual([...MENU_DESTINATIONS]);

    // ...and every item shows a translated label, not a raw key.
    const menuText = await drop.innerText();
    expect(findRawKeys(menuText), "the menu rendered raw i18n key(s)").toEqual([]);
    expect(menuText.trim().length).toBeGreaterThan(0);

    expectNoPageErrors(diag, "/ (The 12 menu)");
  });

  test("the menu is reachable without a mouse", async ({ page }) => {
    // Keyboard and touch members get the menu via focus, not hover. If this
    // regresses, The 12 becomes mouse-only and the dropdown is unreachable.
    await page.goto("/", { waitUntil: "networkidle" });
    const trigger = page.locator("a.nav-menu-btn");
    await trigger.focus();
    await expect(trigger, "focusing the label did not open the menu").toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(page.locator(".nav-drop")).toHaveClass(/is-open/);
  });

  test("clicking the label lands on the /twelve hub", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.locator("a.nav-menu-btn").click();
    await page.waitForURL("**/twelve");
    await expect(page.locator("h1")).toBeVisible();
  });
});

test.describe("The 12 — the hub page", () => {
  test("/twelve carries the AHA emblem and its three doors", async ({ page }) => {
    const diag = watchForErrors(page);
    await page.goto("/twelve", { waitUntil: "networkidle" });

    await expect(page.locator("h1")).toBeVisible();

    // The emblem must actually LOAD, not merely be present in the markup — a
    // broken src renders as empty space and nothing errors.
    const art = page.locator("img.twelve-hub-art");
    await expect(art, "the emblem is missing from /twelve").toBeVisible();
    await expect(art).toHaveAttribute("src", "/images/A-H-A.png");
    await expect
      .poll(
        async () => art.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth),
        { message: "/images/A-H-A.png did not load (naturalWidth stayed 0)" },
      )
      .toBeGreaterThan(0);

    const doors = page.locator("a.twelve-door");
    await expect(doors, "/twelve should offer three doors (Steps, Traditions, Glossary)").toHaveCount(
      MENU_DESTINATIONS.length,
    );
    const hrefs = await doors.evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    expect(hrefs).toEqual([...MENU_DESTINATIONS]);

    const body = await page.evaluate(() => document.body.innerText);
    expect(findRawKeys(body), "/twelve rendered raw i18n key(s)").toEqual([]);

    expectNoPageErrors(diag, "/twelve");
  });
});

test.describe("The 12 — the Steps and the Traditions", () => {
  for (const [i, route] of TWELVE_PAGES.entries()) {
    test(`reaching ${route} from the menu shows 12 numbered items`, async ({ page }) => {
      const diag = watchForErrors(page);
      await page.goto("/", { waitUntil: "networkidle" });

      await page.locator("a.nav-menu-btn").hover();
      await page.locator(".nav-drop a[role='menuitem']").nth(i).click();

      await page.waitForURL(`**${route}`);
      await expect(page.locator("h1")).toBeVisible();

      // The substance of the page: twelve items, in an ordered list so the
      // numbering is semantic rather than typed-in digits.
      const items = page.locator("ol > li");
      await expect(items, `${route} should list exactly 12 items`).toHaveCount(12);

      const texts = await items.evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()));
      for (const [n, t] of texts.entries()) {
        expect(t.length, `${route} item ${n + 1} is empty`).toBeGreaterThan(10);
      }

      const body = await page.evaluate(() => document.body.innerText);
      expect(findRawKeys(body), `${route} rendered raw i18n key(s)`).toEqual([]);

      expectNoPageErrors(diag, route);
    });
  }

  test("the Steps text itself is translated, not just the chrome", async ({ browser }) => {
    // F90 shipped the Steps and Traditions prose into all 19 locales. Guard the
    // BODY: a translated nav around English Steps is the failure mode here.
    const context = await browser.newContext();
    await seedLang(context, "fr");
    const page = await context.newPage();
    try {
      await gotoWithLang(page, "/twelve-steps", "fr");
      const items = page.locator("ol > li");
      await expect(items).toHaveCount(12);
      const joined = (
        await items.evaluateAll((els) => els.map((e) => e.textContent ?? "").join(" "))
      ).replace(/\s+/g, " ");
      expect(joined.length, "fr /twelve-steps rendered no Step text").toBeGreaterThan(200);
      expect(findRawKeys(joined), "fr /twelve-steps rendered raw i18n key(s)").toEqual([]);
    } finally {
      await context.close();
    }
  });
});
