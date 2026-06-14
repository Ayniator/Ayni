#!/usr/bin/env node
// Create an SPL Token m-of-n multisig from the command line (ops helper).
//
// The Ayni program requires a Circle's treasury steward wallet to be one of
// these (m >= 2). See docs/multisig.md.
//
// Usage:
//   node scripts/create-multisig.js <m> <signer1> <signer2> [signer3 ...]
//
// Env:
//   RPC_URL      defaults to devnet
//   KEYPAIR      payer keypair path (default ~/.config/solana/aha-deployer.json)
//
// Example (2-of-3):
//   node scripts/create-multisig.js 2 <pk1> <pk2> <pk3>

const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} = require("@solana/web3.js");

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const MULTISIG_SIZE = 355;
const INITIALIZE_MULTISIG2 = 19;

function loadKeypair(p) {
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function main() {
  const [mArg, ...signerArgs] = process.argv.slice(2);
  const m = Number(mArg);
  if (!Number.isInteger(m) || m < 2 || signerArgs.length < 2 || m > signerArgs.length) {
    console.error("usage: node scripts/create-multisig.js <m>=2 <signer1> <signer2> [signer3 ...]");
    console.error("  (m must be >= 2 and <= number of signers)");
    process.exit(1);
  }
  if (signerArgs.length > 11) {
    console.error("at most 11 signers");
    process.exit(1);
  }
  const signers = signerArgs.map((s) => new PublicKey(s));

  const rpc = process.env.RPC_URL || "https://api.devnet.solana.com";
  const kpPath = process.env.KEYPAIR || path.join(os.homedir(), ".config/solana/aha-deployer.json");
  const connection = new Connection(rpc, "confirmed");
  const payer = loadKeypair(kpPath);

  const multisig = Keypair.generate();
  const lamports = await connection.getMinimumBalanceForRentExemption(MULTISIG_SIZE);

  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: multisig.publicKey,
      lamports,
      space: MULTISIG_SIZE,
      programId: TOKEN_PROGRAM_ID,
    }),
    new TransactionInstruction({
      programId: TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: multisig.publicKey, isSigner: false, isWritable: true },
        ...signers.map((s) => ({ pubkey: s, isSigner: false, isWritable: false })),
      ],
      data: Buffer.from([INITIALIZE_MULTISIG2, m]),
    })
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [payer, multisig], {
    commitment: "confirmed",
  });

  console.log("✅ Created %d-of-%d multisig", m, signers.length);
  console.log("   Address:", multisig.publicKey.toBase58());
  console.log("   Signers:", signers.map((s) => s.toBase58()).join(", "));
  console.log("   Tx:     ", sig);
  console.log("\nUse this address as the Circle treasury steward wallet (SetTreasuryWallet).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
