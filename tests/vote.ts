import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Ayni } from "../target/types/ayni";
import { assert } from "chai";
import { MemberTree, proveVote, to32BE } from "../app/voting/prove";

// End-to-end ZK: build a member, prove an anonymous ballot with the real
// (ceremony) verifying key, and have the program verify it on-chain. Also
// asserts circomlib Poseidon (off-chain) == solana-poseidon (on-chain).
describe("ayni — anonymous member voting (ZK)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Ayni as Program<Ayni>;
  const payer = provider.wallet as anchor.Wallet;
  const parent = anchor.web3.Keypair.generate().publicKey;
  const name = "vote-circle";

  const seats = Array.from({ length: 7 }, () => anchor.web3.Keypair.generate());
  const SECRETARY = 1;

  const [circlePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("circle"), parent.toBuffer(), Buffer.from(name)],
    program.programId
  );
  const [memberTreePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("members"), circlePda.toBuffer()],
    program.programId
  );

  before(async () => {
    await Promise.all(
      seats.map(async (s) => {
        const sig = await provider.connection.requestAirdrop(s.publicKey, 1e9);
        await provider.connection.confirmTransaction(sig);
      })
    );
  });

  it("issues a member; off-chain & on-chain Poseidon roots match", async () => {
    await program.methods
      .initializeCircle(parent, name, new anchor.BN(365 * 24 * 60 * 60), new anchor.BN(0), seats.map((s) => s.publicKey))
      .accounts({ circle: circlePda, parent, payer: payer.publicKey })
      .rpc();
    await program.methods
      .initializeMemberTree(20)
      .accounts({ circle: circlePda, memberTree: memberTreePda, seat: seats[0].publicKey })
      .signers([seats[0]])
      .rpc();

    // off-chain: secret -> commitment = Poseidon(secret) -> leaf in mirror tree.
    // THREE members, not one: create_member_proposal's MIN_ELECTORATE (the
    // 2f5a7c4 governance fix) refuses a ballot over an electorate smaller than
    // 3 unless a parent-Circle seat co-signs — and this fixture's parent is a
    // bare pubkey, not a Circle. The voter is member 0; the other two exist so
    // the Circle may open its own ballots unaided (same shape as tests/maci.ts).
    const tree = await MemberTree.create(20);
    (global as any).__voteTree = tree;
    const secrets = [987654321987654321n, 123456789123456789n, 555555555555555555n];
    (global as any).__voteSecret = secrets[0];
    const twoSponsorPda = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("twosponsor"), circlePda.toBuffer()], program.programId)[0];
    for (const [i, secret] of secrets.entries()) {
      const commitment = tree.h1(secret);
      const leafIndex = tree.insert(commitment);
      if (i === 0) (global as any).__voteLeafIndex = leafIndex;
      const commitmentBytes = Buffer.from(to32BE(commitment));
      const [membershipPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("membership"), circlePda.toBuffer(), commitmentBytes],
        program.programId
      );
      await program.methods
        .issueMembership([...commitmentBytes], anchor.web3.PublicKey.default, [anchor.web3.PublicKey.default, anchor.web3.PublicKey.default], false)
        .accounts({
          circle: circlePda,
          membership: membershipPda,
          memberTree: memberTreePda,
          personhood: null,
          openMembership: null,
          twoSponsor: twoSponsorPda,
          secretary: seats[SECRETARY].publicKey,
        })
        .signers([seats[SECRETARY]])
        .rpc();
    }

    const mt = await program.account.memberTree.fetch(memberTreePda);
    const onchainRoot = Buffer.from(mt.root).toString("hex");
    const offchainRoot = Buffer.from(to32BE(tree.root)).toString("hex");
    assert.equal(onchainRoot, offchainRoot, "on-chain (solana-poseidon) root must equal off-chain (circomlib) root");
  });

  it("casts an anonymous YES ballot verified on-chain (real ZK proof)", async () => {
    const tree: MemberTree = (global as any).__voteTree;
    const secret: bigint = (global as any).__voteSecret;
    const leafIndex: number = (global as any).__voteLeafIndex;

    const nonce = 1;
    const [proposalPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("mproposal"), circlePda.toBuffer(), new anchor.BN(nonce).toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const descriptionHash = Buffer.alloc(32, 7);
    await program.methods
      .createMemberProposal(new anchor.BN(nonce), [...descriptionHash], new anchor.BN(3600))
      // parentCircle/parentSeat are the small-electorate co-signature path;
      // unused because three members meet MIN_ELECTORATE (see the before-hook).
      .accounts({
        circle: circlePda,
        memberTree: memberTreePda,
        proposal: proposalPda,
        proposer: seats[0].publicKey,
        parentCircle: null,
        parentSeat: null,
      })
      .signers([seats[0]])
      .rpc();

    // generate the proof (proposalId == nonce)
    const { nullifier, proofA, proofB, proofC } = await proveVote(tree, secret, leafIndex, BigInt(nonce), true);

    const [voteNullifierPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vote_nullifier"), proposalPda.toBuffer(), Buffer.from(nullifier)],
      program.programId
    );
    await program.methods
      .castVote(true, nullifier, proofA, proofB, proofC)
      .accounts({ proposal: proposalPda, voteNullifier: voteNullifierPda, payer: payer.publicKey })
      .rpc();

    const p = await program.account.memberProposal.fetch(proposalPda);
    assert.equal(p.yes.toNumber(), 1, "YES tally incremented");
    assert.equal(p.no.toNumber(), 0);
  });

  it("rejects a double vote (nullifier already spent)", async () => {
    const tree: MemberTree = (global as any).__voteTree;
    const secret: bigint = (global as any).__voteSecret;
    const leafIndex: number = (global as any).__voteLeafIndex;
    const nonce = 1;
    const [proposalPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("mproposal"), circlePda.toBuffer(), new anchor.BN(nonce).toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const { nullifier, proofA, proofB, proofC } = await proveVote(tree, secret, leafIndex, BigInt(nonce), true);
    const [voteNullifierPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vote_nullifier"), proposalPda.toBuffer(), Buffer.from(nullifier)],
      program.programId
    );
    let threw = false;
    try {
      await program.methods
        .castVote(true, nullifier, proofA, proofB, proofC)
        .accounts({ proposal: proposalPda, voteNullifier: voteNullifierPda, payer: payer.publicKey })
        .rpc();
    } catch {
      threw = true;
    }
    assert.isTrue(threw, "same member cannot vote twice (nullifier PDA already exists)");
  });
});
