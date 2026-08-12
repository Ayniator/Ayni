// Epic 5 Phase-2 — the cryptography behind shielded ownership and the encrypted
// read path (F60 / F61). Pure crypto and codec: NO chain import, NO network, no
// Anchor, no PublicKey — the same discipline lib/sharding.ts keeps, so this file
// can be reasoned about (and tested) on its own.
//
// Everything here hangs off ONE secret: the member's VIEWING SECRET, derived by
// domain separation from the master secret — the credential of record, which
// recovery reconstructs bit-identically (CLAUDE.md locked position). So a member
// who recovers their master recovers, without touching the chain: the tags that
// find their memberships, the key that signs for them, and every element key
// that opens their own profile. Nothing here is backed up anywhere else, and
// nothing here is ever transmitted.
//
// Two problems it solves.
//
// 1. FINDING YOUR MEMBERSHIPS WITHOUT PUBLISHING THE ROSTER. `Membership.owner`
//    was a raw wallet at a fixed offset: one memcmp filter listed every Circle a
//    wallet belonged to. The member only needed that field as an INDEX. So the
//    index moves here — into a tag the member derives from their viewing secret,
//    which addresses a PDA (["mownr", tag]). The member computes the address;
//    nobody else can, because inverting it means inverting SHA-256. And two tags
//    of the same member are unlinkable: distinct Circles hash to unrelated
//    values.
//
// 2. SERVING A BIO AND AN AVATAR ONLY TO THEIR AUDIENCE. Per-tier keys, and a
//    drop where exactly one viewer can find their copy: the address is derived
//    from the X25519 shared secret between the two, so it names neither of them
//    and no "who may read whom" table exists to be scraped. Hidden ≡ absent
//    holds at the byte level — without the key you get fixed-length noise, which
//    is exactly what a member who wrote nothing also stores.
//
// The domain tags below are FROZEN in the same sense as ZK_SECRET_DOMAIN_V2 in
// lib/sharding.ts: changing one orphans everything derived under it.

import nacl from "tweetnacl";

const te = new TextEncoder();
const td = new TextDecoder();

// --- domain tags (frozen) ---------------------------------------------------

export const VIEW_DOMAIN = "aha-owner-view-v1"; // master  → viewing secret
export const TAG_DOMAIN = "aha-owner-tag-v1"; //  viewing → owner tag (the index)
export const OWNER_KEY_DOMAIN = "aha-owner-key-v1"; // viewing → shielded signing key
export const ENC_KEY_DOMAIN = "aha-vis-enc-v1"; //   viewing → X25519 profile key
export const ELEMENT_DOMAIN = "aha-vis-elem-v1"; //  viewing → per-element content key
export const DROP_DOMAIN = "aha-vis-drop-v1"; //     shared  → key-drop address
export const WRAP_DOMAIN = "aha-vis-wrap-v1"; //     shared  → key-drop wrapping key

/** Elements that carry their own key, so a viewer can be given one and not the
 *  other. The quipu is on-chain and unencrypted by nature — it is gated by
 *  policy, not by a key; see docs/visibility.md. */
export const ELEMENT_BIO = 1;
export const ELEMENT_AVATAR = 2;

/** Fixed plaintext size of a bio before sealing. Every bio occupies exactly this
 *  much, so the ciphertext length says nothing about what was written — or
 *  whether anything was. */
export const BIO_PLAINTEXT_LEN = 160;
/** 24-byte nonce + secretbox(BIO_PLAINTEXT_LEN) — must equal MemberProfile::BIO_CT. */
export const BIO_CT_LEN = 24 + BIO_PLAINTEXT_LEN + 16; // 200
/** Padded on-chain pointer to the avatar ciphertext — MemberProfile::AVATAR_REF. */
export const AVATAR_REF_LEN = 64;
/** 24-byte nonce + secretbox(bioKey ‖ avatarKey) — VisibilityKeyDrop::SEALED. */
export const SEALED_LEN = 24 + 64 + 16; // 104

