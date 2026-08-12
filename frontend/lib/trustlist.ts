// The client-side, encrypted TRUST LIST (F64) — whom I have marked as trusted.
//
// By construction this never touches the chain: there is no on-chain "who trusts
// whom" account, and there never will be — a social graph on a public ledger is
// exactly the thing this fellowship must not leak. The list lives only in this
// browser's localStorage, encrypted at rest, and the key that decrypts it is
// re-derived from a wallet signature and never persisted anywhere.
//
// This is the single list that both the messaging surface (Epic 7 — whom I let
// into my inbox / whom I message) and Epic 5's "chosen ones" tier (F58,
// visibility.ts) want. It is deliberately NOT the same store as the presentation
// `chosen-ones` list in visibility.ts: that one is plaintext and keyed by
// membership commitment for the read-path check; THIS one is encrypted at rest
// and holds whatever opaque handles (wallet addresses or commitments) the user
// trusts. A surface may mirror an entry into `setChosen(...)` when it wants a
// trust relationship to also widen a visibility tier — but that mirroring is the
// caller's choice, not something forced here.
//
// AT REST: the list is sealed with nacl.secretbox under a key derived from the
// caller's messaging box secret (deriveBoxKeypair, one signature, session-cached
// — no extra wallet prompt). The secretbox key is a domain-separated hash of the
// box secret, so it is a DISTINCT key from the one that opens the inbox: a bug
// that leaked one does not hand over the other.

// F65 ADDITION — the passkey-wrapped trust/block/mute map. Alongside the
// original wallet-signature-sealed handle list below (unchanged, still
// exported), this file now also holds the F64 per-commitment relationship map
// ("trust" | "block" | "mute"), stored ONLY as a blob sealed by the F65
// keystore (lib/keystore.ts) under the exact name "trustlist" — never on
// chain, never in plaintext localStorage, no plaintext copy anywhere at rest.
//
// RE-DERIVATION (locked position: losing a passkey never loses identity):
// if the passkey is lost, this map is simply re-created by re-marking peers
// in the UI. It is preference data, not identity material; nothing here is
// unrecoverable and nothing here gates recovery.

import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
import { deriveBoxKeypair } from "./messaging";
import { passkeyCreated, unlock } from "./keystore";

const seed = (s: string) => new TextEncoder().encode(s);
const TRUST_KEY = "aha:trust-list"; // localStorage map { ownerBase58 -> sealed }
const KEY_DOMAIN = "AHA trust-list at-rest key v1"; // separates it from the inbox key

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource));
}

type SignMessage = (m: Uint8Array) => Promise<Uint8Array>;

/** The 32-byte secretbox key for THIS wallet's trust list. Derived from the
 *  session-cached box secret + a domain tag, so it needs no second signature and
 *  is cryptographically distinct from the inbox key. */
async function trustKey(publicKey: PublicKey, signMessage: SignMessage): Promise<Uint8Array> {
  const kp = await deriveBoxKeypair(publicKey, signMessage);
  return sha256(concat(seed(KEY_DOMAIN), kp.secretKey));
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

// --- sealed storage (per-owner, localStorage) ------------------------------

function readAll(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(TRUST_KEY) || "{}"); } catch { return {}; }
}
function writeAll(all: Record<string, string>): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(TRUST_KEY, JSON.stringify(all));
}

