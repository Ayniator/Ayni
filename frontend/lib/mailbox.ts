// F63 (v1) — client transport for the off-chain mailbox. Sends go here FIRST
// (nothing on chain: no recipient index, no public timestamp, no fee-payer);
// the on-chain F32 path remains only as the fallback for recipients who have
// not yet published a prekey bundle — that fallback is the sunset bridge, and
// the UI says which path a message took.
//
// Device state (localStorage, this device only): the SPK secrets. The IK is
// re-derivable from a wallet signature (deriveBoxKeypair), but SPK secrets are
// random — losing the device forfeits mail still sealed to those prekeys
// (relay-TTL-bounded). That is the price of forward secrecy and is the same
// trade Signal makes; the next publish heals delivery going forward.
//
// F63 v2 (metadata mixing, docs/messaging.md) adds the CLIENT half of the four
// measures in lib/mailboxMixing.ts, all of it invisible to the inbox page:
//   * every request body is padded to a fixed block, so ops are one size;
//   * a real send waits a random jitter before it leaves the device;
//   * a constant-rate scheduler keeps polling and emitting DUMMY puts for as
//     long as the cached read-signature and the session last, so "a put
//     happened" and "a fetch happened" stop meaning anything;
//   * dummies are dropped by `partitionCover` before the inbox sees them and
//     their ids ride along on the member's next ack, so the mailbox self-cleans
//     without a second wallet signature.
// Session state (cover cohort, cached read-signature, scheduler) is IN MEMORY
// only — no new persistent identifier, nothing written to disk or to the relay.

import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import { SigningWallet } from "./member";
import { deriveBoxKeypair } from "./messaging";
import {
  InnerEnvelope,
  PrekeyBundle,
  SealedEnvelope,
  ackSignedBytes,
  getSignedBytes,
  mailboxGetWindow,
  innerSignedBytes,
  mailboxIdForWallet,
  mbxB64,
  mbxUnb64,
  sealToBundle,
  openSealed,
  verifyBundle,
  verifyInner,
  MBX_MAX_BODY,
} from "./mailboxCrypto";
import {
  CoverTarget,
  MixState,
  applyTick,
  buildCoverEnvelope,
  mixConfig,
  mixRand,
  newMixState,
  noteCoverAcked,
  noteOk,
  noteRateLimited,
  noteRealPut,
  padRequestBody,
  partitionCover,
  planTick,
  sendJitterMs,
} from "./mailboxMixing";

const SPK_STORE = (wallet: string) => `aha:mbx:spk:${wallet}`;
const SPK_KEEP = 2; // current + previous — older secrets are deleted (FS)
const SPK_ROTATE_SECS = 7 * 24 * 3600;

interface StoredSpk {
  epoch: number;
  pub: string; // base64
  sec: string; // base64
  createdAt: number; // unix secs
}

