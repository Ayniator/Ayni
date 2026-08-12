// Epic 12 · F86 — the AHA embedded wallet core (device-local key custody).
//
// The app's own built-in Solana wallet: an ed25519 keypair that lives ONLY on
// this device, sealed by the F65 keystore (lib/keystore.ts). The wallet-standard
// wrapper (lib/embeddedWalletStandard.ts) exposes it to wallet-adapter as
// "AHA Wallet", so every existing page picks it up with zero changes.
//
// ── CUSTODY MODEL ──────────────────────────────────────────────────────────
//  · The 64-byte ed25519 secret key is sealed into the keystore under the name
//    "embedded-wallet" — AES-GCM under a key that (in "prf"/"largeBlob" modes)
//    only exists behind the platform biometric/PIN. NEVER plaintext
//    localStorage, NEVER transmitted: this file contains no fetch, no XHR, no
//    WebSocket, and imports nothing that networks. Sentinel may assert that
//    statically.
//  · Only the PUBLIC key is cached in localStorage ("aha:embwallet:pub") so the
//    wallet can appear in the connect modal — and connect — before any unlock.
//    Unlock (and the biometric prompt it may carry) happens lazily, on the
//    FIRST signature of the session.
//  · The raw secret bytes are zeroed as soon as the in-memory Keypair is
//    constructed (Keypair.fromSecretKey copies); the Keypair's own copy is
//    best-effort wiped on lock/remove.
//
// ── RE-DERIVATION STORY (keystore consumer registry) ───────────────────────
// Until the Epic 11 master-secret rooting round lands, the embedded wallet key
// is INDEPENDENT randomness: losing the passkey/device without an export backup
// loses the key. The create/settings UI must surface exportSecretKey() as the
// backup path. Once rooted, re-derivation is pure and local:
//
//    INTEGRATION POINT (comment only — do NOT implement here until the
//    master-rooting round): derive the wallet keypair from the Epic 11 master
//    secret via deriveFromMaster(master).walletSeed (lib/sharding.ts) and
//    Keypair.fromSeed(walletSeed). The sealed blob then becomes a mere unlock
//    convenience — bit-identically re-creatable from sponsor-shard recovery,
//    with nothing emitted on chain (CLAUDE.md locked position).
//
// ── DESTRUCTIVE OPERATIONS ─────────────────────────────────────────────────
// removeEmbeddedWallet() destroys the sealed blob irreversibly; the calling UI
// owns the explicit confirmation flow (and the "did you export a backup?"
// warning). exportSecretKey() hands out the live secret; the calling UI owns
// the warnings around it, and the caller must wipe the returned bytes.

import { Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import nacl from "tweetnacl";
import { createPasskey, passkeyCreated, unlock } from "./keystore";

/** Keystore blob name (exact-name access only — see lib/keystore.ts). */
const BLOB_NAME = "embedded-wallet";

/** localStorage cache of the PUBLIC key (base58). Public data only. */
const PUB_CACHE = "aha:embwallet:pub";

// ---------------------------------------------------------------------------
// base58 (pure, dependency-free — also lets the pubkey cache round-trip and
// secret-key import work without pulling bs58 in as a direct dependency)
// ---------------------------------------------------------------------------

const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const B58_MAP: Record<string, number> = {};
for (let i = 0; i < B58_ALPHABET.length; i++) B58_MAP[B58_ALPHABET[i]] = i;

/** Encode bytes as base58 (Bitcoin/Solana alphabet). */
export function toBase58(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] * 256;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += B58_ALPHABET[digits[i]];
  return out;
}

/** Decode a base58 string to bytes. Throws on characters outside the alphabet. */
export function fromBase58(s: string): Uint8Array {
  let zeros = 0;
  while (zeros < s.length && s[zeros] === "1") zeros++;
  const bytes: number[] = [];
  for (let i = zeros; i < s.length; i++) {
    const v = B58_MAP[s[i]];
    if (v === undefined) throw new Error(`Invalid base58 character "${s[i]}".`);
    let carry = v;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  const out = new Uint8Array(zeros + bytes.length); // leading zeros already 0
  for (let i = 0; i < bytes.length; i++) out[zeros + i] = bytes[bytes.length - 1 - i];
  return out;
}

// ---------------------------------------------------------------------------
// public-key cache (public data only — lets the wallet show up pre-unlock)
// ---------------------------------------------------------------------------

function readPubCache(): string | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(PUB_CACHE);
  } catch { return null; }
}

