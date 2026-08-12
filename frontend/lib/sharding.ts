// Sharding core (Trust Platform Epic 11 / F72) — Shamir 2-of-3 over the master
// secret, and the master-secret derivation itself.
//
// NO hand-written field arithmetic (CLAUDE.md locked position): the split /
// combine come from `shamir-secret-sharing` (Privy's audited, dependency-free,
// constant-time GF(256) implementation). This module only orchestrates it.
//
// The MASTER SECRET is the credential of record: 32 bytes from which BOTH the
// Solana signing key and the Semaphore identity commitment derive. Recovery
// reconstructs it bit-identically, so recovery is a purely local event — nothing
// is emitted on chain (that unobservability is the whole point).

import { split, combine } from "shamir-secret-sharing";

/** A shard is one of the three Shamir shares (an opaque Uint8Array). */
export type Shard = Uint8Array;

/** A fresh 32-byte master secret. */
export function newMasterSecret(): Uint8Array {
  const s = new Uint8Array(32);
  crypto.getRandomValues(s);
  return s;
}

/** Derive the Semaphore identity commitment input and a Solana seed from the
 *  master secret by domain separation. The commitment itself is Poseidon(secret)
 *  computed elsewhere (zk-vote.ts); here we just produce the 32-byte `secret`
 *  scalar and a distinct 32-byte wallet seed, so ONE master secret backs both.
 *
 *  `walletSeed` ('aha-wallet-seed-v1') is GLOBAL (one wallet per member, not one
 *  per Circle) and is FROZEN — it is the Solana half of the credential of record.
 *
 *  `zkSecret` ('aha-zk-secret-v1') is RETIRED, UNCONSUMED: no identity was ever
 *  minted from it (no call site ever passed it to `newMemberIdentity`), and it is
 *  globally scoped, which would have made one member's commitments linkable
 *  across Circles. The voting-secret contract is `zkSecretForCircle` below. The
 *  v1 field stays only because `app/recovery/page.tsx` uses it as a post-
 *  reconstruction shape check; nothing derives an identity from it. */
export async function deriveFromMaster(master: Uint8Array): Promise<{ zkSecret: Uint8Array; walletSeed: Uint8Array }> {
  const dk = async (tag: string) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array([...new TextEncoder().encode(tag), ...master])));
  return { zkSecret: await dk("aha-zk-secret-v1"), walletSeed: await dk("aha-wallet-seed-v1") };
}

/** Domain-separation tag of the per-Circle voting-secret derivation. FROZEN:
 *  changing this string rotates every master-rooted identity ever minted. */
export const ZK_SECRET_DOMAIN_V2 = "aha-zk-secret-v2";

/**
 * The per-Circle voting secret derived from the master — the v2 derivation
 * contract, FROZEN (pinned by tests/zk-field-constants.test.mjs):
 *
 *   zkSecretForCircle(master, circle, index)
 *     = SHA-256( "aha-zk-secret-v2" ‖ master[32] ‖ circle[32] ‖ u32le(index) )
 *
 * The 32 bytes returned are reduced to a scalar by `secretScalarFromBytes`
 * (lib/zk-vote.ts) and the leaf is Poseidon(secret) as always.
 *
 * Why PER-CIRCLE: a single global zk secret would give one member the same
 * identity commitment in every Circle, making their memberships trivially
 * linkable by anyone reading the chain. Domain-separating on the Circle key
 * makes cross-Circle commitments unlinkable while keeping every one of them
 * reconstructible from the one master secret.
 *
 * Why the INDEX: derivation is deterministic, so leaving a Circle and rejoining
 * it would otherwise remint the *same* commitment (and the same nullifiers).
 * Bumping the index mints a fresh, votable identity in the same Circle without
 * giving up recoverability. Default 0 = the first identity in that Circle.
 *
 * This is a ONE-WAY DOOR: identities minted under it cannot be re-derived under
 * any other rule, so any change here orphans real members. Do not alter the tag,
 * the field order, the lengths, or the u32 endianness.
 *
 * Note: this module stays free of any chain/network import (CLAUDE.md locked
 * position, Sentinel Layer F) — the Circle is passed in as raw 32 bytes, not as
 * a PublicKey.
 */
export async function zkSecretForCircle(master: Uint8Array, circle: Uint8Array, index = 0): Promise<Uint8Array> {
  if (master.length !== 32) throw new Error("master secret must be 32 bytes");
  if (circle.length !== 32) throw new Error("circle key must be 32 bytes");
  if (!Number.isInteger(index) || index < 0 || index > 0xffffffff) throw new Error("derivation index must be a u32");
  const idx = new Uint8Array(4);
  new DataView(idx.buffer).setUint32(0, index, true); // little-endian
  const msg = new Uint8Array([...new TextEncoder().encode(ZK_SECRET_DOMAIN_V2), ...master, ...circle, ...idx]);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", msg));
}

/** Split the master secret into 3 shards, any 2 of which reconstruct it.
 *  Shards are returned as [member, sponsorA, sponsorB] by convention — but they
 *  are cryptographically indistinguishable; the roles live in custody/handover,
 *  not in the shard bytes. */
export async function splitMaster(master: Uint8Array): Promise<[Shard, Shard, Shard]> {
  const shares = await split(master, 3, 2); // 3 shares, threshold 2
  return [shares[0], shares[1], shares[2]];
}

/** Reconstruct the master secret from ANY TWO shards. Throws if the shards are
 *  incompatible or corrupted — it fails loudly, never returns garbage. */
export async function reconstructMaster(a: Shard, b: Shard): Promise<Uint8Array> {
  const out = await combine([a, b]);
  if (out.length !== 32) throw new Error("reconstruction produced an unexpected length — refusing");
  return out;
}
