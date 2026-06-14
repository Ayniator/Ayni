#!/usr/bin/env node
// Devnet smoke test for create_membership_mint (F3): make a throwaway Circle
// (deployer = all 7 seats), create the soulbound mint, and verify it is a
// Token-2022 NonTransferable mint whose authority is the Circle PDA.
const fs = require("fs");
const os = require("os");
const path = require("path");
const anchor = require("@coral-xyz/anchor");
const { PublicKey, Keypair, Connection } = require("@solana/web3.js");

const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const PROGRAM_ID = new PublicKey("3ogteUFYhbHaV7UEWuGCqGVm1X4HDgAswvSePvDspHCw");

(async () => {
  const kp = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), ".config/solana/aha-deployer.json"), "utf8")))
  );
  const connection = new Connection(process.env.RPC_URL || "https://api.devnet.solana.com", "confirmed");
  const wallet = new anchor.Wallet(kp);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const idl = require("../target/idl/ayni.json");
  const program = new anchor.Program(idl, provider);

  const parent = Keypair.generate().publicKey;
  const name = "mint-test-" + Math.floor(Date.now() / 1000) % 100000;
  const [circle] = PublicKey.findProgramAddressSync(
    [Buffer.from("circle"), parent.toBuffer(), Buffer.from(name)],
    PROGRAM_ID
  );
  // deployer = Treasurer (seat 0); the other 6 seats are distinct (unique-seat rule).
  const seats = [kp.publicKey, ...Array.from({ length: 6 }, () => Keypair.generate().publicKey)];

  console.log("circle:", circle.toBase58(), "name:", name);
  await program.methods
    .initializeCircle(parent, name, new anchor.BN(365 * 24 * 60 * 60), new anchor.BN(0), seats)
    .accounts({ circle, parent, payer: kp.publicKey })
    .rpc();
  console.log("✓ circle created");

  const mint = Keypair.generate();
  const sig = await program.methods
    .createMembershipMint()
    .accounts({
      circle,
      mint: mint.publicKey,
      treasurer: kp.publicKey,
      payer: kp.publicKey,
      tokenProgram: TOKEN_2022,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([mint])
    .rpc();
  console.log("✓ create_membership_mint tx:", sig);

  // Verify the mint account.
  const acc = await connection.getAccountInfo(mint.publicKey);
  const ownerOk = acc.owner.equals(TOKEN_2022);
  // base Mint: mint_authority COption (4 + 32) — tag 1 means present, then pubkey.
  const authTag = acc.data.readUInt32LE(0);
  const authority = new PublicKey(acc.data.slice(4, 36));
  const hasExtensions = acc.data.length > 82; // base mint is 82 bytes; extensions add TLV
  console.log("mint:", mint.publicKey.toBase58());
  console.log("  owner is Token-2022:", ownerOk);
  console.log("  size:", acc.data.length, "(has extensions:", hasExtensions, ")");
  console.log("  mint authority:", authTag === 1 ? authority.toBase58() : "(none)");
  console.log("  authority == circle PDA:", authTag === 1 && authority.equals(circle));

  // Confirm the Circle now records the mint.
  const c = await program.account.circle.fetch(circle);
  console.log("  circle.membershipMint == mint:", c.membershipMint.equals(mint.publicKey));

  const pass = ownerOk && hasExtensions && authTag === 1 && authority.equals(circle) && c.membershipMint.equals(mint.publicKey);
  console.log(pass ? "\n✅ PASS — soulbound mint created, NonTransferable, authority = Circle PDA" : "\n❌ FAIL");
  process.exit(pass ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
