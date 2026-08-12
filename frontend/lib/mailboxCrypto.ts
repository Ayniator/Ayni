// F63 (v1) — pure crypto + codec for the OFF-CHAIN mailbox (Epic 7's real
// architecture, stage 1 of docs/messaging-migration.md). No DOM, no network,
// no chain — this module is deliberately importable from the property tests.
//
// What v1 changes vs the on-chain F32 design: the ciphertext never touches the
// ledger, so the three structural leaks E7 names — cleartext recipient as the
// index, public timestamp, public fee-payer — do not exist here at all. What
// v1 keeps from F32 (per the migration doc): sealed sender (the author is
// named + signed only INSIDE the ciphertext), fixed-length padding, and the
// wallet-signature-derived x25519 identity key (IK).
//
// What v1 adds: a SIGNED PREKEY (SPK). The recipient publishes a medium-lived
// x25519 prekey signed by their wallet's Ed25519 key; senders seal to the SPK,
// not to the long-term IK. Rotating the SPK and deleting old SPK secrets gives
// coarse forward secrecy — a compromise of today's keys cannot decrypt mail
// sealed to prekeys already deleted. This is deliberately NOT a hand-rolled
// double ratchet: per docs/messaging-migration.md §2.5 the ratchet comes from
// libsignal (X3DH/PQXDH) in v2; v1 uses only vetted NaCl primitives in their
// ordinary constructions (box, sign, hash).
//
// Honest limits of v1, stated exactly (also in the migration doc):
// * Forward secrecy is prekey-granular, not per-message.
// * The relay can see which mailbox receives mail and when it is fetched —
//   recipient-side traffic analysis AT THE RELAY (not on a public ledger).
//   Sealed sender means it cannot see who wrote.
// * The mailbox id derives from the recipient's IK, and the prekey directory
//   maps wallet → bundle, so the RELAY can link mailbox ↔ wallet. The gain
//   over F32 is that this knowledge lives in one deletable service instead of
//   a permanent public ledger.

import nacl from "tweetnacl";

export const MBX_PLAINTEXT_LEN = 1024; // padded inner envelope
export const MBX_CT_LEN = MBX_PLAINTEXT_LEN + 16; // + NaCl box MAC
export const MBX_MAX_BODY = 800;

const te = new TextEncoder();
const td = new TextDecoder();

export const mbxB64 = (b: Uint8Array): string => Buffer.from(b).toString("base64");
export const mbxUnb64 = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, "base64"));

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

const u64le = (n: number | bigint): Uint8Array => {
  const b = new Uint8Array(8);
  let v = BigInt(n);
  for (let i = 0; i < 8; i++) { b[i] = Number(v & 0xffn); v >>= 8n; }
  return b;
};

/** A recipient's published prekey bundle (all key material base64). */
export interface PrekeyBundle {
  v: 1;
  /** Recipient wallet (base58) — the Ed25519 key that signed the SPK. */
  wallet: string;
  /** Long-term x25519 identity key (public), wallet-signature-derived. */
  ik: string;
  /** Current signed prekey (public). */
  spk: string;
  /** Rotation counter (monotonic per wallet). */
  epoch: number;
  /** Ed25519 signature by `wallet` over spkSignedBytes(spk, epoch). */
  sig: string;
}

/** The canonical bytes the wallet signs to authorize a prekey. */
export function spkSignedBytes(spk: Uint8Array, epoch: number): Uint8Array {
  return concat(te.encode("AHA-SPK-1|"), spk, u64le(epoch));
}

/** Verify a bundle's SPK signature against the wallet's Ed25519 public key. */
export function verifyBundle(bundle: PrekeyBundle, walletEd25519Pub: Uint8Array): boolean {
  try {
    if (bundle.v !== 1) return false;
    const spk = mbxUnb64(bundle.spk);
    const sig = mbxUnb64(bundle.sig);
    if (spk.length !== 32 || sig.length !== 64) return false;
    if (!Number.isInteger(bundle.epoch) || bundle.epoch < 0) return false;
    return nacl.sign.detached.verify(spkSignedBytes(spk, bundle.epoch), sig, walletEd25519Pub);
  } catch {
    return false;
  }
}

/**
 * Mailbox address: 16 bytes of SHA-512("AHA-MBX-1|" ‖ WALLET pubkey), hex.
 *
 * Derived from the WALLET, not the IK. An earlier version hashed the IK, but
 * the prekey bundle does not (and cannot cheaply) prove the wallet owns the
 * IK — so an attacker could publish a directory entry carrying a victim's IK,
 * making `mailboxId(victimIk) === victimMailbox` while signing with their own
 * wallet, and read the victim's mail (ultracode finding, 2026-08-11b). Keying
 * the mailbox on the wallet closes that: ownership is a signature by the same
 * key the id is derived from, with no attacker-suppliable input in the middle.
 * The relay already maps wallet→bundle in its directory, so this leaks nothing
 * new to the relay.
 */
