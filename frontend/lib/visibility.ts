// Per-element visibility (Trust Platform Epic 5) — client for the on-chain
// VisibilityPolicy, plus the read-path decision "may this viewer see this
// element?".
//
// Tiers, widening: 0 chosen ones · 1 my circle (the DEFAULT) · 2 all members.
// Nothing is ever visible to the public internet — "all members" is the widest
// audience that exists, and an unconnected visitor is a member of nothing.
//
// PILOT ENFORCEMENT, honestly: the "my circle" / "all members" test below is
// evaluated in the VIEWER's own client against the memberships their wallet
// holds. That is app-level, not cryptographic — a modified client could ask for
// data it shouldn't. The privacy-correct enforcement is a ZK circle-membership
// proof on the read path (inheriting Epic 2's machinery) plus per-tier
// encryption of the served bio/avatar (F60), which is Phase-2 work. The QUIPU,
// being on-chain and world-readable regardless, is gated here only for
// presentation — its true protection also awaits the encrypted read path.
// "Chosen ones" is a client-side list (the trust list never touches the chain).

import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID, SigningWallet, membershipPda, programWith, readOnlyProgram } from "./member";

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

/** The member sets their own policy. */
export async function setVisibility(wallet: SigningWallet, circle: PublicKey, memberHex: string, v: Visibility): Promise<string> {
  return programWith(wallet)
    .methods.setVisibility(v.avatar, v.quipu, v.bio)
    .accounts({
      circle,
      memberMembership: membershipPda(circle, toBytes(memberHex)),
      policy: visibilityPda(circle, toBytes(memberHex)),
      member: wallet.publicKey,
      systemProgram: (await import("@solana/web3.js")).SystemProgram.programId,
    })
    .rpc();
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
