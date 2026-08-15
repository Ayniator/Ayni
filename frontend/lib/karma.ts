// F98 / F100 — karma: what a member has earned, and thanking a fellow member.
//
// KARMA RANKS MEMBERS, and that is deliberate. Every other per-person counter in
// this project is forbidden; this one exists because the user waived the
// Tradition 2 no-ranking rule in writing on 2026-08-15 (recorded in CLAUDE.md).
// A consequence worth stating rather than discovering: a Karma account derives
// from a membership commitment, and commitments are already enumerable, so
// anyone can read anyone's total. Showing a Circle's karma in the app does not
// disclose anything the chain was keeping — it surfaces what was already public.
//
// WHAT A GIFT IS. You give some of your karma to thank someone. Your balance
// drops, theirs rises, and after the Circle's return period you take yours back
// while they keep theirs — so thanking someone costs you nothing in the end.
// Because that mints karma, it is limited to ONCE PER ORDERED PAIR, ever: you
// may thank each person once, and they may thank you once. What anyone can
// accumulate is therefore bounded by how many distinct people chose to thank
// them, which is the only thing that makes the number worth reading.
//
// Every figure here — the cap on a gift, the return period, the sponsorship
// gains — is set by the Circle's Council through the ordinary 4-of-7 vote. The
// constants below are only where a Circle starts.

import { BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { PROGRAM_ID, SigningWallet, membershipPda, programWith, readOnlyProgram } from "./member";
import { memberAuthority, sendMemberTx } from "./shielded";

const seed = (s: string) => new TextEncoder().encode(s);

const toBytes = (hex: string) => {
  const clean = hex.replace(/^0x/, "");
  const a = new Uint8Array(32);
  for (let i = 0; i < 32; i++) a[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return a;
};

export const karmaPda = (circle: PublicKey, member: Uint8Array) =>
  PublicKey.findProgramAddressSync([seed("karma"), circle.toBytes(), member], PROGRAM_ID)[0];

export const karmaParamsPda = (circle: PublicKey) =>
  PublicKey.findProgramAddressSync([seed("karmaparams"), circle.toBytes()], PROGRAM_ID)[0];

/** A gift's record. Seeded by the ORDERED pair — "I thanked you" and "you
 *  thanked me" are two different acts and each has its own record.
 *
 *  Note this is deliberately NOT the sorted-pair seeding used by the
 *  sponsorship award (see peers.ts): a sponsorship is one relationship however
 *  you name its ends, but a thanks has a direction. */
export const karmaGiftPda = (circle: PublicKey, from: Uint8Array, to: Uint8Array) =>
  PublicKey.findProgramAddressSync(
    [seed("karmagift"), circle.toBytes(), from, to],
    PROGRAM_ID
  )[0];

/** Where a Circle starts before its Council votes otherwise. Mirrors
 *  `KarmaParams::DEFAULT_*` in the program. */
export const KARMA_DEFAULTS = {
  gainSponsee: 100,
  sponsorRatioBps: 1000,
  minSponsors: 2,
  maxGift: 100,
  giftReturnSecs: 90 * 24 * 60 * 60,
};

export interface KarmaPolicy {
  gainSponsee: number;
  sponsorRatioBps: number;
  minSponsors: number;
  maxGift: number;
  giftReturnSecs: number;
  /** False when the Circle has never voted and the defaults are in force. */
  voted: boolean;
}

/** The Circle's karma policy, or the documented defaults if it has never voted. */
export async function getKarmaPolicy(circle: string): Promise<KarmaPolicy> {
  try {
    const a: any = await (readOnlyProgram().account as any).karmaParams.fetch(
      karmaParamsPda(new PublicKey(circle))
    );
    return {
      gainSponsee: Number(a.gainSponsee),
      sponsorRatioBps: Number(a.sponsorRatioBps),
      minSponsors: Number(a.minSponsors),
      maxGift: Number(a.maxGift),
      giftReturnSecs: Number(a.giftReturnSecs),
      voted: true,
    };
  } catch {
    return { ...KARMA_DEFAULTS, voted: false };
  }
}

/** One member's karma. Absent account means none earned yet, which reads as 0 —
 *  the same as a member who has earned and given it all away, deliberately: a
 *  distinct "never earned any" state would be a second thing to compare people
 *  by. */
export async function getKarma(circle: string, commitmentHex: string): Promise<number> {
  try {
    const a: any = await (readOnlyProgram().account as any).karma.fetch(
      karmaPda(new PublicKey(circle), toBytes(commitmentHex))
    );
    return Number(a.points);
  } catch {
    return 0;
  }
}

/** Karma for a set of members, keyed by commitment hex.
 *
 *  `Karma` accounts carry NO circle or member field — the PDA seeds are the
 *  binding — so a row cannot be attributed by reading it. The only sound
 *  attribution is to derive each member's address and fetch those, which is
 *  what this does, in ONE `fetchMultiple` rather than a request per member: a
 *  fifty-member Circle would otherwise be fifty round trips to a public RPC
 *  that rate-limits at exactly the moment the page is most useful.
 *
 *  A member with no account reads as 0, the same as one who earned and gave it
 *  all away. That collapse is deliberate: a distinct "never earned any" state
 *  would be a second thing to compare people by. */
export async function karmaFor(
  circle: string,
  commitments: string[]
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (commitments.length === 0) return out;
  const c = new PublicKey(circle);
  const addrs = commitments.map((h) => karmaPda(c, toBytes(h)));
  const accs = await (readOnlyProgram().account as any).karma.fetchMultiple(addrs);
  commitments.forEach((h, i) => {
    out[h] = accs[i] ? Number(accs[i].points) : 0;
  });
  return out;
}

export interface GiftRow {
  /** The other member's commitment (hex). */
  other: string;
  amount: number;
  givenAt: number;
  returned: boolean;
  /** Unix seconds at which the giver may reclaim. Computed from the Circle's
   *  CURRENT return period, because the program reads it at reclaim time — a
   *  Circle that votes the period down releases karma already out. */
  returnableAt: number;
}

/** Gifts this member has given and received, within a Circle.
 *
 *  Same attribution problem as karma: a `KarmaGift` has no from/to field, so
 *  each candidate pair's address is derived and fetched. Two directions per
 *  other-member, in one batched call. */
export async function listGifts(
  circle: string,
  meHex: string,
  otherHexes: string[],
  giftReturnSecs: number
): Promise<{ given: GiftRow[]; received: GiftRow[] }> {
  const given: GiftRow[] = [];
  const received: GiftRow[] = [];
  const others = otherHexes.filter((h) => h !== meHex);
  if (others.length === 0) return { given, received };

  const c = new PublicKey(circle);
  const me = toBytes(meHex);
  const givenAddrs = others.map((h) => karmaGiftPda(c, me, toBytes(h)));
  const recvAddrs = others.map((h) => karmaGiftPda(c, toBytes(h), me));
  const accs = await (readOnlyProgram().account as any).karmaGift.fetchMultiple([
    ...givenAddrs,
    ...recvAddrs,
  ]);

  const row = (a: any, other: string): GiftRow => {
    const givenAt = Number(a.givenAt);
    return {
      other,
      amount: Number(a.amount),
      givenAt,
      returned: Boolean(a.returned),
      returnableAt: givenAt + giftReturnSecs,
    };
  };
  others.forEach((h, i) => {
    if (accs[i]) given.push(row(accs[i], h));
    const r = accs[others.length + i];
    if (r) received.push(row(r, h));
  });
  return { given, received };
}

/** Thank a fellow member of your Circle by giving them karma.
 *
 *  Once per ordered pair, ever — the program refuses a second gift in the same
 *  direction at account creation, so a repeat surfaces as a plain failure. */
export async function giveKarma(
  wallet: SigningWallet,
  circle: PublicKey,
  fromHex: string,
  toHex: string,
  amount: number
): Promise<{ signature: string; relayed: boolean }> {
  const from = toBytes(fromHex);
  const to = toBytes(toHex);
  const auth = await memberAuthority(wallet, circle, fromHex);
  const program = programWith(wallet);
  return sendMemberTx(wallet, auth, (payer) =>
    program.methods
      .giveKarma(new BN(amount))
      .accounts({
        circle,
        giverMembership: membershipPda(circle, from),
        receiverMembership: membershipPda(circle, to),
        karmaParams: karmaParamsPda(circle),
        karmaGift: karmaGiftPda(circle, from, to),
        giverKarma: karmaPda(circle, from),
        receiverKarma: karmaPda(circle, to),
        signer: auth.authority,
        payer,
        systemProgram: SystemProgram.programId,
      })
      .instruction()
  );
}

/** Take a gift's karma back once its return period has elapsed.
 *
 *  Permissionless in the program — the destination is a seed-bound PDA, so this
 *  cannot be redirected — which is why it needs no member authority and can be
 *  triggered on the giver's behalf. */
export async function reclaimKarma(
  wallet: SigningWallet,
  circle: PublicKey,
  fromHex: string,
  toHex: string
): Promise<string> {
  const from = toBytes(fromHex);
  const to = toBytes(toHex);
  return programWith(wallet)
    .methods.reclaimKarma()
    .accounts({
      circle,
      giverMembership: membershipPda(circle, from),
      receiverMembership: membershipPda(circle, to),
      karmaParams: karmaParamsPda(circle),
      karmaGift: karmaGiftPda(circle, from, to),
      giverKarma: karmaPda(circle, from),
      caller: wallet.publicKey,
    })
    .rpc();
}
