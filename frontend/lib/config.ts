// Per-Circle tunable policy (the CircleConfig sibling PDA, ["config", circle]).
// Set by any Council seat. Drives donation-on-renew, member-vote quorum/pass
// thresholds, and the treasury allowlist toggle. Kept out of Circle so existing
// Circles need no migration.

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { SigningWallet, circleConfigPda, programWith, readOnlyProgram, treasuryAllowPda } from "./member";

export interface CircleConfigFields {
  renewDonationLamports: number; // 0 = free renewal
  voteQuorumNum: number;         // 0 den ⇒ default ⅓
  voteQuorumDen: number;
  votePassNum: number;           // 0 den ⇒ default simple majority
  votePassDen: number;
  treasuryAllowlist: boolean;
}

export const DEFAULT_CONFIG: CircleConfigFields = {
  renewDonationLamports: 0,
  voteQuorumNum: 0,
  voteQuorumDen: 0,
  votePassNum: 0,
  votePassDen: 0,
  treasuryAllowlist: false,
};

/** Set a Circle's policy (any Council seat signs). */
export async function setCircleConfig(
  wallet: SigningWallet,
  circle: PublicKey,
  f: CircleConfigFields
): Promise<string> {
  return programWith(wallet)
    .methods.setCircleConfig(
      new anchor.BN(Math.max(0, Math.round(f.renewDonationLamports)).toString()),
      f.voteQuorumNum,
      f.voteQuorumDen,
      f.votePassNum,
      f.votePassDen,
      f.treasuryAllowlist
    )
    .accounts({
      circle,
      config: circleConfigPda(circle),
      seat: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

/** Add/remove a treasury withdrawal recipient on the allowlist (any seat). */
export async function setTreasuryAllow(
  wallet: SigningWallet,
  circle: PublicKey,
  recipient: PublicKey,
  allowed: boolean
): Promise<string> {
  return programWith(wallet)
    .methods.setTreasuryAllow(recipient, allowed)
    .accounts({
      circle,
      allow: treasuryAllowPda(circle, recipient),
      seat: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export interface AllowEntry { recipient: string; allowed: boolean }

/** Every treasury-allowlist entry for a Circle (allowed and revoked). */
export async function listTreasuryAllowed(circle: string): Promise<AllowEntry[]> {
  const program = readOnlyProgram();
  const rows = await (program.account as any).treasuryAllow.all([
    { memcmp: { offset: 8, bytes: circle } }, // discriminator → circle first
  ]);
  return rows.map((r: any) => ({ recipient: r.account.recipient.toBase58(), allowed: Boolean(r.account.allowed) }));
}

/** This Circle's policy, or DEFAULT_CONFIG if none has been set. */
export async function getCircleConfig(circle: string): Promise<CircleConfigFields> {
  const program = readOnlyProgram();
  try {
    const a: any = await (program.account as any).circleConfig.fetch(circleConfigPda(new PublicKey(circle)));
    return {
      renewDonationLamports: Number(a.renewDonationLamports),
      voteQuorumNum: Number(a.voteQuorumNum),
      voteQuorumDen: Number(a.voteQuorumDen),
      votePassNum: Number(a.votePassNum),
      votePassDen: Number(a.votePassDen),
      treasuryAllowlist: Boolean(a.treasuryAllowlist),
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
