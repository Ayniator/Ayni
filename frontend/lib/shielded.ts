// F61 — making a shielded membership USABLE.
//
// `shield_membership` rebinds `Membership.owner` from the member's public wallet
// to a key derived from their master secret, which closes the roster leak (a
// `getProgramAccounts` memcmp on `owner` used to list every Circle a wallet
// belonged to). But every member-signed write path in the app assumed
// `owner == connected wallet`, so shielding silently cost the member the ability
// to post, set visibility, choose a wing, tie a cord or attest an admission.
// This module is what makes that assumption go away.
//
// Two jobs:
//
// 1. WHICH KEY AUTHORISES THIS WRITE? `memberAuthority()` answers it by reading
//    the membership and comparing `owner` against (a) the connected wallet,
//    (b) the membership's guardian keys, and (c) the keys this device can derive
//    from its cached viewing secret. The caller does not need to know or care
//    which case it is — that is the point. Nothing here needs the master secret:
//    the viewing secret cached at shield time is enough, and it re-derives from
//    the master after any recovery.
//
// 2. WHO PAYS? `sendMemberTx()` routes the transaction. For a SHIELDED
//    membership the authority is a derived key with a zero balance, and it must
//    stay that way — funding it from the member's known wallet is a single-hop
//    funding transfer, the most reliable clustering heuristic in chain analysis,
//    and a STRONGER link than the co-signature it would be trying to avoid. So:
//      · relayer configured  → the relayer is fee-payer AND rent payer, the
//        derived key co-signs as authority, and the member's wallet appears
//        NOWHERE in the transaction. This is the only fully private path.
//      · no relayer          → the member's wallet pays and the derived key
//        co-signs. The action works, but the wallet and the shielded key are
//        now in one transaction forever. The UI must say so — see
//        `shieldingIsFullyPrivate()`.
//    There is deliberately no third option in which the derived key holds SOL.

import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { SigningWallet, connection, membershipPda, readOnlyProgram } from "./member";
import { SHIELD_INDEX_SCAN, cachedViewingSecret, shieldedOwnerKey } from "./visibilityCrypto";
import { relayCosigned, relayerPubkey } from "./relayer";

const toBytes = (hex: string) => Uint8Array.from((hex.match(/.{1,2}/g) ?? []).map((b) => parseInt(b, 16)));

/** Which key authorises a member-signed write, and whether it must co-sign. */
export interface MemberAuthority {
  /** Goes in the instruction's authority account slot. */
  authority: PublicKey;
  /** The derived keypair that must be added as an extra signer, or null when
   *  the connected wallet is itself the authority. */
  signer: Keypair | null;
  /** True when this membership's `owner` is a derived (shielded) key. */
  shielded: boolean;
  /** True when the wallet authorises as a GUARDIAN rather than as the owner.
   *  (`create_post` requires the owner specifically; the others accept either.) */
  guardian: boolean;
}

const eq = (a: PublicKey, b: PublicKey) => a.equals(b);

/**
 * Resolve the key that authorises writes for one membership.
 *
 * Order matters: `owner` first (the ordinary case and the shielded case are the
 * same check against different values), guardians last, because a member who
 * holds both should sign as the owner.
 *
 * Throws only when nothing on this device can act for the membership — a real
 * condition the caller should surface, not paper over: it means the membership
 * is shielded and this device has never held the viewing secret.
 */
