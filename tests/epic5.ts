import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Ayni } from "../target/types/ayni";
import { assert } from "chai";

// Epic 5 — per-element visibility. A member sets their own avatar/quipu/bio
// audience (0 chosen, 1 my-circle default, 2 all-members); absent ⇒ my-circle;
// only the member may set it; tiers are range-checked. No-ZK paths only.
describe("ayni — per-element visibility (Epic 5)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Ayni as Program<Ayni>;
  const payer = provider.wallet as anchor.Wallet;
  const parent = anchor.web3.Keypair.generate().publicKey;
  const name = "vis-circle";
  const ONE_YEAR = new anchor.BN(365 * 24 * 60 * 60);

  const seats = Array.from({ length: 7 }, () => anchor.web3.Keypair.generate());
  const SECRETARY = 1;
  const memberOwner = anchor.web3.Keypair.generate();
  const strangerOwner = anchor.web3.Keypair.generate();

  const makeCommitment = () => { const b = anchor.web3.Keypair.generate().publicKey.toBuffer(); b[0] &= 0x1f; return b; };
  const cMember = makeCommitment();
  const cStranger = makeCommitment();

  const pda = (...s: (Buffer | Uint8Array)[]) =>
    anchor.web3.PublicKey.findProgramAddressSync([...s] as Buffer[], program.programId)[0];
  const circle = pda(Buffer.from("circle"), parent.toBuffer(), Buffer.from(name));
  const memberTree = pda(Buffer.from("members"), circle.toBuffer());
  const twoSponsor = pda(Buffer.from("twosponsor"), circle.toBuffer());
  const membershipPda = (c: Buffer) => pda(Buffer.from("membership"), circle.toBuffer(), c);
  const visPda = (c: Buffer) => pda(Buffer.from("visibility"), circle.toBuffer(), c);

  const noGuardians = [anchor.web3.PublicKey.default, anchor.web3.PublicKey.default];
  const expectFail = async (p: Promise<any>, code?: string) => {
    try { await p; } catch (e: any) {
      if (code) { const s = (e?.error?.errorCode?.code ?? "") + " " + (e?.message ?? "") + " " + JSON.stringify(e?.logs ?? []); assert.include(s, code, `expected ${code}`); }
      return;
    }
    assert.fail(`expected failure${code ? ` with ${code}` : ""}`);
  };

  const issue = (commitment: Buffer, owner: anchor.web3.PublicKey) =>
    program.methods.issueMembership([...commitment], owner, noGuardians, false)
      .accounts({ circle, membership: membershipPda(commitment), memberTree, personhood: null, openMembership: null, twoSponsor, secretary: seats[SECRETARY].publicKey })
      .signers([seats[SECRETARY]]).rpc();

  const setVis = (memberC: Buffer, av: number, q: number, bio: number, signer: anchor.web3.Keypair) =>
    program.methods.setVisibility(av, q, bio)
      .accounts({ circle, memberMembership: membershipPda(memberC), policy: visPda(memberC), member: signer.publicKey })
      .signers([signer]).rpc();

  before(async () => {
    await Promise.all([...seats, memberOwner, strangerOwner].map(async (k) => {
      const sig = await provider.connection.requestAirdrop(k.publicKey, 1e9);
      await provider.connection.confirmTransaction(sig);
    }));
    await program.methods.initializeCircle(parent, name, ONE_YEAR, new anchor.BN(0), seats.map((s) => s.publicKey))
      .accounts({ circle, parent, payer: payer.publicKey }).rpc();
    await program.methods.initializeMemberTree(20).accounts({ circle, memberTree, seat: seats[0].publicKey }).signers([seats[0]]).rpc();
    await issue(cMember, memberOwner.publicKey);
    await issue(cStranger, strangerOwner.publicKey);
  });

  it("has no policy account by default (absent ⇒ my circle)", async () => {
    await expectFail(program.account.visibilityPolicy.fetch(visPda(cMember)) as any);
  });

  it("lets the member set their per-element visibility", async () => {
    await setVis(cMember, 2, 1, 0, memberOwner); // avatar all, quipu circle, bio chosen
    const p: any = await program.account.visibilityPolicy.fetch(visPda(cMember));
    assert.equal(p.avatar, 2);
    assert.equal(p.quipu, 1);
    assert.equal(p.bio, 0);
    assert.deepEqual([...p.member], [...cMember]);
  });

  it("lets the member change it again", async () => {
    await setVis(cMember, 1, 1, 1, memberOwner);
    const p: any = await program.account.visibilityPolicy.fetch(visPda(cMember));
    assert.equal(p.avatar, 1); assert.equal(p.bio, 1);
  });

  it("rejects a tier above 2", async () => {
    await expectFail(setVis(cMember, 3, 1, 1, memberOwner), "InvalidVisibilityTier");
  });

  it("refuses anyone but the member to set their visibility", async () => {
    // The stranger signs against the member's membership — but holds none of its keys.
    await expectFail(setVis(cMember, 0, 0, 0, strangerOwner), "Unauthorized");
    // A seat cannot impose it either.
    await expectFail(setVis(cMember, 0, 0, 0, seats[0]), "Unauthorized");
  });
});
