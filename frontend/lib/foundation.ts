// Foundation (root-circle) administration: set the public directory profile
// (powers /documents + /reflections) and compose Daily Reflections. Seat-gated
// on-chain (any Council seat may upsert a profile). Plus a browser-local
// reflections store so a freshly-composed collection previews instantly on
// /reflections even before it is pinned to IPFS.

import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID, SigningWallet, programWith, readOnlyProgram } from "./member";
import { invalidateProfiles } from "./solana";
import type { Reflection } from "./ipfs";

const seed = (s: string) => new TextEncoder().encode(s);

export const circleProfilePda = (circle: PublicKey) =>
  PublicKey.findProgramAddressSync([seed("profile"), circle.toBytes()], PROGRAM_ID)[0];

export interface ProfileFields {
  latMicrodeg: number;
  lonMicrodeg: number;
  name: string;
  city: string;
  address: string;
  twelveStepsCid: string;
  preambleCid: string;
  dailyReflectionsCid: string;
}

/** Read a circle's current profile (or null if none published). */
export async function getProfile(circle: string): Promise<ProfileFields | null> {
  const program = readOnlyProgram();
  try {
    const a: any = await (program.account as any).circleProfile.fetch(circleProfilePda(new PublicKey(circle)));
    return {
      latMicrodeg: a.latMicrodeg,
      lonMicrodeg: a.lonMicrodeg,
      name: a.name,
      city: a.city,
      address: a.address,
      twelveStepsCid: a.twelveStepsCid,
      preambleCid: a.preambleCid,
      dailyReflectionsCid: a.dailyReflectionsCid,
    };
  } catch {
    return null;
  }
}

/** Create/update the circle's directory profile (any Council seat). */
export async function upsertCircleProfile(
  wallet: SigningWallet,
  circle: PublicKey,
  f: ProfileFields
): Promise<string> {
  const program = programWith(wallet);
  const sig = await program.methods
    .upsertCircleProfile(
      f.latMicrodeg | 0,
      f.lonMicrodeg | 0,
      f.name,
      f.city,
      f.address,
      f.twelveStepsCid,
      f.preambleCid,
      f.dailyReflectionsCid
    )
    .accounts({ circle, profile: circleProfilePda(circle), seat: wallet.publicKey })
    .rpc();
  invalidateProfiles(); // /documents + Find a Circle should reflect the change
  return sig;
}

// ---------------------------------------------------------------------------
// Local reflections store (preview before/without IPFS pinning)
// ---------------------------------------------------------------------------

export type ReflectionMap = Record<string, Reflection>; // keyed "MM-DD"

const REFL_KEY = (circle: string) => `aha:reflections:${circle}`;

export function getLocalReflections(circle: string): ReflectionMap {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(REFL_KEY(circle)) || "{}");
  } catch {
    return {};
  }
}

export function saveLocalReflections(circle: string, map: ReflectionMap) {
  if (typeof window === "undefined") return;
  localStorage.setItem(REFL_KEY(circle), JSON.stringify(map));
}

export function localReflectionFor(circle: string, key: string): Reflection | null {
  return getLocalReflections(circle)[key] ?? null;
}

// ---------------------------------------------------------------------------
// Foundation-led child-Circle seat rotation (4-of-7 of the foundation)
// ---------------------------------------------------------------------------

const anchorBN = (n: number) => new anchor.BN(n);

