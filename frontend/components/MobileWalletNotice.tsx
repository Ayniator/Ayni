"use client";

// The escape hatch for mobile browsers that offer Mobile Wallet Adapter and
// then cannot finish it — see lib/mobileWallet.ts for why Firefox on Android
// hangs on the connect spinner forever.
//
// Two strengths of message, because the two situations are genuinely different:
//
//   * Firefox on Android — MWA is offered and WILL hang. This is stated as a
//     fact, up front, BEFORE the person taps Connect and loses two minutes to a
//     spinner and an app switch. Saying it after would be an apology; saying it
//     before is the useful thing.
//   * Any other mobile browser with no wallet injected — Connect may well work
//     (Chrome does complete MWA). Here the in-app-browser route is offered as an
//     alternative, not a warning, so a working button is not talked out of.
//
// Renders nothing on desktop, and nothing inside a wallet's own browser where
// the ordinary Connect button is the right answer.
//
// Copy is English-only for now, matching the F93 /get-app precedent; the nav
// chrome around it is translated. Queued for the next i18n pass — see BACKLOG.

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  mwaWillHang,
  shouldOfferWalletBrowser,
  walletBrowserLinks,
  type WalletBrowserLink,
} from "../lib/mobileWallet";

export default function MobileWalletNotice() {
  const { connected } = useWallet();
  // Everything below reads the user agent and window.location, so it must be
  // decided after mount: deciding during render would differ between the server
  // and the first client pass and trip hydration.
  const [state, setState] = useState<{
    show: boolean;
    hang: boolean;
    links: WalletBrowserLink[];
  }>({ show: false, hang: false, links: [] });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setState({
      show: shouldOfferWalletBrowser(),
      hang: mwaWillHang(),
      links: walletBrowserLinks(),
    });
  }, []);

  if (connected || dismissed || !state.show || state.links.length === 0) return null;

  return (
    <div className={`mw-notice${state.hang ? " is-warning" : ""}`} role="status">
      <div className="mw-notice-body">
        {state.hang ? (
          <>
            <strong>Connecting will not work in this browser.</strong> Firefox for
            Android cannot complete the Solana wallet handshake — tapping Connect
            opens your wallet on its account screen, and this tab keeps spinning.
            It is not your wallet or your phone.
          </>
        ) : (
          <>
            <strong>On a phone?</strong> The most reliable way to connect is to
            open this site inside your wallet&apos;s own browser.
          </>
        )}
      </div>
      <div className="mw-notice-actions">
        {state.links.map((l) => (
          // Plain links, not window.open: a popup blocker eats the second form
          // on mobile, and a real href is what lets the OS offer the installed
          // app rather than the web page.
          <a key={l.name} className="mw-notice-btn" href={l.href} rel="noreferrer">
            Open in {l.name}
          </a>
        ))}
        <button
          type="button"
          className="mw-notice-dismiss"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
        >
          Not now
        </button>
      </div>
      {state.hang && (
        <div className="mw-notice-foot">
          Chrome for Android connects normally, if you would rather stay in a
          browser. Nothing here is stored or sent anywhere.
        </div>
      )}
    </div>
  );
}