function writePubCache(pub: string | null): void {
  try {
    if (typeof window === "undefined") return;
    if (pub === null) window.localStorage.removeItem(PUB_CACHE);
    else window.localStorage.setItem(PUB_CACHE, pub);
  } catch { /* storage unavailable — wallet still works, just won't pre-list */ }
}

/** True if this device has an embedded wallet (by the public-key cache — the
 *  cheap, prompt-free check the modal needs). The sealed blob is the truth;
 *  createWallet() reconciles the two if the cache was cleared. */
export function hasEmbeddedWallet(): boolean {
  return readPubCache() !== null;
}

/** The embedded wallet's public key (base58), or null if none. No unlock. */
export function embeddedWalletPublicKey(): string | null {
  return readPubCache();
}

// ---------------------------------------------------------------------------
// keystore plumbing + in-memory keypair
// ---------------------------------------------------------------------------

// Session cache: the unlocked Keypair lives in memory for this tab's lifetime
// (mirroring the keystore's own session key). lockEmbeddedWallet() drops it.
let sessionKeypair: Keypair | null = null;

/** Unlock the F65 keystore, creating the device passkey first if this is the
 *  very first sealed item on the device (createPasskey is idempotent). */
async function ensureKeystore() {
  if (!(await passkeyCreated())) await createPasskey("AHA embedded wallet");
  return unlock();
}

/** Build a Keypair from raw secret bytes and wipe the raw bytes.
 *  Accepts a 64-byte ed25519 secret key or a 32-byte seed. */
function keypairFromSecret(raw: Uint8Array): Keypair {
  try {
    if (raw.length === 64) return Keypair.fromSecretKey(raw); // copies internally
    if (raw.length === 32) return Keypair.fromSeed(raw);
    throw new Error(`Secret key must be 64 bytes (or a 32-byte seed); got ${raw.length}.`);
  } finally {
    raw.fill(0);
  }
}

/** Lazily unlock and return the signing keypair (first call in a session may
 *  show the platform biometric/PIN prompt via keystore.unlock()). */
async function unlockKeypair(): Promise<Keypair> {
  if (sessionKeypair) return sessionKeypair;
  const ks = await unlock(); // throws its own clear error if no keystore yet
  const raw = await ks.open(BLOB_NAME);
  if (!raw) throw new Error("No embedded wallet on this device yet.");
  sessionKeypair = keypairFromSecret(raw);
  writePubCache(sessionKeypair.publicKey.toBase58()); // heal a cleared cache
  return sessionKeypair;
}

/**
 * Unlock NOW (may show the platform biometric/PIN prompt once per session) and
 * return the public key (base58). The wallet-standard connect flow uses this so
 * the member proves presence when they pick "AHA Wallet" in the connect modal,
 * rather than being surprised by a prompt at the first signature. Throws if no
 * embedded wallet exists on this device — creation is the UI's job, never a
 * side effect of connecting.
 */
export async function unlockEmbeddedWallet(): Promise<string> {
  const kp = await unlockKeypair();
  return kp.publicKey.toBase58();
}

/** Drop the in-memory keypair (e.g. on disconnect). Best-effort wipes the
 *  secret bytes. Does NOT lock the whole keystore — other consumers
 *  (trustlist, …) keep their session; a full lock is keystore.lock(). */
export function lockEmbeddedWallet(): void {
  if (sessionKeypair) {
    try { sessionKeypair.secretKey.fill(0); } catch { /* wipe is best-effort */ }
    sessionKeypair = null;
  }
}

// ---------------------------------------------------------------------------
// creation / import / export / removal
// ---------------------------------------------------------------------------

/**
 * Create the embedded wallet: fresh random keypair, secret sealed into the
 * keystore, public key cached. NEVER silently overwrites: if a sealed wallet
 * already exists (even with a cleared localStorage cache), it is ADOPTED and
 * returned with `created: false` — destroying a key requires the explicit
 * removeEmbeddedWallet() flow.
 */
