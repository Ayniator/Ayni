// Recovery page helpers (Trust Platform Epic 11 / F75–F78) — small pure
// utilities for the /recovery wizard. NOTHING HERE TOUCHES THE NETWORK OR THE
// CHAIN: no fetch, no socket, no anchor import. The pending sponsor-only
// recovery intent is persisted ONLY in this device's localStorage — it lives in
// the off-chain shard-custody layer by design (CLAUDE.md locked position) and
// must never become an on-chain or server-side, member-linkable record.

import { CHALLENGE_WINDOW_MS, RecoveryIntent } from "./recovery";

const PENDING_KEY = "aha:recovery:pending";

/** Generate a fresh one-time code for the member's re-issued shard set. Same
 *  shape as the ceremony's codes (/recovery/setup): 16 chars in 4 groups from a
 *  lookalike-free alphabet, here rejection-sampled so every character is
 *  uniform. The code is a capability handle shown once to the member to write
 *  down — the custody index AND the seal-key input (lib/shardSeal). */
export function newOneTimeCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789"; // 30 symbols
  const limit = 240; // 8 * 30 — rejection bound for uniformity
  const chars: string[] = [];
  const buf = new Uint8Array(32);
  while (chars.length < 16) {
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < limit && chars.length < 16) chars.push(alphabet[b % alphabet.length]);
    }
  }
  buf.fill(0);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8, 12).join("")}-${chars.slice(12, 16).join("")}`;
}

/** Human-readable remaining time for the challenge-window countdown.
 *  DISPLAY ONLY — the gate is windowElapsed() in lib/recovery, never this. */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return "0 minutes";
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (days > 0) return `${plural(days, "day")}, ${plural(hours, "hour")}`;
  if (hours > 0) return `${plural(hours, "hour")}, ${plural(minutes, "minute")}`;
  return plural(Math.max(1, minutes), "minute");
}

/** The custody codes under which a pending sponsor-only recovery keeps the two
 *  collected sponsor shards (sealed blobs) on THIS device. Derived from the
 *  intent's one-time code — custody itself stays enumeration-free. */
export function intentShardCode(code: string, which: 1 | 2): string {
  return `${code}#sponsor${which}`;
}

/** Load the pending sponsor-only recovery intent held on this device, if any.
 *  The window is CLAMPED up to CHALLENGE_WINDOW_MS on load: a tampered or
 *  corrupted stored record can never shorten the challenge window. */
export function loadPendingRecovery(): RecoveryIntent | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (typeof v?.code !== "string" || typeof v?.openedAt !== "number") return null;
    return { code: v.code, openedAt: v.openedAt, windowMs: CHALLENGE_WINDOW_MS };
  } catch {
    return null;
  }
}

/** Persist the pending intent — localStorage of THIS device only. */
export function savePendingRecovery(intent: RecoveryIntent): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(PENDING_KEY, JSON.stringify(intent));
}

/** Forget the pending intent (completed or cancelled). */
export function clearPendingRecovery(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(PENDING_KEY);
}

/** Zero secret-bearing buffers in place. Best-effort hygiene: JS cannot zero a
 *  string, so byte buffers are wiped the moment the flow no longer needs them. */
export function wipe(...bufs: Array<Uint8Array | null | undefined>): void {
  for (const b of bufs) b?.fill(0);
}