function loadSpks(wallet: string): StoredSpk[] {
  try {
    const raw = localStorage.getItem(SPK_STORE(wallet));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveSpks(wallet: string, spks: StoredSpk[]) {
  // Newest first; DELETING the tail is the forward-secrecy act.
  localStorage.setItem(SPK_STORE(wallet), JSON.stringify(spks.slice(0, SPK_KEEP)));
}

async function post(op: string, payload: Record<string, unknown>): Promise<any> {
  const cfg = mixConfig();
  // SIZE PADDING (F63 v2 §3): every op leaves the device at the same block size
  // — a `get`, a `put` and an `ack` are indistinguishable by request length to
  // anything watching the wire. The relay bounds and discards `pad`.
  const body = cfg.enabled
    ? padRequestBody({ op, ...payload })
    : JSON.stringify({ op, ...payload });
  const res = await fetch("/api/mailbox", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  const j = await res.json().catch(() => ({}));
  // Keep cover traffic out of the member's way: if the relay is rate limiting,
  // the mixing scheduler backs off rather than competing for the per-IP budget
  // that real sends, reads and deletes need.
  if (mixSession) {
    if (res.status === 429) noteRateLimited(mixSession);
    else if (res.ok) noteOk(mixSession);
  }
  if (!res.ok) throw new Error(j.error || "mailbox relay error");
  return j;
}

// ---------------------------------------------------------------------------
// F63 v2 — the mixing session. All state here is IN MEMORY for this tab only.
// ---------------------------------------------------------------------------

/** Scheduler state; null when mixing is off or nothing has armed it yet. */
let mixSession: MixState | null = null;
let mixTimer: ReturnType<typeof setTimeout> | null = null;
let mixWallet: string | null = null;

/**
 * The cached read-signature. `getSignedBytes(to, window)` is accepted by the
 * relay for the current OR previous 10-minute window, so ONE signature the
 * member already gave for their own fetch lets the scheduler keep polling for
 * 10–20 minutes WITHOUT ever prompting the wallet again. When it lapses the
 * poller simply stops polling (cover puts, which need no signature, continue).
 */
let getAuth: { wallet: string; to: string; sig: string; window: number } | null = null;

/**
 * Cover destinations: mailboxes this session already holds a current prekey
 * for. Populated as a side effect of ordinary use (a real send fetches the
 * recipient's bundle). Deliberately NOT persisted: a plaintext contact list on
 * disk would be a worse privacy leak than the metadata mixing buys back.
 */
const coverPeers = new Map<string, CoverTarget>();

/** Dummy ids harvested from our own box, to be swept on the next real ack. */
let pendingCoverAck: string[] = [];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Remember a verified bundle as a legitimate cover destination. */
function rememberCoverPeer(b: PrekeyBundle): void {
  try {
    coverPeers.set(b.wallet, {
      to: mailboxIdForWallet(new PublicKey(b.wallet).toBytes()),
      spk: b.spk,
      epoch: b.epoch,
    });
  } catch {
    /* not a usable target — skip silently */
  }
}

/** Our own mailbox as a cover destination (always available once enrolled). */
function selfCoverTarget(me: string): CoverTarget | null {
  const mine = loadSpks(me)[0];
  if (!mine) return null;
  try {
    return { to: mailboxIdForWallet(new PublicKey(me).toBytes()), spk: mine.pub, epoch: mine.epoch };
  } catch {
    return null;
  }
}

/** Pick a dummy's destination uniformly over {own mailbox} ∪ known peers. */
function pickCoverTarget(me: string): CoverTarget | null {
  const targets: CoverTarget[] = [];
  const self = selfCoverTarget(me);
  if (self) targets.push(self);
  for (const t of coverPeers.values()) targets.push(t);
  if (targets.length === 0) return null;
  return targets[Math.min(targets.length - 1, Math.floor(mixRand() * targets.length))];
}

/**
 * Emit ONE dummy. At the relay this is a `put` like any other: same op, same
 * field set, same fixed-length ciphertext, same padded body — the marker that
 * makes it a dummy is inside the ciphertext, which the relay cannot open.
 */
async function sendCoverPut(me: string): Promise<void> {
  const target = pickCoverTarget(me);
  if (!target) return;
  try {
    const envelope = buildCoverEnvelope(target.spk, target.epoch, Math.floor(Date.now() / 1000));
    await post("put", { to: target.to, envelope });
  } catch {
    /* cover is best-effort and must never surface to the member */
  }
}

/**
 * A constant-rate `get` that the member did not ask for. Its only side effect
 * is harvesting dummy ids so the box self-cleans; real mail found here is left
 * on the relay untouched for the member's own fetch to deliver.
 */
async function silentPoll(me: string): Promise<void> {
  if (!getAuth || getAuth.wallet !== me) return;
  const nowWin = mailboxGetWindow(Math.floor(Date.now() / 1000));
  if (getAuth.window !== nowWin && getAuth.window !== nowWin - 1) {
    getAuth = null; // lapsed — do not prompt, just stop polling
    return;
  }
  try {
    const j = await post("get", { to: getAuth.to, wallet: me, sig: getAuth.sig, window: getAuth.window });
    const rows: { id: string; envelope: SealedEnvelope }[] = j.messages ?? [];
    const secrets = loadSpks(me).map((s) => mbxUnb64(s.sec));
    const { coverIds } = partitionCover(rows.map((r) => ({ id: r.id, inner: openSealed(r.envelope, secrets) })));
    for (const id of coverIds) if (!pendingCoverAck.includes(id)) pendingCoverAck.push(id);
  } catch {
    /* silent by construction */
  }
}

function mixTick(): void {
  mixTimer = null;
  const me = mixWallet;
  if (!mixSession || !me) return;
  const plan = planTick(mixSession, mixConfig(), Date.now());
  if (plan.stop) {
    stopMailboxMixing();
    return;
  }
  applyTick(mixSession, plan, Date.now());
  if (plan.poll) void silentPoll(me);
  if (plan.cover) void sendCoverPut(me);
  mixTimer = setTimeout(mixTick, plan.nextDelayMs);
}

/**
 * Arm the constant-rate scheduler. Called by `fetchMailboxMessages`, so the
 * inbox page needs no change and mixing can never be forgotten at a call site.
 * Idempotent; a no-op server-side and whenever mixing is disabled.
 */
export function startMailboxMixing(me: string): void {
  if (typeof window === "undefined") return;
  if (!mixConfig().enabled) return;
  if (mixSession && mixWallet === me) return;
  // A different member on this device gets a clean slate; arming for the SAME
  // member keeps the cover cohort that ordinary use already built up (peers are
  // learned when a real send verifies their bundle, which usually happens
  // before the first fetch arms the scheduler).
  if (mixWallet !== null && mixWallet !== me) stopMailboxMixing();
  else if (mixTimer !== null) { clearTimeout(mixTimer); mixTimer = null; }
  mixWallet = me;
  mixSession = newMixState(Date.now());
  window.addEventListener("pagehide", stopMailboxMixing);
  mixTimer = setTimeout(mixTick, 1_000);
}

/** Stop mixing and forget every scrap of session state. */
export function stopMailboxMixing(): void {
  if (mixTimer !== null) clearTimeout(mixTimer);
  mixTimer = null;
  mixSession = null;
  mixWallet = null;
  getAuth = null;
  coverPeers.clear();
  pendingCoverAck = [];
  if (typeof window !== "undefined") window.removeEventListener("pagehide", stopMailboxMixing);
}

/** Is the mailbox relay reachable at all? */
export async function mailboxAvailable(): Promise<boolean> {
  try {
    const res = await fetch("/api/mailbox", { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Publish (or rotate) my prekey bundle. Rotates when the newest SPK is older
 * than SPK_ROTATE_SECS or none exists; otherwise republishes the current one
 * only if the directory lacks it. Two wallet signatures at most: one for the
 * IK derivation (cached), one over the new SPK.
 */
export async function publishMailboxBundle(
  wallet: SigningWallet,
  signMessage: (m: Uint8Array) => Promise<Uint8Array>
): Promise<void> {
  const me = wallet.publicKey.toBase58();
  const ik = await deriveBoxKeypair(wallet.publicKey, signMessage);
  const now = Math.floor(Date.now() / 1000);
  let spks = loadSpks(me);

  const needNew = spks.length === 0 || now - spks[0].createdAt > SPK_ROTATE_SECS;
  if (needNew) {
    // Advance past BOTH the local newest epoch AND whatever the directory last
    // published. A fresh/reset device has no local SPKs; without consulting the
    // directory it would restart at epoch 1, and the server's monotonic-epoch
    // rule ("epoch not newer") would reject the publish — permanently breaking
    // inbound mail (ultracode 2026-08-11c). The IK re-derives deterministically
    // and the mailbox id is unchanged, so healing the SPK restores delivery.
    const dir = await post("bundle", { wallet: me }).catch(() => ({ bundle: null }));
    const dirEpoch = Number(dir?.bundle?.epoch) || 0;
    const localEpoch = spks[0]?.epoch ?? 0;
    const kp = nacl.box.keyPair();
    const epoch = Math.max(localEpoch, dirEpoch) + 1;
    spks = [{ epoch, pub: mbxB64(kp.publicKey), sec: mbxB64(kp.secretKey), createdAt: now }, ...spks];
    saveSpks(me, spks);
  } else {
    // Already current — see if the directory has it.
    const j = await post("bundle", { wallet: me }).catch(() => ({ bundle: null }));
    if (j.bundle && Number(j.bundle.epoch) >= spks[0].epoch) return;
  }

  const spkPub = mbxUnb64(spks[0].pub);
  const { spkSignedBytes } = await import("./mailboxCrypto");
  const sig = await signMessage(spkSignedBytes(spkPub, spks[0].epoch));
  const bundle: PrekeyBundle = {
    v: 1,
    wallet: me,
    ik: mbxB64(ik.publicKey),
    spk: spks[0].pub,
    epoch: spks[0].epoch,
    sig: mbxB64(sig),
  };
  await post("publish", { bundle });
}

/** Fetch + verify a recipient's bundle; null if none (fall back to F32). */
export async function recipientBundle(recipient: PublicKey): Promise<PrekeyBundle | null> {
  try {
    const j = await post("bundle", { wallet: recipient.toBase58() });
    const b = j.bundle as PrekeyBundle | null;
    if (!b) return null;
    if (b.wallet !== recipient.toBase58()) return null;
    if (!verifyBundle(b, recipient.toBytes())) return null;
    // A verified bundle is a mailbox we may legitimately cover to — dummies to
    // it are real sealed envelopes the recipient can open, recognise and ack,
    // so cover never leaves undeletable litter in someone else's box.
    rememberCoverPeer(b);
    return b;
  } catch {
    return null;
  }
}

/** Send off-chain. Returns the mailbox id it landed in. */
export async function sendMailboxMessage(
  wallet: SigningWallet,
  signMessage: (m: Uint8Array) => Promise<Uint8Array>,
  recipient: PublicKey,
  text: string,
  expiresAt: number // unix secs, 0 = never
): Promise<string> {
  if (new TextEncoder().encode(text).length > MBX_MAX_BODY) {
    throw new Error(`Message too long (max ~${MBX_MAX_BODY} bytes).`);
  }
  const bundle = await recipientBundle(recipient);
  if (!bundle) throw new Error("Recipient has no mailbox bundle yet.");
  const recipientIk = mbxUnb64(bundle.ik);
  const ts = Math.floor(Date.now() / 1000);
  const sig = await signMessage(innerSignedBytes(recipientIk, ts, text));
  const inner: InnerEnvelope = { v: 3, from: wallet.publicKey.toBase58(), ts, body: text, sig: mbxB64(sig) };
  const envelope = sealToBundle(bundle, inner, expiresAt);
  const to = mailboxIdForWallet(recipient.toBytes());
  // TIMING DECORRELATION (F63 v2 §1): hold the put for a random moment so the
  // instant it reaches the relay is not the instant the member pressed Send —
  // which would otherwise line the put up against everything else the app did
  // in that same second. Bounded (default ≤ 2.5 s) so Send still feels live;
  // 0 when mixing is off.
  await sleep(sendJitterMs(mixConfig()));
  // A real put CLAIMS the next scheduled dummy, so the client's put rate stays
  // flat whether or not the member is writing to anyone.
  if (mixSession) noteRealPut(mixSession);
  await post("put", { to, envelope });
  return to;
}

export interface MailboxMessage {
  id: string;
  receivedAt: number; // relay timestamp
  ts: number;         // sender-claimed
  text: string;
  from: string | null;
  verified: boolean;
  expired: boolean;
}

/** Fetch and decrypt my mailbox (one IK signature; SPK secrets are local). */
export async function fetchMailboxMessages(
  wallet: SigningWallet,
  signMessage: (m: Uint8Array) => Promise<Uint8Array>
): Promise<MailboxMessage[]> {
  const me = wallet.publicKey.toBase58();
  const ik = await deriveBoxKeypair(wallet.publicKey, signMessage);
  const to = mailboxIdForWallet(wallet.publicKey.toBytes());
  // Reading is recipient-signed: prove ownership of this mailbox before the
  // relay reveals even envelope count/timing.
  const window = mailboxGetWindow(Math.floor(Date.now() / 1000));
  const getSig = await signMessage(getSignedBytes(to, window));
  const sigB64 = mbxB64(getSig);
  // Cache the read-signature so the constant-rate poller can keep fetching for
  // the rest of this window (and the next) without another wallet prompt.
  getAuth = { wallet: me, to, sig: sigB64, window };
  const j = await post("get", { to, wallet: me, sig: sigB64, window });
  const rows: { id: string; ts: number; envelope: SealedEnvelope }[] = j.messages ?? [];
  const secrets = loadSpks(me).map((s) => mbxUnb64(s.sec));
  const now = Math.floor(Date.now() / 1000);
  const out: MailboxMessage[] = [];
  // COVER TRAFFIC (F63 v2 §2): decrypt first, then split. `partitionCover` is
  // the ONLY gate between the relay and the inbox — a dummy is recognised by a
  // marker inside its own ciphertext and never reaches `out`, so it cannot be
  // rendered, replied to, counted or notified on. Its id goes to the pending
  // sweep instead, to be deleted on the member's next ack.
  const opened = rows.map((r) => ({ row: r, id: r.id, inner: openSealed(r.envelope, secrets) }));
  const { mail, coverIds } = partitionCover(opened);
  for (const id of coverIds) if (!pendingCoverAck.includes(id)) pendingCoverAck.push(id);
  for (const { row: r, inner } of mail) {
    if (!inner) continue; // sealed to a prekey this device no longer holds
    let verified = false;
    try {
      verified = verifyInner(inner, ik.publicKey, new PublicKey(inner.from).toBytes());
    } catch {
      verified = false;
    }
    out.push({
      id: r.id,
      receivedAt: r.ts,
      ts: inner.ts,
      text: inner.body,
      from: verified ? inner.from : null,
      verified,
      expired: r.envelope.expiresAt !== 0 && r.envelope.expiresAt < now,
    });
  }
  // Arm constant-rate polling + cover from here, so the inbox page needs no
  // change and no call site can forget it. Idempotent, and a no-op when mixing
  // is disabled — messaging is identical to v1 in that case.
  startMailboxMixing(me);
  return out;
}

/** Delete fetched mail at the relay (recipient-signed). */
export async function ackMailboxMessages(
  wallet: SigningWallet,
  signMessage: (m: Uint8Array) => Promise<Uint8Array>,
  ids: string[]
): Promise<void> {
  // Dummies harvested since the last ack RIDE ALONG on this one: one signature
  // deletes the member's read mail and sweeps the cover out of the same box, so
  // self-cleaning costs no extra wallet prompt. The relay caps an ack at 100
  // ids, so real mail is served first and leftover cover waits for the next
  // sweep (or the relay's 30-day TTL).
  const cover = pendingCoverAck.filter((c) => !ids.includes(c));
  const all = [...ids, ...cover].slice(0, 100);
  if (all.length === 0) return;
  const ik = await deriveBoxKeypair(wallet.publicKey, signMessage);
  const to = mailboxIdForWallet(wallet.publicKey.toBytes());
  const sig = await signMessage(ackSignedBytes(to, all));
  await post("ack", { to, wallet: wallet.publicKey.toBase58(), ids: all, sig: mbxB64(sig) });
  const swept = all.filter((c) => cover.includes(c));
  pendingCoverAck = pendingCoverAck.filter((c) => !swept.includes(c));
  if (mixSession) noteCoverAcked(mixSession, swept.length);
}
