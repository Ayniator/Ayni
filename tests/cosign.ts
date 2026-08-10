import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Ayni } from "../target/types/ayni";
import { assert } from "chai";

// Member co-signature path: an opted-in membership cannot be migrated by the
// Council alone, and a member holding a key can self-migrate. No ZK involved.
describe("ayni — member co-signature & self-recovery", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Ayni as Program<Ayni>;
  const payer = provider.wallet as anchor.Wallet;
  const parent = anchor.web3.Keypair.generate().publicKey;
  const name = "cosign-circle";

  // 7 seats (the Council is seated at creation); threshold is 4-of-7.
  const seats = Array.from({ length: 7 }, () => anchor.web3.Keypair.generate());
  const SECRETARY = 1;

  const [circlePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("circle"), parent.toBuffer(), Buffer.from(name)],
    program.programId
  );
  const proposalPda = (n: number) =>
    anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("proposal"), circlePda.toBuffer(), new anchor.BN(n).toArrayLike(Buffer, "le", 8)],
      program.programId
    )[0];
  const membershipPda = (commitment: Buffer) =>
    anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("membership"), circlePda.toBuffer(), commitment],
      program.programId
    )[0];
  const [memberTreePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("members"), circlePda.toBuffer()],
    program.programId
  );

  const issue = (commitment: Buffer, owner: anchor.web3.PublicKey, guardians: anchor.web3.PublicKey[], cosign: boolean) =>
    program.methods
      .issueMembership([...commitment], owner, guardians, cosign)
      .accounts({
        circle: circlePda,
        membership: membershipPda(commitment),
        memberTree: memberTreePda,
        personhood: null,
        openMembership: null, // gated Circle: omit the marker explicitly
        twoSponsor: anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("twosponsor"), circlePda.toBuffer()], program.programId)[0],
        secretary: seats[SECRETARY].publicKey,
      })
      .signers([seats[SECRETARY]])
      .rpc();

  before(async () => {
    await Promise.all(
      seats.map(async (s) => {
        const sig = await provider.connection.requestAirdrop(s.publicKey, 1e9);
        await provider.connection.confirmTransaction(sig);
      })
    );
    await program.methods
      .initializeCircle(parent, name, new anchor.BN(365 * 24 * 60 * 60), new anchor.BN(0), seats.map((s) => s.publicKey)) // no time-lock
      .accounts({ circle: circlePda, parent, payer: payer.publicKey })
      .rpc();
    await program.methods
      .initializeMemberTree(20)
      .accounts({ circle: circlePda, memberTree: memberTreePda, seat: seats[0].publicKey })
      .signers([seats[0]])
      .rpc();
  });

  it("blocks council-only migration of a require_cosign membership, allows it with either guardian", async () => {
    const commitment = anchor.web3.Keypair.generate().publicKey.toBuffer();
    commitment[0] &= 0x1f; // < BN254 field modulus (valid Poseidon input)
    const memberOwner = anchor.web3.Keypair.generate().publicKey;
    const guardian1 = anchor.web3.Keypair.generate();
    const guardian2 = anchor.web3.Keypair.generate();
    const newWallet = anchor.web3.Keypair.generate().publicKey;
    const membership = membershipPda(commitment);
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(guardian2.publicKey, 1e9)
    );

    // require_cosign = true, two guardians (1-of-2)
    await issue(commitment, memberOwner, [guardian1.publicKey, guardian2.publicKey], true);

    // Council reaches 4/7 to migrate memberOwner -> newWallet and executes.
    const nonce = 1;
    const proposal = proposalPda(nonce);
    await program.methods
      .propose(new anchor.BN(nonce), { migrateWallet: { oldWallet: memberOwner, newWallet } })
      .accounts({ circle: circlePda, proposal, proposer: seats[0].publicKey })
      .signers([seats[0]])
      .rpc();
    for (const i of [1, 2, 3]) {
      await program.methods
        .approve()
        .accounts({ circle: circlePda, proposal, seat: seats[i].publicKey })
        .signers([seats[i]])
        .rpc();
    }
    await program.methods
      .executeProposal()
      .accounts({ circle: circlePda, proposal, executor: seats[0].publicKey })
      .signers([seats[0]])
      .rpc();

    // Council-only recover must FAIL (no member signature).
    let threw = false;
    try {
      await program.methods
        .recoverMembership()
        .accounts({ circle: circlePda, proposal, membership, memberAuthority: null, payer: payer.publicKey })
        .rpc();
    } catch {
      threw = true;
    }
    assert.isTrue(threw, "council alone must not migrate a require_cosign membership");

    // The SECOND guardian co-signs (proves 1-of-2 redundancy) — it succeeds.
    await program.methods
      .recoverMembership()
      .accounts({ circle: circlePda, proposal, membership, memberAuthority: guardian2.publicKey, payer: payer.publicKey })
      .signers([guardian2])
      .rpc();

    const m = await program.account.membership.fetch(membership);
    assert.ok(m.owner.equals(newWallet), "owner migrated with second guardian's co-signature");
  });

  it("lets a member self-migrate with a key they hold (no council)", async () => {
    const commitment = anchor.web3.Keypair.generate().publicKey.toBuffer();
    commitment[0] &= 0x1f; // < BN254 field modulus (valid Poseidon input)
    const owner = anchor.web3.Keypair.generate();
    const fresh = anchor.web3.Keypair.generate().publicKey;
    const membership = membershipPda(commitment);
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(owner.publicKey, 1e9)
    );

    await issue(commitment, owner.publicKey, [anchor.web3.PublicKey.default, anchor.web3.PublicKey.default], false);

    await program.methods
      .memberMigrate(fresh)
      .accounts({ membership, memberAuthority: owner.publicKey })
      .signers([owner])
      .rpc();

    const m = await program.account.membership.fetch(membership);
    assert.ok(m.owner.equals(fresh), "member self-migrated their own membership");
  });
});
