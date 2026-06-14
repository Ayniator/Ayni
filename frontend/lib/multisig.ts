// SPL Token multisig helpers — pure @solana/web3.js (no @solana/spl-token dep).
//
// A Solana "multisig wallet", in the on-chain-verifiable sense, is an SPL Token
// `Multisig` account: an m-of-n set of signer pubkeys owned by the SPL Token
// program. The Ayni program REQUIRES the Circle treasury steward wallet to be one
// of these (m ≥ 2) — see programs/ayni/src/instructions/set_treasury_wallet.rs
// and docs/multisig.md. These helpers let the UI check an address and mint a new
// multisig with the connected wallet as payer.

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import type { SigningWallet } from "./member";

/** Classic SPL Token program. `spl-token create-multisig` / createMultisig mint here. */
export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
/** Token-2022 — layout-identical multisig, accepted by the program too. */
export const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

/** Fixed on-chain size of an SPL Token `Multisig` account. */
export const MULTISIG_SIZE = 355;
/** Token instruction discriminator for InitializeMultisig2 (no rent sysvar). */
const INITIALIZE_MULTISIG2 = 19;
const MAX_SIGNERS = 11;

export interface MultisigInfo {
  ok: boolean;          // a valid, initialized multisig with m ≥ 2
  m: number;            // required signatures (threshold)
  n: number;            // number of signers
  signers: string[];    // the n signer addresses
  program: "spl-token" | "token-2022";
  reason?: string;      // why ok === false
}

/** Parse raw `Multisig` account data (m, n, is_initialized, then 11 signer slots). */
export function parseMultisig(
  data: Uint8Array,
  program: "spl-token" | "token-2022" = "spl-token"
): MultisigInfo {
  if (data.length !== MULTISIG_SIZE) {
    return { ok: false, m: 0, n: 0, signers: [], program, reason: "not a multisig account (wrong size)" };
  }
  const m = data[0];
  const n = data[1];
  const initialized = data[2] === 1;
  const signers: string[] = [];
  for (let i = 0; i < n && i < MAX_SIGNERS; i++) {
    signers.push(new PublicKey(data.slice(3 + i * 32, 3 + i * 32 + 32)).toBase58());
  }
  const ok = initialized && m >= 2 && n >= m;
  const reason = !initialized
    ? "multisig is not initialized"
    : m < 2
      ? "threshold must be at least 2 (single-sig is not allowed)"
      : n < m
        ? "fewer signers than the threshold requires"
        : undefined;
  return { ok, m, n, signers, program, reason };
}

/** Fetch an address and report whether it is a usable m-of-n multisig (m ≥ 2). */
export async function isMultisig(connection: Connection, address: PublicKey): Promise<MultisigInfo> {
  const acc = await connection.getAccountInfo(address);
  if (!acc) return { ok: false, m: 0, n: 0, signers: [], program: "spl-token", reason: "account does not exist" };
  const program =
    acc.owner.equals(TOKEN_PROGRAM_ID) ? "spl-token" : acc.owner.equals(TOKEN_2022_PROGRAM_ID) ? "token-2022" : null;
  if (!program) {
    return { ok: false, m: 0, n: 0, signers: [], program: "spl-token", reason: "not owned by the SPL Token program" };
  }
  return parseMultisig(acc.data, program);
}

/** InitializeMultisig2 instruction (data = [19, m]); accounts = [multisig, ...signers]. */
function initMultisig2Ix(multisig: PublicKey, signers: PublicKey[], m: number): TransactionInstruction {
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: multisig, isSigner: false, isWritable: true },
      ...signers.map((s) => ({ pubkey: s, isSigner: false, isWritable: false })),
    ],
    data: Buffer.from([INITIALIZE_MULTISIG2, m]),
  });
}

/**
 * Build (but do not send) a tx that creates a fresh m-of-n SPL Token multisig.
 * Returns the unsigned tx and the new multisig Keypair (which must co-sign).
 */
export async function buildCreateMultisigTx(
  connection: Connection,
  payer: PublicKey,
  signers: PublicKey[],
  m: number
): Promise<{ tx: Transaction; multisig: Keypair }> {
  if (signers.length < 2) throw new Error("a multisig needs at least 2 signers");
  if (signers.length > MAX_SIGNERS) throw new Error(`at most ${MAX_SIGNERS} signers`);
  if (m < 2 || m > signers.length) throw new Error("threshold must be between 2 and the number of signers");

  const multisig = Keypair.generate();
  const lamports = await connection.getMinimumBalanceForRentExemption(MULTISIG_SIZE);
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer,
      newAccountPubkey: multisig.publicKey,
      lamports,
      space: MULTISIG_SIZE,
      programId: TOKEN_PROGRAM_ID,
    }),
    initMultisig2Ix(multisig.publicKey, signers, m)
  );
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer;
  tx.partialSign(multisig); // the new account signs its own creation
  return { tx, multisig };
}

/**
 * Create an m-of-n multisig with the connected wallet as payer, returning its
 * address. The wallet signs+pays; the multisig keypair co-signs creation only.
 */
export async function createMultisigWithWallet(
  wallet: SigningWallet,
  connection: Connection,
  signers: PublicKey[],
  m: number
): Promise<PublicKey> {
  const { tx, multisig } = await buildCreateMultisigTx(connection, wallet.publicKey, signers, m);
  const signed = await wallet.signTransaction(tx);
  const sig = await connection.sendRawTransaction(signed.serialize());
  await connection.confirmTransaction(sig, "confirmed");
  return multisig.publicKey;
}
