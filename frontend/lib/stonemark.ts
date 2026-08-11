// Epic 6 / F62 — the stone-mark (symbolic avatar).
//
// A member's avatar is the digitized stone-mark from the Cavern Ceremony: a
// personal sign drawn inside an equilateral triangle. A MARK, not a face — a
// symbol, so that even the widest audience ("all members") stays
// anonymity-compatible. There is no photograph, ever.
//
// AUDIENCE: the stone-mark is disclosed ONLY under Epic 5's rules. Who may see
// it is the on-chain VisibilityPolicy.avatar tier (see lib/visibility.ts,
// getVisibility/mayView), enforced on the READ path by the trust page — never
// here, and never by default. This module only stores the owner's OWN mark on
// their OWN device and offers a neutral silhouette for the not-disclosed case.
//
// HIDDEN LOOKS LIKE A BARE PAGE (Epic 5): when a viewer isn't entitled to see a
// mark, the fallback is a plain empty triangle outline — the NEUTRAL_SILHOUETTE
// below. Never a lock icon, never a "hidden" badge: absence, not a padlock.

const KEY = "aha:stonemark";

/** A stable, tiny "not disclosed" placeholder: a bare equilateral-triangle
 *  outline on transparent ground. Deliberately NOT a lock — hidden must read as
 *  an empty page, per Epic 5. Handbuilt SVG so it needs no canvas/DOM and is
 *  safe to use during SSR. 96px box, centered triangle. */
export const NEUTRAL_SILHOUETTE: string = (() => {
  // apex up, equilateral, inset within a 96×96 box
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">` +
    `<polygon points="48,10 86,80 10,80" fill="none" stroke="#8a8a8a" ` +
    `stroke-width="3" stroke-linejoin="round" opacity="0.5"/>` +
    `</svg>`;
  // encodeURIComponent keeps this valid in both light/dark and avoids base64 bulk
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
})();

/** The connected member's own saved stone-mark (a small PNG data URL), or
 *  undefined if they've never drawn one. Per-device, like profile.ts. */
export function getStoneMark(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return localStorage.getItem(KEY) || undefined;
}

/** Persist the member's own stone-mark. Pass an empty string / undefined to
 *  clear it. Fires "aha:stonemark" so open ProfileCards can refresh. */
export function setStoneMark(dataUrl?: string): void {
  if (typeof window === "undefined") return;
  if (dataUrl) localStorage.setItem(KEY, dataUrl);
  else localStorage.removeItem(KEY);
  window.dispatchEvent(new Event("aha:stonemark"));
}