export function mailboxIdForWallet(walletPub: Uint8Array): string {
  const h = nacl.hash(concat(te.encode("AHA-MBX-1|"), walletPub));
  return [...h.subarray(0, 16)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** Pad to the fixed plaintext length (2-byte BE length prefix + zeros). */
export function mbxPad(bytes: Uint8Array): Uint8Array {
  if (bytes.length + 2 > MBX_PLAINTEXT_LEN) throw new Error("Message too long.");
  const out = new Uint8Array(MBX_PLAINTEXT_LEN);
  out[0] = (bytes.length >> 8) & 0xff;
  out[1] = bytes.length & 0xff;
  out.set(bytes, 2);
  return out;
}

export function mbxUnpad(plain: Uint8Array): Uint8Array {
  const len = (plain[0] << 8) | plain[1];
  if (len + 2 > plain.length) throw new Error("Corrupt padding.");
  return plain.slice(2, 2 + len);
}

/** The sealed envelope as it rests at the relay: no sender field, by design. */
export interface SealedEnvelope {
  v: 1;
  /** Ephemeral x25519 public key (base64) — fresh per message. */
  eph: string;
  /** 24-byte box nonce (base64). */
  nonce: string;
  /** Which SPK epoch this was sealed to (so the recipient picks the secret). */
  spkEpoch: number;
  /** nacl.box ciphertext, exactly MBX_CT_LEN bytes (base64). */
  ct: string;
  /** Sender-declared expiry (unix secs, 0 = never) — advisory, enforced by
   *  the recipient's client and by the relay TTL. */
  expiresAt: number;
}

/** The authenticated inner envelope (only the recipient ever sees it). */
export interface InnerEnvelope {
  v: 3;
  from: string; // sender wallet, base58
  ts: number;   // sender-claimed unix secs
  body: string;
  sig: string;  // base64 Ed25519 by `from` over innerSignedBytes(...)
  /** F63 v2 cover traffic (mailboxMixing.ts): present and === 1 on a DUMMY.
   *  It lives INSIDE the ciphertext, so the relay cannot see it and a dummy is
   *  indistinguishable from real mail at the relay; the recipient drops it
   *  (partitionCover) before the inbox ever renders a row. Absent on real
   *  mail — a real message is never suppressed by its own author's choice of
   *  body, because the marker is a distinct field, not a body prefix. */
  cover?: number;
}

/** Bytes the sender signs: binds body to recipient IK + time, so a relay (or
 *  recipient) cannot re-attribute or replay it to another mailbox. */
export function innerSignedBytes(recipientIk: Uint8Array, ts: number, body: string): Uint8Array {
  return concat(te.encode("AHAmbx-v1|"), recipientIk, u64le(ts), te.encode(body));
}

/** Seal an inner envelope to a (verified) bundle. Fresh ephemeral key per
 *  message — sender-side forward secrecy, same as F32. */
export function sealToBundle(bundle: PrekeyBundle, inner: InnerEnvelope, expiresAt: number): SealedEnvelope {
  const spk = mbxUnb64(bundle.spk);
  const eph = nacl.box.keyPair();
  const nonce = nacl.randomBytes(24);
  const plain = mbxPad(te.encode(JSON.stringify(inner)));
  const ct = nacl.box(plain, nonce, spk, eph.secretKey);
  if (ct.length !== MBX_CT_LEN) throw new Error("internal: ciphertext length mismatch");
  return { v: 1, eph: mbxB64(eph.publicKey), nonce: mbxB64(nonce), spkEpoch: bundle.epoch, ct: mbxB64(ct), expiresAt };
}

/** Try to open a sealed envelope with each candidate SPK secret (newest
 *  first). Returns the inner envelope or null — never throws on bad input. */
export function openSealed(env: SealedEnvelope, spkSecrets: Uint8Array[]): InnerEnvelope | null {
  try {
    const eph = mbxUnb64(env.eph);
    const nonce = mbxUnb64(env.nonce);
    const ct = mbxUnb64(env.ct);
    if (eph.length !== 32 || nonce.length !== 24 || ct.length !== MBX_CT_LEN) return null;
    for (const sec of spkSecrets) {
      if (!sec || sec.length !== 32) continue;
      const plain = nacl.box.open(ct, nonce, eph, sec);
      if (!plain) continue;
      const inner = JSON.parse(td.decode(mbxUnpad(plain)));
      if (inner && inner.v === 3 && typeof inner.from === "string" && typeof inner.body === "string") {
        return inner as InnerEnvelope;
      }
      return null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Verify the inner envelope's authorship (recipient-side). */
export function verifyInner(inner: InnerEnvelope, recipientIk: Uint8Array, senderEd25519Pub: Uint8Array): boolean {
  try {
    const sig = mbxUnb64(inner.sig);
    if (sig.length !== 64) return false;
    return nacl.sign.detached.verify(innerSignedBytes(recipientIk, inner.ts, inner.body), sig, senderEd25519Pub);
  } catch {
    return false;
  }
}

/** Bytes a recipient's wallet signs to delete fetched mail (relay-verified). */
export function ackSignedBytes(mailboxId: string, ids: string[]): Uint8Array {
  return te.encode("AHA-MBX-ACK|" + mailboxId + "|" + ids.slice().sort().join(","));
}

/** Bytes a recipient's wallet signs to READ a mailbox. The `window` (a coarse
 *  time bucket) bounds replay of a captured signature without a server nonce
 *  round-trip: the relay accepts only the current or previous bucket. Reading
 *  another member's mailbox therefore needs their signature, not just their
 *  address — closing the metadata leak (envelope count/timing) that an
 *  unauthenticated read would expose. */
export function getSignedBytes(mailboxId: string, window: number): Uint8Array {
  return te.encode("AHA-MBX-GET|" + mailboxId + "|" + window);
}

/** The coarse time bucket a get-signature is valid for (10-minute windows). */
export function mailboxGetWindow(nowSecs: number): number {
  return Math.floor(nowSecs / 600);
}
