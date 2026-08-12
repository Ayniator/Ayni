// Epic 8 · F65 — a passkey-UNLOCKED, DEVICE-LOCAL encrypted keystore.
//
// ── LOCKED POSITION (CLAUDE.md — binding) ──────────────────────────────────
// The passkey here is a DEVICE-LOCAL UNLOCK for locally-encrypted data.
// It is NEVER the credential of record and NEVER gates recovery. The member's
// identity is the master secret (Solana keypair + Semaphore commitment both
// derive from it), and the safety net for a lost device is Epic 11 sponsor
// shard recovery (/recovery, /recovery/setup) — NOT this module. Losing the
// passkey must never mean losing the identity: every blob sealed by this
// keystore MUST be re-derivable through normal app flows, and each consumer
// documents what "re-derivation" means for its blob (registry below).
//
// ── SERVERLESS ─────────────────────────────────────────────────────────────
// This is WebAuthn with NO server: the challenge is local random bytes that
// exist only to satisfy the browser API, attestation is "none" and the
// attestation object is discarded unread, and nothing produced here is ever
// transmitted — this file contains no fetch, no XHR, no WebSocket, no import
// of anything that networks. Sentinel may assert that statically.
//
// ── NO BIOMETRIC EXPOSURE ──────────────────────────────────────────────────
// The fingerprint / face template never reaches JavaScript. The platform
// authenticator verifies the user inside its secure element; all we receive
// is a credentialId and, where supported, a PRF output or a largeBlob read.
//
// ── THREE MODES (feature-detected, honest about their differences) ─────────
//  "prf"       WebAuthn PRF extension. The AES key is re-derived from the
//              passkey's PRF output at every unlock and NEVER stored anywhere.
//              Strongest: no key at rest, biometric/PIN gates every derivation.
//  "largeBlob" PRF unavailable but largeBlob supported. A random 32-byte
//              secret is written INTO the credential's largeBlob (it travels
//              with the passkey, not with our storage) and read back, behind
//              user verification, at unlock. Slightly weaker than PRF only in
//              that the secret exists as stored bytes (inside the credential).
//  "local"     No usable passkey support. A random AES-GCM key is generated
//              NON-EXTRACTABLE via WebCrypto and stored as a CryptoKey in
//              IndexedDB. HONEST DIFFERENCE: there is no user-verification
//              gate — any code running in this origin on this profile can use
//              (though never export) the key. It still protects blobs from
//              being copied off the device in usable form, but it is
//              access-control by OS user profile, not by biometric.
//
// ── NO ENUMERATION (shardCustody discipline) ───────────────────────────────
// The API is seal / open / remove by EXACT name only. There is deliberately
// no list(), keys(), count(), or debug view of what the keystore holds — a
// seized or inspected device should not be able to answer "what does this
// member keep sealed?" beyond names an inspector already knows. If a test
// needs enumeration, the test is wrong.
//
// ── CONSUMER REGISTRY (re-derivation documented per item) ──────────────────
//  "trustlist" (lib/trustlist.ts, F64) — the member's private trust/block/
//      mute marks. If the passkey is lost, this list is simply re-created by
//      re-marking peers in the UI; it contains preference data, never
//      identity material, so nothing is unrecoverable.
// Any new consumer must add itself here with its re-derivation story.
//
// Relation to lib/passkey.ts: that earlier module wraps ONE fixed blob in
// localStorage. This module is the general-purpose named-blob keystore that
// F65 ships; new consumers should use this one.

export type KeystoreMode = "prf" | "largeBlob" | "local";

/** A handle to the unlocked keystore. The AES key inside is a non-extractable
 *  in-memory CryptoKey; the handle exposes exact-name operations only. */
export interface Keystore {
  readonly mode: KeystoreMode;
  /** AES-GCM-encrypt `bytes` and store them under `name` (overwrites). */
  seal(name: string, bytes: Uint8Array): Promise<void>;
  /** Decrypt and return the blob at `name`, or null if none exists.
   *  Throws if a blob exists but cannot be opened (wrong key / tampering). */
  open(name: string): Promise<Uint8Array | null>;
  /** Delete the blob at `name`. Idempotent. */
  remove(name: string): Promise<void>;
  // Intentionally NO list()/keys()/count() — see header.
}

