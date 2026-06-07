import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Ayni } from "../target/types/ayni";
import { assert } from "chai";

// Exercises the 7-seat Council 4-of-7 flow. No ZK involved, so this runs as a
// normal anchor test once the toolchain is installed.
describe("ayni — resilience (7-seat Council, 4-of-7)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Ayni as Program<Ayni>;
  const authority = provider.wallet as anchor.Wallet;
  const worldService = anchor.web3.Keypair.generate().publicKey;
  const name = "resilience-circle";

  const [circlePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("circle"), worldService.toBuffer(), Buffer.from(name)],
    program.programId
  );

  // 7 council members.
  const seats = Array.from({ length: 7 }, () => anchor.web3.Keypair.generate());

  const proposalPda = (nonce: number) =>
    anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("proposal"), circlePda.toBuffer(), new anchor.BN(nonce).toArrayLike(Buffer, "le", 8)],
      program.programId
    )[0];

  before(async () => {
    // fund the seat keypairs so they can sign/pay
    await Promise.all(
      seats.map(async (s) => {
        const sig = await provider.connection.requestAirdrop(s.publicKey, 1e9);
        await provider.connection.confirmTransaction(sig);
      })
    );

    await program.methods
      .initializeCircle(name, new anchor.BN(365 * 24 * 60 * 60))
      .accounts({ circle: circlePda, worldService, authority: authority.publicKey })
      .rpc();

    // seat all 7 (bootstrap path)
    for (let i = 0; i < 7; i++) {
      await program.methods
        .appointSeat(i, seats[i].publicKey)
        .accounts({ circle: circlePda, authority: authority.publicKey })
        .rpc();
    }
  });

  it("rotates a seat with exactly 4 approvals, not 3", async () => {
    const nonce = 1;
    const proposal = proposalPda(nonce);
    const newHolder = anchor.web3.Keypair.generate().publicKey;

    // seat 0 proposes (auto-approves => 1 vote)
    await program.methods
      .propose(new anchor.BN(nonce), { rotateSeat: { seatIndex: 6, newHolder } })
      .accounts({ circle: circlePda, proposal, proposer: seats[0].publicKey })
      .signers([seats[0]])
      .rpc();

    // seats 1,2 approve => 3 votes total
    for (const i of [1, 2]) {
      await program.methods
        .approve()
        .accounts({ circle: circlePda, proposal, seat: seats[i].publicKey })
        .signers([seats[i]])
        .rpc();
    }

    // 3/7 must NOT be executable
    let threw = false;
    try {
      await program.methods
        .executeProposal()
        .accounts({ circle: circlePda, proposal, executor: seats[0].publicKey })
        .signers([seats[0]])
        .rpc();
    } catch {
      threw = true;
    }
    assert.isTrue(threw, "should not execute below threshold");

    // seat 3 approves => 4 votes, now executable
    await program.methods
      .approve()
      .accounts({ circle: circlePda, proposal, seat: seats[3].publicKey })
      .signers([seats[3]])
      .rpc();

    await program.methods
      .executeProposal()
      .accounts({ circle: circlePda, proposal, executor: seats[0].publicKey })
      .signers([seats[0]])
      .rpc();

    const circle = await program.account.circle.fetch(circlePda);
    assert.ok(circle.council.seats[6].equals(newHolder), "seat 6 rotated");
  });

  it("migrates a lost wallet across all council seats (4/7)", async () => {
    const nonce = 2;
    const proposal = proposalPda(nonce);
    const lost = seats[0].publicKey; // pretend seat 0's key is lost
    const fresh = anchor.web3.Keypair.generate().publicKey;

    await program.methods
      .propose(new anchor.BN(nonce), { migrateWallet: { oldWallet: lost, newWallet: fresh } })
      .accounts({ circle: circlePda, proposal, proposer: seats[1].publicKey })
      .signers([seats[1]])
      .rpc();

    for (const i of [2, 3, 4]) {
      await program.methods
        .approve()
        .accounts({ circle: circlePda, proposal, seat: seats[i].publicKey })
        .signers([seats[i]])
        .rpc();
    }

    await program.methods
      .executeProposal()
      .accounts({ circle: circlePda, proposal, executor: seats[1].publicKey })
      .signers([seats[1]])
      .rpc();

    const circle = await program.account.circle.fetch(circlePda);
    assert.ok(circle.council.seats[0].equals(fresh), "seat 0 migrated to new wallet");
  });
});
