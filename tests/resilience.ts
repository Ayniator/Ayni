import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Ayni } from "../target/types/ayni";
import { assert } from "chai";

// Exercises the 7-seat Council 4-of-7 flow, the migration time-lock, and the
// any-seat contest. No ZK involved, so this runs as a normal anchor test.
describe("ayni — resilience (7-seat Council, 4-of-7, time-lock, contest)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Ayni as Program<Ayni>;
  const authority = provider.wallet as anchor.Wallet;
  const worldService = anchor.web3.Keypair.generate().publicKey;
  const name = "resilience-circle";
  const TIMELOCK = 2; // seconds — short so the test can wait it out

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const [circlePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("circle"), worldService.toBuffer(), Buffer.from(name)],
    program.programId
  );

  const seats = Array.from({ length: 7 }, () => anchor.web3.Keypair.generate());

  const proposalPda = (nonce: number) =>
    anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("proposal"), circlePda.toBuffer(), new anchor.BN(nonce).toArrayLike(Buffer, "le", 8)],
      program.programId
    )[0];

  const execute = (proposal: anchor.web3.PublicKey, by: anchor.web3.Keypair) =>
    program.methods
      .executeProposal()
      .accounts({ circle: circlePda, proposal, executor: by.publicKey })
      .signers([by])
      .rpc();

  const approveBy = (proposal: anchor.web3.PublicKey, i: number) =>
    program.methods
      .approve()
      .accounts({ circle: circlePda, proposal, seat: seats[i].publicKey })
      .signers([seats[i]])
      .rpc();

  before(async () => {
    await Promise.all(
      seats.map(async (s) => {
        const sig = await provider.connection.requestAirdrop(s.publicKey, 1e9);
        await provider.connection.confirmTransaction(sig);
      })
    );

    await program.methods
      .initializeCircle(name, new anchor.BN(365 * 24 * 60 * 60), new anchor.BN(TIMELOCK))
      .accounts({ circle: circlePda, worldService, authority: authority.publicKey })
      .rpc();

    for (let i = 0; i < 7; i++) {
      await program.methods
        .appointSeat(i, seats[i].publicKey)
        .accounts({ circle: circlePda, authority: authority.publicKey })
        .rpc();
    }
  });

  it("rotates a seat with exactly 4 approvals (immediate, no time-lock)", async () => {
    const nonce = 1;
    const proposal = proposalPda(nonce);
    const newHolder = anchor.web3.Keypair.generate().publicKey;

    await program.methods
      .propose(new anchor.BN(nonce), { rotateSeat: { seatIndex: 6, newHolder } })
      .accounts({ circle: circlePda, proposal, proposer: seats[0].publicKey })
      .signers([seats[0]])
      .rpc();

    await approveBy(proposal, 1);
    await approveBy(proposal, 2);

    // 3/7 must not execute
    let threw = false;
    try { await execute(proposal, seats[0]); } catch { threw = true; }
    assert.isTrue(threw, "should not execute below threshold");

    await approveBy(proposal, 3); // 4/7 → armed immediately (rotation)
    await execute(proposal, seats[0]);

    const circle = await program.account.circle.fetch(circlePda);
    assert.ok(circle.council.seats[6].equals(newHolder), "seat 6 rotated");
  });

  it("holds a wallet migration for the time-lock, then executes (4/7)", async () => {
    const nonce = 2;
    const proposal = proposalPda(nonce);
    const lost = seats[0].publicKey;
    const fresh = anchor.web3.Keypair.generate().publicKey;

    await program.methods
      .propose(new anchor.BN(nonce), { migrateWallet: { oldWallet: lost, newWallet: fresh } })
      .accounts({ circle: circlePda, proposal, proposer: seats[1].publicKey })
      .signers([seats[1]])
      .rpc();
    await approveBy(proposal, 2);
    await approveBy(proposal, 3);
    await approveBy(proposal, 4); // 4/7 → armed with contest window

    // within the window: must NOT execute yet
    let threw = false;
    try { await execute(proposal, seats[1]); } catch { threw = true; }
    assert.isTrue(threw, "must not execute before time-lock elapses");

    await sleep((TIMELOCK + 1) * 1000);
    await execute(proposal, seats[1]);

    const circle = await program.account.circle.fetch(circlePda);
    assert.ok(circle.council.seats[0].equals(fresh), "seat 0 migrated after time-lock");
  });

  it("lets any single seat contest (cancel) a migration", async () => {
    const nonce = 3;
    const proposal = proposalPda(nonce);
    const lost = seats[2].publicKey;
    const fresh = anchor.web3.Keypair.generate().publicKey;

    await program.methods
      .propose(new anchor.BN(nonce), { migrateWallet: { oldWallet: lost, newWallet: fresh } })
      .accounts({ circle: circlePda, proposal, proposer: seats[1].publicKey })
      .signers([seats[1]])
      .rpc();
    await approveBy(proposal, 3);
    await approveBy(proposal, 4);
    await approveBy(proposal, 5); // 4/7 reached

    // one honest seat contests during the window
    await program.methods
      .cancelProposal()
      .accounts({ circle: circlePda, proposal, seat: seats[5].publicKey })
      .signers([seats[5]])
      .rpc();

    await sleep((TIMELOCK + 1) * 1000);
    let threw = false;
    try { await execute(proposal, seats[1]); } catch { threw = true; }
    assert.isTrue(threw, "cancelled migration must not execute");

    const p = await program.account.proposal.fetch(proposal);
    assert.isTrue(p.cancelled, "proposal marked cancelled");

    const circle = await program.account.circle.fetch(circlePda);
    assert.ok(circle.council.seats[2].equals(lost), "seat 2 unchanged");
  });
});