// ---------------------------------------------------------------------------
// IndexedDB plumbing — one DB, two stores, exact-key access only
// ---------------------------------------------------------------------------

const DB_NAME = "aha-keystore";
const DB_VERSION = 1;
const BLOBS = "blobs"; // name -> { iv: Uint8Array, ct: Uint8Array }
const META = "meta";   // "meta" -> Meta, "localKey" -> CryptoKey (local mode)

interface Meta {
  mode: KeystoreMode;
  credId?: string; // base64url credentialId ("prf" / "largeBlob" modes)
  label?: string;
}

interface SealedRecord { iv: Uint8Array; ct: Uint8Array }

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("IndexedDB is not available.")); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS);
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not open keystore DB."));
  });
}

async function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const req = db.transaction(store, "readonly").objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } finally { db.close(); }
}

async function idbPut(store: string, key: string, value: unknown): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

async function idbDel(store: string, key: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

const utf8 = (s: string) => new TextEncoder().encode(s);
const b64url = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => {
  const p = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(p), (c) => c.charCodeAt(0));
};
const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const asBuf = (a: ArrayBuffer | Uint8Array) => (a instanceof Uint8Array ? a : new Uint8Array(a));

// Fixed PRF salt: the PRF output depends only on (credential, salt) — NOT the
// per-call challenge — so the derived key is stable across unlocks.
const PRF_SALT = utf8("AHA keystore wrap v1");
const HKDF_SALT = utf8("aha-keystore-hkdf-v1");
const HKDF_INFO = utf8("aha-keystore-aes-gcm");

/** HKDF a raw secret (PRF output / largeBlob secret) into a non-extractable
 *  AES-GCM-256 key. The raw secret is wiped by the caller after this returns. */
async function deriveAesKey(secret: Uint8Array): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey("raw", secret as unknown as BufferSource, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: HKDF_SALT as unknown as BufferSource, info: HKDF_INFO as unknown as BufferSource },
    ikm,
    { name: "AES-GCM", length: 256 },
    false, // non-extractable: the key never exists as exportable bytes
    ["encrypt", "decrypt"]
  );
}

function webAuthnPresent(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as any).PublicKeyCredential !== "undefined" &&
    !!navigator.credentials &&
    typeof navigator.credentials.create === "function"
  );
}

// ---------------------------------------------------------------------------
// availability
// ---------------------------------------------------------------------------

/**
 * Which mode this device gets.
 *
 * If a keystore credential already exists, this is the RECORDED TRUTH (settled
 * at creation). Before creation it is a best-effort pre-flight estimate:
 * `PublicKeyCredential.getClientCapabilities()` where the browser has it,
 * otherwise an optimistic "prf" when a user-verifying platform authenticator
 * exists (modern platform authenticators overwhelmingly support PRF). The
 * settings page labels the pre-creation value as an estimate; createPasskey()
 * records what the authenticator actually granted.
 */
export async function keystoreAvailable(): Promise<KeystoreMode> {
  const meta = await idbGet<Meta>(META, "meta").catch(() => undefined);
  if (meta) return meta.mode;

  if (!webAuthnPresent()) return "local";

  const PKC: any = (window as any).PublicKeyCredential;
  try {
    if (typeof PKC.getClientCapabilities === "function") {
      const caps = await PKC.getClientCapabilities();
      if (caps?.["extension:prf"]) return "prf";
      if (caps?.["extension:largeBlob"]) return "largeBlob";
      return "local";
    }
    if (typeof PKC.isUserVerifyingPlatformAuthenticatorAvailable === "function") {
      const uv = await PKC.isUserVerifyingPlatformAuthenticatorAvailable();
      return uv ? "prf" : "local";
    }
  } catch {
    /* fall through — detection failure is not an error, just uncertainty */
  }
  return "local";
}