// --- small helpers ----------------------------------------------------------

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

const u32le = (n: number): Uint8Array => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
};

const u16le = (n: number): Uint8Array => {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
};

const sha256 = async (...parts: Uint8Array[]): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", concat(...parts) as unknown as ArrayBuffer));

const tag = (s: string) => te.encode(s);

/** Constant-time-ish equality (length-independent short-circuit is fine here —
 *  both operands are public-length values). */
export const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
};

export const isZero = (b: Uint8Array): boolean => b.every((x) => x === 0);

export const b64 = (b: Uint8Array): string =>
  typeof Buffer !== "undefined"
    ? Buffer.from(b).toString("base64")
    : btoa(String.fromCharCode(...b));

export const unb64 = (s: string): Uint8Array =>
  typeof Buffer !== "undefined"
    ? Uint8Array.from(Buffer.from(s, "base64"))
    : Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// --- the viewing secret -----------------------------------------------------

/**
 * The viewing secret: SHA-256("aha-owner-view-v1" ‖ master).
 *
 * Domain-separated from `walletSeed` and `zkSecretForCircle` (lib/sharding.ts)
 * so the three never collide, and derived from the master rather than stored
 * independently so that recovery — which reconstructs the master and emits
 * nothing on chain — silently restores the member's ability to find and open
 * everything. It is not a backup artefact and must never be shared, printed or
 * put in a shard: it is a pure function of something the member already has.
 */
export async function deriveViewingSecret(master: Uint8Array): Promise<Uint8Array> {
  if (master.length !== 32) throw new Error("master secret must be 32 bytes");
  return sha256(tag(VIEW_DOMAIN), master);
}

// The unlocked viewing secret is cached on the device so ordinary page loads can
// resolve "my memberships" without a biometric prompt on every render. It is
// device-local, re-derivable from the master, and deliberately stored under ONE
// fixed key — there is no list, no index and no per-member naming here, so the
// cache itself cannot be walked to learn how many identities this device holds.
const VIEW_CACHE_KEY = "aha:owner-view";

export function cachedViewingSecret(): Uint8Array | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(VIEW_CACHE_KEY);
    if (!raw) return null;
    const b = unb64(raw);
    return b.length === 32 ? b : null;
  } catch {
    return null;
  }
}

export function cacheViewingSecret(vk: Uint8Array): void {
  if (typeof window === "undefined") return;
  if (vk.length !== 32) throw new Error("viewing secret must be 32 bytes");
  localStorage.setItem(VIEW_CACHE_KEY, b64(vk));
}

/** Forget the cached viewing secret (a lock action). The member loses nothing
 *  permanent: it re-derives from the master secret. */
export function forgetViewingSecret(): void {
  if (typeof window !== "undefined") localStorage.removeItem(VIEW_CACHE_KEY);
}

// --- shielded ownership -----------------------------------------------------

/** How many derivation indices a device looks at per Circle when resolving its
 *  own memberships or its own shielded signing key. Small on purpose: this is a
 *  fixed, private derivation walk, never a scan of anything, and it must not
 *  grow into one. */
export const SHIELD_INDEX_SCAN = 3;

/**
 * The owner tag for one membership: SHA-256(TAG ‖ vk ‖ circle ‖ u32le(index)).
 *
 * This 32-byte value IS the address seed of the member's private index into the
 * chain. `index` exists for the same reason it exists in `zkSecretForCircle`:
 * a member may hold more than one membership in a Circle over time, and a tag
 * is written once, so rotation means moving to the next index.
 */
export async function ownerTagFor(vk: Uint8Array, circle: Uint8Array, index = 0): Promise<Uint8Array> {
  if (circle.length !== 32) throw new Error("circle key must be 32 bytes");
  return sha256(tag(TAG_DOMAIN), vk, circle, u32le(index));
}

