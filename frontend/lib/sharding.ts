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
 *  scalar and a distinct 32-byte wallet seed, so ONE master secret backs both. */
export async function deriveFromMaster(master: Uint8Array): Promise<{ zkSecret: Uint8Array; walletSeed: Uint8Array }> {
  const dk = async (tag: string) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array([...new TextEncoder().encode(tag), ...master])));
  return { zkSecret: await dk("aha-zk-secret-v1"), walletSeed: await dk("aha-wallet-seed-v1") };
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