/** True once createPasskey() has set this device up (any mode). */
export async function passkeyCreated(): Promise<boolean> {
  return (await idbGet<Meta>(META, "meta").catch(() => undefined)) !== undefined;
}

// ---------------------------------------------------------------------------
// creation
// ---------------------------------------------------------------------------

/**
 * Set the device up: create a platform passkey (PRF requested, largeBlob as
 * fallback) or, where passkeys are unusable, the local non-extractable key.
 * Idempotent: if the keystore already exists, returns its recorded mode.
 *
 * SERVERLESS: the challenge is local randomness, attestation is "none", and
 * nothing from the ceremony leaves this function except the credentialId we
 * keep in IndexedDB to address the credential later.
 */
export async function createPasskey(label: string): Promise<{ mode: KeystoreMode }> {
  const existing = await idbGet<Meta>(META, "meta").catch(() => undefined);
  if (existing) return { mode: existing.mode };

  if (!webAuthnPresent()) return setupLocalMode(label);

  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: rand(32) as unknown as BufferSource, // local-only, discarded
      rp: { name: "AHA · Ayni" },
      user: {
        id: rand(16) as unknown as BufferSource, // opaque local handle — NOT a wallet, NOT a commitment
        name: label || "AHA member",
        displayName: label || "AHA member",
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },   // ES256
        { type: "public-key", alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "required",
        userVerification: "required",
      },
      timeout: 60_000,
      attestation: "none", // we neither need nor want to identify the authenticator
      extensions: { prf: {}, largeBlob: { support: "preferred" } } as any,
    },
  }).catch((e) => { throw new Error("Passkey creation failed: " + (e?.message ?? e)); })) as PublicKeyCredential | null;

  if (!cred) return setupLocalMode(label); // user backed out of the platform dialog

  const credId = b64url(asBuf(cred.rawId));
  const ext: any = cred.getClientExtensionResults?.() ?? {};

  if (ext.prf?.enabled) {
    await idbPut(META, "meta", { mode: "prf", credId, label } satisfies Meta);
    return { mode: "prf" };
  }

  if (ext.largeBlob?.supported) {
    // Write a fresh random secret INTO the credential's largeBlob. The write
    // itself requires a user-verified assertion; the secret then lives with
    // the passkey (and syncs with it), never in our storage.
    const secret = rand(32);
    try {
      const assertion = (await navigator.credentials.get({
        publicKey: {
          challenge: rand(32) as unknown as BufferSource,
          allowCredentials: [{ type: "public-key", id: unb64url(credId) as unknown as BufferSource }],
          userVerification: "required",
          timeout: 60_000,
          extensions: { largeBlob: { write: secret } } as any,
        },
      })) as PublicKeyCredential | null;
      const wres: any = assertion?.getClientExtensionResults?.() ?? {};
      if (wres.largeBlob?.written) {
        await idbPut(META, "meta", { mode: "largeBlob", credId, label } satisfies Meta);
        return { mode: "largeBlob" };
      }
    } finally {
      secret.fill(0); // our copy of the secret is gone either way
    }
  }

  // The passkey exists but grants neither PRF nor largeBlob — it cannot carry
  // a stable secret (WebAuthn signatures are randomised, so they can never
  // re-derive a key). Fall back honestly to the non-passkey local mode.
  return setupLocalMode(label);
}

/** The no-passkey fallback: a random, NON-EXTRACTABLE AES-GCM key stored as a
 *  CryptoKey in IndexedDB. See the header for the honest security difference. */
async function setupLocalMode(label: string): Promise<{ mode: KeystoreMode }> {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await idbPut(META, "localKey", key);
  await idbPut(META, "meta", { mode: "local", label } satisfies Meta);
  return { mode: "local" };
}

// ---------------------------------------------------------------------------
// unlock
// ---------------------------------------------------------------------------

