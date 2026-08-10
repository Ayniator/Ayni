import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Ayni } from "../target/types/ayni";
import { assert } from "chai";

// Epic 1 — two-sponsor admission (amended v0.2): the parrain (any member in
// good standing) attests, the newcomer enters PROVISIONALLY (membership exists,
// commitment NOT in the member tree), and a trusted servant (any of the 7
// seats, a different person than the parrain) confirms — only then does the
// commitment join the votable set and member_count move. No-ZK paths only; the
// "provisional cannot vote" half is structural (not in tree ⇒ no inclusion
// proof) and is asserted here via tree.next_index / member_count.
describe("ayni — two-sponsor admission (Epic 1)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Ayni as Program<Ayni>;
  const payer = provider.wallet as anchor.Wallet;
  const parent = anchor.web3.Keypair.generate().publicKey;
  const name = "epic1-circle";
  const ONE_YEAR = new anchor.BN(365 * 24 * 60 * 60);

  const seats = Array.from({ length: 7 }, () => anchor.web3.Keypair.generate());
  const SECRETARY = 1;
  const RHYTHM = 2;

  const stranger = anchor.web3.Keypair.generate();
  const parrainOwner = anchor.web3.Keypair.generate();
  const newcomerOwner = anchor.web3.Keypair.generate();
  const newcomer2Owner = anchor.web3.Keypair.generate();
  // A parrain who ALSO holds a seat (Elder North) — the distinct-persons fixture.
  const elderParrainOwner = seats[3];

  const makeCommitment = () => {
    const b = anchor.web3.Keypair.generate().publicKey.toBuffer();
    b[0] &= 0x1f;
    return b;
  };
  const cParrain = makeCommitment();
  const cElderParrain = makeCommitment();
  const cNewcomer = makeCommitment();
  const cNewcomer2 = makeCommitment();

  const pda = (...seeds: (Buffer | Uint8Array)[]) =>
    anchor.web3.PublicKey.findProgramAddressSync([...seeds] as Buffer[], program.programId)[0];

  const circle = pda(Buffer.from("circle"), parent.toBuffer(), Buffer.from(name));
  const memberTree = pda(Buffer.from("members"), circle.toBuffer());
  const policy = pda(Buffer.from("twosponsor"), circle.toBuffer());
  const membershipPda = (c: Buffer) => pda(Buffer.from("membership"), circle.toBuffer(), c);
  const attestPda = (c: Buffer) => pda(Buffer.from("attest"), circle.toBuffer(), c);
  const provisionalPda = (c: Buffer) => pda(Buffer.from("provisional"), circle.toBuffer(), c);

  const noGuardians = [anchor.web3.PublicKey.default, anchor.web3.PublicKey.default];

  const expectFail = async (p: Promise<any>, code?: string) => {
    try {
      await p;
    } catch (e: any) {
      if (code) {
        const s =
          (e?.error?.errorCode?.code ?? "") + " " + (e?.message ?? "") + " " + JSON.stringify(e?.logs ?? []);
        assert.include(s, code, `expected error ${code}`);
      }
      return;
    }
    assert.fail(`expected the transaction to fail${code ? ` with ${code}` : ""}`);
  };

  const issueLegacy = (commitment: Buffer, owner: anchor.web3.PublicKey) =>
    program.methods
      .issueMembership([...commitment], owner, noGuardians, false)
      .accounts({
        circle,
        membership: membershipPda(commitment),
        memberTree,
        personhood: null,
        openMembership: null,
        secretary: seats[SECRETARY].publicKey,
        twoSponsor: policy,
      })
      .signers([seats[SECRETARY]])
      .rpc();

  const attest = (newcomer: Buffer, parrainCommitment: Buffer, signer: anchor.web3.Keypair) =>
    program.methods
      .attestAdmission([...newcomer])
      .accounts({
        circle,
        parrainMembership: membershipPda(parrainCommitment),
        attestation: attestPda(newcomer),
        parrain: signer.publicKey,
      })
      .signers([signer])
      .rpc();

  const issueProvisional = (commitment: Buffer, owner: anchor.web3.PublicKey, signer: anchor.web3.Keypair) =>
    program.methods
      .issueProvisionalMembership([...commitment], owner, noGuardians, false)
      .accounts({
        circle,
        policy,
        attestation: attestPda(commitment),
        membership: membershipPda(commitment),
        provisional: provisionalPda(commitment),
        personhood: null,
        payer: signer.publicKey,
      })
      .signers([signer])
      .rpc();

  const confirm = (commitment: Buffer, parrainCommitment: Buffer, servant: anchor.web3.Keypair) =>
    program.methods
      .confirmAdmission()
      .accounts({
        circle,
        membership: membershipPda(commitment),
        provisional: provisionalPda(commitment),
        attestation: attestPda(commitment),
        parrainMembership: membershipPda(parrainCommitment),
        memberTree,
        servant: servant.publicKey,
      })
      .signers([servant])
      .rpc();

  const treeState = async () => {
    const t: any = await program.account.memberTree.fetch(memberTree);
    const c: any = await program.account.circle.fetch(circle);
    return { leaves: Number(t.nextIndex), members: Number(c.memberCount) };
  };

  before(async () => {
    await Promise.all(
      [...seats, stranger, parrainOwner, newcomerOwner, newcomer2Owner].map(async (k) => {
        const sig = await provider.connection.requestAirdrop(k.publicKey, 1e9);
        await provider.connection.confirmTransaction(sig);
      })
    );
    await program.methods
      .initializeCircle(parent, name, ONE_YEAR, new anchor.BN(0), seats.map((s) => s.publicKey))
      .accounts({ circle, parent, payer: payer.publicKey })
      .rpc();
    await program.methods
      .initializeMemberTree(20)
      .accounts({ circle, memberTree, seat: seats[0].publicKey })
      .signers([seats[0]])
      .rpc();
    // Two future parrains enter under the legacy Secretary gate (policy off).
    await issueLegacy(cParrain, parrainOwner.publicKey);
    await issueLegacy(cElderParrain, elderParrainOwner.publicKey);
  });

  it("legacy issuance auto-creates the policy PDA with required=false", async () => {
    const p: any = await program.account.twoSponsorAdmission.fetch(policy);
    assert.isFalse(p.required);
  });

  it("only a seat can toggle the policy; a seat enables it", async () => {
    await expectFail(
      program.methods.setTwoSponsorAdmission(true)
        .accounts({ circle, policy, seat: stranger.publicKey })
        .signers([stranger]).rpc(),
      "NotCouncilSeat"
    );
    await program.methods.setTwoSponsorAdmission(true)
      .accounts({ circle, policy, seat: seats[RHYTHM].publicKey })
      .signers([seats[RHYTHM]]).rpc();
    const p: any = await program.account.twoSponsorAdmission.fetch(policy);
    assert.isTrue(p.required);
  });

  it("closes the legacy door once two-sponsor admission is required", async () => {
    await expectFail(issueLegacy(makeCommitment(), anchor.web3.Keypair.generate().publicKey), "TwoSponsorRequired");
  });

  it("refuses attestation from a non-member and from the newcomer themselves", async () => {
    await expectFail(attest(cNewcomer, cParrain, stranger), "Unauthorized");
    await expectFail(attest(cParrain, cParrain, parrainOwner), "SelfAttestation");
  });

  it("refuses provisional admission with no parrain attestation", async () => {
    // The attestation PDA does not exist → account resolution fails.
    await expectFail(issueProvisional(cNewcomer, newcomerOwner.publicKey, newcomerOwner));
  });

  it("parrain attests; newcomer enters provisionally — tree and count untouched", async () => {
    const before = await treeState();
    await attest(cNewcomer, cParrain, parrainOwner);
    await issueProvisional(cNewcomer, newcomerOwner.publicKey, newcomerOwner);

    const m: any = await program.account.membership.fetch(membershipPda(cNewcomer));
    assert.equal(m.owner.toBase58(), newcomerOwner.publicKey.toBase58());
    const prov: any = await program.account.provisionalMember.fetch(provisionalPda(cNewcomer));
    assert.deepEqual([...prov.commitment], [...cNewcomer]);

    const after = await treeState();
    assert.equal(after.leaves, before.leaves, "commitment NOT in the votable set");
    assert.equal(after.members, before.members, "member_count untouched");
  });

  it("refuses a second parrain attestation for the same newcomer", async () => {
    await expectFail(attest(cNewcomer, cElderParrain, elderParrainOwner)); // PDA exists
  });

  it("refuses confirmation from a non-seat", async () => {
    await expectFail(confirm(cNewcomer, cParrain, stranger), "NotCouncilSeat");
  });

  it("a trusted servant confirms: tree +1, member_count +1, marker closed", async () => {
    const before = await treeState();
    await confirm(cNewcomer, cParrain, seats[RHYTHM]);
    const after = await treeState();
    assert.equal(after.leaves, before.leaves + 1, "commitment entered the votable set");
    assert.equal(after.members, before.members + 1, "member_count incremented");
    await expectFail(program.account.provisionalMember.fetch(provisionalPda(cNewcomer)) as any);
  });

  it("refuses a second confirmation (marker gone)", async () => {
    await expectFail(confirm(cNewcomer, cParrain, seats[RHYTHM]));
  });

  it("distinct persons: the parrain's own seat cannot confirm their neophyte", async () => {
    // Elder North is BOTH a seat holder and the parrain of newcomer2.
    await attest(cNewcomer2, cElderParrain, elderParrainOwner);
    await issueProvisional(cNewcomer2, newcomer2Owner.publicKey, newcomer2Owner);
    await expectFail(confirm(cNewcomer2, cElderParrain, seats[3]), "ParrainCannotConfirm");
    // A different servant confirms fine.
    await confirm(cNewcomer2, cElderParrain, seats[SECRETARY]);
  });

  it("confirm accepts a null parrainMembership only for an anonymous attestation", async () => {
    // A named attestation (parrain set) with parrainMembership omitted must fail
    // the distinct-persons check — the handler requires the account when
    // attestation.parrain != 0. cNewcomer2 was already confirmed; use a fresh one.
    const cN3 = makeCommitment();
    const n3Owner = anchor.web3.Keypair.generate();
    const sig = await provider.connection.requestAirdrop(n3Owner.publicKey, 1e9);
    await provider.connection.confirmTransaction(sig);
    await attest(cN3, cParrain, parrainOwner);
    await issueProvisional(cN3, n3Owner.publicKey, n3Owner);
    await expectFail(
      program.methods.confirmAdmission()
        .accounts({
          circle, membership: membershipPda(cN3), provisional: provisionalPda(cN3),
          attestation: attestPda(cN3), parrainMembership: null, memberTree, servant: seats[RHYTHM].publicKey,
        } as any)
        .signers([seats[RHYTHM]]).rpc(),
      "ParrainCannotConfirm"
    );
    // With the parrain account present it confirms fine.
    await confirm(cN3, cParrain, seats[RHYTHM]);
  });

  it("re-opening the legacy door works when the policy is toggled off", async () => {
    await program.methods.setTwoSponsorAdmission(false)
      .accounts({ circle, policy, seat: seats[RHYTHM].publicKey })
      .signers([seats[RHYTHM]]).rpc();
    await issueLegacy(makeCommitment(), anchor.web3.Keypair.generate().publicKey);
  });
});
