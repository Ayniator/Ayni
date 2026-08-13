// Per-element visibility (Trust Platform Epic 5) — client for the on-chain
// VisibilityPolicy, plus the read-path decision "may this viewer see this
// element?".
//
// Tiers, widening: 0 chosen ones · 1 my circle (the DEFAULT) · 2 all members.
// Nothing is ever visible to the public internet — "all members" is the widest
// audience that exists, and an unconnected visitor is a member of nothing.
//
// WHAT IS ENFORCED BY CRYPTOGRAPHY, AND WHAT IS STILL APP-LEVEL — read this
// before trusting either.
//
// * BIO and AVATAR (F60 Phase-2, this round): cryptographic. The served bytes
//   are ciphertext under a per-element key; the key reaches a viewer through a
//   sealed drop at an address only the two of them can compute. A patched
//   client gains nothing — without the key there is nothing to render, and what
//   it does see (fixed-length noise) is exactly what a member who wrote nothing
//   also stores. `mayView` is not consulted for these; possession of the key IS
//   the decision.
//
// * The AUDIENCE decision itself — who gets a key — is made by the OWNER when
//   they grant, so "my circle" and "all members" are enforced at grant time by
//   the person the data belongs to, not at read time by the reader's browser.
//   The cost is that granting is O(audience): a wide tier means many drops. The
//   scalable form (release a tier key against a ZK circle-membership proof,
//   inheriting Epic 2) is still Phase 3 — see docs/visibility.md.
//
// * The QUIPU stays app-level, and this is stated plainly rather than papered
//   over: cords are unencrypted on-chain accounts, world-readable by anyone who
//   reads the ledger directly. `mayView` gates the RENDER only. Encrypting the
//   quipu means moving cords off chain, which is a different feature.
//
// "Chosen ones" is a client-side list (the trust list never touches the chain).

import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  PROGRAM_ID,
  SigningWallet,
  connection,
  membershipPda,
  ownerTagPda,
  programWith,
  readOnlyProgram,
} from "./member";
import { ipfsUrl } from "./ipfs";
import { memberAuthority, sendMemberTx } from "./shielded";
import { relayCosigned, relayInstruction, relayerPubkey } from "./relayer";
import {
  ELEMENT_AVATAR,
  ELEMENT_BIO,
  cacheViewingSecret,
  cachedViewingSecret,
  deriveViewingSecret,
  dropIdFor,
  elementKey,
  openAvatar,
  openBio,
  openElementKeys,
  opaqueBio,
  ownerTagFor,
  bytesEqual,
  packAvatarRef,
  profileEncKey,
  legacyProfileEncKey,
  sealBio,
  sealElementKeys,
  sharedSecret,
  shieldedOwnerKey,
  unpackAvatarRef,
} from "./visibilityCrypto";

const seed = (s: string) => new TextEncoder().encode(s);
const toBytes = (hex: string) => Uint8Array.from((hex.match(/.{1,2}/g) ?? []).map((b) => parseInt(b, 16)));

export const CHOSEN = 0;
export const MY_CIRCLE = 1; // the protective default
export const ALL_MEMBERS = 2;
export type Tier = 0 | 1 | 2;

export const TIER_LABEL: Record<Tier, string> = {
  0: "chosen ones",
  1: "my circle",
  2: "all members",
};

export interface Visibility {
  avatar: Tier;
  quipu: Tier;
  bio: Tier;
}

/** The protective default: everything to "my circle" on day one. */
export const DEFAULT_VISIBILITY: Visibility = { avatar: MY_CIRCLE, quipu: MY_CIRCLE, bio: MY_CIRCLE };

export const visibilityPda = (circle: PublicKey, member: Uint8Array) =>
  PublicKey.findProgramAddressSync([seed("visibility"), circle.toBytes(), member], PROGRAM_ID)[0];

/** A member's policy, or the protective defaults if they've never set one. */
export async function getVisibility(circle: PublicKey, memberHex: string): Promise<Visibility> {
  try {
    const a: any = await (readOnlyProgram().account as any).visibilityPolicy.fetch(visibilityPda(circle, toBytes(memberHex)));
    return { avatar: a.avatar as Tier, quipu: a.quipu as Tier, bio: a.bio as Tier };
  } catch {
    return { ...DEFAULT_VISIBILITY };
  }
}

/** The member sets their own policy. Authorised by whichever key the membership
 *  answers to — the derived key when it is shielded (F61). */
