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
  const res = await fetch("/api/mailbox", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ op, ...payload }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || "mailbox relay error");
  return j;
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
    const kp = nacl.box.keyPair();
    const epoch = (spks[0]?.epoch ?? 0) + 1;
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
  const j = await post("get", { to, wallet: me, sig: mbxB64(getSig), window });
  const rows: { id: string; ts: number; envelope: SealedEnvelope }[] = j.messages ?? [];
  const secrets = loadSpks(me).map((s) => mbxUnb64(s.sec));
  const now = Math.floor(Date.now() / 1000);
  const out: MailboxMessage[] = [];
  for (const r of rows) {
    const inner = openSealed(r.envelope, secrets);
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
  return out;
}

/** Delete fetched mail at the relay (recipient-signed). */
export async function ackMailboxMessages(
  wallet: SigningWallet,
  signMessage: (m: Uint8Array) => Promise<Uint8Array>,
  ids: string[]
): Promise<void> {
  if (ids.length === 0) return;
  const ik = await deriveBoxKeypair(wallet.publicKey, signMessage);
  const to = mailboxIdForWallet(wallet.publicKey.toBytes());
  const sig = await signMessage(ackSignedBytes(to, ids));
  await post("ack", { to, wallet: wallet.publicKey.toBase58(), ids, sig: mbxB64(sig) });
}
