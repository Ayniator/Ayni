import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Ayni } from "../target/types/ayni";
import { assert } from "chai";

// CircleProfile: the directory data behind "Find a Circle Near You" — geo +
// IPFS doc CIDs, upserted by any Council seat.
describe("ayni — circle directory profile (geo + IPFS docs)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Ayni as Program<Ayni>;
  const payer = provider.wallet as anchor.Wallet;
  const parent = anchor.web3.Keypair.generate().publicKey;
  const name = "profile-circle";

  const seats = Array.from({ length: 7 }, () => anchor.web3.Keypair.generate());

  const [circlePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("circle"), parent.toBuffer(), Buffer.from(name)],
    program.programId
  );
  const [profilePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("profile"), circlePda.toBuffer()],
    program.programId
  );

  // Cusco, Peru — microdegrees.
  const LAT = -13_531_000;
  const LON = -71_967_000;
  const CID = "bafkreid2cusco12steps0000000000000000000000000000000";

  before(async () => {
    await Promise.all(
      seats.map(async (s) => {
        const sig = await provider.connection.requestAirdrop(s.publicKey, 1e9);
        await provider.connection.confirmTransaction(sig);
      })
    );
    await program.methods
      .initializeCircle(parent, name, new anchor.BN(365 * 24 * 60 * 60), new anchor.BN(0), seats.map((s) => s.publicKey))
      .accounts({ circle: circlePda, parent, payer: payer.publicKey })
      .rpc();
  });

  it("any seat creates the profile (geo + CIDs)", async () => {
    await program.methods
      .upsertCircleProfile(LAT, LON, "Cusco Circle", "Cusco", "Plaza de Armas", CID, "", "")
      .accounts({ circle: circlePda, profile: profilePda, seat: seats[3].publicKey })
      .signers([seats[3]])
      .rpc();

    const p = await program.account.circleProfile.fetch(profilePda);
    assert.equal(p.latMicrodeg, LAT);
    assert.equal(p.lonMicrodeg, LON);
    assert.equal(p.name, "Cusco Circle");
    assert.equal(p.city, "Cusco");
    assert.equal(p.twelveStepsCid, CID);
    assert.ok(p.circle.equals(circlePda));
  });

  it("the same PDA updates in place (upsert), with another seat", async () => {
    await program.methods
      .upsertCircleProfile(LAT, LON, "Cusco Circle", "Cusco", "New Address 42", CID, "bafprembl", "bafdaily")
      .accounts({ circle: circlePda, profile: profilePda, seat: seats[1].publicKey })
      .signers([seats[1]])
      .rpc();

    const p = await program.account.circleProfile.fetch(profilePda);
    assert.equal(p.address, "New Address 42");
    assert.equal(p.preambleCid, "bafprembl");
    assert.equal(p.dailyReflectionsCid, "bafdaily");
  });

  it("rejects a non-seat", async () => {
    const stranger = anchor.web3.Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(stranger.publicKey, 1e9)
    );
    let threw = false;
    try {
      await program.methods
        .upsertCircleProfile(LAT, LON, "Hijack", "X", "Y", "", "", "")
        .accounts({ circle: circlePda, profile: profilePda, seat: stranger.publicKey })
        .signers([stranger])
        .rpc();
    } catch {
      threw = true;
    }
    assert.isTrue(threw, "only a Council seat may set the profile");
  });

  it("rejects out-of-range coordinates", async () => {
    let threw = false;
    try {
      await program.methods
        .upsertCircleProfile(95_000_000, 0, "Bad", "X", "Y", "", "", "")
        .accounts({ circle: circlePda, profile: profilePda, seat: seats[2].publicKey })
        .signers([seats[2]])
        .rpc();
    } catch {
      threw = true;
    }
    assert.isTrue(threw, "latitude > 90° must be rejected");
  });
});