export async function createWallet(): Promise<{ publicKey: string; created: boolean }> {
  const ks = await ensureKeystore();
  const existing = await ks.open(BLOB_NAME);
  if (existing) {
    sessionKeypair = keypairFromSecret(existing);
    const pub = sessionKeypair.publicKey.toBase58();
    writePubCache(pub);
    return { publicKey: pub, created: false };
  }
  const kp = Keypair.generate();
  await ks.seal(BLOB_NAME, kp.secretKey);
  sessionKeypair = kp;
  const pub = kp.publicKey.toBase58();
  writePubCache(pub);
  return { publicKey: pub, created: true };
}

/**
 * Import an existing secret key (64-byte ed25519 secret key or 32-byte seed,
 * as raw bytes or a base58 string) and seal it as the embedded wallet.
 * Refuses if a wallet already exists — remove it explicitly first, so an
 * import can never silently destroy a key that was not backed up.
 * Note: a base58 STRING cannot be wiped (JS strings are immutable); prefer
 * passing bytes where the caller controls the buffer.
 */
export async function importSecretKey(secret: Uint8Array | string): Promise<{ publicKey: string }> {
  const raw = typeof secret === "string" ? fromBase58(secret.trim()) : secret.slice();
  const ks = await ensureKeystore();
  if (await ks.open(BLOB_NAME)) {
    raw.fill(0);
    throw new Error("An embedded wallet already exists on this device. Remove it explicitly before importing another key.");
  }
  const kp = keypairFromSecret(raw); // validates length, wipes raw
  await ks.seal(BLOB_NAME, kp.secretKey);
  sessionKeypair = kp;
  const pub = kp.publicKey.toBase58();
  writePubCache(pub);
  return { publicKey: pub };
}

/**
 * Export the 64-byte secret key (the member's backup path until master-secret
 * rooting lands). Requires unlock. The calling UI owns the warnings; the
 * CALLER MUST WIPE the returned bytes (fill(0)) after use.
 */
export async function exportSecretKey(): Promise<Uint8Array> {
  const kp = await unlockKeypair();
  return kp.secretKey.slice(); // caller's copy to display/wipe
}

/**
 * Destroy the embedded wallet: delete the sealed blob, clear the public-key
 * cache, wipe the in-memory keypair. IRREVERSIBLE without a backup — the
 * calling UI owns the explicit confirmation flow before invoking this.
 */
export async function removeEmbeddedWallet(): Promise<void> {
  if (await passkeyCreated()) {
    const ks = await unlock();
    await ks.remove(BLOB_NAME);
  }
  lockEmbeddedWallet();
  writePubCache(null);
}

// ---------------------------------------------------------------------------
// signing (against the lazily-unlocked keypair)
// ---------------------------------------------------------------------------

/** Sign a legacy or versioned transaction in place and return it. Throws if
 *  the embedded wallet is not a required signer of the transaction. */
export async function signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
  const kp = await unlockKeypair();
  if (tx instanceof VersionedTransaction) tx.sign([kp]);
  else tx.partialSign(kp);
  return tx;
}

/** Sign several transactions with one unlock. */
export async function signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
  await unlockKeypair(); // one prompt up front, not one per transaction
  const out: T[] = [];
  for (const tx of txs) out.push(await signTransaction(tx));
  return out;
}

/** Detached ed25519 signature over arbitrary bytes (SIWS-style messages). */
export async function signMessage(message: Uint8Array): Promise<Uint8Array> {
  const kp = await unlockKeypair();
  return nacl.sign.detached(message, kp.secretKey);
}

/** Byte-level transaction signing for the wallet-standard layer: deserializes
 *  (versioned wire format covers legacy messages too, but fall back to the
 *  legacy Transaction codec for pre-versioned serializations), signs, and
 *  re-serializes without requiring the other signatures yet. */
export async function signSerializedTransaction(bytes: Uint8Array): Promise<Uint8Array> {
  let versioned: VersionedTransaction | null = null;
  try {
    versioned = VersionedTransaction.deserialize(bytes);
  } catch {
    versioned = null;
  }
  if (versioned) {
    await signTransaction(versioned);
    return versioned.serialize();
  }
  const legacy = Transaction.from(bytes);
  await signTransaction(legacy);
  return new Uint8Array(legacy.serialize({ requireAllSignatures: false, verifySignatures: false }));
}

/** The public key as bytes (from the cache — no unlock), or null. */
export function embeddedWalletPublicKeyBytes(): Uint8Array | null {
  const pub = readPubCache();
  if (!pub) return null;
  try { return new PublicKey(pub).toBytes(); } catch { return null; }
}
