// F97 — the sponsorship landing page, in both directions: the ordinary
// invitation (?to=…, someone offers to sponsor the opener) and the request
// (?from=…&mode=ask, someone is looking for a sponsor and the opener may
// become one). The ask direction writes nothing on chain at all; it hands a
// willing member their own invitation to send back.
//
// This page is reachable WITHOUT a connected wallet (it must explain itself to
// someone who just scanned a QR code), so unlike the /me Sponsors & Sponsees
// blocks it is testable in a plain browser. What it CANNOT test here — because
// there is no wallet in CI — is the on-chain accept path itself; that stays a
// wallet-gated action, asserted only up to the point where it asks the visitor
// to connect.
//
// The compassionate-wording contract is the real subject: a decline records
// nothing, and the buttons never say "reject". Those strings are asserted so a
// revert to blunt wording fails here rather than reaching a newcomer.

import { test, expect } from "@playwright/test";
import { watchForErrors, expectNoPageErrors, isExpectedHost } from "./helpers";

const CIRCLE = "DH6uDzb77mZuF8TP2ucdHUkwyW6wyZkJj8nm3i79EAUo";
const COMMIT = "ab".repeat(32); // a well-formed 64-hex commitment
const GOOD = `/sponsor-request?circle=${CIRCLE}&to=${COMMIT}`;
// The reverse direction (F97): the OPENER is the prospective sponsor, and the
// link carries the seeker's commitment as `from`. Also reachable logged-out.
const ASK = `/sponsor-request?circle=${CIRCLE}&from=${COMMIT}&mode=ask`;

test.describe("sponsor-request landing", () => {
  test("a well-formed invitation explains itself and offers connect", async ({ page }) => {
    const diag = watchForErrors(page);
    await page.goto(GOOD, { waitUntil: "networkidle" });

    // The intro must name what this is and what accepting does. (The layout
    // has its own site-title h1, so assert on the page's own copy, not "the h1".)
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).toContain("a sponsorship invitation");
    expect(body).toContain("sponsor");
    // Without a wallet, the page asks the visitor to connect rather than
    // showing a dead Accept button.
    expect(body).toContain("connect your wallet");

    expectNoPageErrors(diag, GOOD);
  });

  test("a malformed link says so instead of rendering a broken form", async ({ page }) => {
    await page.goto("/sponsor-request?circle=not-a-key&to=xyz", { waitUntil: "networkidle" });
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).toContain("incomplete");
    // A bad link must NOT surface accept/decline controls.
    expect(body).not.toContain("accept this link");
  });

  test("an ask link explains that a member is looking for a sponsor", async ({ page }) => {
    const diag = watchForErrors(page);
    await page.goto(ASK, { waitUntil: "networkidle" });

    const body = (await page.locator("body").innerText()).toLowerCase();
    // The opener is the prospective SPONSOR here, so the page must lead with
    // what is being asked of them rather than with an offer to them.
    expect(body).toContain("looking for a sponsor");
    // The seeker is named by their commitment, never by a wallet address.
    expect(body).toContain(COMMIT.slice(0, 8));
    // Without a wallet the page asks to connect instead of dangling a dead
    // "I am willing" button.
    expect(body).toContain("connect your wallet");
    // Nothing on this path is written on chain, and nothing is offered until a
    // member says they are willing — the return link must stay hidden here.
    expect(body).not.toContain("send this back to them");

    expectNoPageErrors(diag, ASK);
  });

  test("an ask link with no from= is treated as malformed", async ({ page }) => {
    // `mode=ask` reads `from`, not `to`: a link carrying the wrong parameter
    // must fail closed rather than silently render the forward direction.
    await page.goto(`/sponsor-request?circle=${CIRCLE}&to=${COMMIT}&mode=ask`, { waitUntil: "networkidle" });
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).toContain("incomplete");
  });

  // NOTE ON WHAT IS *NOT* TESTED HERE. The accept/decline controls render only
  // for a CONNECTED member of the invitation's Circle, which no browser test in
  // this suite can be. An earlier version of this file asserted "the page never
  // says 'reject'" and passed happily with the word "Reject" live in the
  // dictionary — the control simply never rendered. That is coverage that
  // cannot fail, which reads as proof and is not.
  //
  // The compassionate-wording contract is therefore enforced as a STATIC check
  // over the shipped string table, in tests/sentinel/sponsor-wording-check.sh,
  // where it can actually fail. Nothing about it is asserted from this file.

  test("mounting the page contacts no third-party host", async ({ page, baseURL }) => {
    // Same privacy floor as every other route: a newcomer opening this from a
    // QR code must not have their visit leaked to an analytics or font host.
    const baseHost = new URL(baseURL!).hostname;
    const foreign = new Set<string>();
    page.on("request", (req) => {
      const host = new URL(req.url()).hostname;
      if (!isExpectedHost(host, baseHost)) foreign.add(`${host} (${req.resourceType()})`);
    });
    await page.goto(GOOD, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    expect([...foreign].sort(), "the invitation page contacted a third-party host").toEqual([]);
  });
});