/**
 * The shielded signing key for one membership — an ed25519 keypair derived from
 * the viewing secret, which takes the place of the member's public wallet in
 * `Membership.owner`.
 *
 * Why a derived key rather than nothing at all: `owner` is what authorises the
 * member's own writes (visibility, profile, posts, tying a cord). Emptying it
 * makes the membership guardian-only. This keeps the member able to act while
 * removing the handle a stranger could scan for — the key is unlinkable to the
 * wallet, and never appears anywhere the member has not put it.
 *
 * HONEST LIMIT: a transaction that this key signs while the member's ordinary
 * wallet pays the fee puts both in the same transaction, and transaction history
 * is public. Passive, keyless enumeration is what this closes; the transaction
 * graph closes only with relayed fee payment.
 */
export async function shieldedOwnerKey(
  vk: Uint8Array,
  circle: Uint8Array,
  index = 0
): Promise<nacl.SignKeyPair> {
  if (circle.length !== 32) throw new Error("circle key must be 32 bytes");
  const seed = await sha256(tag(OWNER_KEY_DOMAIN), vk, circle, u32le(index));
  return nacl.sign.keyPair.fromSeed(seed);
}

// --- the encrypted profile --------------------------------------------------

/** The member's X25519 profile keypair, derived from the viewing secret. Its
 *  PUBLIC half goes on chain in `MemberProfile.enc_pub` — it is a public key by
 *  definition and links to no wallet and no commitment beyond the profile it
 *  sits in. */
export async function profileEncKey(vk: Uint8Array): Promise<nacl.BoxKeyPair> {
  const seed = await sha256(tag(ENC_KEY_DOMAIN), vk);
  return nacl.box.keyPair.fromSecretKey(seed);
}

/** The content key for one element of one member's profile, at one epoch.
 *  Bumping the epoch changes every element key at once — that is revocation. */
export async function elementKey(
  vk: Uint8Array,
  circle: Uint8Array,
  commitment: Uint8Array,
  element: number,
  epoch: number
): Promise<Uint8Array> {
  return sha256(tag(ELEMENT_DOMAIN), vk, circle, commitment, new Uint8Array([element]), u16le(epoch));
}

/** Seal a bio into exactly BIO_CT_LEN bytes. Longer text is refused rather than
 *  silently truncated; shorter text is padded with RANDOM bytes, so nothing
 *  about the length survives into the ciphertext. */
export function sealBio(bio: string, key: Uint8Array): Uint8Array {
  const body = te.encode(bio);
  if (body.length > BIO_PLAINTEXT_LEN - 2) throw new Error("bio is too long");
  const plain = nacl.randomBytes(BIO_PLAINTEXT_LEN);
  plain.set(u16le(body.length), 0);
  plain.set(body, 2);
  const nonce = nacl.randomBytes(24);
  return concat(nonce, nacl.secretbox(plain, nonce, key));
}

/** A bio slot that no key will ever open — what a member with nothing written
 *  stores, so that silence and secrecy are the same 200 bytes. */
export function opaqueBio(): Uint8Array {
  return nacl.randomBytes(BIO_CT_LEN);
}

/** Open a sealed bio, or null. Null is the ONLY failure signal: a wrong key, a
 *  member who wrote nothing, and a member who wrote something you may not read
 *  are indistinguishable here — the caller renders nothing in all three cases
 *  and must never render a difference. */
export function openBio(ct: Uint8Array, key: Uint8Array): string | null {
  if (ct.length !== BIO_CT_LEN) return null;
  const opened = nacl.secretbox.open(ct.slice(24), ct.slice(0, 24), key);
  if (!opened) return null;
  const len = new DataView(opened.buffer, opened.byteOffset, opened.byteLength).getUint16(0, true);
  if (len > BIO_PLAINTEXT_LEN - 2) return null;
  return td.decode(opened.slice(2, 2 + len));
}

