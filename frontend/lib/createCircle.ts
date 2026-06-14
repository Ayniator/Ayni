// F23 — open a Circle from the web app (permissionless). Mirrors the two-step
// bootstrap the seed scripts do: initialize_circle (seats the 7-member Council)
// then initialize_member_tree (the votable population, depth pinned to the
// circuit). The creator signs both, so the creator MUST be one of the 7 seats —
// initialize_member_tree requires the signer to hold a seat.

import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID, SigningWallet, invalidateCircles, memberTreePda, programWith } from "./member";

/** Member tree depth must equal the member_vote circuit depth (merkle::CIRCUIT_DEPTH). */
export const MEMBER_TREE_DEPTH = 20;
export const ONE_YEAR_SECS = 365 * 24 * 60 * 60;
export const DEFAULT_TIMELOCK_SECS = 7 * 24 * 60 * 60;
export const MAX_NAME_BYTES = 32; // Circle::MAX_NAME (also a PDA seed)

const seed = (s: string) => new TextEncoder().encode(s);

export function circlePda(parent: PublicKey, name: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [seed("circle"), parent.toBytes(), seed(name)],
    PROGRAM_ID
  )[0];
}

export function nameByteLength(name: string): number {
  return new TextEncoder().encode(name).length;
}

export interface CreateCircleParams {
  parent: PublicKey;
  name: string;
  seats: PublicKey[]; // exactly 7, distinct, all non-default; one is the creator
  membershipPeriodSecs?: number;
  recoveryTimelockSecs?: number;
}

export interface CreateCircleResult {
  circle: string;
  txCircle: string;
  txTree: string;
}

/**
 * Create the Circle and its member tree. The connected `wallet` pays for both
 * and signs the tree init, so it must be one of `seats`.
 */
export async function createCircle(
  wallet: SigningWallet,
  params: CreateCircleParams
): Promise<CreateCircleResult> {
  const { parent, name, seats } = params;
  if (seats.length !== 7) throw new Error("A Council needs exactly 7 seats.");
  if (nameByteLength(name) > MAX_NAME_BYTES) throw new Error(`Name must be ≤ ${MAX_NAME_BYTES} bytes.`);

  const program = programWith(wallet);
  const circle = circlePda(parent, name);
  const tree = memberTreePda(circle);

  const txCircle = await program.methods
    .initializeCircle(
      parent,
      name,
      new anchor.BN(params.membershipPeriodSecs ?? ONE_YEAR_SECS),
      new anchor.BN(params.recoveryTimelockSecs ?? DEFAULT_TIMELOCK_SECS),
      seats
    )
    .accounts({ circle, parent, payer: wallet.publicKey })
    .rpc();

  const txTree = await program.methods
    .initializeMemberTree(MEMBER_TREE_DEPTH)
    .accounts({ circle, memberTree: tree, seat: wallet.publicKey })
    .rpc();

  invalidateCircles(); // a new circle now exists
  return { circle: circle.toBase58(), txCircle, txTree };
}
