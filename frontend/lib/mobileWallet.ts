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
  //
  // KNOWN FALSE POSITIVE, left in deliberately. A desktop Mac driving a
  // touchscreen display also reports maxTouchPoints > 1, so it is classified
  // iOS and would be shown the "only route" copy. There is no feature that
  // separates the two: iPadOS impersonates macOS on purpose, and platform,
  // pointer media queries and screen size all agree between an iPad with a
  // trackpad and a Mac with a touch monitor. Any tightening that excludes the
  // Mac also excludes real iPads, which is the worse error — an iPad user has
  // NO way to connect and must be told so.
  //
  // What the false positive actually costs, since "rare" is not an argument on
  // its own: the banner is suppressed entirely whenever a wallet provider is
  // injected (see isInWalletBrowser), so a Mac with an extension never sees it.
  // A Mac WITHOUT any wallet sees copy addressed to "iPhone and iPad" — advice
  // aimed at devices they are not using, which is misplaced rather than false,
  // and offers them a working link either way. Raised as a WARNING by the
  // connect-and-cluster round; disposition recorded here rather than fixed.
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

/** How strongly to put it — because the SAME sentence is true on one device and
 *  false on another, which is how the first version of this banner got it
 *  wrong.
 *
 *  * `"broken"` — Android Firefox. MWA is offered and will hang. Say so before
 *    the tap.
 *  * `"only-route"` — iOS, any browser. The adapter injects MWA **only** on
 *    Android (its own environment check tests the UA for "android"), so on
 *    iPhone and iPad there is no browser path to an external wallet at all.
 *    Calling the in-app browser "the most reliable way" here understates it to
 *    the point of being wrong: it is the only way.
 *  * `"alternative"` — Android Chrome, Samsung Internet and friends, where
 *    Connect genuinely works. Offer the route without talking anyone out of a
 *    button that is fine. */
export type NoticeTone = "broken" | "only-route" | "alternative";

export function noticeTone(): NoticeTone {
  if (mwaWillHang()) return "broken";
  if (isIOS()) return "only-route";
  return "alternative";
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

export type WalletBrowserLink = { id: string; name: string; href: string };

type WalletEntry = { id?: string; name?: string; browse?: string };

/** Uniform Fisher–Yates, drawing only on Math.random().
 *
 *  Same discipline as WalletChooser (F67): never seeded by, correlated with, or
 *  derived from anything member-linkable. Two people opening this banner see
 *  independent orders. */
function shuffle<T>(input: T[]): T[] {
  const a = [...input];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Build the in-app-browser links from a wallets.json payload.
 *
 *  T6 (no endorsements): the order is SHUFFLED, so neither wallet holds a
 *  permanent first position — the same reason WalletChooser shuffles. The set is
 *  narrower than the full chooser only because a wallet can appear here at all
 *  only if it publishes a documented universal link we can deep-link into; that
 *  is a property of the wallet, not a ranking of it, and the banner says so.
 *
 *  Percent-encoding is not cosmetic: this site is served on a non-default port
 *  (…:8443), and an unencoded ":8443" is exactly what makes these links drop the
 *  port and land on the wrong host. */
export function walletBrowserLinks(
  wallets: WalletEntry[],
  url = here(),
  ref = refOrigin()
): WalletBrowserLink[] {
  if (!url) return [];
  const u = encodeURIComponent(url);
  const r = encodeURIComponent(ref);
  const usable = wallets.filter(
    (w): w is Required<Pick<WalletEntry, "id" | "name" | "browse">> =>
      typeof w?.browse === "string" && !!w.id && !!w.name
  );
  return shuffle(usable).map((w) => ({
    id: w.id,
    name: w.name,
    href: w.browse.replace("{url}", u).replace("{ref}", r),
  }));
}