export async function memberAuthority(
  wallet: SigningWallet,
  circle: PublicKey,
  commitmentHex: string
): Promise<MemberAuthority> {
  const commitment = toBytes(commitmentHex);
  const account: any = await (readOnlyProgram().account as any).membership.fetch(
    membershipPda(circle, commitment)
  );
  const owner: PublicKey = account.owner;

  if (eq(owner, wallet.publicKey)) {
    return { authority: wallet.publicKey, signer: null, shielded: false, guardian: false };
  }

  // Shielded? Only this device can answer — it needs the viewing secret, and
  // the check is a derivation, never a query. A stranger holding the same
  // `owner` value learns nothing from it.
  const vk = cachedViewingSecret();
  if (vk && !owner.equals(PublicKey.default)) {
    for (let i = 0; i < SHIELD_INDEX_SCAN; i++) {
      const kp = Keypair.fromSecretKey((await shieldedOwnerKey(vk, circle.toBytes(), i)).secretKey);
      if (eq(kp.publicKey, owner)) {
        return { authority: kp.publicKey, signer: kp, shielded: true, guardian: false };
      }
    }
  }

  const guardians: PublicKey[] = (account.recoveryKeys ?? []).filter(
    (k: PublicKey) => !k.equals(PublicKey.default)
  );
  if (guardians.some((k) => eq(k, wallet.publicKey))) {
    return { authority: wallet.publicKey, signer: null, shielded: false, guardian: true };
  }

  throw new Error(
    "No key on this device can act for this membership. If you shielded it on another device, " +
      "restore your recovery secret here first."
  );
}

/** Convenience: is this membership shielded, from this device's point of view?
 *  Never throws — an unknown membership simply reads as not shielded. */
export async function isMembershipShielded(
  wallet: SigningWallet,
  circle: PublicKey,
  commitmentHex: string
): Promise<boolean> {
  try {
    return (await memberAuthority(wallet, circle, commitmentHex)).shielded;
  } catch {
    return false;
  }
}

/**
 * Send one member-signed instruction with the right signer and the right payer.
 *
 * `build(payer)` must produce the instruction with `payer` in its rent-payer
 * slot — the caller does not choose the payer, this function does, because the
 * choice is a privacy decision and not a call-site detail.
 *
 * Returns `relayed: false` when the member's own wallet paid. That is not a
 * failure — the write succeeded — but it is a disclosure, and every caller is
 * expected to pass it to the UI rather than swallow it.
 */
export async function sendMemberTx(
  wallet: SigningWallet,
  auth: MemberAuthority,
  build: (payer: PublicKey) => Promise<TransactionInstruction>
): Promise<{ signature: string; relayed: boolean }> {
  if (auth.signer) {
    const relayer = await relayerPubkey();
    if (relayer) {
      try {
        const ix = await build(relayer);
        return { signature: await relayCosigned(ix, auth.signer, connection()), relayed: true };
      } catch {
        // A relayer that refuses (budget exhausted, policy skew, offline) must
        // not silently drop the member's action — but falling back means the
        // wallet pays and the link is made, so the caller is told via
        // `relayed: false` rather than left to assume it went the private way.
        //
        // The fallback is safe to retry because every instruction it covers is
        // either idempotent (`set_visibility`, `establish_wing_peer`,
        // `end_wing_peer` are `init_if_needed` or plain writes) or refuses a
        // duplicate outright (`create_post`, `tie_quipu_cord`,
        // `attest_admission` collide on their own PDA). A relay that landed but
        // whose RESPONSE was lost therefore fails loudly on retry; it never
        // double-writes.
      }
    }
  }

  const conn: Connection = connection();
  const ix = await build(wallet.publicKey);
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction({ blockhash, lastValidBlockHeight, feePayer: wallet.publicKey }).add(ix);
  if (auth.signer) tx.partialSign(auth.signer);
  const signed = await wallet.signTransaction(tx);
  const signature = await conn.sendRawTransaction(signed.serialize());
  await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  return { signature, relayed: false };
}

/**
 * Can a shielded member act without their wallet appearing on chain?
 *
 * This is the single honest question the shield UI must answer before the
 * member commits, and the answer is "only if a relayer is configured for this
 * deployment". Without one, shielding still closes the passive whole-roster
 * scan — the thing anyone could run against anyone — but every subsequent
 * action puts the wallet and the shielded key in the same transaction.
 */
export async function shieldingIsFullyPrivate(): Promise<boolean> {
  return (await relayerPubkey()) !== null;
}
