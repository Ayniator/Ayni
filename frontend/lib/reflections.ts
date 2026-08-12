// Default (built-in) Daily Reflections resolution. Shown on /reflections when no
// Circle has published an entry for the chosen day. The dataset covers 161 of the
// 365 calendar days, so any day resolves to an exact entry or the nearest one by
// circular calendar distance (wrapping across the year boundary).

import { DEFAULT_REFLECTIONS, REFLECTION_KEYS, DefaultReflection } from "./daily-reflections-default";

export type { DefaultReflection } from "./daily-reflections-default";

// "MM-DD" → ordinal day (1..365) on a fixed non-leap reference calendar.
const CUM = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
export function keyToOrdinal(key: string): number {
  const [m, d] = key.split("-").map((n) => parseInt(n, 10));
  const mm = Math.min(Math.max(m || 1, 1), 12);
  return CUM[mm - 1] + (d || 1);
}

// Circular distance between two ordinals on a 365-day ring.
function ringDistance(a: number, b: number): number {
  const raw = Math.abs(a - b);
  return Math.min(raw, 365 - raw);
}

/** The set of "MM-DD" keys that have a built-in entry (for calendar dots). */
export const REFLECTION_KEY_SET: Set<string> = new Set(REFLECTION_KEYS);

export interface DefaultResolution {
  entry: DefaultReflection;
  key: string; // the key actually used (may differ from the requested day)
  exact: boolean;
}

/** Resolve the built-in reflection for a "MM-DD" key: exact if present, else the
 *  nearest available day. Returns null only if the dataset is empty. */
export function defaultReflectionFor(key: string): DefaultResolution | null {
  if (!REFLECTION_KEYS.length) return null;
  const exact = DEFAULT_REFLECTIONS[key];
  if (exact) return { entry: exact, key, exact: true };
  const want = keyToOrdinal(key);
  let best = REFLECTION_KEYS[0];
  let bestDist = Infinity;
  for (const k of REFLECTION_KEYS) {
    const dist = ringDistance(want, keyToOrdinal(k));
    if (dist < bestDist) {
      bestDist = dist;
      best = k;
    }
  }
  return { entry: DEFAULT_REFLECTIONS[best], key: best, exact: false };
}