export async function setVisibility(
  wallet: SigningWallet,
  circle: PublicKey,
  memberHex: string,
  v: Visibility
): Promise<{ signature: string; relayed: boolean }> {
  const auth = await memberAuthority(wallet, circle, memberHex);
  const program = programWith(wallet);
  return sendMemberTx(wallet, auth, (payer) =>
    program.methods
      .setVisibility(v.avatar, v.quipu, v.bio)
      .accounts({
        circle,
        memberMembership: membershipPda(circle, toBytes(memberHex)),
        policy: visibilityPda(circle, toBytes(memberHex)),
        member: auth.authority,
        payer,
        systemProgram: SystemProgram.programId,
      })
      .instruction()
  );
}

// --- chosen-ones list (client-side; never touches the chain) ---------------

const CHOSEN_KEY = "aha:chosen-ones";
function readChosen(): Record<string, string[]> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(CHOSEN_KEY) || "{}"); } catch { return {}; }
}
/** The commitments the owner (keyed by their own commitment) has chosen. */
export function getChosen(ownerHex: string): string[] {
  return readChosen()[ownerHex] ?? [];
}
export function setChosen(ownerHex: string, chosen: string[]): void {
  const all = readChosen();
  all[ownerHex] = chosen;
  localStorage.setItem(CHOSEN_KEY, JSON.stringify(all));
}

// --- the read-path decision -------------------------------------------------

/** The viewer's context: the circles they belong to, and their own commitments
 *  (for the chosen-ones check). Empty ⇒ an unconnected visitor, a member of
 *  nothing, who therefore sees no gated element. */
export interface Viewer {
  circles: Set<string>; // circle pubkeys the viewer is a member of
  commitments: Set<string>; // the viewer's own membership commitments
}

/** May `viewer` see an element at `tier`, owned by a member of `circle`?
 *  `ownerHex` is the element owner's commitment (for the chosen check).
 *  Hidden ≡ absent: the caller shows nothing and no "hidden" indicator. */
export function mayView(tier: Tier, circle: string, ownerHex: string, viewer: Viewer): boolean {
  switch (tier) {
    case ALL_MEMBERS:
      return viewer.circles.size > 0; // any member of the fellowship
    case MY_CIRCLE:
      return viewer.circles.has(circle);
    case CHOSEN:
      return [...viewer.commitments].some((c) => getChosen(ownerHex).includes(c));
    default:
      return false;
  }
}

/** The owner always sees their own page in full. */
export function viewerOwns(ownerHex: string, viewer: Viewer): boolean {
  return viewer.commitments.has(ownerHex);
}

// ---------------------------------------------------------------------------
// Shielded ownership (F61) — stop `Membership.owner` indexing the roster
// ---------------------------------------------------------------------------

/**
 * Shield one membership: mint the member's private index entry and rebind
 * `owner` off their public wallet, in ONE transaction.
 *
 * Before: `Membership.owner` held the member's wallet at a fixed offset, so a
 * single `getProgramAccounts` memcmp against that wallet listed every Circle
 * they belong to — for anyone, with no key, from anywhere. After: `owner` holds
 * a key derived from the member's own master secret, which nobody can connect to
 * the wallet they are known by, and the member finds the membership through a
 * tag only they can derive.
 *
 * `master` is the master secret (the credential of record). Nothing is stored
 * from it but the derived viewing secret, cached on this device and re-derivable
 * after any recovery — so shielding costs the member no recoverability.
 *
 * Returns the transaction signature and the shielded key, which the caller must
 * use to sign this membership's later writes.
 */
