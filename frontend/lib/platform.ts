// Which device is this? (F92/F93)
//
// Used for two things only, both cosmetic: putting the install link that works
// here first in the wallet chooser, and labelling the "Get AHA" nav entry with
// the store the visitor can actually use. Read from the user agent at mount,
// never stored, never transmitted, never mixed into any shuffle or identifier.

export type Platform = "ios" | "android" | "web";

export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "web";
  const ua = navigator.userAgent || "";
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  // iPadOS 13+ reports a desktop Mac user agent; the touch points give it away.
  if (/macintosh|mac os x/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1) return "ios";
  return "web";
}
