// The master secret at rest on this device (Epic 11 / F61).
//
// CLAUDE.md, locked position: "the member's identity is the master secret from
// which BOTH the Solana keypair and the Semaphore identity commitment derive",
// and "the passkey is a device-local unlock for a locally-encrypted keystore".
// This module is exactly that and nothing more — where the 32 bytes live
// between uses, sealed by the F65 keystore (lib/keystore.ts), so that the shield
// flow and the recovery ceremony are talking about the SAME secret.
//
// Why this file had to exist before F61 could ship as a feature. The viewing
// secret that finds a shielded membership and derives the key that signs for it
// is `SHA-256("aha-owner-view-v1" ‖ master)`. If the shield flow invented its
// own random secret instead, recovery would reconstruct a master that derives a
// DIFFERENT viewing secret — the member's sponsors would hand back shards that
// restore nothing, and they would only find out when they needed it. Before this
// module the master was generated inside `/recovery/setup` and wiped in the same
// function, so there was no master to shield against at all.
//
// WHAT IS AND IS NOT PROMISED:
//  · Sealed under the keystore's AES-GCM key, bound to the blob name, in
//    IndexedDB. In "prf"/"largeBlob" mode that key comes from the passkey and
//    never exists outside an authenticated session; in "local" mode it is a
//    non-extractable CryptoKey on the device — weaker, and lib/keystore.ts says
//    so in its own header.
//  · DEVICE-LOCAL. It is never transmitted, never in a shard by itself, never
//    on any server. Losing the device loses this copy, which is precisely what
//    the 2-of-3 Shamir split exists to survive.
//  · NO ENUMERATION. One fixed blob name, exact-name access only; the keystore
//    deliberately has no list()/keys()/count(). Nothing here can be walked to
//    learn how many identities a device holds.

import { unlock } from "./keystore";

/** The one blob name. Exact-name access only — see the keystore header. */
const BLOB = "master";

/** Session cache so a single page interaction does not re-prompt. Dropped by
 *  `forgetMaster()` and by any reload; never written anywhere. */
let session: Uint8Array | null = null;

/**
 * The member's master secret, or null if this device holds none.
 *
 * Triggers the keystore unlock (biometric / device PIN in passkey modes). Throws
 * only if there is no keystore at all on this device — a condition the caller
 * should surface, since the answer is "create one in Settings → Security", not
 * "silently make a new identity".
 */
export async function getMaster(): Promise<Uint8Array | null> {
  if (session) return session;
  const ks = await unlock();
  const bytes = await ks.open(BLOB);
  if (!bytes) return null;
  if (bytes.length !== 32) throw new Error("The stored master secret is the wrong size — refusing to use it.");
  session = bytes;
  // Unlocking the master is also the moment this device can address the
  // member's shielded memberships again: cache the derived viewing secret so
  // `findMyMemberships` resolves them without a second unlock. Derived, never
  // stored elsewhere, and the same value on every device the member holds.
  await cacheView(bytes);
  return bytes;
}

/** Derive and cache the viewing secret. Split out so `getMaster`, `adoptMaster`
 *  and `getOrCreateMaster` cannot drift apart on this one point. */
async function cacheView(master: Uint8Array): Promise<void> {
  const { cacheViewingSecret, deriveViewingSecret } = await import("./visibilityCrypto");
  cacheViewingSecret(await deriveViewingSecret(master));
}

/**
 * The member's master secret, creating one if this device holds none.
 *
 * `created` tells the caller which happened, and callers are expected to act on
 * it: a freshly created master has NO recovery shards, so the member must be
 * told to run the recovery ceremony — otherwise losing the device loses the
 * identity, silently.
 */
export async function getOrCreateMaster(): Promise<{ master: Uint8Array; created: boolean }> {
  const existing = await getMaster();
  if (existing) return { master: existing, created: false };

  const master = new Uint8Array(32);
  crypto.getRandomValues(master);
  const ks = await unlock();
  await ks.seal(BLOB, master);
  session = master;
  await cacheView(master);
  return { master, created: true };
}

/**
 * Does this device hold a master secret?
 *
 * NOTE: this UNLOCKS the keystore, so in passkey modes it prompts exactly like
 * `getMaster()` does — there is no cheaper existence check, and inventing one
 * would mean an unsealed side-channel saying "this device has an identity",
 * which is the kind of marker this design has no business writing. Call it only
 * where a prompt is already expected. Returns false, never throws, when there is
 * no keystore on the device at all.
 */
export async function hasMaster(): Promise<boolean> {
  try {
    return (await getMaster()) !== null;
  } catch {
    return false;
  }
}

/**
 * Adopt a master secret this device has just reconstructed from shards.
 *
 * Recovery is a purely local event (CLAUDE.md): it emits nothing on chain,
 * because the reconstructed secret is bit-identical and every derived key comes
 * back with it. "Comes back" is the part this function makes true in practice —
 * without it, a member who recovered on a new device would hold the right bytes
 * for a few seconds and then have them wiped, and their shielded memberships
 * would be unreachable from that device forever.
 *
 * Two effects, and the second is the one that matters most:
 *  · seal the master into the keystore, if this device has one. A device that
 *    has not set up a keystore yet cannot seal — that is reported, not hidden.
 *  · cache the VIEWING SECRET, which is what actually finds shielded
 *    memberships and derives the keys that sign for them.
 *
 * Nothing is emitted, requested, or transmitted. `master` is not wiped here —
 * the caller owns that buffer.
 */
export async function adoptMaster(master: Uint8Array): Promise<{ sealed: boolean }> {
  if (master.length !== 32) throw new Error("master secret must be 32 bytes");
  await cacheView(master);
  session = Uint8Array.from(master);
  try {
    const ks = await unlock();
    await ks.seal(BLOB, master);
    return { sealed: true };
  } catch {
    // No keystore on this device yet. The member can still act — the viewing
    // secret above is what F61 needs — but the master will not survive a reload
    // here until they create one in Settings → Security.
    return { sealed: false };
  }
}

/** Drop the in-memory copy (a lock action). The sealed blob is untouched. */
export function forgetMaster(): void {
  if (session) session.fill(0);
  session = null;
}
