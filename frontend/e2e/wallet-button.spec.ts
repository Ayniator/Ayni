// The connect button's label and its Solana mark.
//
// Both are load-bearing and both are easy to lose silently:
//
//   * The label comes from a LABELS object we pass to BaseWalletMultiButton.
//     Reverting to the upstream `WalletMultiButton` would compile, render, and
//     quietly say "Select Wallet" again — nothing else in the suite reads this
//     string.
//   * The mark is a CSS ::before, chosen because the library overwrites
//     `startIcon` unconditionally. A rename of the upstream trigger class, or
//     dropping :has() support, would remove the icon with no error anywhere.
//
// The `:not(:has(...))` guard is asserted too, since the failure it prevents —
// the Solana mark and the selected wallet's own icon rendering side by side —
// only appears once a wallet is connected, which the desktop suite never
// reaches.

import { test, expect } from "@playwright/test";

const TRIGGER = ".sol-wallet .wallet-adapter-button-trigger";

test.describe("connect button", () => {
  test("says Connect, not Select Wallet", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const btn = page.locator(TRIGGER);
    await expect(btn).toBeVisible();
    await expect(btn).toHaveText("Connect");
  });

  test("carries the Solana mark inside the button", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const mark = await page.locator(TRIGGER).evaluate((el) => {
      const s = getComputedStyle(el, "::before");
      return {
        rendered: s.content !== "none",
        width: parseFloat(s.width),
        height: parseFloat(s.height),
        isSvg: (s.backgroundImage || "").includes("svg"),
      };
    });
    expect(mark.rendered, "the ::before mark is not rendered").toBe(true);
    expect(mark.isSvg, "the mark is not an inline SVG background").toBe(true);
    // A zero-sized ::before would satisfy "rendered" while showing nothing.
    expect(mark.width).toBeGreaterThan(8);
    expect(mark.height).toBeGreaterThan(6);
  });

  test("the mark steps aside once a wallet icon is present", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    // Inject the element the library renders for a selected wallet, and confirm
    // the :not(:has(...)) guard suppresses our mark rather than stacking two.
    const suppressed = await page.locator(TRIGGER).evaluate((el) => {
      const i = document.createElement("i");
      i.className = "wallet-adapter-button-start-icon";
      el.prepend(i);
      const hidden = getComputedStyle(el, "::before").content === "none";
      i.remove();
      return hidden;
    });
    expect(suppressed, "two icons would render side by side").toBe(true);
  });

  test("no stray Solana badge is left in the nav", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    // The mark used to live here. If both ever render, the nav shows it twice.
    await expect(page.locator(".sol-badge")).toHaveCount(0);
  });
});