export async function shieldMembership(
  wallet: SigningWallet,
  circle: PublicKey,
  memberHex: string,
  master: Uint8Array,
  index = 0
): Promise<{ signature: string; shieldedOwner: PublicKey; relayed: boolean }> {
  const vk = await deriveViewingSecret(master);
  const tag = await ownerTagFor(vk, circle.toBytes(), index);
  const kp = Keypair.fromSecretKey((await shieldedOwnerKey(vk, circle.toBytes(), index)).secretKey);

  const program = programWith(wallet);
  const build = (payer: PublicKey) =>
    program.methods
      .shieldMembership([...tag], kp.publicKey)
      .accounts({
        membership: membershipPda(circle, toBytes(memberHex)),
        ownerTag: ownerTagPda(tag),
        member: wallet.publicKey,
        // The derived key never holds a lamport (see the account docs on
        // `shield_membership` for why funding it is worse than co-signing).
        payer,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

  // THE ONE THING RELAYING CANNOT FIX, stated where the code does it: only the
  // current owner may shield, so the member's ordinary wallet SIGNS this
  // transaction no matter who pays. An observer who indexes transactions (rather
  // than scanning accounts, which is what this closes) can therefore always link
  // that wallet to this membership and this tag. Relaying it buys one real
  // thing and no privacy: a member whose wallet holds nothing can still shield.
  let signature: string;
  let relayed = false;
  const relayer = await relayerPubkey();
  if (relayer) {
    try {
      signature = await relayCosigned(await build(relayer), wallet, connection());
      relayed = true;
    } catch {
      signature = await program.methods
        .shieldMembership([...tag], kp.publicKey)
        .accounts({
          membership: membershipPda(circle, toBytes(memberHex)),
          ownerTag: ownerTagPda(tag),
          member: wallet.publicKey,
          payer: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }
  } else {
    signature = await program.methods
      .shieldMembership([...tag], kp.publicKey)
      .accounts({
        membership: membershipPda(circle, toBytes(memberHex)),
        ownerTag: ownerTagPda(tag),
        member: wallet.publicKey,
        payer: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  // Only cache once the chain has accepted it: a viewing secret cached for a
  // membership that never shielded would send discovery looking for an index
  // entry that does not exist.
  cacheViewingSecret(vk);
  return { signature, shieldedOwner: kp.publicKey, relayed };
}

/** The keypair that signs for a shielded membership. Derived, never stored —
 *  the member re-derives it from the master secret on any device. */
export async function shieldedSigner(
  master: Uint8Array,
  circle: PublicKey,
  index = 0
): Promise<Keypair> {
  const vk = await deriveViewingSecret(master);
  return Keypair.fromSecretKey((await shieldedOwnerKey(vk, circle.toBytes(), index)).secretKey);
}

/** True if this membership has been shielded — i.e. its index entry exists.
 *  Answerable only by someone who can derive the tag, which is the point. */
export async function isShielded(
  master: Uint8Array,
  circle: PublicKey,
  index = 0
): Promise<boolean> {
  const vk = await deriveViewingSecret(master);
  const tag = await ownerTagFor(vk, circle.toBytes(), index);
  const info = await connection().getAccountInfo(ownerTagPda(tag));
  return !!info;
}

// ---------------------------------------------------------------------------
// The encrypted profile (F60 Phase-2) — served bio + avatar
// ---------------------------------------------------------------------------

export const memberProfilePda = (circle: PublicKey, member: Uint8Array) =>
  PublicKey.findProgramAddressSync([seed("mprofile"), circle.toBytes(), member], PROGRAM_ID)[0];

export const keyDropPda = (dropId: Uint8Array) =>
  PublicKey.findProgramAddressSync([seed("vdrop"), dropId], PROGRAM_ID)[0];

/** The on-chain profile as read (all still sealed). */
export interface SealedProfile {
  encPub: Uint8Array;
  epoch: number;
  bioCt: Uint8Array;
  avatarCid: string;
}

export async function readSealedProfile(circle: PublicKey, memberHex: string): Promise<SealedProfile | null> {
  try {
    const a: any = await (readOnlyProgram().account as any).memberProfile.fetch(
      memberProfilePda(circle, toBytes(memberHex))
    );
    return {
      encPub: Uint8Array.from(a.encPub),
      epoch: Number(a.epoch),
      bioCt: Uint8Array.from(a.bioCt),
      avatarCid: unpackAvatarRef(Uint8Array.from(a.avatarRef)),
    };
  } catch {
    return null;
  }
}

/**
 * Publish the member's encrypted profile.
 *
 * A member with no bio still writes 200 bytes — `opaqueBio()`, random bytes no
 * key opens. That is not busywork: it is what makes "wrote nothing" and "wrote
 * something you may not read" the same account on chain. Skipping it would turn
 * the mere existence of a readable-looking profile into a disclosure.
 *
 * `signer` is required for a SHIELDED membership (its `owner` is the derived key,
 * not the wallet); pass what `shieldedSigner()` returns.
 */
export async function publishProfile(
  wallet: SigningWallet,
  circle: PublicKey,
  memberHex: string,
  master: Uint8Array,
  opts: { bio?: string; avatarCid?: string; epoch?: number; signer?: Keypair } = {}
): Promise<{ signature: string; relayed: boolean }> {
  const vk = await deriveViewingSecret(master);
  const commitment = toBytes(memberHex);
  const epoch = opts.epoch ?? 1;
  // Circle-bound (v2). Every write goes out under the new derivation, so a
  // member still carrying a v1 `enc_pub` migrates the moment they next publish.
  const enc = await profileEncKey(vk, circle.toBytes());

  const bioCt = opts.bio
    ? sealBio(opts.bio, await elementKey(vk, circle.toBytes(), commitment, ELEMENT_BIO, epoch))
    : opaqueBio();

  // The right signer is now RESOLVED rather than passed in: callers no longer
  // have to know whether this membership is shielded, and cannot get it wrong.
  // `opts.signer` still overrides, for tests and for the shield flow itself.
  const auth = opts.signer
    ? { authority: opts.signer.publicKey, signer: opts.signer, shielded: true, guardian: false }
    : await memberAuthority(wallet, circle, memberHex);

  const program = programWith(wallet);
  return sendMemberTx(wallet, auth, (payer) =>
    program.methods
      .upsertMemberProfile([...enc.publicKey], epoch, [...bioCt], [...packAvatarRef(opts.avatarCid ?? "")])
      .accounts({
        circle,
        memberMembership: membershipPda(circle, commitment),
        profile: memberProfilePda(circle, commitment),
        // Authority and rent payer are DIFFERENT accounts on purpose: a shielded
        // membership's `owner` is the derived key, which has no balance and must
        // never be funded from a wallet the member is known by.
        member: auth.authority,
        payer,
        systemProgram: SystemProgram.programId,
      })
      .instruction()
  );
}

/**
 * Grant one viewer the element keys they are entitled to.
 *
 * The drop lands at an address derived from the X25519 secret this member shares
 * with that viewer, so the account names neither party and the set of drops
 * cannot be read as a "who may see whom" table. An element the viewer is not in
 * the audience for travels as zeroes, so a partial grant is the same size as a
 * full one.
 *
 * Revocation is NOT done here and there is no revoke instruction: bump the
 * profile epoch (re-publish with `epoch + 1`), which re-keys the content and
 * strands every outstanding drop at once, naming nobody.
 */
export async function grantElementKeys(
  wallet: SigningWallet,
  circle: PublicKey,
  memberHex: string,
  master: Uint8Array,
  viewerEncPub: Uint8Array,
  grant: { bio: boolean; avatar: boolean },
  epoch: number
): Promise<{ signature: string; relayed: boolean }> {
  const vk = await deriveViewingSecret(master);
  const commitment = toBytes(memberHex);
  const enc = await profileEncKey(vk, circle.toBytes());
  const shared = sharedSecret(enc.secretKey, viewerEncPub);
  const dropId = await dropIdFor(shared, commitment, epoch);
  const sealed = await sealElementKeys(
    shared,
    grant.bio ? await elementKey(vk, circle.toBytes(), commitment, ELEMENT_BIO, epoch) : null,
    grant.avatar ? await elementKey(vk, circle.toBytes(), commitment, ELEMENT_AVATAR, epoch) : null
  );

  // No member signature exists on this instruction BY DESIGN (an authority field
  // would be a memcmp handle on the granter, and the audience sizes derived from
  // it would be the interest graph Epic 5 forbids). That leaves the fee-payer as
  // the last thing naming the granter — so relay it when a relayer exists.
  const program = programWith(wallet);
  const relayer = await relayerPubkey();
  if (relayer) {
    try {
      const ix = await program.methods
        .grantVisibilityKey([...dropId], [...sealed], epoch)
        .accounts({ keyDrop: keyDropPda(dropId), payer: relayer, systemProgram: SystemProgram.programId })
        .instruction();
      return { signature: await relayInstruction(ix), relayed: true };
    } catch {
      /* fall through to self-pay, and say so */
    }
  }
  const signature = await program.methods
    .grantVisibilityKey([...dropId], [...sealed], epoch)
    .accounts({
      keyDrop: keyDropPda(dropId),
      payer: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  return { signature, relayed: false };
}

/** What a viewer can actually open. Absent fields mean absent CONTENT — the
 *  caller renders nothing and shows no indicator, because "you may not see this"
 *  and "there is nothing here" must look identical. */
export interface OpenedProfile {
  bio?: string;
  avatar?: string; // data URL
}

/**
 * Open as much of a member's profile as this viewer holds keys for.
 *
 * Three cases, all ending in the same shape:
 *  - the viewer IS the member: element keys derive straight from their own
 *    viewing secret, no drop needed;
 *  - the viewer holds a drop: X25519 to the owner's published key, derive the
 *    drop address, open it, use whichever element keys are in it;
 *  - anyone else (including every unconnected visitor): nothing opens, and the
 *    function returns {} — the same value it returns for a member who wrote
 *    nothing at all.
 */
export async function openMemberProfile(
  circle: PublicKey,
  memberHex: string,
  viewerMaster?: Uint8Array | null
): Promise<OpenedProfile> {
  const sealedProfile = await readSealedProfile(circle, memberHex);
  if (!sealedProfile) return {};

  const vk = viewerMaster ? await deriveViewingSecret(viewerMaster) : cachedViewingSecret();
  if (!vk) return {};

  const commitment = toBytes(memberHex);
  // Circle-bound (v2) is the live derivation. The v1 key — the same 32 bytes in
  // every Circle — is derived ONLY to read what was published before the fix:
  // profiles still carrying a v1 `enc_pub`, and key drops addressed under a v1
  // shared secret. Nothing is ever sealed under it. See `legacyProfileEncKey`.
  const enc = await profileEncKey(vk, circle.toBytes());
  const legacyEnc = await legacyProfileEncKey(vk);

  let bioKey: Uint8Array | null = null;
  let avatarKey: Uint8Array | null = null;

  const mine =
    bytesEqual(enc.publicKey, sealedProfile.encPub) ||
    bytesEqual(legacyEnc.publicKey, sealedProfile.encPub);

  if (mine) {
    // It is our own profile — derive both keys directly. This path is unchanged
    // by the fix: element keys were already Circle-bound, so a member whose
    // profile predates v2 still opens their own bio and avatar.
    bioKey = await elementKey(vk, circle.toBytes(), commitment, ELEMENT_BIO, sealedProfile.epoch);
    avatarKey = await elementKey(vk, circle.toBytes(), commitment, ELEMENT_AVATAR, sealedProfile.epoch);
  } else {
    // Someone else's profile: look for a drop addressed to us. The owner sealed
    // it to whichever of OUR public keys we handed them, so try the current
    // derivation first and fall back to the legacy one for drops granted before
    // the fix. A miss on both is indistinguishable from no content.
    for (const secret of [enc.secretKey, legacyEnc.secretKey]) {
      const shared = sharedSecret(secret, sealedProfile.encPub);
      const dropId = await dropIdFor(shared, commitment, sealedProfile.epoch);
      try {
        const d: any = await (readOnlyProgram().account as any).visibilityKeyDrop.fetch(keyDropPda(dropId));
        const keys = await openElementKeys(Uint8Array.from(d.sealed), shared);
        if (keys) { bioKey = keys.bio; avatarKey = keys.avatar; break; }
      } catch {
        /* no drop for us under this derivation — try the next, then give up */
      }
    }
  }

  const out: OpenedProfile = {};
  if (bioKey) {
    const bio = openBio(sealedProfile.bioCt, bioKey);
    if (bio) out.bio = bio;
  }
  if (avatarKey && sealedProfile.avatarCid) {
    try {
      const res = await fetch(ipfsUrl(sealedProfile.avatarCid));
      const ct = new Uint8Array(await res.arrayBuffer());
      const avatar = openAvatar(ct, avatarKey);
      if (avatar) out.avatar = avatar;
    } catch {
      /* unreachable ciphertext reads as absent, never as an error banner */
    }
  }
  return out;
}

/** The viewer's own X25519 profile key for ONE Circle — what a member hands (or
 *  publishes) so others can seal element keys to them.
 *
 *  Circle-scoped, so the key a member shows in one Circle is not the key they
 *  show in another. Handing the same 32 bytes to two Circles is exactly the
 *  cross-Circle handle this fix removes, so the Circle is a required argument
 *  rather than an optional one: there is no correct Circle-less answer. */
export async function myEncPub(master: Uint8Array, circle: PublicKey): Promise<Uint8Array> {
  const vk = await deriveViewingSecret(master);
  return (await profileEncKey(vk, circle.toBytes())).publicKey;
}
