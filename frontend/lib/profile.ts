// F33 — local user profile: an avatar image + a preferred timezone, stored
// per-device (localStorage). The avatar overrides the Jazzicon for the
// connected user's own wallet; the timezone localises timestamps shown in the UI.
//
// F69 (Epic 9) changed what an avatar IS. Before: `fileToAvatarDataUrl` read the
// chosen file with `FileReader.readAsDataURL` — materialising the whole original
// photograph as a base64 string, assigning it to an <img> `src`, then drawing a
// plain downscale to canvas. The value handed back, and written to localStorage
// by every caller, was the RESIZED ORIGINAL PHOTOGRAPH.
//
// After: the file is decoded straight from the Blob (no base64 copy of the
// original anywhere), cartoonised on-device by lib/cartoonise.ts, and only the
// cartoon is returned. The original's pixels are scrubbed before the promise
// resolves. See docs/avatars.md for the algorithm, the caps, and an honest
// statement of what this does and does not protect against.

import {
  fileToCartoonAvatar,
  isSafeAvatarValue,
  MAX_AVATAR_PX,
  type CartoonStyle,
  type CartooniseOptions,
} from "./cartoonise";

export interface UserProfile {
  avatar?: string; // bounded image data URL (cartoon or stone-mark), or an https URL
  timezone?: string; // IANA tz, e.g. "Europe/Lisbon"
}

const KEY = "aha:profile";

export function getUserProfile(): UserProfile {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

/**
 * F69 defence-in-depth: the ONLY writer of the avatar slot refuses anything
 * that is not a bounded `image/webp|png|jpeg` data URL (what cartoonise.ts and
 * the Epic-6 stone-mark emit) or a remote https URL. A megabyte-scale
 * photograph data URL — the shape a naive "just store the file" regression
 * would take — cannot get through.
 *
 * This is a backstop, not the guarantee. The guarantee is that no code path in
 * this app produces the original in the first place (see fileToAvatarDataUrl).
 */
export function setUserProfile(p: UserProfile) {
  if (typeof window === "undefined") return;
  const safe: UserProfile = { ...p };
  if (safe.avatar !== undefined && !isSafeAvatarValue(safe.avatar)) delete safe.avatar;
  localStorage.setItem(KEY, JSON.stringify(safe));
  window.dispatchEvent(new Event("aha:profile"));
}

export function userTimezone(): string | undefined {
  return getUserProfile().timezone || undefined;
}

/** Format a unix timestamp in the user's chosen timezone (or local default). */
export function formatTime(unixSecs: number): string {
  const tz = userTimezone();
  try {
    return new Date(unixSecs * 1000).toLocaleString(undefined, tz ? { timeZone: tz } : undefined);
  } catch {
    return new Date(unixSecs * 1000).toLocaleString();
  }
}

export function listTimezones(): string[] {
  const anyIntl = Intl as any;
  if (typeof anyIntl.supportedValuesOf === "function") {
    try { return anyIntl.supportedValuesOf("timeZone"); } catch {}
  }
  return [
    "UTC", "Europe/London", "Europe/Lisbon", "Europe/Paris", "Europe/Berlin", "Europe/Madrid",
    "Europe/Stockholm", "Europe/Oslo", "Europe/Copenhagen", "Africa/Nairobi", "Asia/Jerusalem",
    "Asia/Bangkok", "Asia/Kolkata", "Asia/Shanghai", "Asia/Tokyo", "Asia/Vientiane", "Asia/Yangon",
    "Asia/Thimphu", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
    "America/Lima", "Australia/Sydney",
  ];
}

/**
 * F69 — turn a chosen photo into a CARTOON avatar, entirely on this device.
 *
 * Signature-compatible with the F33 version it replaces, so every existing
 * caller (`/me`, `/onboarding`) is cartoonised without changing a line. What
 * changed is the contract:
 *
 *   - the original is never converted to a data URL or any other string;
 *   - the original's pixels are scrubbed (zero-filled) before this resolves;
 *   - the returned data URL is built only from the cartoon raster;
 *   - nothing is uploaded, stored or logged here — the caller decides what to
 *     do with the cartoon, and `setUserProfile` bounds what it may persist.
 *
 * Deterministic: the same file + the same style always yields the same pixels.
 */
export function fileToAvatarDataUrl(
  file: File,
  maxPx = MAX_AVATAR_PX,
  style?: CartoonStyle,
): Promise<string> {
  const opts: CartooniseOptions = { maxPx };
  if (style) opts.style = style;
  return fileToCartoonAvatar(file, opts);
}

// Re-exported so UI can offer the styles without importing two modules.
export {
  CARTOON_STYLES,
  DEFAULT_CARTOON_STYLE,
  MAX_AVATAR_BYTES,
  MAX_AVATAR_PX,
  isSafeAvatarValue,
} from "./cartoonise";
export type { CartoonStyle, CartooniseSettings } from "./cartoonise";
