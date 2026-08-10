// WingPeer (mentor) relationships + progress tokens (milestone chips).
// Memberships are keyed by a 32-byte commitment (hex in the UI); these helpers
// translate to/from the on-chain accounts.

import { PublicKey, SystemProgram } from "@solana/web3.js";
import { PROGRAM_ID, SigningWallet, findMyMemberships, membershipPda, programWith, readOnlyProgram } from "./member";

const seed = (s: string) => new TextEncoder().encode(s);
const toBytes = (hex: string) => Uint8Array.from((hex.match(/.{1,2}/g) ?? []).map((b) => parseInt(b, 16)));
const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const milestoneLe = (m: number) => {
  const a = new Uint8Array(4);
  new DataView(a.buffer).setUint32(0, m >>> 0, true);
  return a;
};

export const wingPeerPda = (circle: PublicKey, mentee: Uint8Array) =>
  PublicKey.findProgramAddressSync([seed("wingpeer"), circle.toBytes(), mentee], PROGRAM_ID)[0];

export const progressPda = (circle: PublicKey, member: Uint8Array, milestone: number) =>
  PublicKey.findProgramAddressSync([seed("progress"), circle.toBytes(), member, milestoneLe(milestone)], PROGRAM_ID)[0];

/** A wallet's membership commitment (hex) in a given Circle, or null. */
export async function memberCommitmentOf(circle: string, wallet: string): Promise<string | null> {
  try {
    const mine = await findMyMemberships(new PublicKey(wallet), []);
    return mine.find((m) => m.circle === circle)?.commitment ?? null;
  } catch {
    return null;
  }
}

// --- WingPeer ---

export async function establishWingPeer(wallet: SigningWallet, circle: PublicKey, menteeHex: string, wingHex: string): Promise<string> {
  const mentee = toBytes(menteeHex);
  const wing = toBytes(wingHex);
  return programWith(wallet)
    .methods.establishWingPeer()
    .accounts({
      circle,
      menteeMembership: membershipPda(circle, mentee),
      wingMembership: membershipPda(circle, wing),
      wingPeer: wingPeerPda(circle, mentee),
      signer: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function endWingPeer(wallet: SigningWallet, circle: PublicKey, menteeHex: string, myHex: string): Promise<string> {
  return programWith(wallet)
    .methods.endWingPeer()
    .accounts({
      circle,
      wingPeer: wingPeerPda(circle, toBytes(menteeHex)),
      membership: membershipPda(circle, toBytes(myHex)),
      signer: wallet.publicKey,
    })
    .rpc();
}

export interface WingPeerInfo { wing: string; active: boolean; establishedAt: number }

/** The mentee's WingPeer (their chosen mentor), or null. */
export async function getWingPeer(circle: string, menteeHex: string): Promise<WingPeerInfo | null> {
  try {
    const a: any = await (readOnlyProgram().account as any).wingPeer.fetch(wingPeerPda(new PublicKey(circle), toBytes(menteeHex)));
    return { wing: toHex(Uint8Array.from(a.wing)), active: Boolean(a.active), establishedAt: Number(a.establishedAt) };
  } catch {
    return null;
  }
}

// --- Progress tokens (chips) ---

export const MILESTONES = [1, 30, 60, 90, 180, 270, 365, 730, 1095, 1825]; // days
export const milestoneLabel = (d: number) =>
  d === 1 ? "24 hours" : d < 365 ? `${d} days` : d % 365 === 0 ? `${d / 365} year${d === 365 ? "" : "s"}` : `${d} days`;

export async function issueProgressToken(wallet: SigningWallet, circle: PublicKey, memberHex: string, milestone: number): Promise<string> {
  const member = toBytes(memberHex);
  return programWith(wallet)
    .methods.issueProgressToken(milestone)
    .accounts({
      circle,
      memberMembership: membershipPda(circle, member),
      token: progressPda(circle, member, milestone),
      seat: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export interface Chip { member: string; milestone: number; issuedAt: number }

/** Every progress token in a Circle (filter by member in the UI). */
export async function listProgressTokens(circle: string): Promise<Chip[]> {
  const rows = await (readOnlyProgram().account as any).progressToken.all([{ memcmp: { offset: 8, bytes: circle } }]);
  return rows
    .map((r: any): Chip => ({ member: toHex(Uint8Array.from(r.account.member)), milestone: Number(r.account.milestone), issuedAt: Number(r.account.issuedAt) }))
    .sort((a: Chip, b: Chip) => a.milestone - b.milestone);
}

// --- Quipu cords (Epic 3) — one pendant cord per completed step -------------

export const quipuCordPda = (circle: PublicKey, member: Uint8Array, step: number) =>
  PublicKey.findProgramAddressSync([seed("quipu"), circle.toBytes(), member, Uint8Array.of(step)], PROGRAM_ID)[0];

/** The sponsor (the member's wing) ties a cord for a completed step (1..=12). */
export async function tieQuipuCord(wallet: SigningWallet, circle: PublicKey, memberHex: string, sponsorHex: string, step: number): Promise<string> {
  const member = toBytes(memberHex);
  const sponsor = toBytes(sponsorHex);
  return programWith(wallet)
    .methods.tieQuipuCord(step)
    .accounts({
      circle,
      memberMembership: membershipPda(circle, member),
      sponsorMembership: membershipPda(circle, sponsor),
      wingPeer: wingPeerPda(circle, member),
      cord: quipuCordPda(circle, member, step),
      sponsor: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export interface CordRow { member: string; step: number; completedAt: number; sponsor: string }

/** Every quipu cord in a Circle (filter by member in the UI). Never summed. */
export async function listQuipuCords(circle: string): Promise<CordRow[]> {
  const rows = await (readOnlyProgram().account as any).quipuCord.all([{ memcmp: { offset: 8, bytes: circle } }]);
  return rows
    .map((r: any): CordRow => ({
      member: toHex(Uint8Array.from(r.account.member)),
      step: Number(r.account.step),
      completedAt: Number(r.account.completedAt),
      sponsor: toHex(Uint8Array.from(r.account.sponsor)),
    }))
    .sort((a: CordRow, b: CordRow) => a.step - b.step);
}
