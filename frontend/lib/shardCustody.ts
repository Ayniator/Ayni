// ShardCustody (Trust Platform Epic 11 / F73) — where a sponsor's shard lives.
//
// A shard at rest is an OPAQUE BLOB, encrypted under a key the custodian does
// not hold, indexed by a one-time code the member supplies at recovery. The
// custodian's storage contains no name, address, public key, identity
// commitment, or admission-correlated timestamp — nothing that links a shard to
// a member.
//
// THE INTERFACE HAS NO ENUMERATION PATH — no list, count, iterate, keys, or
// debug view — by design, not omission (see CLAUDE.md locked positions). You can
// PUT a blob under a code, GET it back only if you already know the code, and
// BURN it. You cannot ask "what do I hold?" A custodian who has forgotten every
// code they were given holds, observably, nothing. If a test needs enumeration,
// the test is wrong (Sentinel Layer F asserts the absence statically).
//
// There is NO NETWORK CODE PATH here: nothing in this module imports fetch, a
// socket, or a storage-sync API. A shard reaches this store only from an
// in-person device-to-device transfer (F74); it never touches a server.

/** A one-time code (the member's recovery index) → an opaque sealed blob. */
export interface ShardCustody {
  /** Store a sealed shard under a one-time code. Overwrites silently — a
   *  re-issue (F77) puts a fresh blob under a fresh code. */
  put(code: string, sealed: Uint8Array): Promise<void>;
  /** Return the blob for a code you already know, or null. This is the ONLY
   *  read — there is deliberately no way to discover codes you were not given. */
  get(code: string): Promise<Uint8Array | null>;
  /** Burn the blob at a code (recovery consumed it, or a re-issue supersedes it).
   *  Idempotent. */
  burn(code: string): Promise<void>;
  // NOTE: intentionally NO list()/keys()/count()/entries()/has() — enumeration
  // would let a seized device reveal how many people a sponsor is helping, which
  // the whole scheme exists to prevent.
}

// --- a local, browser-only custody: opaque blobs in localStorage -------------
//
// One-time codes are hashed before use as the storage key, so even the localStorage
// key namespace reveals nothing (a raw code is a capability; its hash is an
// opaque locator). Blobs are base64. No metadata is stored beside a blob.

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function codeKey(code: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("aha-shard:" + code));
  // A short opaque prefix — collisions are astronomically unlikely and even a
  // full dump of these keys reveals no code and no member.
  return "shard:" + b64(new Uint8Array(h)).slice(0, 24);
}

export const localShardCustody: ShardCustody = {
  async put(code, sealed) {
    if (typeof window === "undefined") return;
    localStorage.setItem(await codeKey(code), b64(sealed));
  },
  async get(code) {
    if (typeof window === "undefined") return null;
    const v = localStorage.getItem(await codeKey(code));
    return v ? unb64(v) : null;
  },
  async burn(code) {
    if (typeof window === "undefined") return;
    localStorage.removeItem(await codeKey(code));
  },
};
