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
//
// F103 (ADR 0002 Stage 1) — HYBRID post-quantum sealing. A v2 bundle carries,
// alongside the x25519 SPK, an ML-KEM-768 encapsulation key (FIPS 203, via the
// audited @noble/post-quantum — never hand-rolled, per the ADR's own rule).
// A v2 envelope is sealed under a key derived from BOTH shared secrets —
// x25519 ECDH and an ML-KEM encapsulation — so the message stays confidential
// if EITHER assumption survives. This is the hybrid construction PQXDH uses,
// applied to v1's prekey model; it does NOT add a ratchet (still v2/libsignal
// work) — it closes the harvest-now-decrypt-later window, which is the one
// quantum threat that acts retroactively. v1 bundles and envelopes remain
// fully supported: a sender seals v2 exactly when the recipient's bundle
// advertises the KEM key, so mail never stops flowing during rollout.

import nacl from "tweetnacl";
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";

/** ML-KEM-768 sizes (FIPS 203), pinned so a drifting dependency fails loudly. */
export const MLKEM_PUB_LEN = 1184;
export const MLKEM_SEC_LEN = 2400;
export const MLKEM_CT_LEN = 1088;

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
  /** 1 = x25519 SPK only; 2 = SPK + ML-KEM-768 key (hybrid, F103). */
  v: 1 | 2;
  /** Recipient wallet (base58) — the Ed25519 key that signed the SPK. */
  wallet: string;
  /** Long-term x25519 identity key (public), wallet-signature-derived. */
  ik: string;
  /** Current signed prekey (public). */
  spk: string;
  /** v2 only: ML-KEM-768 encapsulation key (public), signed WITH the SPK. */
  pqk?: string;
  /** Rotation counter (monotonic per wallet). */
  epoch: number;
  /** Ed25519 signature by `wallet` over spkSignedBytes(spk, epoch) (v1) or
   *  spkSignedBytesV2(spk, pqk, epoch) (v2). */
  sig: string;
}

/** The canonical bytes the wallet signs to authorize a v1 prekey. */
export function spkSignedBytes(spk: Uint8Array, epoch: number): Uint8Array {
  return concat(te.encode("AHA-SPK-1|"), spk, u64le(epoch));
}

/** v2: the signature covers the KEM key too — an attacker cannot strip or
 *  swap `pqk` to downgrade a hybrid bundle without breaking the signature. */
export function spkSignedBytesV2(spk: Uint8Array, pqk: Uint8Array, epoch: number): Uint8Array {
  return concat(te.encode("AHA-SPK-2|"), spk, pqk, u64le(epoch));
}

