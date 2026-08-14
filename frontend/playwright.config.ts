import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright smoke suite for the AHA / Ayni web app.
 *
 * WHY THIS EXISTS
 * ---------------
 * `tests/sentinel/i18n-key-check.sh` is a STATIC check: it proves a key exists
 * in a dictionary. It cannot see a blank page, a raw key rendered on screen, a
 * crashed component, or an untranslated page body. The Circle Administration
 * incident — 244 `admin.*` keys resolving to nothing and rendering as the
 * literal text `admin.config.add` in all 19 languages — passed the static check
 * cleanly. This suite renders the real pages in a real browser and asserts on
 * what a member actually sees.
 *
 * WHERE IT RUNS
 * -------------
 * Against a DEPLOYED app, never against `next dev`. This repo's node is 18 and
 * Next 16 requires >= 20, so `next dev` / `next build` cannot run here at all.
 * The default target is the live deployment behind Caddy on :8443, which serves
 * a self-signed-ish certificate — hence `ignoreHTTPSErrors`. Override with
 * E2E_BASE_URL (e.g. http://localhost:3000 against the frontend container).
 *
 * CONCURRENCY
 * -----------
 * Deliberately low. The app's pages call a Solana RPC endpoint on load; running
 * 6 workers against the live deployment reliably self-inflicts HTTP 429 (and
 * 502s from Caddy's upstream) that look like application errors but are pure
 * load artifacts. Two workers runs clean. Raise via E2E_WORKERS only if you are
 * pointing at a target that can take it.
 */

const BASE_URL = process.env.E2E_BASE_URL || "https://aha.a13z.org:8443";

export default defineConfig({
  testDir: "./e2e",
  // A page load here is a full Next.js hydration plus RPC chatter over the
  // network, not a local dev server; 60s leaves room without hiding a hang.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // One retry absorbs genuine network transients against a live deployment.
  // Set E2E_RETRIES=0 when you want to see raw flakiness (e.g. investigating a
  // report of intermittent breakage).
  retries: Number(process.env.E2E_RETRIES ?? 1),
  workers: Number(process.env.E2E_WORKERS ?? 2),
  // Artefacts stay inside e2e/ (and are gitignored there) so a test run never
  // drops untracked directories into frontend/.
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: "e2e/.report" }]]
    : [["list"]],
  outputDir: "e2e/.results",
  use: {
    baseURL: BASE_URL,
    // Caddy on :8443 serves a certificate this host does not trust.
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
  },
  projects: [
    {
      name: "chromium",
      // The mobile spec is excluded here rather than allowed to run twice: on a
      // desktop UA the banner it tests never renders, so it would pass by
      // vacuum — asserting nothing while looking green.
      testIgnore: /mobile-wallet\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // F95. Added because a Sentinel round found that "no third-party requests
      // on page load" ran ONLY on Desktop Chrome, where
      // shouldOfferWalletBrowser() is false — so MobileWalletNotice's
      // fetch("/wallets.json") was never exercised by any committed test. The
      // property was true and unproven, which is the kind of coverage that
      // looks present and is not.
      //
      // Pixel 7 viewport with the user agent Firefox for Android actually
      // sends, because that specific UA is what makes the app conclude Mobile
      // Wallet Adapter will hang. Engine is still Chromium — this emulates the
      // DETECTION path, not Gecko itself; it cannot prove the MWA handshake
      // fails, which is a real-device property no browser automation here
      // establishes.
      name: "mobile-firefox-android",
      testMatch: /mobile-wallet\.spec\.ts/,
      use: {
        ...devices["Pixel 7"],
        userAgent:
          "Mozilla/5.0 (Android 13; Mobile; rv:109.0) Gecko/121.0 Firefox/121.0",
      },
    },
  ],
  // NO `webServer` block on purpose: the suite must not depend on `next dev`,
  // which cannot start under this repo's node 18. See docs/e2e.md.
});
