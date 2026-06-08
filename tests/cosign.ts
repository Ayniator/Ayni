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
  const authority = provider.wallet as anchor.Wallet;
  const worldService = anchor.web3.Keypair.generate().publicKey;
  const name = "cosign-circle";

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const seats = Array.from({ length: 4 }, () => anchor.web3.Keypair.generate());

  const [circlePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("circle"), worldService.toBuffer(), Buffer.from(name)],
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

  before(async () => {
    await Promise.all(
      seats.map(async (s) => {
        const sig = await provider.connection.requestAirdrop(s.publicKey, 1e9);
        await provider.connection.confirmTransaction(sig);
      })
    );
    await program.methods
      .initializeCircle(name, new anchor.BN(365 * 24 * 60 * 60), new anchor.BN(0)) // no time-lock
      .accounts({ circle: circlePda, worldService, authority: authority.publicKey })
      .rpc();
    for (let i = 0; i < 4; i++) {
      await program.methods
        .appointSeat(i, seats[i].publicKey)
        .accounts({ circle: circlePda, authority: authority.publicKey })
        .rpc();
    }
  });

  it("blocks council-only migration of a require_cosign membership, allows it with either guardian", async () => {
    const commitment = anchor.web3.Keypair.generate().publicKey.toBuffer();
    const memberOwner = anchor.web3.Keypair.generate().publicKey;
    const guardian1 = anchor.web3.Keypair.generate();
    const guardian2 = anchor.web3.Keypair.generate();
    const newWallet = anchor.web3.Keypair.generate().publicKey;
    const membership = membershipPda(commitment);
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(guardian2.publicKey, 1e9)
    );

    // require_cosign = true, two guardians (1-of-2)
    await program.methods
      .issueMembership([...commitment], memberOwner, [guardian1.publicKey, guardian2.publicKey], true)
      .accounts({ circle: circlePda, membership, authority: authority.publicKey })
      .rpc();

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
        .accounts({ circle: circlePda, proposal, membership, memberAuthority: null, payer: authority.publicKey })
        .rpc();
    } catch {
      threw = true;
    }
    assert.isTrue(threw, "council alone must not migrate a require_cosign membership");

    // The SECOND guardian co-signs (proves 1-of-2 redundancy) — it succeeds.
    await program.methods
      .recoverMembership()
      .accounts({ circle: circlePda, proposal, membership, memberAuthority: guardian2.publicKey, payer: authority.publicKey })
      .signers([guardian2])
      .rpc();

    const m = await program.account.membership.fetch(membership);
    assert.ok(m.owner.equals(newWallet), "owner migrated with second guardian's co-signature");
  });

  it("lets a member self-migrate with a key they hold (no council)", async () => {
    const commitment = anchor.web3.Keypair.generate().publicKey.toBuffer();
    const owner = anchor.web3.Keypair.generate();
    const fresh = anchor.web3.Keypair.generate().publicKey;
    const membership = membershipPda(commitment);
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(owner.publicKey, 1e9)
    );

    await program.methods
      .issueMembership([...commitment], owner.publicKey, [anchor.web3.PublicKey.default, anchor.web3.PublicKey.default], false)
      .accounts({ circle: circlePda, membership, authority: authority.publicKey })
      .rpc();

    await program.methods
      .memberMigrate(fresh)
      .accounts({ membership, memberAuthority: owner.publicKey })
      .signers([owner])
      .rpc();

    const m = await program.account.membership.fetch(membership);
    assert.ok(m.owner.equals(fresh), "member self-migrated their own membership");
  });
});
