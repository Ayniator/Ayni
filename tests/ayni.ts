import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Ayni } from "../target/types/ayni";
import { assert } from "chai";

describe("ayni — AHA on Solana", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Ayni as Program<Ayni>;
  const authority = provider.wallet as anchor.Wallet;
  const worldService = anchor.web3.Keypair.generate().publicKey;

  const name = "aha-test-circle";
  const ONE_YEAR = new anchor.BN(365 * 24 * 60 * 60);

  const [circlePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("circle"), worldService.toBuffer(), Buffer.from(name)],
    program.programId
  );

  it("initializes a Circle under the World Service Circle", async () => {
    await program.methods
      .initializeCircle(name, ONE_YEAR, new anchor.BN(0)) // recovery_timelock = 0
      .accounts({
        circle: circlePda,
        worldService,
        authority: authority.publicKey,
      })
      .rpc();

    const circle = await program.account.circle.fetch(circlePda);
    assert.equal(circle.name, name);
    assert.ok(circle.worldService.equals(worldService));
    assert.equal(circle.memberCount.toNumber(), 0);
  });

  it("issues a soulbound yearly membership (keyed by a ZK commitment)", async () => {
    // 32-byte stand-in for a Poseidon/keccak identity commitment.
    const commitment = anchor.web3.Keypair.generate().publicKey.toBuffer();
    const [membershipPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("membership"), circlePda.toBuffer(), commitment],
      program.programId
    );

    await program.methods
      .issueMembership([...commitment], authority.publicKey) // owner (selective disclosure)
      .accounts({
        circle: circlePda,
        membership: membershipPda,
        authority: authority.publicKey,
      })
      .rpc();

    const m = await program.account.membership.fetch(membershipPda);
    assert.equal(m.level, 0);
    assert.ok(m.expiresAt.toNumber() > m.issuedAt.toNumber());

    const circle = await program.account.circle.fetch(circlePda);
    assert.equal(circle.memberCount.toNumber(), 1);
  });
});
