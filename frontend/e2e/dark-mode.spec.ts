import { test, expect } from "@playwright/test";
import { luminance, watchForErrors, expectNoPageErrors, THEME_KEY } from "./helpers";

/**
 * Dark mode.
 *
 * Locks in the fix that just shipped. The failure this guards against is the
 * one that is invisible to every static check and to a light-mode screenshot:
 * `data-theme="dark"` is set on <html>, but a stylesheet rule never lands, so
 * the nav stays light-on-light (or white text on a white bar) and the nav
 * becomes unreadable. So the assertions are on COMPUTED colour, not on class
 * names — a class can be present and style nothing.
 */

/** Anything below this reads as a dark surface. Pure black is 0, white is 1. */
const DARK_LUMINANCE_MAX = 0.2;
/** Nav links in dark mode must be near-white to stay legible. */
const LIGHT_TEXT_LUMINANCE_MIN = 0.7;

test.describe("dark mode", () => {
  test("toggling sets the dark theme and repaints the nav", async ({ page }) => {
    const diag = watchForErrors(page);
    await page.goto("/", { waitUntil: "networkidle" });

    // Default is light (SettingsProvider falls back to "light").
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    const lightNavBg = await page
      .locator("header.nav")
      .evaluate((el) => getComputedStyle(el).backgroundColor);

    const toggle = page.locator("button.theme-toggle");
    await expect(toggle, "the theme toggle is missing from the nav").toBeVisible();
    await toggle.click();

    // 1. the theme flag flipped
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // 2. the nav actually repainted dark
    const nav = page.locator("header.nav");
    const navBg = await nav.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(navBg, "the nav background did not change when dark mode was enabled").not.toBe(
      lightNavBg,
    );
    expect(
      luminance(navBg),
      `the nav background ${navBg} is not a dark colour in dark mode`,
    ).toBeLessThan(DARK_LUMINANCE_MAX);

    // 3. nav links are legible against it
    const linkColor = await nav
      .locator("nav a")
      .first()
      .evaluate((el) => getComputedStyle(el).color);
    expect(
      luminance(linkColor),
      `nav link colour ${linkColor} is not near-white in dark mode — links would be unreadable on the dark nav`,
    ).toBeGreaterThan(LIGHT_TEXT_LUMINANCE_MIN);

    // 4. the page behind it is dark too, so the nav is not a dark island
    const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(
      luminance(bodyBg),
      `the page background ${bodyBg} is not dark in dark mode`,
    ).toBeLessThan(DARK_LUMINANCE_MAX);

    expectNoPageErrors(diag, "/ (dark mode)");
  });

  test("the choice persists across reload and navigation", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.locator("button.theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    expect(
      await page.evaluate((k) => localStorage.getItem(k), THEME_KEY),
      "the theme choice was not persisted",
    ).toBe("dark");

    await page.reload({ waitUntil: "networkidle" });
    await expect(
      page.locator("html"),
      "dark mode did not survive a reload",
    ).toHaveAttribute("data-theme", "dark");

    // ...and on another route, since the theme lives in shared chrome.
    await page.goto("/twelve-steps", { waitUntil: "networkidle" });
    await expect(
      page.locator("html"),
      "dark mode did not carry across a navigation",
    ).toHaveAttribute("data-theme", "dark");
    const navBg = await page
      .locator("header.nav")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(luminance(navBg)).toBeLessThan(DARK_LUMINANCE_MAX);
  });

  test("toggling back returns to light", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const toggle = page.locator("button.theme-toggle");
    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    const navBg = await page
      .locator("header.nav")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(
      luminance(navBg),
      `the nav background ${navBg} is still dark after toggling back to light`,
    ).toBeGreaterThan(DARK_LUMINANCE_MAX);
  });

  test("dark mode does not break rendering on the content pages", async ({ page }) => {
    // A theme regression that only shows on a text-heavy page (e.g. a rule that
    // paints text the same colour as its background) would slip past a check
    // that only ever looks at the home page.
    const diag = watchForErrors(page);
    await page.goto("/", { waitUntil: "networkidle" });
    await page.locator("button.theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    for (const route of ["/twelve-traditions", "/reflections", "/me"]) {
      await page.goto(route, { waitUntil: "networkidle" });
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

      const main = page.locator("main").first();
      await expect(main).toBeVisible();
      const { color, bg } = await main.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { color: cs.color, bg: getComputedStyle(document.body).backgroundColor };
      });
      // Text must contrast with the page it sits on.
      const delta = Math.abs(luminance(color) - luminance(bg));
      expect(
        delta,
        `${route} in dark mode: body text ${color} barely contrasts with the page background ${bg}`,
      ).toBeGreaterThan(0.2);
    }

    expectNoPageErrors(diag, "dark mode content pages");
  });
});
