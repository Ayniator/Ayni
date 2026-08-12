import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Ayni } from "../target/types/ayni";
import { assert } from "chai";

// Epic 3 — the Quipu: one pendant cord per completed step, tied by the member's
// sponsor (their wing). Binary and personal; steps 1..=12; one cord per
// (member, step). No-ZK paths only.
describe("ayni — the quipu (Epic 3)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Ayni as Program<Ayni>;
  const payer = provider.wallet as anchor.Wallet;
  const parent = anchor.web3.Keypair.generate().publicKey;
  const name = "quipu-circle";
  const ONE_YEAR = new anchor.BN(365 * 24 * 60 * 60);

  const seats = Array.from({ length: 7 }, () => anchor.web3.Keypair.generate());
  const SECRETARY = 1;
  const memberOwner = anchor.web3.Keypair.generate();
  const sponsorOwner = anchor.web3.Keypair.generate();
  const strangerOwner = anchor.web3.Keypair.generate();

  const makeCommitment = () => {
    const b = anchor.web3.Keypair.generate().publicKey.toBuffer();
    b[0] &= 0x1f;
    return b;
  };
  const cMember = makeCommitment();
  const cSponsor = makeCommitment();
  const cStranger = makeCommitment();

  const pda = (...s: (Buffer | Uint8Array)[]) =>
    anchor.web3.PublicKey.findProgramAddressSync([...s] as Buffer[], program.programId)[0];
  const circle = pda(Buffer.from("circle"), parent.toBuffer(), Buffer.from(name));
  const memberTree = pda(Buffer.from("members"), circle.toBuffer());
  const twoSponsor = pda(Buffer.from("twosponsor"), circle.toBuffer());
  const membershipPda = (c: Buffer) => pda(Buffer.from("membership"), circle.toBuffer(), c);
  const wingPeerPda = (c: Buffer) => pda(Buffer.from("wingpeer"), circle.toBuffer(), c);
  const cordPda = (c: Buffer, step: number) => pda(Buffer.from("quipu"), circle.toBuffer(), c, Uint8Array.of(step));

  const noGuardians = [anchor.web3.PublicKey.default, anchor.web3.PublicKey.default];

  const expectFail = async (p: Promise<any>, code?: string) => {
    try { await p; } catch (e: any) {
      if (code) {
        const s = (e?.error?.errorCode?.code ?? "") + " " + (e?.message ?? "") + " " + JSON.stringify(e?.logs ?? []);
        assert.include(s, code, `expected error ${code}`);
      }
      return;
    }
    assert.fail(`expected failure${code ? ` with ${code}` : ""}`);
  };

  const issue = (commitment: Buffer, owner: anchor.web3.PublicKey) =>
    program.methods.issueMembership([...commitment], owner, noGuardians, false)
      .accounts({
        circle, membership: membershipPda(commitment), memberTree,
        personhood: null, openMembership: null, twoSponsor, secretary: seats[SECRETARY].publicKey,
      })
      .signers([seats[SECRETARY]]).rpc();

  const tie = (memberC: Buffer, sponsorC: Buffer, step: number, signer: anchor.web3.Keypair) =>
    program.methods.tieQuipuCord(step)
      .accounts({
        circle,
        memberMembership: membershipPda(memberC),
        sponsorMembership: membershipPda(sponsorC),
        wingPeer: wingPeerPda(memberC),
        cord: cordPda(memberC, step),
        sponsor: signer.publicKey,
        payer: signer.publicKey,
      })
      .signers([signer]).rpc();

  before(async () => {
    await Promise.all([...seats, memberOwner, sponsorOwner, strangerOwner].map(async (k) => {
      const sig = await provider.connection.requestAirdrop(k.publicKey, 1e9);
      await provider.connection.confirmTransaction(sig);
    }));
    await program.methods.initializeCircle(parent, name, ONE_YEAR, new anchor.BN(0), seats.map((s) => s.publicKey))
      .accounts({ circle, parent, payer: payer.publicKey }).rpc();
    await program.methods.initializeMemberTree(20)
      .accounts({ circle, memberTree, seat: seats[0].publicKey }).signers([seats[0]]).rpc();
    await issue(cMember, memberOwner.publicKey);
    await issue(cSponsor, sponsorOwner.publicKey);
    await issue(cStranger, strangerOwner.publicKey);
    // The member designates their sponsor as their wing.
    await program.methods.establishWingPeer()
      .accounts({
        circle, menteeMembership: membershipPda(cMember), wingMembership: membershipPda(cSponsor),
        wingPeer: wingPeerPda(cMember), signer: memberOwner.publicKey, payer: memberOwner.publicKey,
      })
      .signers([memberOwner]).rpc();
  });

  it("rejects a step outside 1..=12", async () => {
    await expectFail(tie(cMember, cSponsor, 0, sponsorOwner), "InvalidStep");
    await expectFail(tie(cMember, cSponsor, 13, sponsorOwner), "InvalidStep");
  });

  it("lets the sponsor tie a cord for a completed step", async () => {
    await tie(cMember, cSponsor, 1, sponsorOwner);
    const c: any = await program.account.quipuCord.fetch(cordPda(cMember, 1));
    assert.equal(c.step, 1);
    assert.deepEqual([...c.member], [...cMember]);
    assert.deepEqual([...c.sponsor], [...cSponsor]);
    assert.isAbove(c.completedAt.toNumber(), 0);
  });

  it("refuses a second cord for the same (member, step)", async () => {
    await expectFail(tie(cMember, cSponsor, 1, sponsorOwner)); // PDA collision
  });

  it("lets the same member earn a different step", async () => {
    await tie(cMember, cSponsor, 2, sponsorOwner);
    const c: any = await program.account.quipuCord.fetch(cordPda(cMember, 2));
    assert.equal(c.step, 2);
  });

  it("refuses anyone but the member's wing (the sponsor) to tie", async () => {
    // The stranger is a real member but not the member's wing.
    await expectFail(tie(cMember, cStranger, 3, strangerOwner), "NotParrain");
    // A seat with no wing bond cannot tie either.
    await expectFail(tie(cMember, cSponsor, 3, seats[0]), "Unauthorized");
  });

  it("refuses a member tying their own cord (no self-sponsorship)", async () => {
    // The member signs against their own membership as 'sponsor' — but they are
    // not their own wing, and member == sponsor is refused.
    await expectFail(tie(cMember, cMember, 4, memberOwner), "SelfAttestation");
  });
});
