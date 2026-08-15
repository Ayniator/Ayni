import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Ayni } from "../target/types/ayni";
import { assert } from "chai";

// F98 — sponsorship karma, end to end.
//
// KARMA RANKS MEMBERS. That is a Tradition 2 rule the user waived explicitly on
// 2026-08-15 ("I waive the Tradition 2 no-ranking rule for F98 karma, and accept
// that it ranks members"), recorded in CLAUDE.md. These tests do not re-litigate
// that; they check the feature does what was asked and cannot be abused.
//
// THE TEST THAT MATTERS MOST is the anti-farming one. `establish_wing_peer` is
// `init_if_needed` and `end_wing_peer` only flips a flag, so a pair can link,
// release and re-link as often as they like. Credited naively, two members could
// sit in a loop and mint each other an unbounded total — and since karma now
// ranks people, that is not cosmetic, it is the ranking becoming meaningless.
// The `KarmaAward` PDA is the guard, and "release then re-link pays nothing"
// is the assertion that proves it.
describe("F98 — sponsorship karma", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Ayni as Program<Ayni>;
  const payer = provider.wallet as anchor.Wallet;

  const root = anchor.web3.Keypair.generate().publicKey;
  const seats = Array.from({ length: 7 }, () => anchor.web3.Keypair.generate());
  const NAME = "karma-circle";
  const DAY = 24 * 60 * 60;

  // Two members: the sponsee (mentee) and the sponsor (wing).
  const sponsee = anchor.web3.Keypair.generate();
  const sponsor = anchor.web3.Keypair.generate();
  const sponseeCommit = Buffer.alloc(32, 11);
  const sponsorCommit = Buffer.alloc(32, 22);

  const pda = (seeds: (Buffer | Uint8Array)[]) =>
    anchor.web3.PublicKey.findProgramAddressSync(seeds, program.programId)[0];

  const circle = pda([Buffer.from("circle"), root.toBuffer(), Buffer.from(NAME)]);
  const membership = (c: Buffer) => pda([Buffer.from("membership"), circle.toBuffer(), c]);
  const karma = (c: Buffer) => pda([Buffer.from("karma"), circle.toBuffer(), c]);
  // CANONICALISED pair seed — sorted, not role-ordered. Must mirror
  // KarmaAward::lo/hi in the program, or the client derives a different PDA
  // than the program expects and every call fails.
  const award = (a: Buffer, b: Buffer) => {
    const [lo, hi] = Buffer.compare(a, b) <= 0 ? [a, b] : [b, a];
    return pda([Buffer.from("karmaaward"), circle.toBuffer(), lo, hi]);
  };
  const wingPeer = (m: Buffer) => pda([Buffer.from("wingpeer"), circle.toBuffer(), m]);
  const karmaParams = pda([Buffer.from("karmaparams"), circle.toBuffer()]);
  const memberTree = pda([Buffer.from("members"), circle.toBuffer()]);
  const twoSponsor = pda([Buffer.from("twosponsor"), circle.toBuffer()]);
  const proposalPda = (n: number) =>
    pda([Buffer.from("proposal"), circle.toBuffer(), new anchor.BN(n).toArrayLike(Buffer, "le", 8)]);

  const NO_GUARDIANS = [anchor.web3.PublicKey.default, anchor.web3.PublicKey.default];

  const fund = async (kps: anchor.web3.Keypair[]) => {
    for (const k of kps) {
      const sig = await provider.connection.requestAirdrop(k.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);
    }
  };

  const points = async (c: Buffer): Promise<number> => {
    const a: any = await (program.account as any).karma.fetch(karma(c));
    return Number(a.points);
  };

  async function link() {
    await program.methods
      .establishWingPeer()
      .accounts({
        circle,
        menteeMembership: membership(sponseeCommit),
        wingMembership: membership(sponsorCommit),
        wingPeer: wingPeer(sponseeCommit),
        karmaParams,
        karmaAward: award(sponseeCommit, sponsorCommit),
        menteeKarma: karma(sponseeCommit),
        wingKarma: karma(sponsorCommit),
        signer: sponsee.publicKey,
        payer: payer.publicKey,
      })
      .signers([sponsee])
      .rpc();
  }

  // The Secretary seat issues memberships; the Circle needs a member tree first.
  async function issue(commit: Buffer, owner: anchor.web3.PublicKey) {
    await program.methods
      .issueMembership(Array.from(commit) as any, owner, NO_GUARDIANS as any, false)
      .accounts({
        circle,
        membership: membership(commit),
        memberTree,
        personhood: null,   // sybil gate off in this Circle
        openMembership: null,
        twoSponsor,
        secretary: seats[1].publicKey,
      })
      .signers([seats[1]])
      .rpc();
  }

  before(async () => {
    await fund([...seats.slice(0, 4), sponsee, sponsor]);
    await program.methods
      .initializeCircle(root, NAME, new anchor.BN(365 * DAY), new anchor.BN(0), seats.map((k) => k.publicKey) as any)
      .accounts({ circle, parent: root, payer: payer.publicKey })
      .rpc();

    await program.methods
      .initializeMemberTree(20)
      .accounts({ circle, memberTree, seat: seats[0].publicKey })
      .signers([seats[0]])
      .rpc();

    // Two memberships, each owned by its own wallet so the mentee can sign.
    for (const [commit, owner] of [
      [sponseeCommit, sponsee.publicKey],
      [sponsorCommit, sponsor.publicKey],
    ] as const) {
      await issue(commit, owner);
    }
  });

  it("credits both parties on the first Link, using the documented defaults", async () => {
    await link();
    // 100 to the sponsee, 10% of that to the sponsor — the request's figures.
    assert.equal(await points(sponseeCommit), 100, "the sponsee did not receive the default gain");
    assert.equal(await points(sponsorCommit), 10, "the sponsor did not receive 10% of it");
  });

  it("does NOT credit again when the same Link is re-established", async () => {
    await link();
    assert.equal(await points(sponseeCommit), 100, "re-establishing paid the sponsee twice");
    assert.equal(await points(sponsorCommit), 10, "re-establishing paid the sponsor twice");
  });

  it("cannot be farmed: release then re-link pays nothing", async () => {
    // The whole point of the KarmaAward guard. Without it this loop mints karma
    // for free, as often as the pair care to run it.
    for (let i = 0; i < 3; i++) {
      await program.methods
        .endWingPeer()
        .accounts({
          circle,
          wingPeer: wingPeer(sponseeCommit),
          membership: membership(sponseeCommit),
          signer: sponsee.publicKey,
        })
        .signers([sponsee])
        .rpc();
      await link();
    }
    assert.equal(await points(sponseeCommit), 100, "karma was farmed by release/re-link");
    assert.equal(await points(sponsorCommit), 10, "karma was farmed by release/re-link");
  });

  it("lets the Council vote new numbers, and uses them for a NEW pair", async () => {
    const nonce = 1;
    const prop = proposalPda(nonce);
    // 500 to a sponsee, 20% (2000 bps) to the sponsor.
    await program.methods
      .propose(new anchor.BN(nonce), {
        setKarmaParams: { gainSponsee: new anchor.BN(500), sponsorRatioBps: 2000, minSponsors: 3 },
      } as any)
      .accounts({ circle, proposal: prop, proposer: seats[0].publicKey })
      .signers([seats[0]])
      .rpc();
    for (const s of seats.slice(1, 4)) {
      await program.methods.approve().accounts({ circle, proposal: prop, seat: s.publicKey }).signers([s]).rpc();
    }
    await program.methods
      .executeProposal()
      .accounts({ circle, proposal: prop, executor: seats[0].publicKey })
      .signers([seats[0]])
      .rpc();
    await program.methods
      .setKarmaParams()
      .accounts({ circle, proposal: prop, params: karmaParams, caller: payer.publicKey })
      .rpc();

    const p: any = await (program.account as any).karmaParams.fetch(karmaParams);
    assert.equal(Number(p.gainSponsee), 500);
    assert.equal(Number(p.sponsorRatioBps), 2000);
    assert.equal(Number(p.minSponsors), 3, "the advisory minimum is stored");

    // A third member links to the same sponsor — a NEW pair, so it is credited,
    // and at the newly voted rate.
    const third = anchor.web3.Keypair.generate();
    const thirdCommit = Buffer.alloc(32, 33);
    await fund([third]);
    await issue(thirdCommit, third.publicKey);
    await program.methods
      .establishWingPeer()
      .accounts({
        circle,
        menteeMembership: membership(thirdCommit),
        wingMembership: membership(sponsorCommit),
        wingPeer: wingPeer(thirdCommit),
        karmaParams,
        karmaAward: award(thirdCommit, sponsorCommit),
        menteeKarma: karma(thirdCommit),
        wingKarma: karma(sponsorCommit),
        signer: third.publicKey,
        payer: payer.publicKey,
      })
      .signers([third])
      .rpc();

    assert.equal(await points(thirdCommit), 500, "the new sponsee gain was not applied");
    // The sponsor keeps their earlier 10 and gains 20% of 500 = 100.
    assert.equal(await points(sponsorCommit), 110, "the sponsor's share used the wrong rate");
  });

  it("refuses a sponsor share above 100% at propose time", async () => {
    const nonce = 2;
    let threw = false;
    try {
      await program.methods
        .propose(new anchor.BN(nonce), {
          setKarmaParams: { gainSponsee: new anchor.BN(10), sponsorRatioBps: 10001, minSponsors: 2 },
        } as any)
        .accounts({ circle, proposal: proposalPda(nonce), proposer: seats[0].publicKey })
        .signers([seats[0]])
        .rpc();
    } catch {
      threw = true;
    }
    assert.isTrue(threw, "a ratio above 100% was accepted");
  });

  it("a ROLE SWAP between the same two members does not pay twice", async () => {
    // The abuse a Sentinel round found and reproduced against the first
    // version of this feature: the award PDA was seeded in role order, so the
    // same pair could swap roles, derive a SECOND award account, and collect
    // again — 220 between them instead of 110. Two individually-legitimate
    // transactions, no farming loop.
    //
    // This asserts the pair's COMBINED total, which is the thing that was
    // actually wrong. The original farming test only checked one direction's
    // individual totals and sailed straight past it.
    const a = anchor.web3.Keypair.generate();
    const b = anchor.web3.Keypair.generate();
    // Byte values must stay BELOW the BN254 field modulus (top byte 0x30), or
    // the membership's Poseidon leaf insert fails — 0x55/0x66 did exactly that.
    const aCommit = Buffer.alloc(32, 0x07);
    const bCommit = Buffer.alloc(32, 0x08);
    await fund([a, b]);
    await issue(aCommit, a.publicKey);
    await issue(bCommit, b.publicKey);

    const linkAs = async (menteeCommit: Buffer, wingCommit: Buffer, signer: anchor.web3.Keypair) =>
      program.methods
        .establishWingPeer()
        .accounts({
          circle,
          menteeMembership: membership(menteeCommit),
          wingMembership: membership(wingCommit),
          wingPeer: wingPeer(menteeCommit),
          karmaParams,
          karmaAward: award(menteeCommit, wingCommit),
          menteeKarma: karma(menteeCommit),
          wingKarma: karma(wingCommit),
          signer: signer.publicKey,
          payer: payer.publicKey,
        })
        .signers([signer])
        .rpc();

    // A sponsors B.
    await linkAs(bCommit, aCommit, b);
    const afterFirst = (await points(aCommit)) + (await points(bCommit));

    // Now the roles swap: B sponsors A. Same two people, same Circle.
    await linkAs(aCommit, bCommit, a);
    const afterSwap = (await points(aCommit)) + (await points(bCommit));

    assert.equal(
      afterSwap,
      afterFirst,
      "a role swap paid the pair a second time — the award seed is directional again"
    );
  });

  it("the advisory minimum gates nothing — a member with no sponsor still acts", async () => {
    // min_sponsors is 3 by now. A member with ZERO sponsors must still be able
    // to use the platform; the request was explicit about that. Establishing a
    // Link is the nearest thing to a gated action, and it works.
    const loner = anchor.web3.Keypair.generate();
    const lonerCommit = Buffer.alloc(32, 44);
    await fund([loner]);
    await issue(lonerCommit, loner.publicKey);
    await program.methods
      .establishWingPeer()
      .accounts({
        circle,
        menteeMembership: membership(lonerCommit),
        wingMembership: membership(sponsorCommit),
        wingPeer: wingPeer(lonerCommit),
        karmaParams,
        karmaAward: award(lonerCommit, sponsorCommit),
        menteeKarma: karma(lonerCommit),
        wingKarma: karma(sponsorCommit),
        signer: loner.publicKey,
        payer: payer.publicKey,
      })
      .signers([loner])
      .rpc();
    assert.equal(await points(lonerCommit), 500, "a member below the advisory minimum was blocked or unpaid");
  });
});
