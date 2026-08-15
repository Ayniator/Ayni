// The mobile banner says three different things, and picking the wrong one is
// not a cosmetic bug.
//
// The first version of this banner had two tones and told iPhone users the
// wallet's in-app browser was "the most reliable way to connect". On Android
// Chrome that sentence is accurate — Mobile Wallet Adapter works there, and the
// in-app browser is one route of two. On iOS it is wrong by understatement:
// @solana/wallet-adapter-react injects the mobile adapter ONLY on Android, so
// Safari, Chrome and Firefox on iPhone and iPad have no path to an external
// wallet at all. "Most reliable" invites someone to keep tapping a button that
// can never work.
//
// So the rule under test is: the SAME sentence must not be shown on a device
// where it is false. Each case below pins the wording that is true for that
// device and, where a previous version got it wrong, asserts the wrong wording
// is gone rather than merely that the right wording is present — a banner can
// contain both.
//
// WHAT THIS DOES NOT PROVE. The engine is Chromium in every case; only the user
// agent varies. This covers the DETECTION and the copy, which is where the bug
// was. It cannot demonstrate that the MWA handshake fails on real Firefox or
// that no path exists on real Safari — those are device properties, established
// by the bug report and by the adapter's own environment check.

import { test, expect } from "@playwright/test";

const NOTICE = ".mw-notice";

const UA = {
  // iPhone, Safari 17.
  ios: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
  // The reporting device: a Galaxy Z Fold on Chrome, where Connect works.
  androidChrome:
    "Mozilla/5.0 (Linux; Android 13; SM-F946B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  // The reporting device on Firefox, where it hangs.
  androidFirefox: "Mozilla/5.0 (Android 13; Mobile; rv:109.0) Gecko/121.0 Firefox/121.0",
};

async function noticeText(page: import("@playwright/test").Page): Promise<string> {
  await page.goto("/", { waitUntil: "networkidle" });
  const notice = page.locator(NOTICE);
  await expect(notice, "the banner did not render on a mobile user agent").toBeVisible();
  return (await notice.innerText()).toLowerCase();
}

test.describe("iOS — the in-app browser is the only route", () => {
  test.use({ userAgent: UA.ios });

  test("says it is the only way, not the most reliable way", async ({ page }) => {
    const text = await noticeText(page);
    expect(text, "iOS is not told the in-app browser is the only route").toContain("only way");
    // The exact regression. "Most reliable" implies an alternative that does
    // not exist on iOS.
    expect(text, 'iOS is being told "most reliable", which implies a second route').not.toContain(
      "most reliable",
    );
    // Not the Android-Firefox message: nothing is broken on iOS, there is
    // simply no browser path at all.
    expect(text).not.toContain("firefox for android");
  });

  test("is styled as a warning, not as a passing suggestion", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.locator(NOTICE)).toHaveClass(/is-warning/);
  });
});

test.describe("Android Chrome — Connect works, the route is a fallback", () => {
  test.use({ userAgent: UA.androidChrome });

  test("does not talk anyone out of a button that works", async ({ page }) => {
    const text = await noticeText(page);
    expect(text, "a working Connect button is being called broken").not.toContain("will not work");
    expect(text, "Android Chrome is told the in-app browser is the only way").not.toContain(
      "only way",
    );
    expect(text).toContain("fallback");
  });

  test("is not styled as a warning", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    // The merely-helpful variant. Warning styling here would read as "your
    // wallet is broken" to someone whose wallet is fine.
    await expect(page.locator(NOTICE)).not.toHaveClass(/is-warning/);
  });
});

test.describe("Android Firefox — stated before the tap", () => {
  test.use({ userAgent: UA.androidFirefox });

  test("says connecting will not work, and why it is not the phone's fault", async ({ page }) => {
    const text = await noticeText(page);
    expect(text).toContain("will not work");
    // The reassurance matters: the reported symptom looks exactly like a broken
    // wallet, and the person's next move otherwise is to reinstall it.
    expect(text).toContain("not your wallet");
    // Naming the browsers that do work is the actionable half.
    expect(text).toMatch(/chrome/);
  });
});
