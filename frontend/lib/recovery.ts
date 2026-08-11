// Recovery flows (Trust Platform Epic 11 / F75–F78) — reconstruct the master
// secret through the two humans who admitted the member.
//
// EVERYTHING HERE IS LOCAL. There is no import of fetch, a socket, or the anchor
// program — reconstruction emits nothing on chain (CLAUDE.md locked position;
// Sentinel Layer F asserts it by spying the send path and finding zero calls).
// The recovery INTENT (sponsor-only flow) lives in the off-chain custody layer,
// never as an on-chain member-linkable event.

import { Shard, reconstructMaster } from "./sharding";

export const CHALLENGE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (locked)

/** Shard provenance is tracked by the flow, NOT by the shard bytes (they are
 *  indistinguishable). The fast path requires a genuine MEMBER shard. */
export interface HeldShard {
  shard: Shard;
  role: "member" | "sponsor";
}

// --- member-present: own shard + one sponsor shard, immediate ----------------

/**
 * The honest fast path: the member's own shard combined with one sponsor's.
 * REQUIRES a genuine member shard — two sponsor shards cannot masquerade as
 * member-present (asserted; Sentinel Layer F re-checks). No waiting, nothing on
 * chain.
 */
export async function recoverMemberPresent(mine: HeldShard, sponsor: HeldShard): Promise<Uint8Array> {
  if (mine.role !== "member") throw new Error("the fast path requires your own (member) shard");
  if (sponsor.role !== "sponsor") throw new Error("the second shard must be a sponsor's");
  return reconstructMaster(mine.shard, sponsor.shard);
}

// --- sponsor-only: two sponsor shards, challenge window ----------------------

/** A pending sponsor-only recovery. Lives in the OFF-CHAIN custody layer, keyed
 *  by a one-time code — never an on-chain, member-linkable record. Even its
 *  existence must not be publicly correlatable to an identity. */
export interface RecoveryIntent {
  code: string;      // one-time code, the only handle
  openedAt: number;  // unix ms
  windowMs: number;  // = CHALLENGE_WINDOW_MS; not shortenable by any caller
}

/** Open a sponsor-only recovery intent. The window is fixed by the constant and
 *  cannot be shortened by a caller-supplied value (there is no window parameter).
 */
export function openSponsorRecovery(code: string, now: number): RecoveryIntent {
  return { code, openedAt: now, windowMs: CHALLENGE_WINDOW_MS };
}

/** Has the challenge window elapsed? */
export function windowElapsed(intent: RecoveryIntent, now: number): boolean {
  return now - intent.openedAt >= intent.windowMs;
}

/**
 * Complete a sponsor-only recovery: two sponsor shards, but ONLY after the
 * window has elapsed and the member has not cancelled. A cancellation
 * (`cancelled` true) aborts and the caller must burn the shards (see
 * reshareAfter... in F77). Reconstruction, again, touches nothing on chain.
 */
export async function completeSponsorRecovery(
  intent: RecoveryIntent,
  a: HeldShard,
  b: HeldShard,
  now: number,
  cancelled: boolean
): Promise<Uint8Array> {
  if (cancelled) throw new Error("recovery was cancelled by the member — shards must be burned");
  if (!windowElapsed(intent, now)) throw new Error("the challenge window has not elapsed");
  if (a.role !== "sponsor" || b.role !== "sponsor") throw new Error("sponsor-only recovery needs two sponsor shards");
  return reconstructMaster(a.shard, b.shard);
}

// --- lifecycle: burn + re-issue (F77) ----------------------------------------

/**
 * Re-share after any event that spent or exposed a shard: a sponsor-shard
 * recovery, a key rotation, or a holder replacement. A stale shard is worse
 * than no shard — it looks like protection — so the OLD three are all burned and
 * a FRESH three are cut from the (reconstructed) master. Returns the new shards;
 * the caller distributes them and burns the old codes in custody.
 *
 * `splitFresh` is injected (the sharding core's splitMaster) so this module
 * stays free of the library import and easy to test.
 */
export async function reshareMaster(
  master: Uint8Array,
  splitFresh: (m: Uint8Array) => Promise<[Shard, Shard, Shard]>
): Promise<[Shard, Shard, Shard]> {
  return splitFresh(master);
}

// --- provisional guard (F78) -------------------------------------------------

/** A provisional member has only one sponsor, so no valid 2-of-3 split exists →
 *  no sponsor recovery. Onboarding must surface this BEFORE the member finishes. */
export function sponsorRecoveryAvailable(sponsorCount: number): boolean {
  return sponsorCount >= 2;
}
