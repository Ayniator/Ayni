"use client";

// The escape hatch for mobile browsers that offer Mobile Wallet Adapter and
// then cannot finish it — see lib/mobileWallet.ts for why Firefox on Android
// hangs on the connect spinner forever.
//
// THREE strengths of message, because the same sentence is true on one device
// and false on another — which is how the first version of this banner got iOS
// wrong, telling iPhone users the in-app browser was "the most reliable way"
// when it is the only one that exists:
//
//   * "broken" — Firefox on Android. MWA is offered and WILL hang. Stated as a
//     fact, up front, BEFORE the person taps Connect and loses two minutes to a
//     spinner and an app switch. Saying it after would be an apology; saying it
//     before is the useful thing.
//   * "only-route" — iOS, any browser. The adapter injects MWA only on Android,
//     so Safari, Chrome and Firefox on iPhone/iPad have NO path to an external
//     wallet at all. Understating that is worse than saying nothing.
//   * "alternative" — Android Chrome, Samsung Internet and friends, where
//     Connect genuinely works. Offered as a fallback, not a warning, so a button
//     that is fine does not get talked out of.
//
// Renders nothing on desktop, and nothing inside a wallet's own browser where
// the ordinary Connect button is the right answer.
//
// The three tones live in mw.* and are translated into all 19 locales. Their
// MEANINGS are the thing under translation, not their words: "broken" must
// still say connecting will fail here, "only-route" that the wallet's own
// browser is the sole path on iOS, "alternative" that Connect works and the
// in-app browser is merely a fallback. Softening one into another reintroduces
// the exact bug this component was written to fix.

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useT } from "./SettingsProvider";
import {
  noticeTone,
  shouldOfferWalletBrowser,
  walletBrowserLinks,
  type NoticeTone,
  type WalletBrowserLink,
} from "../lib/mobileWallet";

export default function MobileWalletNotice() {
  const { connected } = useWallet();
  const t = useT();
  // Everything below reads the user agent and window.location, so it must be
  // decided after mount: deciding during render would differ between the server
  // and the first client pass and trip hydration.
  const [state, setState] = useState<{
    show: boolean;
    tone: NoticeTone;
    links: WalletBrowserLink[];
  }>({ show: false, tone: "alternative", links: [] });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!shouldOfferWalletBrowser()) return;
    const tone = noticeTone();
    // Read the same vetted list WalletChooser uses, so a wallet is added or
    // dropped in one data file rather than in two places that can disagree.
    // On failure we show nothing: a banner with no way out is worse than
    // silence, and a hardcoded fallback list is the T6 problem all over again.
    fetch("/wallets.json")
      .then((r) => r.json())
      .then((cfg) => {
        const links = walletBrowserLinks((cfg?.wallets ?? []) as Parameters<
          typeof walletBrowserLinks
        >[0]);
        setState({ show: links.length > 0, tone, links });
      })
      .catch(() => {});
  }, []);

  if (connected || dismissed || !state.show || state.links.length === 0) return null;

  return (
    <div
      className={`mw-notice${state.tone === "alternative" ? "" : " is-warning"}`}
      role="status"
    >
      <div className="mw-notice-body">
        {state.tone === "broken" && (
          <>
            <strong>{t("mw.brokenStrong")}</strong> {t("mw.brokenBody")}
          </>
        )}
        {state.tone === "only-route" && (
          <>
            <strong>{t("mw.onlyStrong")}</strong> {t("mw.onlyBody")}
          </>
        )}
        {state.tone === "alternative" && (
          <>
            <strong>{t("mw.altStrong")}</strong> {t("mw.altBody")}
          </>
        )}
      </div>
      <div className="mw-notice-actions">
        {state.links.map((l) => (
          // Plain links, not window.open: a popup blocker eats the second form
          // on mobile, and a real href is what lets the OS offer the installed
          // app rather than the web page.
          <a key={l.id} className="mw-notice-btn" href={l.href} rel="noreferrer">
            {/* The wallet name is data from wallets.json, so it is substituted
                rather than concatenated: several locales put it first. */}
            {t("mw.openIn").replace("{wallet}", l.name)}
          </a>
        ))}
        <button
          type="button"
          className="mw-notice-dismiss"
          onClick={() => setDismissed(true)}
          aria-label={t("mw.dismissAria")}
        >
          {t("mw.dismiss")}
        </button>
      </div>
      {/* Says why the list is short, so a two-item list does not read as a
          recommendation. The order is shuffled on every load; these are simply
          the wallets that publish a link we can open. */}
      <div className="mw-notice-foot">{t("mw.foot")}</div>
    </div>
  );
}
