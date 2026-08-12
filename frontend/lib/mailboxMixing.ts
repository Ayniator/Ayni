// F63 v2 — MAILBOX METADATA MIXING. Pure, network-free, DOM-free at module
// scope: the relay route (server) and the client transport both import it, and
// tests/mailbox-mixing.test.mjs loads it in plain node.
//
// WHAT v1 LEFT ON THE TABLE. v1 put the message content and the sender's
// identity beyond the relay's reach (sealed sender + fixed-length ciphertext),
// but the relay still saw a clean, unmixed pattern:
//   put(to=BOX_B) at T   →   get(BOX_B) shortly after
// which is "somebody wrote to B at T, and B read it at T+δ". Sender identity is
// hidden cryptographically, but the SHAPE of the traffic still carries a lot.
//
// WHAT v2 DOES ABOUT IT — four independent, individually-disableable measures:
//
//  1. TIMING DECORRELATION. The client jitters a real send by a random delay
//     (`sendJitterMs`), and the relay releases every envelope on a fixed
//     boundary grid (`mbxReleaseAt`) instead of the instant it lands. The grid
//     is a monotone ceiling, so two envelopes NEVER swap order — the FIFO the
//     inbox relies on is preserved exactly.
//  2. COVER TRAFFIC. Clients emit dummy puts on a fixed cadence. A dummy is a
//     genuine sealed envelope — same op, same field set, same ciphertext length,
//     same padded request size — so it is indistinguishable AT THE RELAY. It is
//     marked `cover: 1` INSIDE the ciphertext, which only the recipient can
//     read; `partitionCover` drops it before the inbox ever sees it and hands
//     its id to the next ack so the box self-cleans. A real send suppresses the
//     next scheduled dummy (`noteRealPut`), so the client's put RATE stays flat
//     whether or not the member is writing to anyone.
//  3. SIZE PADDING. v1 already fixed the ciphertext length. v2 pads the whole
//     HTTP request body to a 2 KiB block (`padRequestBody`) and the relay's
//     replies to size classes (`mbxRespTarget`, `MBX_BUNDLE_RESP_BYTES`), so an
//     on-path observer cannot separate a put from a get from an ack, nor read a
//     mailbox's envelope count off a response length, nor tell an enrolled
//     wallet from an unenrolled one by the length of a `bundle` reply.
//  4. CONSTANT-RATE POLLING. `planTick` schedules gets on a fixed period from a
//     random phase, whether or not mail exists, for as long as the cached
//     read-signature stays valid — so a fetch stops meaning "the member just
//     opened the app".
//
// WHAT THIS STILL DOES NOT HIDE (see docs/messaging.md §5 — the copy in
// i18n.ts must never claim more than this):
//   * The relay sees the SOURCE IP of every request alongside the destination
//     mailbox id. Cover traffic makes any single put uninformative, but an
//     operator who correlates source IPs across time still learns which
//     addresses talk to which mailboxes. Only a mixnet/Tor transport fixes
//     that, and that is explicitly out of scope here.
//   * The prekey directory remains an enrollment oracle (v1's accepted,
//     rate-limited residual). Closing it needs PIR/OPRF — out of scope.
//   * Cover destinations are mailboxes this device already holds a prekey
//     bundle for, so a FIRST message to a brand-new contact is not covered.
//
// No new persistent identifier is introduced anywhere: the cover cohort and the
// scheduler state live in memory for the session and are never written to disk,
// to localStorage, or to the relay.

import nacl from "tweetnacl";
import {
  InnerEnvelope,
  PrekeyBundle,
  SealedEnvelope,
  sealToBundle,
} from "./mailboxCrypto";

// ---------------------------------------------------------------------------
// Relay limits — the single source of truth, imported by app/api/mailbox/route.ts
// so the cover-traffic budget in this file and the limiter it must live within
// can never drift apart (tests/mailbox-mixing.test.mjs asserts the budget).
// ---------------------------------------------------------------------------

/** Per-IP requests per window, ALL ops (spoofable first gate). */
export const MBX_RATE_LIMIT = 30;
export const MBX_RATE_WINDOW_MS = 60_000;
/** Unspoofable global cap, scoped to `bundle` + `put` only. */
export const MBX_GLOBAL_LIMIT = 240;

// ---------------------------------------------------------------------------
// 3. Size padding — requests and responses
// ---------------------------------------------------------------------------

/** Every mailbox request body is padded up to a multiple of this. */
export const MBX_REQ_BLOCK = 2048;
/** Hard bound the relay enforces on the `pad` field (anti-amplification). */
export const MBX_REQ_MAX_PAD = 8192;
/** Fixed size of a `bundle` reply, so "enrolled" and "not enrolled" match. */
export const MBX_BUNDLE_RESP_BYTES = 1024;
/** Upper bound on one serialised `{id, ts, envelope}` row (ct is 1040 B → 1388
 *  base64 chars; the rest is fixed keys). Used to size response classes. */
