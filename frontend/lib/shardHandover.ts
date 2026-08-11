// Shard handover codec (Trust Platform Epic 11 / F74) — the bytes that cross
// between two devices, in person, at a circle meeting.
//
// THIS MODULE HAS NO NETWORK CODE PATH. It imports no fetch, socket, storage-sync
// or chain API — there is deliberately nowhere for a shard to go except into a
// QR image on this screen or an NFC tap to a device held against this one. A
// shard must never appear in a request body, a server relay, a cloud backup, or
// a log (CLAUDE.md locked position; Sentinel Layer F asserts the absence
// statically). The QR/NFC *hardware* glue lives in the component; this file is
// only the payload codec, so it stays pure and unit-testable.
//
// The payload is an OPAQUE sealed blob (already encrypted under a key the
// receiving sponsor does not hold — see shardCustody). The codec adds only a
// version tag, a length, and an integrity check so a mis-scan fails LOUDLY
// instead of delivering a silently-truncated shard that looks like protection.

/** Human/scanner-recognisable prefix. Anything without it is rejected outright,
 *  so a random QR or NDEF record can never be mistaken for a shard. */
export const HANDOVER_PREFIX = "AHA-SHARD-1.";

/** NFC NDEF record type — a private MIME, never a URL (a URL record could invite
 *  a reader to *fetch* it; a shard has no URL and no fetch). */
export const HANDOVER_MIME = "application/vnd.aha.shard";

const VERSION = 1;

// --- base64url (no +/=, QR- and NDEF-safe) -----------------------------------

function toB64url(u: Uint8Array): string {
  let s = "";
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

// --- CRC-32 (integrity only — NOT security; the blob is already sealed) -------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(u: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of u) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// --- codec -------------------------------------------------------------------

/**
 * Frame a sealed shard for transfer: version || len(2, BE) || blob || crc(4, BE),
 * base64url-encoded behind the recognisable prefix. Deterministic — the same
 * blob always yields the same string (no timestamp, no nonce added here; the
 * blob's own sealing carries the entropy), so nothing about *when* a handover
 * happened leaks from the payload.
 */
export function encodeShardPayload(sealed: Uint8Array): string {
  if (sealed.length === 0) throw new Error("refusing to encode an empty shard");
  if (sealed.length > 0xffff) throw new Error("shard too large to frame");
  const body = new Uint8Array(1 + 2 + sealed.length + 4);
  body[0] = VERSION;
  body[1] = (sealed.length >>> 8) & 0xff;
  body[2] = sealed.length & 0xff;
  body.set(sealed, 3);
  const crc = crc32(sealed);
  const off = 3 + sealed.length;
  body[off] = (crc >>> 24) & 0xff;
  body[off + 1] = (crc >>> 16) & 0xff;
  body[off + 2] = (crc >>> 8) & 0xff;
  body[off + 3] = crc & 0xff;
  return HANDOVER_PREFIX + toB64url(body);
}

/**
 * Decode a scanned/tapped payload back to the sealed blob, or throw LOUDLY.
 * Rejects: wrong prefix, wrong version, length mismatch, CRC mismatch. A partial
 * or corrupted scan never returns a valid-looking shard.
 */
export function decodeShardPayload(text: string): Uint8Array {
  const t = text.trim();
  if (!t.startsWith(HANDOVER_PREFIX)) throw new Error("not an AHA shard payload");
  const body = fromB64url(t.slice(HANDOVER_PREFIX.length));
  if (body.length < 1 + 2 + 4) throw new Error("shard payload too short — corrupted scan");
  if (body[0] !== VERSION) throw new Error(`unsupported shard version ${body[0]}`);
  const len = (body[1] << 8) | body[2];
  if (body.length !== 1 + 2 + len + 4) throw new Error("shard length mismatch — corrupted scan");
  const sealed = body.slice(3, 3 + len);
  const off = 3 + len;
  const crc = ((body[off] << 24) | (body[off + 1] << 16) | (body[off + 2] << 8) | body[off + 3]) >>> 0;
  if (crc32(sealed) !== crc) throw new Error("shard checksum failed — do not trust this scan, try again");
  return sealed;
}

/** True if a string even looks like a shard payload (cheap pre-check for a
 *  scanner loop — full validation is decodeShardPayload). */
export function looksLikeShardPayload(text: string): boolean {
  return typeof text === "string" && text.trim().startsWith(HANDOVER_PREFIX);
}
