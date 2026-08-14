// F95 — the mobile wallet notice, exercised on a mobile user agent.
//
// WHY THIS FILE EXISTS SEPARATELY. A Sentinel round found that the suite's
// "no third-party requests on page load" test ran only under the Desktop Chrome
// project, where shouldOfferWalletBrowser() is false. So MobileWalletNotice
// never mounted, its fetch("/wallets.json") never fired, and the privacy
// property held for a reason no committed test established. Coverage that
// cannot fail is worse than absent coverage, because it reads as proof.
//
// This spec runs under the `mobile-firefox-android` project only (see
// playwright.config.ts) — Pixel 7 viewport, the user agent Firefox for Android
// actually sends. That UA is what makes the app conclude Mobile Wallet Adapter
// will hang.
//
// WHAT THIS CANNOT PROVE, said plainly so nobody reads more into a green run:
// the engine here is still Chromium. This emulates the DETECTION path, not
// Gecko. It cannot demonstrate that the MWA handshake fails on real Firefox —
// that is a device property, established by the original bug report and by the
// adapter's own environment check, not by this file.

import { test, expect } from "@playwright/test";
import { isExpectedHost, watchForErrors, expectNoPageErrors } from "./helpers";

const NOTICE = ".mw-notice";
const BUTTON = ".mw-notice-btn";

test.describe("mobile wallet notice", () => {
  test("warns before the tap, on the browser that cannot connect", async ({ page }) => {
    const diag = watchForErrors(page);
    await page.goto("/", { waitUntil: "networkidle" });

    const notice = page.locator(NOTICE);
    await expect(notice, "the banner did not render on a mobile UA").toBeVisible();
    // Firefox/Android is the "will hang" case, so it must carry the stronger
    // warning styling, not the merely-helpful variant.
    await expect(notice).toHaveClass(/is-warning/);

    const text = await notice.innerText();
    expect(text.toLowerCase()).toContain("will not work");

    expectNoPageErrors(diag, "/ (mobile wallet notice)");
  });

  test("offers every wallet that publishes a browse link, and only those", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.locator(NOTICE)).toBeVisible();

    // The banner is data-driven: whatever wallets.json marks with `browse` is
    // exactly what must appear. Asserting against the file rather than a
    // hardcoded pair means adding a wallet cannot silently skip this test.
    const cfg = await page.evaluate(async () => {
      const r = await fetch("/wallets.json");
      return (await r.json()) as { wallets: { id: string; name: string; browse?: string }[] };
    });
    const expected = cfg.wallets.filter((w) => w.browse).map((w) => w.name).sort();
    expect(expected.length, "wallets.json marks no wallet with `browse`").toBeGreaterThan(0);

    const buttons = page.locator(BUTTON);
    await expect(buttons).toHaveCount(expected.length);
    const labels = await buttons.evaluateAll((els) =>
      els.map((e) => (e.textContent || "").replace(/^Open in\s+/, "").trim())
    );
    expect(labels.slice().sort()).toEqual(expected);

    // A wallet with no `browse` must be absent, not rendered as a dead button.
    const without = cfg.wallets.filter((w) => !w.browse).map((w) => w.name);
    for (const name of without) {
      expect(labels, `${name} has no browse link but was offered anyway`).not.toContain(name);
    }
  });

  test("the deep links keep the port and point back at this site", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const hrefs = await page
      .locator(BUTTON)
      .evaluateAll((els) => els.map((e) => e.getAttribute("href") || ""));
    expect(hrefs.length).toBeGreaterThan(0);

    const origin = new URL(baseURL!).origin;
    for (const href of hrefs) {
      const u = new URL(href);
      // The target must be percent-encoded INSIDE the path, not appended raw:
      // this site runs on a non-default port, and an unencoded ":8443" is what
      // makes these links drop the port and land on the wrong host.
      expect(href, "the target was not percent-encoded").toContain(
        encodeURIComponent(origin)
      );
      expect(u.searchParams.get("ref"), "ref must name this origin").toBe(origin);
      expect(href).not.toContain(`${origin}/`); // i.e. never the raw, unencoded form
    }
  });

  test("mounting the notice contacts no third-party host", async ({ page, baseURL }) => {
    // The gap this whole file was written for. On desktop this assertion passed
    // without the banner ever mounting.
    const baseHost = new URL(baseURL!).hostname;
    const foreign = new Set<string>();
    page.on("request", (req) => {
      const host = new URL(req.url()).hostname;
      if (!isExpectedHost(host, baseHost)) foreign.add(`${host} (${req.resourceType()})`);
    });

    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.locator(NOTICE)).toBeVisible();
    await page.waitForTimeout(1500);

    expect(
      [...foreign].sort(),
      "the mobile banner contacted a third-party host — this leaks the member's IP and the page they are on"
    ).toEqual([]);
  });

  test("dismissing it keeps it gone for the rest of the visit", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const notice = page.locator(NOTICE);
    await expect(notice).toBeVisible();
    await page.locator(".mw-notice-dismiss").click();
    await expect(notice).toHaveCount(0);
  });
});
