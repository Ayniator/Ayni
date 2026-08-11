// The Quipu Page (Trust Platform Epic 4) — read a member's public trust data.
//
// What a viewer can verify about a member in ten seconds, before meeting a
// stranger — but through vouching and presence, never through ratings. Every
// field here is read from on-chain accounts (anyone may read them); the
// per-element visibility gating ("all members / my circle / chosen ones") is
// Epic 5, layered on top of this read path.
//
// DELIBERATELY ABSENT (Epic 4 spec, Traditions): no rating, no review, no score,
// no follower count, no verification tier — none is read, computed, or returned.

import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID, connection, readOnlyProgram, listCircles, membershipPda } from "./member";
import { attestPda } from "./admission";
import { Cord } from "./quipu";

const seed = (s: string) => new TextEncoder().encode(s);
const toBytes = (hex: string) => Uint8Array.from((hex.match(/.{1,2}/g) ?? []).map((b) => parseInt(b, 16)));
const toHex = (b: ArrayLike<number>) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export interface TrustPage {
  commitment: string;
  circle: string;
  circleName: string;
  region: string; // ISO country code, or ""
  issuedAt: number;
  expiresAt: number;
  provisional: boolean; // admitted but not yet confirmed into the votable set
  vouched: "anonymous" | "named" | "none"; // the vouch-proof, if a two-sponsor admission
  cords: Cord[]; // the quipu — never summed
}

/** Gather the trust page for a member commitment. `circle` may be given to skip
 *  the lookup; otherwise the membership is found across all Circles. */
export async function getTrustPage(commitmentHex: string, circleHint?: string): Promise<TrustPage | null> {
  const program = readOnlyProgram();
  const commitment = toBytes(commitmentHex);

  // Find the membership. With no hint, filter by the commitment field
  // (offset 8 discriminator + 32 circle = 40).
  let circle = circleHint ?? "";
  let membershipAcct: any = null;
  if (circle) {
    try {
      membershipAcct = await (program.account as any).membership.fetch(membershipPda(new PublicKey(circle), commitment));
    } catch {
      membershipAcct = null;
    }
  }
  if (!membershipAcct) {
    const rows = await (program.account as any).membership.all([
      { memcmp: { offset: 40, bytes: new PublicKey(commitment).toBase58() } },
    ]).catch(() => []);
    if (rows.length) {
      membershipAcct = rows[0].account;
      circle = membershipAcct.circle.toBase58();
    }
  }
  if (!membershipAcct) return null;

  const circles = await listCircles();
  const circleInfo = circles.find((c) => c.pubkey === circle);
  const circleName = circleInfo?.name ?? circle.slice(0, 8);

  // region (CircleCountry sibling PDA)
  let region = "";
  try {
    const cc: any = await (program.account as any).circleCountry.fetch(
      PublicKey.findProgramAddressSync([seed("country"), new PublicKey(circle).toBytes()], PROGRAM_ID)[0]
    );
    region = String(cc.code || "");
  } catch {
    /* none set */
  }

  // provisional? (marker present)
  let provisional = false;
  try {
    await (program.account as any).provisionalMember.fetch(
      PublicKey.findProgramAddressSync([seed("provisional"), new PublicKey(circle).toBytes(), commitment], PROGRAM_ID)[0]
    );
    provisional = true;
  } catch {
    /* full member */
  }

  // vouch-proof: is there a two-sponsor admission attestation, and which form?
  let vouched: TrustPage["vouched"] = "none";
  try {
    const a: any = await (program.account as any).admissionAttestation.fetch(attestPda(new PublicKey(circle), commitment));
    const anonymous = (a.parrain as number[]).every((b) => b === 0);
    vouched = anonymous ? "anonymous" : "named";
  } catch {
    /* no attestation — legacy/open admission */
  }

  // the quipu — this member's cords, in step order, never summed
  const cordRows = await (program.account as any).quipuCord.all([
    { memcmp: { offset: 8, bytes: circle } },
  ]);
  const cords: Cord[] = cordRows
    .filter((r: any) => toHex(Uint8Array.from(r.account.member)) === commitmentHex)
    .map((r: any): Cord => ({
      step: Number(r.account.step),
      completedAt: Number(r.account.completedAt),
      sponsor: toHex(Uint8Array.from(r.account.sponsor)),
    }));

  return {
    commitment: commitmentHex,
    circle,
    circleName,
    region,
    issuedAt: Number(membershipAcct.issuedAt),
    expiresAt: Number(membershipAcct.expiresAt),
    provisional,
    vouched,
    cords,
  };
}
