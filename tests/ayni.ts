import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Ayni } from "../target/types/ayni";
import { assert } from "chai";

// Council-is-authority API: a Circle is created WITH its 7 seats (no appoint_seat);
// the Secretary seat (index 1) admits members.
describe("ayni — AHA on Solana", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Ayni as Program<Ayni>;
  const payer = provider.wallet as anchor.Wallet;
  const parent = anchor.web3.Keypair.generate().publicKey; // foundation/root seed

  const name = "aha-test-circle";
  const ONE_YEAR = new anchor.BN(365 * 24 * 60 * 60);

  // 7 distinct seats: [Treasurer, Secretary, RhythmKeeper, Elder N/E/S/W].
  const seats = Array.from({ length: 7 }, () => anchor.web3.Keypair.generate());
  const SECRETARY = 1;
  const RHYTHM = 2;

  const [circlePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("circle"), parent.toBuffer(), Buffer.from(name)],
    program.programId
  );
  const [memberTreePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("members"), circlePda.toBuffer()],
    program.programId
  );

  before(async () => {
    // Seats sign + pay for their own duties, so fund them.
    await Promise.all(
      seats.map(async (s) => {
        const sig = await provider.connection.requestAirdrop(s.publicKey, 1e9);
        await provider.connection.confirmTransaction(sig);
      })
    );
  });

  it("initializes a Circle with its 7-seat Council", async () => {
    await program.methods
      .initializeCircle(parent, name, ONE_YEAR, new anchor.BN(0), seats.map((s) => s.publicKey))
      .accounts({ circle: circlePda, parent, payer: payer.publicKey })
      .rpc();
    await program.methods
      .initializeMemberTree(20)
      .accounts({ circle: circlePda, memberTree: memberTreePda, seat: seats[RHYTHM].publicKey })
      .signers([seats[RHYTHM]])
      .rpc();

    const circle = await program.account.circle.fetch(circlePda);
    assert.equal(circle.name, name);
    assert.ok(circle.parent.equals(parent));
    assert.equal(circle.memberCount.toNumber(), 0);
    assert.ok(circle.council.seats[SECRETARY].equals(seats[SECRETARY].publicKey));
  });

  it("issues a soulbound yearly membership (keyed by a ZK commitment), via the Secretary seat", async () => {
    // 32-byte stand-in for a Poseidon identity commitment. Clear the top 3 bits
    // so it is < the BN254 field modulus (a valid Poseidon syscall input).
    const commitment = anchor.web3.Keypair.generate().publicKey.toBuffer();
    commitment[0] &= 0x1f;
    const [membershipPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("membership"), circlePda.toBuffer(), commitment],
      program.programId
    );

    const noGuardians = [anchor.web3.PublicKey.default, anchor.web3.PublicKey.default];
    await program.methods
      // owner (for disclosure), no guardian keys, council-only recovery
      .issueMembership([...commitment], payer.publicKey, noGuardians, false)
      .accounts({
        circle: circlePda,
        membership: membershipPda,
        memberTree: memberTreePda,
        personhood: null, // sybil gate off in this Circle
        secretary: seats[SECRETARY].publicKey,
      })
      .signers([seats[SECRETARY]])
      .rpc();

    const m = await program.account.membership.fetch(membershipPda);
    assert.equal(m.level, 0);
    assert.ok(m.expiresAt.toNumber() > m.issuedAt.toNumber());

    const circle = await program.account.circle.fetch(circlePda);
    assert.equal(circle.memberCount.toNumber(), 1);
  });

  it("rejects a non-Secretary seat trying to issue a membership", async () => {
    const commitment = anchor.web3.Keypair.generate().publicKey.toBuffer();
    commitment[0] &= 0x1f;
    const [membershipPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("membership"), circlePda.toBuffer(), commitment],
      program.programId
    );
    const noGuardians = [anchor.web3.PublicKey.default, anchor.web3.PublicKey.default];
    let threw = false;
    try {
      await program.methods
        .issueMembership([...commitment], payer.publicKey, noGuardians, false)
        .accounts({
          circle: circlePda,
          membership: membershipPda,
          memberTree: memberTreePda,
          personhood: null,
          secretary: seats[RHYTHM].publicKey, // not the Secretary seat
        })
        .signers([seats[RHYTHM]])
        .rpc();
    } catch {
      threw = true;
    }
    assert.isTrue(threw, "only the Secretary seat may admit members");
  });
});