export const MBX_RESP_ROW_BYTES = 1700;

const PAD_CHAR = "A"; // JSON-safe: never escaped, so 1 char === 1 byte of body

/**
 * Serialise `payload` with a `pad` field that brings the whole body up to the
 * next MBX_REQ_BLOCK boundary. The relay ignores `pad` and never stores it.
 */
export function padRequestBody(payload: Record<string, unknown>): string {
  return padJson(payload, 0, MBX_REQ_BLOCK);
}

/**
 * Serialise `obj` padded to at least `target` bytes, rounded up to `block` when
 * `block > 0`. Always returns valid JSON whose byte length is deterministic in
 * (target, block) and NOT in the real content length.
 */
export function padJson(obj: Record<string, unknown>, target: number, block = 0): string {
  const base = JSON.stringify({ ...obj, pad: "" });
  let want = Math.max(target, base.length + 1);
  if (block > 0) want = Math.max(block, Math.ceil(want / block) * block);
  const pad = PAD_CHAR.repeat(Math.max(0, want - base.length));
  return JSON.stringify({ ...obj, pad });
}

/**
 * Response size class for a `get` carrying `count` envelopes: the next power of
 * two of rows. An observer of TLS record sizes learns only log2(count), never
 * the exact envelope count; the relay itself of course still knows it.
 */
export function mbxRespTarget(count: number): number {
  let cls = 1;
  while (cls < count) cls *= 2;
  return cls * MBX_RESP_ROW_BYTES;
}

// ---------------------------------------------------------------------------
// 1. Timing decorrelation
// ---------------------------------------------------------------------------

/** Default relay release grid, seconds. 0 disables the delay entirely. */
export const MBX_DELIVERY_BUCKET_SECS = 60;

/**
 * When an envelope that LANDED at `nowSecs` becomes visible to `get`.
 *
 * The next multiple of `bucketSecs` strictly after `nowSecs`. This is monotone
 * non-decreasing in `nowSecs`, which is the property the inbox depends on: if
 * envelope A lands before envelope B, A is released no later than B, so the
 * FIFO ordering `get` sorts by is never inverted by the delay. Returns 0 when
 * mixing is off, meaning "visible immediately".
 */
export function mbxReleaseAt(nowSecs: number, bucketSecs: number): number {
  if (!Number.isFinite(bucketSecs) || bucketSecs <= 0) return 0;
  return (Math.floor(nowSecs / bucketSecs) + 1) * bucketSecs;
}

// ---------------------------------------------------------------------------
// Randomness — vetted (tweetnacl → webcrypto / node crypto), never Math.random
// for anything an observer could exploit.
// ---------------------------------------------------------------------------

/** Uniform in [0, 1). */
export function mixRand(): number {
  const b = nacl.randomBytes(6);
  let v = 0;
  for (const x of b) v = v * 256 + x;
  return v / 2 ** 48;
}

// ---------------------------------------------------------------------------
// Configuration — one knob per measure, every one degradable to "off"
// ---------------------------------------------------------------------------

export interface MixConfig {
  /** Master switch. False ⇒ v1 behaviour exactly (messaging still works). */
  enabled: boolean;
  /** Upper bound of the uniform delay before a real put leaves the device. */
  maxSendJitterMs: number;
  /** Constant polling period (fixed rate, random phase). */
  pollPeriodMs: number;
  /** Constant cover-put period. */
  coverPeriodMs: number;
  /** Cap on dummies outstanding in a mailbox, so cover can never FIFO-evict
   *  real mail out of a box the member has not cleared (MAX_PER_BOX = 500). */
  maxOutstandingCover: number;
  /** Hard stop for a mixing session, so a forgotten tab is not a data plan. */
  maxSessionMs: number;
}

export const MIX_DEFAULTS: MixConfig = {
  enabled: true,
  maxSendJitterMs: 2_500,
  pollPeriodMs: 45_000,
  coverPeriodMs: 180_000,
  maxOutstandingCover: 16,
  maxSessionMs: 60 * 60_000,
};

const OFF: MixConfig = { ...MIX_DEFAULTS, enabled: false, maxSendJitterMs: 0 };

/**
 * Resolve the config. Disabled by `NEXT_PUBLIC_AHA_MAILBOX_MIXING=off` at build
 * time or by `localStorage["aha:mbx:mix"] = "off"` on the device (an escape
 * hatch for a member on a metered connection). Every failure mode falls back to
 * a WORKING configuration — mixing is a privacy improvement, never a
 * prerequisite for delivery.
 */
export function mixConfig(): MixConfig {
  let off = false;
  try {
    if (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_AHA_MAILBOX_MIXING === "off") off = true;
  } catch {
    /* no process */
  }
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem("aha:mbx:mix") === "off") off = true;
  } catch {
    /* no storage / blocked */
  }
  return off ? OFF : MIX_DEFAULTS;
}