// Session cache: after the first successful unlock, the (non-extractable,
// in-memory) AES key is kept for this tab's lifetime so consumers don't
// re-prompt the biometric on every read/write. Closing the tab drops it.
let sessionKey: CryptoKey | null = null;
let sessionMode: KeystoreMode | null = null;

/**
 * Unlock the keystore and return a handle. In "prf"/"largeBlob" modes the
 * first call in a session triggers the platform biometric / device-PIN
 * prompt; "local" mode has no prompt (see header for why that is weaker).
 */
export async function unlock(): Promise<Keystore> {
  const meta = await idbGet<Meta>(META, "meta");
  if (!meta) throw new Error("No keystore on this device yet — create one in Settings → Security.");

  if (!sessionKey || sessionMode !== meta.mode) {
    sessionKey = await obtainKey(meta);
    sessionMode = meta.mode;
  }
  return makeKeystore(meta.mode, sessionKey);
}

/** Drop the in-memory session key (e.g. on an explicit "lock" action). */
export function lock(): void {
  sessionKey = null;
  sessionMode = null;
}

async function obtainKey(meta: Meta): Promise<CryptoKey> {
  if (meta.mode === "local") {
    const key = await idbGet<CryptoKey>(META, "localKey");
    if (!key) throw new Error("Local keystore key is missing.");
    return key;
  }

  if (!webAuthnPresent()) throw new Error("This keystore needs a passkey, but WebAuthn is unavailable here.");
  if (!meta.credId) throw new Error("Keystore credential record is corrupted.");

  const wantPrf = meta.mode === "prf";
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: rand(32) as unknown as BufferSource, // local-only anti-replay for the API's sake
      allowCredentials: [{ type: "public-key", id: unb64url(meta.credId) as unknown as BufferSource }],
      userVerification: "required",
      timeout: 60_000,
      extensions: (wantPrf
        ? { prf: { eval: { first: PRF_SALT } } }
        : { largeBlob: { read: true } }) as any,
    },
  }).catch((e) => { throw new Error("Unlock failed: " + (e?.message ?? e)); })) as PublicKeyCredential | null;

  if (!assertion) throw new Error("Unlock was cancelled.");
  const ext: any = assertion.getClientExtensionResults?.() ?? {};

  const raw: ArrayBuffer | Uint8Array | undefined = wantPrf ? ext.prf?.results?.first : ext.largeBlob?.blob;
  if (!raw) {
    // Fail loudly rather than silently downgrade to a weaker path.
    throw new Error(wantPrf
      ? "Authenticator did not return a PRF result; cannot derive the key."
      : "Authenticator did not return the largeBlob secret; cannot derive the key.");
  }

  const secret = asBuf(raw).slice();
  try {
    return await deriveAesKey(secret);
  } finally {
    secret.fill(0);
  }
}

function makeKeystore(mode: KeystoreMode, key: CryptoKey): Keystore {
  return {
    mode,
    async seal(name: string, bytes: Uint8Array): Promise<void> {
      const iv = rand(12);
      const ct = new Uint8Array(await crypto.subtle.encrypt(
        // additionalData binds the ciphertext to its name: a blob copied under
        // another name will refuse to open (no blob-swapping).
        { name: "AES-GCM", iv: iv as unknown as BufferSource, additionalData: utf8("aha-keystore:" + name) as unknown as BufferSource },
        key,
        bytes as unknown as BufferSource
      ));
      await idbPut(BLOBS, name, { iv, ct } satisfies SealedRecord);
    },
    async open(name: string): Promise<Uint8Array | null> {
      const rec = await idbGet<SealedRecord>(BLOBS, name);
      if (!rec) return null;
      try {
        return new Uint8Array(await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: asBuf(rec.iv) as unknown as BufferSource, additionalData: utf8("aha-keystore:" + name) as unknown as BufferSource },
          key,
          asBuf(rec.ct) as unknown as BufferSource
        ));
      } catch {
        throw new Error(`Keystore blob "${name}" exists but cannot be opened (wrong key or tampered).`);
      }
    },
    async remove(name: string): Promise<void> {
      await idbDel(BLOBS, name);
    },
  };
}