export const childVotePda = (child: PublicKey, nonce: anchor.BN) =>
  PublicKey.findProgramAddressSync(
    [seed("childvote"), child.toBytes(), nonce.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  )[0];

export interface ChildVote {
  pubkey: string;
  foundation: string;
  child: string;
  nonce: string;
  newSeats: string[];
  approvals: number; // popcount
  approvedSeats: number[];
  createdAt: number;
  expiresAt: number;
  executed: boolean;
  status: "open" | "passed" | "executed" | "expired";
}

const popcount = (n: number) => { let c = 0; for (let i = 0; i < 8; i++) c += (n >> i) & 1; return c; };
const bitsOf = (n: number) => Array.from({ length: 7 }, (_, i) => i).filter((i) => (n >> i) & 1);

/** All child-rotation votes opened under `foundation`. */
export async function listChildVotes(foundation: string, threshold = 4): Promise<ChildVote[]> {
  const program = readOnlyProgram();
  const rows = await (program.account as any).childSeatVote.all([
    { memcmp: { offset: 8, bytes: foundation } },
  ]);
  const now = Date.now() / 1000;
  return rows
    .map((r: any): ChildVote => {
      const a = r.account;
      const approvals = popcount(a.approvals);
      const expiresAt = Number(a.expiresAt);
      const status: ChildVote["status"] = a.executed
        ? "executed"
        : now >= expiresAt
          ? "expired"
          : approvals >= threshold
            ? "passed"
            : "open";
      return {
        pubkey: r.publicKey.toBase58(),
        foundation: a.foundation.toBase58(),
        child: a.child.toBase58(),
        nonce: a.nonce.toString(),
        newSeats: a.newSeats.map((s: PublicKey) => s.toBase58()),
        approvals,
        approvedSeats: bitsOf(a.approvals),
        createdAt: Number(a.createdAt),
        expiresAt,
        executed: a.executed,
        status,
      };
    })
    .sort((x: ChildVote, y: ChildVote) => y.createdAt - x.createdAt);
}

/** Open a 4-of-7 foundation vote to set `child`'s 7 seats; valid `validityDays` (1–90). */
export async function proposeChildRotation(
  wallet: SigningWallet,
  foundation: PublicKey,
  child: PublicKey,
  newSeats: PublicKey[],
  validityDays: number
): Promise<string> {
  const program = programWith(wallet);
  const nonce = anchorBN(Date.now());
  const validitySecs = Math.round(Math.min(90, Math.max(1, validityDays)) * 24 * 60 * 60);
  return program.methods
    .proposeChildRotation(nonce, newSeats, anchorBN(validitySecs))
    .accounts({ foundation, child, vote: childVotePda(child, nonce), proposer: wallet.publicKey })
    .rpc();
}

export async function approveChildRotation(
  wallet: SigningWallet,
  foundation: PublicKey,
  vote: PublicKey
): Promise<string> {
  return programWith(wallet)
    .methods.approveChildRotation()
    .accounts({ foundation, vote, seat: wallet.publicKey })
    .rpc();
}

export async function executeChildRotation(
  wallet: SigningWallet,
  foundation: PublicKey,
  child: PublicKey,
  vote: PublicKey
): Promise<string> {
  return programWith(wallet)
    .methods.executeChildRotation()
    .accounts({ foundation, vote, child, executor: wallet.publicKey })
    .rpc();
}

// --- Delete a federation Circle (foundation 4-of-7) ---

export const childCloseVotePda = (child: PublicKey, nonce: anchor.BN) =>
  PublicKey.findProgramAddressSync(
    [seed("childclose"), child.toBytes(), nonce.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  )[0];

export async function listChildCloseVotes(foundation: string, threshold = 4): Promise<ChildVote[]> {
  const program = readOnlyProgram();
  const rows = await (program.account as any).childCloseVote.all([{ memcmp: { offset: 8, bytes: foundation } }]);
  const now = Date.now() / 1000;
  return rows
    .map((r: any): ChildVote => {
      const a = r.account;
      const approvals = popcount(a.approvals);
      const expiresAt = Number(a.expiresAt);
      const status: ChildVote["status"] = a.executed ? "executed" : now >= expiresAt ? "expired" : approvals >= threshold ? "passed" : "open";
      return {
        pubkey: r.publicKey.toBase58(), foundation: a.foundation.toBase58(), child: a.child.toBase58(),
        nonce: a.nonce.toString(), newSeats: [], approvals, approvedSeats: bitsOf(a.approvals),
        createdAt: Number(a.createdAt), expiresAt, executed: a.executed, status,
      };
    })
    .sort((x: ChildVote, y: ChildVote) => y.createdAt - x.createdAt);
}

export async function proposeChildClose(
  wallet: SigningWallet, foundation: PublicKey, child: PublicKey, validityDays: number
): Promise<string> {
  const nonce = anchorBN(Date.now());
  const validitySecs = Math.round(Math.min(90, Math.max(1, validityDays)) * 24 * 60 * 60);
  return programWith(wallet)
    .methods.proposeChildClose(nonce, anchorBN(validitySecs))
    .accounts({ foundation, child, vote: childCloseVotePda(child, nonce), proposer: wallet.publicKey })
    .rpc();
}

export async function approveChildClose(wallet: SigningWallet, foundation: PublicKey, vote: PublicKey): Promise<string> {
  return programWith(wallet).methods.approveChildClose().accounts({ foundation, vote, seat: wallet.publicKey }).rpc();
}

/** Apply a passed delete vote — closes the child Circle (and its profile if any). */
export async function executeChildClose(
  wallet: SigningWallet, foundation: PublicKey, child: PublicKey, vote: PublicKey, hasProfile: boolean
): Promise<string> {
  return programWith(wallet)
    .methods.executeChildClose()
    .accounts({
      foundation, vote, child,
      profile: hasProfile ? circleProfilePda(child) : null,
      recipient: wallet.publicKey,
      executor: wallet.publicKey,
    } as any)
    .rpc();
}