function seal(key: Uint8Array, list: string[]): string {
  const nonce = nacl.randomBytes(24);
  const ct = nacl.secretbox(new TextEncoder().encode(JSON.stringify(list)), nonce, key);
  return b64(concat(nonce, ct));
}
function open(key: Uint8Array, sealed: string): string[] {
  const raw = unb64(sealed);
  const nonce = raw.slice(0, 24);
  const ct = raw.slice(24);
  const plain = nacl.secretbox.open(ct, nonce, key);
  if (!plain) return []; // wrong key / tampered → treat as empty, never throw a mystery
  try {
    const parsed = JSON.parse(new TextDecoder().decode(plain));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch { return []; }
}

// --- public API ------------------------------------------------------------

/** F65 form: the passkey-sealed trust/block/mute map for this device.
 *  Returns {} when no keystore has been created yet (nothing stored). */
export async function getTrustList(): Promise<TrustEntries>;
/** Legacy form (unchanged): the wallet-signature-sealed list of trusted
 *  handles. Requires a signature to derive the at-rest key (session-cached,
 *  so at most one prompt). */
export async function getTrustList(publicKey: PublicKey, signMessage: SignMessage): Promise<string[]>;
export async function getTrustList(
  publicKey?: PublicKey,
  signMessage?: SignMessage
): Promise<TrustEntries | string[]> {
  if (publicKey && signMessage) {
    const sealed = readAll()[publicKey.toBase58()];
    if (!sealed) return [];
    return open(await trustKey(publicKey, signMessage), sealed);
  }
  return readEntries();
}

/** Replace the whole list (deduped, order-preserving). Returns the new list. */
export async function setTrustList(publicKey: PublicKey, signMessage: SignMessage, list: string[]): Promise<string[]> {
  const deduped = [...new Set(list.map((s) => s.trim()).filter(Boolean))];
  const key = await trustKey(publicKey, signMessage);
  const all = readAll();
  all[publicKey.toBase58()] = seal(key, deduped);
  writeAll(all);
  return deduped;
}

/** Add a trusted handle (wallet address or commitment). Idempotent. */
export async function addTrusted(publicKey: PublicKey, signMessage: SignMessage, handle: string): Promise<string[]> {
  const current = await getTrustList(publicKey, signMessage);
  return setTrustList(publicKey, signMessage, [...current, handle]);
}

/** Remove a trusted handle. No-op if it isn't present. */
export async function removeTrusted(publicKey: PublicKey, signMessage: SignMessage, handle: string): Promise<string[]> {
  const current = await getTrustList(publicKey, signMessage);
  return setTrustList(publicKey, signMessage, current.filter((h) => h !== handle));
}

/** Convenience: is `handle` on my trust list? */
export async function isTrusted(publicKey: PublicKey, signMessage: SignMessage, handle: string): Promise<boolean> {
  return (await getTrustList(publicKey, signMessage)).includes(handle);
}

/** Forget the local sealed list for this wallet (does not touch other wallets).
 *  The key was never persisted, so this is a full local erase of the trust list. */
export function forgetTrustList(publicKey: PublicKey): void {
  const all = readAll();
  delete all[publicKey.toBase58()];
  writeAll(all);
}

// ===========================================================================
// F65 — passkey-wrapped trust/block/mute map (keystore-sealed, F64 seed)
// ===========================================================================
//
// One relationship state per member commitment (or other opaque handle).
// Stored ONLY as the F65 keystore blob named "trustlist": AES-GCM under the
// passkey-derived key, in the "aha-keystore" IndexedDB. Never on chain, never
// in plaintext localStorage. Unlocking prompts the platform biometric at most
// once per tab session (the keystore session-caches the derived key).
//
// If no keystore has been created yet, reads report "nothing marked" (an
// empty map / false) rather than throwing — a member who never set up the
// passkey has, observably, marked no one. Writes DO throw, with a pointer to
// Settings → Security, because silently storing the map anywhere weaker would
// break the "never in plaintext" rule.

export type TrustState = "trust" | "block" | "mute";
/** commitment (or opaque handle) -> relationship state */
export type TrustEntries = Record<string, TrustState>;

const KEYSTORE_BLOB = "trustlist"; // exact name — the keystore has no enumeration

const TRUST_STATES: readonly TrustState[] = ["trust", "block", "mute"];

function parseEntries(bytes: Uint8Array | null): TrustEntries {
  if (!bytes) return {};
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: TrustEntries = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (TRUST_STATES.includes(v as TrustState)) out[k] = v as TrustState;
    }
    return out;
  } catch {
    return {}; // tampered / unparseable → treat as empty, never a mystery throw
  }
}

async function readEntries(): Promise<TrustEntries> {
  if (!(await passkeyCreated())) return {}; // no keystore ⇒ nothing was ever marked
  const ks = await unlock();
  return parseEntries(await ks.open(KEYSTORE_BLOB));
}

async function writeEntries(entries: TrustEntries): Promise<void> {
  if (!(await passkeyCreated())) {
    throw new Error(
      "No device keystore yet — create one in Settings → Security before marking members."
    );
  }
  const ks = await unlock();
  await ks.seal(KEYSTORE_BLOB, new TextEncoder().encode(JSON.stringify(entries)));
}

/** Set (or clear, with null) the relationship state for one commitment.
 *  Returns the updated map. */
export async function setEntry(commitment: string, state: TrustState | null): Promise<TrustEntries> {
  const handle = commitment.trim();
  if (!handle) throw new Error("Empty commitment.");
  const entries = await readEntries();
  if (state === null) delete entries[handle];
  else entries[handle] = state;
  await writeEntries(entries);
  return entries;
}

/** Is this commitment blocked? False when no keystore exists yet. */
export async function isBlocked(commitment: string): Promise<boolean> {
  return (await readEntries())[commitment.trim()] === "block";
}

/** Is this commitment muted? (A block also silences, so callers that only
 *  check mute still honour a block.) False when no keystore exists yet. */
export async function isMuted(commitment: string): Promise<boolean> {
  const s = (await readEntries())[commitment.trim()];
  return s === "mute" || s === "block";
}
