// Connecting a wallet from a mobile browser, when Mobile Wallet Adapter cannot.
//
// THE BUG THIS EXISTS FOR. On Android, @solana/wallet-adapter-react injects a
// SolanaMobileWalletAdapter automatically — we never ask for it and never listed
// it (WalletProviders passes an empty adapter array). Its own environment check
// is only "userAgent says Android, and this is not a WebView", so it offers MWA
// to EVERY Android browser. MWA then needs the browser to launch a
// `solana-wallet:` intent and hold a local association session open across the
// app switch. Chrome does that. Firefox for Android does not: the wallet opens
// cold on its account screen with no approval prompt, and the tab you return to
// is still sitting on the connect spinner, waiting for an association that will
// never arrive. That is exactly what a Z Fold on Firefox reports.
//
// There is no client-side fix for the handshake — it is the browser that cannot
// carry it. So this module provides the way around it that does work everywhere:
// re-open the site INSIDE the wallet's own in-app browser, where the wallet
// injects its provider and registers through the Wallet Standard. Connecting
// there is the ordinary desktop-like path, no MWA involved.
//
// Nothing here is read from or written to the chain, and no identifier is
// derived from the user agent — it decides which hint to show and nothing else.

export type MobileBrowser = "firefox" | "chromium" | "other";

function ua(): string {
  if (typeof navigator === "undefined") return "";
  return navigator.userAgent || "";
}

export function isAndroid(): boolean {
  return /android/i.test(ua());
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const s = ua();
  if (/iphone|ipad|ipod/i.test(s)) return true;
  // iPadOS 13+ reports a desktop Mac UA; touch points give it away.
  return /macintosh|mac os x/i.test(s) && (navigator.maxTouchPoints ?? 0) > 1;
}

export function isMobile(): boolean {
  return isAndroid() || isIOS();
}

/** Which engine, as far as the wallet handshake cares.
 *
 *  Firefox for Android is "Mozilla/5.0 (Android …) Gecko/… Firefox/…". Note the
 *  test must come BEFORE any Chrome test: several Chromium browsers put "Chrome"
 *  in the string, but Firefox never does, so ordering this way is safe both ways
 *  round. */
export function mobileBrowser(): MobileBrowser {
  const s = ua();
  if (/firefox|fxios/i.test(s)) return "firefox";
  if (/chrome|chromium|crios|edg|samsungbrowser/i.test(s)) return "chromium";
  return "other";
}

/** Are we already inside a wallet's in-app browser? If so, say nothing: the
 *  ordinary Connect button works, and a "open in your wallet" hint shown to
 *  someone already in their wallet is worse than no hint at all.
 *
 *  Checked by injected provider first (the thing that actually decides whether
 *  connecting works) and only then by user-agent string, which is a hint rather
 *  than a guarantee. */
export function isInWalletBrowser(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  if (w.solflare || w.phantom || w.backpack) return true;
  const sol = w.solana as { isPhantom?: boolean; isSolflare?: boolean } | undefined;
  if (sol && (sol.isPhantom || sol.isSolflare)) return true;
  return /solflare|phantom|backpack/i.test(ua());
}

/** True when this browser will offer MWA but cannot complete it.
 *
 *  Deliberately narrow: Firefox on Android is the confirmed case, reported from
 *  a device and reproduced against the adapter's own environment check. Other
 *  engines are not guessed at — a wrong guess here either hides a working
 *  Connect button or nags someone whose wallet is fine. */
export function mwaWillHang(): boolean {
  return isAndroid() && !isInWalletBrowser() && mobileBrowser() === "firefox";
}

/** Should we offer the in-app-browser route at all? Any mobile browser with no
 *  injected wallet benefits from it; on Firefox it is the ONLY route that
 *  works. iOS gets it too — MWA is Android-only, so an iOS browser has no
 *  native path whatsoever. */
export function shouldOfferWalletBrowser(): boolean {
  return isMobile() && !isInWalletBrowser();
}

/** The current page, absolute, for handing to a wallet's browser. */
function here(): string {
  if (typeof window === "undefined") return "";
  return window.location.href;
}

function refOrigin(): string {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

export type WalletBrowserLink = { name: string; href: string };

/** Universal links that open a URL in the wallet's own in-app browser.
 *
 *  Both wallets take a percent-encoded target plus a `ref` origin. Encoding is
 *  not optional: this site is served on a non-default port (…:8443) and an
 *  unencoded ":8443" is what makes these links silently drop the port and land
 *  on the wrong host. */
export function walletBrowserLinks(url = here(), ref = refOrigin()): WalletBrowserLink[] {
  if (!url) return [];
  const u = encodeURIComponent(url);
  const r = encodeURIComponent(ref);
  return [
    { name: "Solflare", href: `https://solflare.com/ul/v1/browse/${u}?ref=${r}` },
    { name: "Phantom", href: `https://phantom.app/ul/browse/${u}?ref=${r}` },
  ];
}
