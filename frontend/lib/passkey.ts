// Epic 8 · F65 — passkey unlock for a DEVICE-LOCAL encrypted keystore.
//
// WHAT THIS IS. A passkey (WebAuthn platform credential, backed by the phone /
// laptop's built-in authenticator) is used here as a *local unlock*: the user's
// biometric or device PIN is verified BY THE AUTHENTICATOR, on-device, and all
// we ever receive back is a cryptographic assertion. From that assertion we
// derive a symmetric wrapping key, and with it we nacl.secretbox-encrypt a small
// keystore blob (the member's zk secret / identity material) into localStorage.
//
// WHAT THIS IS NOT. The passkey is NEVER the credential of record and never
// gates recovery on its own. Losing the device must not lose the identity —
// that is the job of sponsor-bound social recovery (F66), which is deferred and
// documented in docs/passkeys.md. This file only makes the on-device secret sit
// behind a biometric instead of in the clear.
//
// SENTINEL ASSERTION — "no biometric leaves the device": this module never reads
// or transmits any biometric bytes. navigator.credentials only ever hands back a
// credentialId and a signature/PRF output; the fingerprint / face template stays
// inside the platform authenticator's secure element and is never exposed to JS,
// to us, or to the chain. Nothing here touches Solana at all.

import nacl from "tweetnacl";

// ---------------------------------------------------------------------------
// storage
// ---------------------------------------------------------------------------
const CRED_KEY = "aha:passkey:cred";       // credential metadata (public, non-secret)
const STORE_KEY = "aha:passkey:keystore";  // the encrypted secret blob

// A fixed PRF salt: the PRF output depends only on (credential, salt), NOT on
// the per-assertion challenge, so the wrapping key is stable across unlocks.
const PRF_SALT = new TextEncoder().encode("AHA passkey keystore wrap v1");

interface CredMeta {
  id: string;              // credentialId, base64url
  label: string;
  prf: boolean;            // did the authenticator enable the PRF extension?
  wrapFallback?: string;   // b64 32-byte wrap key, ONLY when prf === false (see note)
}
interface StoreBlob { nonce: string; box: string } // both base64

// ---------------------------------------------------------------------------
// base64 / base64url helpers (no deps)
// ---------------------------------------------------------------------------
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (b: Uint8Array) => b64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) =>
  unb64(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));

const buf = (a: ArrayBuffer | Uint8Array) =>
  a instanceof Uint8Array ? a : new Uint8Array(a);

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource));
}

function readCred(): CredMeta | null {
  if (typeof window === "undefined") return null;
  try { const s = localStorage.getItem(CRED_KEY); return s ? JSON.parse(s) : null; } catch { return null; }
}
function writeCred(c: CredMeta) { localStorage.setItem(CRED_KEY, JSON.stringify(c)); }

// ---------------------------------------------------------------------------
// feature detection
// ---------------------------------------------------------------------------

/** True only if this browser exposes WebAuthn with a platform authenticator. */
export function isPasskeySupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as any).PublicKeyCredential !== "undefined" &&
    !!navigator.credentials &&
    typeof navigator.credentials.create === "function"
  );
}

/** True if a passkey has already been registered on THIS device. */
export function hasPasskey(): boolean {
  return readCred() !== null;
}

/** Forget the local credential + encrypted keystore (device-local reset). */
export function forgetPasskey() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(CRED_KEY);
  localStorage.removeItem(STORE_KEY);
}

// ---------------------------------------------------------------------------
// registration
// ---------------------------------------------------------------------------

/**
 * Create a platform (built-in authenticator) passkey and remember its
 * credentialId locally. Requests the PRF extension so we can derive a stable
 * wrapping key from later assertions; if the authenticator declines PRF we fall
 * back to a locally-stored random wrap key (see the honesty note below).
 */
