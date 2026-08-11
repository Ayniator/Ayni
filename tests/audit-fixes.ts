import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Ayni } from "../target/types/ayni";
import { assert } from "chai";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

// Regression coverage for the 2026-08-11 security-audit fixes that did not yet
// have their own tests: the negative recovery_timelock rejection, the
// MigrateWallet one-holder-per-seat dedup, and the new withdraw_treasury_token
// path that closes the donate_token fund-lock. (The two CRITICAL federation
// fixes and the HIGH member_migrate fix are covered by tests/federation.ts and
// tests/cosign.ts respectively.)
describe("ayni — security-audit fixes (2026-08-11)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Ayni as Program<Ayni>;
  const payer = provider.wallet as anchor.Wallet;
  const walletKp = payer.payer;
  const connection = provider.connection;

  const circlePda = (parent: anchor.web3.PublicKey, name: string) =>
    anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("circle"), parent.toBuffer(), Buffer.from(name)],
      program.programId
    )[0];
  const proposalPda = (circle: anchor.web3.PublicKey, nonce: number) =>
    anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("proposal"), circle.toBuffer(), new anchor.BN(nonce).toArrayLike(Buffer, "le", 8)],
      program.programId
    )[0];

  const seats = Array.from({ length: 7 }, () => anchor.web3.Keypair.generate());

  before(async () => {
    await Promise.all(
      seats.map(async (s) => provider.connection.confirmTransaction(await connection.requestAirdrop(s.publicKey, 2e9)))
    );
  });

  // --- #4: negative recovery_timelock is rejected -----------------------------
  it("initialize_circle rejects a NEGATIVE recovery_timelock (contest-window nullification)", async () => {
    const parent = anchor.web3.Keypair.generate().publicKey;
    const circle = circlePda(parent, "neg-timelock");
    let threw = false;
    try {
      await program.methods
        .initializeCircle(parent, "neg-timelock", new anchor.BN(365 * 24 * 3600), new anchor.BN(-1), seats.map((s) => s.publicKey))
        .accounts({ circle, parent, payer: payer.publicKey })
        .rpc();
    } catch {
      threw = true; // AyniError::InvalidTimelock
    }
    assert.isTrue(threw, "a negative recovery_timelock must be refused");
    // 0 is still allowed (explicit instant opt-out) — sanity check
    const parent2 = anchor.web3.Keypair.generate().publicKey;
    const circle2 = circlePda(parent2, "zero-timelock");
    await program.methods
      .initializeCircle(parent2, "zero-timelock", new anchor.BN(365 * 24 * 3600), new anchor.BN(0), seats.map((s) => s.publicKey))
      .accounts({ circle: circle2, parent: parent2, payer: payer.publicKey })
      .rpc();
  });

  // --- #6: MigrateWallet one-holder-per-seat dedup ----------------------------
  it("MigrateWallet refuses to collapse two Council seats onto one wallet", async () => {
    const parent = anchor.web3.Keypair.generate().publicKey;
    const circle = circlePda(parent, "dedup-circle");
    await program.methods
      .initializeCircle(parent, "dedup-circle", new anchor.BN(365 * 24 * 3600), new anchor.BN(0), seats.map((s) => s.publicKey))
      .accounts({ circle, parent, payer: payer.publicKey })
      .rpc();

    // Migrate seats[0] -> seats[1], but seats[1] ALREADY holds a seat.
    const nonce = 1;
    const proposal = proposalPda(circle, nonce);
    await program.methods
      .propose(new anchor.BN(nonce), { migrateWallet: { oldWallet: seats[0].publicKey, newWallet: seats[1].publicKey } })
      .accounts({ circle, proposal, proposer: seats[0].publicKey })
      .signers([seats[0]])
      .rpc();
    for (const i of [1, 2, 3]) {
      await program.methods.approve().accounts({ circle, proposal, seat: seats[i].publicKey }).signers([seats[i]]).rpc();
    }
    let threw = false;
    try {
      await program.methods.executeProposal().accounts({ circle, proposal, executor: seats[0].publicKey }).signers([seats[0]]).rpc();
    } catch {
      threw = true; // AyniError::DuplicateSeat
    }
    assert.isTrue(threw, "migrating a seat holder onto an existing seat must be refused");
    const c = await program.account.circle.fetch(circle);
    assert.ok(c.council.seats[0].equals(seats[0].publicKey), "seat 0 unchanged after refused migration");
  });

  // --- #5: donated SPL tokens are recoverable via withdraw_treasury_token ------
  it("withdraw_treasury_token moves donated SPL tokens out (fund-lock fixed)", async () => {
    const parent = anchor.web3.Keypair.generate().publicKey;
    const circle = circlePda(parent, "token-circle");
    await program.methods
      .initializeCircle(parent, "token-circle", new anchor.BN(365 * 24 * 3600), new anchor.BN(0), seats.map((s) => s.publicKey))
      .accounts({ circle, parent, payer: payer.publicKey })
      .rpc();

    const [treasury] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("treasury"), circle.toBuffer()],
      program.programId
    );

    // A fresh SPL mint; the payer mints 1000 to itself.
    const mint = await createMint(connection, walletKp, walletKp.publicKey, null, 0);
    const donorAta = await getOrCreateAssociatedTokenAccount(connection, walletKp, mint, payer.publicKey);
    await mintTo(connection, walletKp, mint, donorAta.address, walletKp, 1000);
    // Treasury token account (owner is the off-curve treasury PDA).
    const treasuryAta = await getOrCreateAssociatedTokenAccount(connection, walletKp, mint, treasury, true);

    // Donate 400 tokens to the treasury.
    await program.methods
      .donateToken(new anchor.BN(400))
      .accounts({
        circle,
        treasury,
        mint,
        treasuryTokenAccount: treasuryAta.address,
        donor: payer.publicKey,
        donorTokenAccount: donorAta.address,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    assert.equal((await getAccount(connection, treasuryAta.address)).amount.toString(), "400", "treasury holds the donation");

    // Council authorizes moving 250 back to the payer (recipient).
    const nonce = 1;
    const proposal = proposalPda(circle, nonce);
    await program.methods
      .propose(new anchor.BN(nonce), { withdrawTreasuryToken: { mint, amount: new anchor.BN(250), recipient: payer.publicKey } })
      .accounts({ circle, proposal, proposer: seats[0].publicKey })
      .signers([seats[0]])
      .rpc();
    for (const i of [1, 2, 3]) {
      await program.methods.approve().accounts({ circle, proposal, seat: seats[i].publicKey }).signers([seats[i]]).rpc();
    }
    await program.methods.executeProposal().accounts({ circle, proposal, executor: seats[0].publicKey }).signers([seats[0]]).rpc();

    const before = (await getAccount(connection, donorAta.address)).amount;
    await program.methods
      .withdrawTreasuryToken()
      .accounts({
        circle,
        proposal,
        config: anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("config"), circle.toBuffer()], program.programId)[0],
        allow: null,
        mint,
        treasury,
        treasuryTokenAccount: treasuryAta.address,
        recipient: payer.publicKey,
        recipientTokenAccount: donorAta.address,
        caller: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const after = (await getAccount(connection, donorAta.address)).amount;
    assert.equal((after - before).toString(), "250", "recipient received the withdrawn tokens");
    assert.equal((await getAccount(connection, treasuryAta.address)).amount.toString(), "150", "treasury debited by the withdrawn amount");

    // Replay is refused (one-shot drained guard).
    let replay = false;
    try {
      await program.methods
        .withdrawTreasuryToken()
        .accounts({
          circle, proposal,
          config: anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("config"), circle.toBuffer()], program.programId)[0],
          allow: null, mint, treasury,
          treasuryTokenAccount: treasuryAta.address,
          recipient: payer.publicKey,
          recipientTokenAccount: donorAta.address,
          caller: payer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      replay = true;
    } catch {
      /* AlreadyExecuted (drained) */
    }
    assert.isFalse(replay, "an executed token withdrawal must not be replayable");
  });
});
