// The cluster box in the nav.
//
// Two properties, and the second is the one that makes this file worth having.
//
//   1. Testnet is not offered. AHA is not deployed there, so listing it — even
//      greyed out — implies a cluster you could switch to and a deployment that
//      does not exist.
//
//   2. The box NEVER renders blank. Testnet is removed conditionally, not
//      deleted, because a <select> whose `value` matches no rendered <option>
//      shows an empty box. This control exists to say which chain you are on;
//      going blank is the one thing it must never do, and it is exactly what a
//      straight `git rm` of the option would cause on a testnet-pointed
//      deployment. Asserting "no Testnet option" alone would pass on the broken
//      version too, so the emptiness check is the real assertion here.

import { test, expect } from "@playwright/test";

const SELECT = "select.net-select";

test.describe("cluster box", () => {
  test("offers Devnet and Mainnet (soon), and not Testnet", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const sel = page.locator(SELECT);
    await expect(sel).toBeVisible();

    const options = await sel
      .locator("option")
      .evaluateAll((els) => els.map((e) => (e.textContent || "").trim()));
    expect(options).toEqual(["Devnet", "Mainnet (soon)"]);
    expect(options.join(" "), "Testnet is still on offer").not.toMatch(/testnet/i);
  });

  test("names the cluster it is really on — never an empty box", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const state = await page.locator(SELECT).evaluate((el) => {
      const s = el as HTMLSelectElement;
      return {
        value: s.value,
        selectedIndex: s.selectedIndex,
        label: s.selectedOptions[0]?.textContent?.trim() ?? "",
        values: [...s.options].map((o) => o.value),
      };
    });
    // selectedIndex === -1 is the blank-box state: a value with no matching
    // option. That is the regression the conditional render exists to prevent.
    expect(state.selectedIndex, "the cluster box is blank — value matches no option").toBeGreaterThanOrEqual(0);
    expect(state.values, "the selected value is not among the options").toContain(state.value);
    expect(state.label.length, "the cluster box shows no text").toBeGreaterThan(0);
  });

  test("mainnet is present but not selectable", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    // Named as coming, and disabled: an enabled option would let someone switch
    // to a cluster the app has nothing deployed on.
    await expect(page.locator(`${SELECT} option[value="mainnet"]`)).toBeDisabled();
  });
});