/** Uniform jitter in [0, maxSendJitterMs] applied before a real put. */
export function sendJitterMs(cfg: MixConfig, r: number = mixRand()): number {
  if (!cfg.enabled || cfg.maxSendJitterMs <= 0) return 0;
  return Math.floor(r * (cfg.maxSendJitterMs + 1));
}

// ---------------------------------------------------------------------------
// 2. Cover traffic — construction and recognition
// ---------------------------------------------------------------------------

/** The in-ciphertext marker. Invisible to the relay by construction. */
export const MBX_COVER_MARKER = 1;

/** Anything with a truthy `cover` marker is a dummy and must never surface. */
export function isCoverInner(inner: unknown): boolean {
  return !!inner && typeof inner === "object" && (inner as { cover?: number }).cover === MBX_COVER_MARKER;
}

/**
 * The dummy plaintext. Deliberately carries NO identity, no body and no
 * signature: even the holder of the prekey secret learns nothing from it beyond
 * "this was cover". Padding (MBX_PLAINTEXT_LEN) makes its length identical to
 * any real message, so the ciphertext is the same size either way.
 */
export function makeCoverInner(nowSecs: number): InnerEnvelope {
  return { v: 3, from: "", ts: nowSecs, body: "", sig: "", cover: MBX_COVER_MARKER };
}

/** The expiry choices the compose form offers, in days. A dummy must draw from
 *  exactly this set, or `expiresAt` — the ONE envelope field with real variety
 *  that the relay can read — would separate cover from real mail. */
export const MBX_EXPIRY_DAYS = [0, 1, 7, 30];
/** Weight of "Never" (the form's default, and so the modal real value). */
const COVER_NEVER_P = 0.7;

/** A dummy's expiry, drawn from the same values a real send can produce. */
export function coverExpiresAt(nowSecs: number, r: number = mixRand()): number {
  if (r < COVER_NEVER_P) return 0;
  const rest = MBX_EXPIRY_DAYS.filter((d) => d > 0);
  const days = rest[Math.min(rest.length - 1, Math.floor(((r - COVER_NEVER_P) / (1 - COVER_NEVER_P)) * rest.length))];
  return Math.floor(nowSecs) + days * 86400;
}

/**
 * Build a dummy sealed to a mailbox we hold a current prekey for (our own, or a
 * peer whose bundle this session already fetched). The result is byte-shaped
 * exactly like a real envelope: same keys, same 32-byte ephemeral key, same
 * 24-byte nonce, same MBX_CT_LEN ciphertext, and an `expiresAt` drawn from the
 * same menu the compose form offers — so every field the relay can read agrees
 * with the distribution real mail produces.
 */
export function buildCoverEnvelope(spkB64: string, epoch: number, nowSecs: number): SealedEnvelope {
  const bundle: PrekeyBundle = { v: 1, wallet: "", ik: "", spk: spkB64, epoch, sig: "" };
  return sealToBundle(bundle, makeCoverInner(nowSecs), coverExpiresAt(nowSecs));
}

/** A destination this device can legitimately cover to (bundle already held). */
export interface CoverTarget {
  /** Mailbox id (32 hex) the dummy is put to. */
  to: string;
  /** Recipient's current signed prekey, base64. */
  spk: string;
  /** Its epoch, so the recipient picks the right secret and drops it. */
  epoch: number;
}

/**
 * Split decrypted rows into deliverable mail and cover to be dropped.
 *
 * THIS is the single choke point on the inbox path: `fetchMailboxMessages`
 * routes every decrypted row through it, so a dummy cannot reach the UI without
 * this function returning it in `mail` — which the test asserts it never does.
 * Cover ids come back separately so the next ack sweeps them off the relay
 * without a second wallet signature.
 */
export function partitionCover<T extends { id: string; inner: unknown }>(
  rows: T[]
): { mail: T[]; coverIds: string[] } {
  const mail: T[] = [];
  const coverIds: string[] = [];
  for (const r of rows) {
    if (isCoverInner(r.inner)) coverIds.push(r.id);
    else mail.push(r);
  }
  return { mail, coverIds };
}

// ---------------------------------------------------------------------------
// 4. Constant-rate scheduler — pure decision function, timer lives in mailbox.ts
// ---------------------------------------------------------------------------

export interface MixState {
  startedAt: number;
  lastPollAt: number;
  lastCoverAt: number;
  /** Dummies believed to be sitting in our own mailbox (reset by a real ack). */
  outstandingCover: number;
  /** Set by `noteRealPut`: the next cover slot is consumed by the real put, so
   *  the client's put RATE does not rise when the member actually writes. */
  skipNextCover: boolean;
  /** Multiplier applied to both periods after a 429 (relay is busy). */
  backoff: number;
}