/** Seal an avatar (a data URL) under the avatar element key. The ciphertext is
 *  meant to live off chain; only a pointer to it goes on. */
export function sealAvatar(dataUrl: string, key: Uint8Array): Uint8Array {
  const nonce = nacl.randomBytes(24);
  return concat(nonce, nacl.secretbox(te.encode(dataUrl), nonce, key));
}

export function openAvatar(ct: Uint8Array, key: Uint8Array): string | null {
  if (ct.length < 24 + 16) return null;
  const opened = nacl.secretbox.open(ct.slice(24), ct.slice(0, 24), key);
  return opened ? td.decode(opened) : null;
}

/** Pad an avatar pointer (an IPFS CID, or "") into the fixed on-chain field. */
export function packAvatarRef(cid: string): Uint8Array {
  const b = te.encode(cid);
  if (b.length > AVATAR_REF_LEN) throw new Error("avatar reference is too long");
  const out = new Uint8Array(AVATAR_REF_LEN);
  out.set(b, 0);
  return out;
}

export function unpackAvatarRef(ref: Uint8Array): string {
  const end = ref.indexOf(0);
  return td.decode(ref.slice(0, end === -1 ? ref.length : end));
}

// --- key drops --------------------------------------------------------------

/** The X25519 shared secret between a profile owner and one viewer. Symmetric:
 *  both sides compute the same 32 bytes, and nobody else can. */
export function sharedSecret(mySecret: Uint8Array, theirPub: Uint8Array): Uint8Array {
  return nacl.scalarMult(mySecret, theirPub);
}

/**
 * The address seed of a key drop: SHA-256(DROP ‖ shared ‖ ownerCommitment ‖ epoch).
 *
 * Both parties can compute it and nobody else can, which is the whole reason the
 * on-chain account can afford to name neither of them. Including the owner's
 * commitment keeps drops from one viewer to two different profiles distinct;
 * including the epoch is what makes a bump strand the whole previous generation.
 */
export async function dropIdFor(
  shared: Uint8Array,
  ownerCommitment: Uint8Array,
  epoch: number
): Promise<Uint8Array> {
  if (ownerCommitment.length !== 32) throw new Error("commitment must be 32 bytes");
  return sha256(tag(DROP_DOMAIN), shared, ownerCommitment, u16le(epoch));
}

const wrapKey = (shared: Uint8Array) => sha256(tag(WRAP_DOMAIN), shared);

/**
 * Seal the pair of element keys for one viewer. An element this viewer is not in
 * the audience for is passed as null and travels as 32 zero bytes — so a partial
 * grant and a full grant are the same 104 bytes on chain, and the viewer learns
 * only "there is nothing here for me", never "there is something you may not
 * see".
 */
export async function sealElementKeys(
  shared: Uint8Array,
  bioKey: Uint8Array | null,
  avatarKey: Uint8Array | null
): Promise<Uint8Array> {
  const plain = new Uint8Array(64);
  if (bioKey) plain.set(bioKey, 0);
  if (avatarKey) plain.set(avatarKey, 32);
  const nonce = nacl.randomBytes(24);
  return concat(nonce, nacl.secretbox(plain, nonce, await wrapKey(shared)));
}

export interface ElementKeys {
  bio: Uint8Array | null;
  avatar: Uint8Array | null;
}

/** Open a key drop. Returns nulls for elements that were not granted, and null
 *  for a drop that is not ours to open. */
export async function openElementKeys(sealed: Uint8Array, shared: Uint8Array): Promise<ElementKeys | null> {
  if (sealed.length !== SEALED_LEN) return null;
  const opened = nacl.secretbox.open(sealed.slice(24), sealed.slice(0, 24), await wrapKey(shared));
  if (!opened) return null;
  const bio = opened.slice(0, 32);
  const avatar = opened.slice(32, 64);
  return { bio: isZero(bio) ? null : bio, avatar: isZero(avatar) ? null : avatar };
}