/** Verify a bundle's signature against the wallet's Ed25519 public key. */
export function verifyBundle(bundle: PrekeyBundle, walletEd25519Pub: Uint8Array): boolean {
  try {
    if (bundle.v !== 1 && bundle.v !== 2) return false;
    const spk = mbxUnb64(bundle.spk);
    const sig = mbxUnb64(bundle.sig);
    if (spk.length !== 32 || sig.length !== 64) return false;
    if (!Number.isInteger(bundle.epoch) || bundle.epoch < 0) return false;
    if (bundle.v === 1) {
      // A v1 bundle must not smuggle a KEM key the signature does not cover.
      if (bundle.pqk !== undefined) return false;
      return nacl.sign.detached.verify(spkSignedBytes(spk, bundle.epoch), sig, walletEd25519Pub);
    }
    if (typeof bundle.pqk !== "string") return false;
    const pqk = mbxUnb64(bundle.pqk);
    if (pqk.length !== MLKEM_PUB_LEN) return false;
    return nacl.sign.detached.verify(spkSignedBytesV2(spk, pqk, bundle.epoch), sig, walletEd25519Pub);
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
  /** 1 = x25519-only (nacl.box); 2 = hybrid x25519 + ML-KEM-768 (F103). */
  v: 1 | 2;
  /** Ephemeral x25519 public key (base64) — fresh per message. */
  eph: string;
  /** 24-byte box nonce (base64). */
  nonce: string;
  /** v2 only: ML-KEM-768 ciphertext (base64), fresh encapsulation per message. */
  kct?: string;
  /** Which SPK epoch this was sealed to (so the recipient picks the secret). */
  spkEpoch: number;
  /** Ciphertext, exactly MBX_CT_LEN bytes (base64): nacl.box (v1) or
   *  nacl.secretbox under the hybrid key (v2) — same MAC size, same length. */
  ct: string;
  /** Sender-declared expiry (unix secs, 0 = never) — advisory, enforced by
   *  the recipient's client and by the relay TTL. */
  expiresAt: number;
}

/**
 * The hybrid key (v2): SHA-512 over a domain tag, BOTH shared secrets, and the
 * full public transcript (ephemeral pub, KEM ciphertext, SPK, KEM key),
 * truncated to 32 bytes for nacl.secretbox. Binding the transcript means a
 * mix-and-match of parts from two envelopes never yields a valid key. The
 * x25519 contribution uses nacl.box.before — the exact keystream key nacl.box
 * itself uses — so v2's ECDH strength is identical to v1's, and ML-KEM's
 * shared secret is purely additive: BOTH assumptions must fall before the
 * plaintext does.
 */
function hybridKey(
  xShared: Uint8Array,
  kemShared: Uint8Array,
  ephPub: Uint8Array,
  kemCt: Uint8Array,
  spk: Uint8Array,
  pqk: Uint8Array
): Uint8Array {
  return nacl.hash(concat(te.encode("AHA-HYB-1|"), xShared, kemShared, ephPub, kemCt, spk, pqk)).subarray(0, 32);
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

/** Seal an inner envelope to a (verified) bundle. Fresh ephemeral key (and,
 *  for a v2 bundle, a fresh ML-KEM encapsulation) per message — sender-side
 *  forward secrecy, same as F32. Hybrid exactly when the bundle offers it. */
export function sealToBundle(bundle: PrekeyBundle, inner: InnerEnvelope, expiresAt: number): SealedEnvelope {
  const spk = mbxUnb64(bundle.spk);
  const eph = nacl.box.keyPair();
  const nonce = nacl.randomBytes(24);
  const plain = mbxPad(te.encode(JSON.stringify(inner)));
  if (bundle.v === 2 && typeof bundle.pqk === "string") {
    const pqk = mbxUnb64(bundle.pqk);
    if (pqk.length !== MLKEM_PUB_LEN) throw new Error("internal: bad ML-KEM key length");
    const { cipherText, sharedSecret } = ml_kem768.encapsulate(pqk);
    const xShared = nacl.box.before(spk, eph.secretKey);
    const key = hybridKey(xShared, sharedSecret, eph.publicKey, cipherText, spk, pqk);
    const ct = nacl.secretbox(plain, nonce, key);
    if (ct.length !== MBX_CT_LEN) throw new Error("internal: ciphertext length mismatch");
    return {
      v: 2,
      eph: mbxB64(eph.publicKey),
      nonce: mbxB64(nonce),
      kct: mbxB64(cipherText),
      spkEpoch: bundle.epoch,
      ct: mbxB64(ct),
      expiresAt,
    };
  }
  const ct = nacl.box(plain, nonce, spk, eph.secretKey);
  if (ct.length !== MBX_CT_LEN) throw new Error("internal: ciphertext length mismatch");
  return { v: 1, eph: mbxB64(eph.publicKey), nonce: mbxB64(nonce), spkEpoch: bundle.epoch, ct: mbxB64(ct), expiresAt };
}

/** One stored prekey's secret material, as the opener holds it. `pqSec` (the
 *  ML-KEM decapsulation key) exists only for epochs published as v2 bundles;
 *  its public halves ride along so the opener can rebuild the v2 transcript. */
export interface SpkSecretSet {
  /** x25519 SPK secret (32 bytes). */
  sec: Uint8Array;
  /** x25519 SPK public (32 bytes) — needed for the v2 transcript binding. */
  pub?: Uint8Array;
  /** ML-KEM-768 decapsulation key (2400 bytes), when this epoch is hybrid. */
  pqSec?: Uint8Array;
  /** ML-KEM-768 encapsulation key (1184 bytes) — v2 transcript binding. */
  pqPub?: Uint8Array;
}

/** Try to open a sealed envelope with each candidate SPK secret (newest
 *  first). Accepts either bare x25519 secrets (legacy call shape) or full
 *  `SpkSecretSet`s. Returns the inner envelope or null — never throws. */
export function openSealed(env: SealedEnvelope, spkSecrets: (Uint8Array | SpkSecretSet)[]): InnerEnvelope | null {
  try {
    const eph = mbxUnb64(env.eph);
    const nonce = mbxUnb64(env.nonce);
    const ct = mbxUnb64(env.ct);
    if (eph.length !== 32 || nonce.length !== 24 || ct.length !== MBX_CT_LEN) return null;
    if (env.v !== 1 && env.v !== 2) return null;
    const kct = env.v === 2 ? mbxUnb64(env.kct ?? "") : null;
    if (env.v === 2 && (!kct || kct.length !== MLKEM_CT_LEN)) return null;
    for (const cand of spkSecrets) {
      const set: SpkSecretSet = cand instanceof Uint8Array ? { sec: cand } : cand;
      if (!set.sec || set.sec.length !== 32) continue;
      let plain: Uint8Array | null = null;
      if (env.v === 2) {
        // Hybrid: this epoch must hold the KEM secret AND both public halves.
        if (!set.pqSec || set.pqSec.length !== MLKEM_SEC_LEN) continue;
        if (!set.pub || set.pub.length !== 32) continue;
        if (!set.pqPub || set.pqPub.length !== MLKEM_PUB_LEN) continue;
        const kemShared = ml_kem768.decapsulate(kct!, set.pqSec);
        const xShared = nacl.box.before(eph, set.sec);
        const key = hybridKey(xShared, kemShared, eph, kct!, set.pub, set.pqPub);
        plain = nacl.secretbox.open(ct, nonce, key);
      } else {
        plain = nacl.box.open(ct, nonce, eph, set.sec);
      }
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