export const MIX_MAX_BACKOFF = 8;

export function newMixState(now: number, r: number = mixRand()): MixState {
  // Random phase: the first poll/cover lands somewhere inside the first period,
  // so a fleet of clients does not fire in lockstep and a device's phase is not
  // a stable fingerprint across sessions.
  return {
    startedAt: now,
    lastPollAt: now - Math.floor(r * MIX_DEFAULTS.pollPeriodMs),
    lastCoverAt: now - Math.floor(r * MIX_DEFAULTS.coverPeriodMs),
    outstandingCover: 0,
    skipNextCover: false,
    backoff: 1,
  };
}

export interface TickPlan {
  /** Session is over — the caller must clear its timer. */
  stop: boolean;
  /** Issue a constant-rate `get` (only if a valid read-signature is cached). */
  poll: boolean;
  /** A cover slot came due (budget allowing) — consume it either way. */
  coverSlotDue: boolean;
  /** Actually emit a dummy (a slot came due AND no real put claimed it). */
  cover: boolean;
  /** How long until the next tick. */
  nextDelayMs: number;
}

/** Pure: decide what this tick does. No clock, no timers, no I/O. */
export function planTick(s: MixState, cfg: MixConfig, now: number): TickPlan {
  const stop = !cfg.enabled || now - s.startedAt >= cfg.maxSessionMs;
  const pollEvery = cfg.pollPeriodMs * s.backoff;
  const coverEvery = cfg.coverPeriodMs * s.backoff;
  const poll = !stop && now - s.lastPollAt >= pollEvery;
  const budget = s.outstandingCover < cfg.maxOutstandingCover;
  const coverSlotDue = !stop && budget && now - s.lastCoverAt >= coverEvery;
  const cover = coverSlotDue && !s.skipNextCover;
  const untilPoll = Math.max(0, pollEvery - (now - s.lastPollAt));
  const untilCover = Math.max(0, coverEvery - (now - s.lastCoverAt));
  const nextDelayMs = Math.max(1_000, Math.min(poll ? pollEvery : untilPoll, coverSlotDue ? coverEvery : untilCover));
  return { stop, poll, coverSlotDue, cover, nextDelayMs };
}

/** Record what the tick actually did (the only mutation point). */
export function applyTick(s: MixState, plan: TickPlan, now: number): void {
  if (plan.poll) s.lastPollAt = now;
  if (plan.coverSlotDue) {
    s.lastCoverAt = now;
    s.skipNextCover = false; // a due slot always consumes the suppression
    if (plan.cover) s.outstandingCover += 1;
  }
}

/** A REAL put went out: suppress the next dummy so the put rate stays flat. */
export function noteRealPut(s: MixState): void {
  s.skipNextCover = true;
}

/** The relay said 429: halve our rate (up to MIX_MAX_BACKOFF) rather than
 *  compete with the member's own real traffic for the per-IP budget. */
export function noteRateLimited(s: MixState): void {
  s.backoff = Math.min(MIX_MAX_BACKOFF, s.backoff * 2);
}

/** A successful non-cover request: recover one step toward the base rate. */
export function noteOk(s: MixState): void {
  if (s.backoff > 1) s.backoff = Math.max(1, s.backoff / 2);
}

/** Dummies were acked off the relay — the box is clean again. */
export function noteCoverAcked(s: MixState, n: number): void {
  s.outstandingCover = Math.max(0, s.outstandingCover - n);
}

// ---------------------------------------------------------------------------
// Budget — what mixing costs the relay's existing limiters
// ---------------------------------------------------------------------------

export interface MixBudget {
  /** Requests per minute one continuously-mixing client adds (poll + cover). */
  perClientPerMin: number;
  /** Cover puts per minute per client — the only part the GLOBAL limiter,
   *  which is scoped to bundle+put, ever sees. */
  coverPutsPerMin: number;
  /** How many such clients fit under the per-IP cap sharing one NAT address. */
  clientsPerIp: number;
  /** How many fit under the global cap before cover alone saturates it. */
  clientsGlobal: number;
}

export function mixBudget(cfg: MixConfig = MIX_DEFAULTS): MixBudget {
  const polls = 60_000 / cfg.pollPeriodMs;
  const coverPutsPerMin = 60_000 / cfg.coverPeriodMs;
  const perClientPerMin = polls + coverPutsPerMin;
  return {
    perClientPerMin,
    coverPutsPerMin,
    // Leave half the per-IP budget for the member's own real traffic.
    clientsPerIp: Math.floor(MBX_RATE_LIMIT / 2 / perClientPerMin),
    // Leave half the global budget for real puts and bundle lookups.
    clientsGlobal: Math.floor(MBX_GLOBAL_LIMIT / 2 / coverPutsPerMin),
  };
}
