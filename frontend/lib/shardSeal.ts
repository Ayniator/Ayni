// Shard sealing (Trust Platform Epic 11 / F73–F74) — the shared seal/unseal
// pair used by the shard ceremony (/recovery/setup) and the recovery wizard
// (/recovery). Extracted so both surfaces derive keys IDENTICALLY; if they ever
// drifted, recovery would silently fail.
//
// A shard at rest is an OPAQUE BLOB encrypted under a key the HOLDER does not
// have (lib/shardCustody contract): the seal key derives from the member's
// one-time code plus the shard's role, so a sponsor (or this device's custody)
// can read nothing from the blob it stores — only someone presenting the code
// can open it.
//
//   key   = SHA-256("aha-shard-seal-v1:<role>:" + code),  role ∈ member |
//           sponsor-1 | sponsor-2  (domain separation per shard)
//   blob  = nonce(24) || nacl.secretbox(raw, nonce, key)
//
// Cipher is tweetnacl's secretbox (vetted, constant-time) — never hand-rolled.
// NO NETWORK CODE PATH: pure functions over bytes; no fetch, socket, storage,
// or chain import. Keys are wiped (fill(0)) before returning.

import nacl from "tweetnacl";

export type SealRole = "member" | "sponsor-1" | "sponsor-2";

const NONCE_LEN = 24;

async function sealKeyFor(code: string, role: SealRole): Promise<Uint8Array> {
  const material = new TextEncoder().encode(`aha-shard-seal-v1:${role}:${code}`);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", material as unknown as BufferSource));
}

/** Seal a raw shard → opaque blob (nonce || secretbox). The raw shard buffer is
 *  the caller's to wipe. */
export async function sealShard(role: SealRole, code: string, raw: Uint8Array): Promise<Uint8Array> {
  const key = await sealKeyFor(code, role);
  const nonce = nacl.randomBytes(NONCE_LEN);
  const box = nacl.secretbox(raw, nonce, key);
  key.fill(0);
  const out = new Uint8Array(nonce.length + box.length);
  out.set(nonce, 0);
  out.set(box, nonce.length);
  return out;
}

/** Open a sealed blob back to the raw shard, or null if this role+code pair did
 *  not seal it (secretbox authenticates — a wrong key never yields garbage). */
export async function openShard(role: SealRole, code: string, blob: Uint8Array): Promise<Uint8Array | null> {
  if (blob.length < NONCE_LEN + nacl.secretbox.overheadLength) return null;
  const key = await sealKeyFor(code, role);
  const raw = nacl.secretbox.open(blob.subarray(NONCE_LEN), blob.subarray(0, NONCE_LEN), key);
  key.fill(0);
  return raw ? new Uint8Array(raw) : null;
}

/** Open a SPONSOR blob when the opener cannot know which of the two sponsor
 *  keys sealed it: shard bytes are indistinguishable by design and a handover
 *  payload carries no role marker, so we try both sponsor role keys and report
 *  which one opened. (Also lets a flow detect the SAME sponsor shard being
 *  presented twice — two copies of one shard reconstruct nothing.) */
export async function openSponsorShard(
  code: string,
  blob: Uint8Array
): Promise<{ raw: Uint8Array; role: "sponsor-1" | "sponsor-2" } | null> {
  const asFirst = await openShard("sponsor-1", code, blob);
  if (asFirst) return { raw: asFirst, role: "sponsor-1" };
  const asSecond = await openShard("sponsor-2", code, blob);
  if (asSecond) return { raw: asSecond, role: "sponsor-2" };
  return null;
}
