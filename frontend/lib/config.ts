// Per-Circle tunable policy (the CircleConfig sibling PDA, ["config", circle]).
// Set by any Council seat. Drives donation-on-renew, member-vote quorum/pass
// thresholds, and the treasury allowlist toggle. Kept out of Circle so existing
// Circles need no migration.

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { SigningWallet, circleConfigPda, programWith, readOnlyProgram } from "./member";

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
