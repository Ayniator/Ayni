// F33 — local user profile: an avatar image + a preferred timezone, stored
// per-device (localStorage). The avatar overrides the Jazzicon for the
// connected user's own wallet; the timezone localises timestamps shown in the UI.

export interface UserProfile {
  avatar?: string; // data URL or image URL
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

export function setUserProfile(p: UserProfile) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(p));
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

/** Read an image File into a size-bounded data URL (so avatars stay small). */
export function fileToAvatarDataUrl(file: File, maxPx = 128): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("could not read file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("not an image"));
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const ctx = c.getContext("2d");
        if (!ctx) return reject(new Error("no canvas"));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/webp", 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
