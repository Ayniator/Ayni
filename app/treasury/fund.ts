// Client helpers for funding a Circle's treasury — in particular the foundation
// (World Service) Circle. The treasury is the per-Circle PDA ["treasury", circle];
// anyone may contribute any amount. SOL goes through `donate`, any SPL/Token-2022
// token through `donate_token` (the token lands in the treasury's associated
// token account, owned by the treasury PDA, so only the Council can move it).
//
// Requires: npm i @solana/spl-token
//
//   import { fundFoundation, fundFoundationSol } from "./app/treasury/fund";
//   await fundFoundation(program, FOUNDATION, USDC_MINT, 25_000_000n, donor); // 25 USDC
//   await fundFoundationSol(program, FOUNDATION, 1_000_000_000n, donor);      // 1 SOL

import * as anchor from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";

const { PublicKey } = anchor.web3;
type PublicKey = anchor.web3.PublicKey;

/** The treasury PDA for a Circle: ["treasury", circle]. */
export function treasuryPda(programId: PublicKey, circle: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("treasury"), circle.toBuffer()],
    programId
  )[0];
}

/**
 * Fund a Circle's treasury with any SPL / Token-2022 token. Creates the
 * treasury's associated token account idempotently (first funder pays for it),
 * then transfers `amount` (base units) from the donor.
 *
 * Pass the foundation Circle as `circle` to "fund the foundation".
 */
export async function fundFoundation(
  program: anchor.Program<any>,
  circle: PublicKey,
  mint: PublicKey,
  amount: bigint,
  donor: anchor.web3.Keypair,
  tokenProgram: PublicKey = TOKEN_PROGRAM_ID
): Promise<string> {
  const treasury = treasuryPda(program.programId, circle);

  // PDA owners are off-curve, so allowOwnerOffCurve = true.
  const treasuryAta = getAssociatedTokenAddressSync(mint, treasury, true, tokenProgram);
  const donorAta = getAssociatedTokenAddressSync(mint, donor.publicKey, false, tokenProgram);

  const createAta = createAssociatedTokenAccountIdempotentInstruction(
    donor.publicKey, // payer
    treasuryAta,
    treasury, // owner (PDA)
    mint,
    tokenProgram
  );

  return program.methods
    .donateToken(new anchor.BN(amount.toString()))
    .accounts({
      circle,
      treasury,
      mint,
      treasuryTokenAccount: treasuryAta,
      donor: donor.publicKey,
      donorTokenAccount: donorAta,
      tokenProgram,
    })
    .preInstructions([createAta]) // ensure the treasury ATA exists in the same tx
    .signers([donor])
    .rpc();
}

/** Fund a Circle's treasury with native SOL (lamports). */
export async function fundFoundationSol(
  program: anchor.Program<any>,
  circle: PublicKey,
  lamports: bigint,
  donor: anchor.web3.Keypair
): Promise<string> {
  const treasury = treasuryPda(program.programId, circle);
  return program.methods
    .donate(new anchor.BN(lamports.toString()))
    .accounts({ circle, treasury, donor: donor.publicKey })
    .signers([donor])
    .rpc();
}