export async function registerPasskey(label: string): Promise<CredMeta> {
  if (!isPasskeySupported()) throw new Error("Passkeys are not supported in this browser.");

  const challenge = nacl.randomBytes(32);      // one-shot, not persisted
  const userId = nacl.randomBytes(16);         // opaque local handle (not a wallet)

  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: challenge as unknown as BufferSource,
      rp: { name: "AHA · Ayni" },
      user: { id: userId as unknown as BufferSource, name: label || "AHA member", displayName: label || "AHA member" },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },   // ES256
        { type: "public-key", alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform", // the phone/laptop's own biometric
        residentKey: "required",
        userVerification: "required",
      },
      timeout: 60_000,
      // No attestation requested: we don't need — and don't want — to identify
      // the make/model of the authenticator. Local unlock only.
      attestation: "none",
      extensions: { prf: {} } as any,
    },
  })) as PublicKeyCredential | null;

  if (!cred) throw new Error("Passkey creation was cancelled.");

  const ext: any = cred.getClientExtensionResults?.() ?? {};
  const prfEnabled = !!ext.prf?.enabled;

  const meta: CredMeta = {
    id: b64url(buf(cred.rawId)),
    label: label || "AHA member",
    prf: prfEnabled,
  };

  // HONESTY: when the authenticator supports PRF, the wrapping key never touches
  // disk — it is re-derived from the biometric-gated assertion each unlock. When
  // it does NOT (older platforms), we cannot derive a stable key from a raw
  // assertion signature — ECDSA/WebAuthn signatures are randomised (fresh `k`
  // every call), so signing the same challenge twice yields different bytes and
  // could never decrypt what it encrypted. Rather than fake determinism, the
  // fallback stores a random wrap key locally and uses the passkey purely as a
  // user-verification GATE in front of it. Still device-local, still no biometric
  // exposure — but weaker: the key sits in localStorage. Documented in
  // docs/passkeys.md.
  if (!prfEnabled) meta.wrapFallback = b64(nacl.randomBytes(32));

  writeCred(meta);
  return meta;
}

// ---------------------------------------------------------------------------
// unlock — obtain the symmetric wrapping key behind a fresh assertion
// ---------------------------------------------------------------------------

/**
 * Trigger a WebAuthn assertion (the biometric / device-PIN prompt) and return a
 * 32-byte symmetric wrapping key. With PRF, the key is derived from the PRF
 * output (stable, never stored). Without PRF, the assertion is a presence gate
 * and the key comes from the locally-stored fallback.
 */
export async function unlockWithPasskey(): Promise<Uint8Array> {
  if (!isPasskeySupported()) throw new Error("Passkeys are not supported in this browser.");
  const meta = readCred();
  if (!meta) throw new Error("No passkey registered on this device yet.");

  const challenge = nacl.randomBytes(32);
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: challenge as unknown as BufferSource,
      allowCredentials: [{ type: "public-key", id: unb64url(meta.id) as unknown as BufferSource }],
      userVerification: "required",
      timeout: 60_000,
      extensions: { prf: { eval: { first: PRF_SALT } } } as any,
    },
  })) as PublicKeyCredential | null;

  if (!assertion) throw new Error("Unlock was cancelled.");

  // biometric verified locally ⇒ we hold only the assertion, never the biometric.
  const ext: any = assertion.getClientExtensionResults?.() ?? {};
  const prfOut: ArrayBuffer | undefined = ext.prf?.results?.first;

  if (meta.prf && prfOut) {
    // Domain-separate + fix length to 32 bytes for nacl.secretbox.
    return sha256(new Uint8Array([...new TextEncoder().encode("AHA-prf|"), ...buf(prfOut)]));
  }

  // Fallback path: presence-gated local key. If we expected PRF but got nothing,
  // fail loudly rather than silently downgrade.
  if (meta.prf && !prfOut) throw new Error("Authenticator did not return a PRF result; cannot unlock.");
  if (!meta.wrapFallback) throw new Error("No wrapping key available for this passkey.");
  return unb64(meta.wrapFallback);
}

// ---------------------------------------------------------------------------
// keystore — encrypt/decrypt the member's device-local secret
// ---------------------------------------------------------------------------

/**
 * Encrypt `secret` under a passkey-derived key and store it locally. Triggers an
 * assertion (biometric prompt). The plaintext secret never touches localStorage.
 */
export async function putKeystore(secret: Uint8Array): Promise<void> {
  if (typeof window === "undefined") throw new Error("No window.");
  const key = await unlockWithPasskey();
  const nonce = nacl.randomBytes(24);
  const box = nacl.secretbox(secret, nonce, key);
  const blob: StoreBlob = { nonce: b64(nonce), box: b64(box) };
  localStorage.setItem(STORE_KEY, JSON.stringify(blob));
}

/** True if an encrypted keystore blob exists on this device. */
export function hasKeystore(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(STORE_KEY) !== null;
}

/**
 * Decrypt the device-local keystore behind a passkey assertion (biometric
 * prompt). Returns null if there is no keystore; throws if the assertion
 * fails or the blob can't be opened.
 */
export async function getKeystore(): Promise<Uint8Array | null> {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) return null;
  const blob: StoreBlob = JSON.parse(raw);
  const key = await unlockWithPasskey();
  const opened = nacl.secretbox.open(unb64(blob.box), unb64(blob.nonce), key);
  if (!opened) throw new Error("Could not decrypt keystore (wrong passkey or corrupted blob).");
  return opened;
}
