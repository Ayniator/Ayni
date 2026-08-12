import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Ayni } from "../target/types/ayni";
import { assert } from "chai";

// Epic 2 hardening (F54 + F56) — the bookkeeping and gate logic that needs no
// real Groth16 proof: the recent-roots ring buffer, the epoch rebuild
// (good-standing set), and the fellowship anchor. Real-proof e2e for the ZK
// paths lives with the browser-ZK suite (tests/vote.ts), excluded from the
// default glob by design.
describe("ayni — F54 recent roots / epochs + F56 fellowship anchor", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Ayni as Program<Ayni>;
  const payer = provider.wallet as anchor.Wallet;
  const connection = provider.connection;

  const seats = Array.from({ length: 7 }, () => anchor.web3.Keypair.generate());
  const SECRETARY = 1; // SEAT_SECRETARY (council.rs)

  const circlePda = (parent: anchor.web3.PublicKey, name: string) =>
    anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("circle"), parent.toBuffer(), Buffer.from(name)],
      program.programId
    )[0];
  const pda = (...seeds: (Buffer | Uint8Array)[]) =>
    anchor.web3.PublicKey.findProgramAddressSync(seeds.map((s) => Buffer.from(s)), program.programId)[0];
  const membersPda = (circle: anchor.web3.PublicKey) => pda(Buffer.from("members"), circle.toBuffer());
  const rootsPda = (circle: anchor.web3.PublicKey) => pda(Buffer.from("roots"), circle.toBuffer());
  const policyPda = (circle: anchor.web3.PublicKey) => pda(Buffer.from("twosponsor"), circle.toBuffer());
  const membershipPda = (circle: anchor.web3.PublicKey, c: Buffer) =>
    pda(Buffer.from("membership"), circle.toBuffer(), c);
  const provisionalPda = (circle: anchor.web3.PublicKey, c: Buffer) =>
    pda(Buffer.from("provisional"), circle.toBuffer(), c);
  const epochLeafPda = (circle: anchor.web3.PublicKey, epoch: number, c: Buffer) => {
    const e = Buffer.alloc(8);
    e.writeBigUInt64LE(BigInt(epoch));
    return pda(Buffer.from("epochleaf"), circle.toBuffer(), e, c);
  };

  const makeCommitment = () => {
    const b = Buffer.from(anchor.web3.Keypair.generate().secretKey.slice(0, 32));
    b[0] = 0; // keep the commitment below the BN254 field modulus
    return b;
  };
  const noGuardians = [anchor.web3.PublicKey.default, anchor.web3.PublicKey.default] as any;

  const initCircle = async (parent: anchor.web3.PublicKey, name: string, periodSecs: number) => {
    const circle = circlePda(parent, name);
    await program.methods
      .initializeCircle(parent, name, new anchor.BN(periodSecs), new anchor.BN(0), seats.map((s) => s.publicKey))
      .accounts({ circle, parent, payer: payer.publicKey })
      .rpc();
    await program.methods
      .initializeMemberTree(20)
      .accounts({ circle, memberTree: membersPda(circle), seat: seats[0].publicKey })
      .signers([seats[0]])
      .rpc();
    return circle;
  };

  const issue = (circle: anchor.web3.PublicKey, commitment: Buffer, owner: anchor.web3.PublicKey) =>
    program.methods
      .issueMembership([...commitment], owner, noGuardians, false)
      .accounts({
        circle,
        membership: membershipPda(circle, commitment),
        memberTree: membersPda(circle),
        personhood: null,
        openMembership: null,
        secretary: seats[SECRETARY].publicKey,
        twoSponsor: policyPda(circle),
      })
      .signers([seats[SECRETARY]])
      .rpc();

  const noteRoot = (circle: anchor.web3.PublicKey) =>
    program.methods
      .noteRoot()
      .accounts({ circle, memberTree: membersPda(circle), recentRoots: rootsPda(circle), caller: payer.publicKey })
      .rpc();

  before(async () => {
    await Promise.all(
      seats.map(async (s) => connection.confirmTransaction(await connection.requestAirdrop(s.publicKey, 2e9)))
    );
  });

  // --- F54a: the ring buffer keeps superseded roots provable ---------------
  it("note_root records roots that survive later insertions", async () => {
    const parent = anchor.web3.Keypair.generate().publicKey;
    const circle = await initCircle(parent, "rr-circle", 365 * 24 * 3600);

    await noteRoot(circle); // creates the buffer; records the empty root
    await issue(circle, makeCommitment(), anchor.web3.Keypair.generate().publicKey);
    await noteRoot(circle);
    const treeAfterA: any = await program.account.memberTree.fetch(membersPda(circle));
    const rootAfterA = Buffer.from(treeAfterA.root);

    await issue(circle, makeCommitment(), anchor.web3.Keypair.generate().publicKey);
    const treeAfterB: any = await program.account.memberTree.fetch(membersPda(circle));
    assert.notDeepEqual(Buffer.from(treeAfterB.root), rootAfterA, "insertion changed the root");

    const rr: any = await program.account.recentRoots.fetch(rootsPda(circle));
    const stored = (rr.roots as number[][]).map((r) => Buffer.from(r).toString("hex"));
    assert.include(stored, rootAfterA.toString("hex"), "the superseded root is still in the ring buffer");
  });

  // --- F54a: verification gate refuses an unknown root ---------------------
  it("attest_admission_zk refuses a root that is neither current nor recent", async () => {
    const parent = anchor.web3.Keypair.generate().publicKey;
    const circle = await initCircle(parent, "rr-gate", 365 * 24 * 3600);
    const newcomer = makeCommitment();
    const garbageRoot = makeCommitment();
    const nullifier = makeCommitment();
    try {
      await program.methods
        .attestAdmissionZk(
          [...newcomer],
          [...garbageRoot],
          [...nullifier],
          new Array(64).fill(0) as any,
          new Array(128).fill(0) as any,
          new Array(64).fill(0) as any
        )
        .accounts({
          circle,
          memberTree: membersPda(circle),
          recentRoots: null,
          attestation: pda(Buffer.from("attest"), circle.toBuffer(), newcomer),
          vouchNullifier: pda(Buffer.from("vouchnull"), circle.toBuffer(), nullifier),
          payer: payer.publicKey,
        })
        .rpc();
      assert.fail("an unknown root must be refused");
    } catch (e: any) {
      assert.include(String(e), "RootNotRecent", "refused specifically at the root gate (before proof work)");
    }
  });

  // --- F54b: epoch rebuild = good-standing set ------------------------------
  it("begin_member_epoch + reinsert_member: live members re-enter, expired do not, duplicates refused", async () => {
    const parent = anchor.web3.Keypair.generate().publicKey;
    // Membership TTL. This must be comfortably LONGER than everything cLive has
    // to survive between its issuance and the reinsert call: the mandatory
    // >1s separation below, plus two on-chain confirmations. The original 2s
    // left ~370ms of margin before confirmation latency was even counted, so on
    // a 2-vCPU box cLive was genuinely expired by the time reinsert landed and
    // the test failed with MembershipExpired (6001) on its first
    // expected-to-succeed call — a test racing itself, not a program bug.
    // (Sentinel known_flaky: epic2-reinsert-timing.) The cost of the wider
    // margin is that cDead now takes TERM_SECS+0.5s to expire.
    const TERM_SECS = 12;
    const circle = await initCircle(parent, "epoch-circle", TERM_SECS);
    const cLive = makeCommitment();
    const cDead = makeCommitment();
    await issue(circle, cDead, anchor.web3.Keypair.generate().publicKey);
    await new Promise((r) => setTimeout(r, TERM_SECS * 1000 + 500)); // cDead expires
    const liveIssuedAt = Date.now();
    await issue(circle, cLive, anchor.web3.Keypair.generate().publicKey);
    // Separate the issuance from the rebuild by >1s so cLive.issued_at is
    // strictly < epoch_started_at (reinsert's predate-the-epoch guard uses
    // second-granularity timestamps; a member issued in the SAME second as
    // begin_member_epoch is conservatively excluded until the next epoch).
    await new Promise((r) => setTimeout(r, 1500));

    await program.methods
      .beginMemberEpoch()
      .accounts({ circle, memberTree: membersPda(circle), recentRoots: rootsPda(circle), seat: seats[1].publicKey })
      .signers([seats[1]])
      .rpc();

    let c: any = await program.account.circle.fetch(circle);
    assert.equal(Number(c.memberCount), 0, "rebuild empties the votable set");
    const rr: any = await program.account.recentRoots.fetch(rootsPda(circle));
    assert.equal(Number(rr.epoch), 1, "epoch advanced");

    const reinsert = (commitment: Buffer) =>
      program.methods
        .reinsertMember(new anchor.BN(1))
        .accounts({
          circle,
          membership: membershipPda(circle, commitment),
          provisional: provisionalPda(circle, commitment),
          memberTree: membersPda(circle),
          recentRoots: rootsPda(circle),
          epochLeaf: epochLeafPda(circle, 1, commitment),
          caller: payer.publicKey,
        })
        .rpc();

    // If this ever fails with MembershipExpired again, the margin — not the
    // program — is what regressed: raise TERM_SECS rather than relaxing the
    // assertion. Surfacing the elapsed time makes that diagnosable from the
    // failure output alone, instead of needing instrumentation.
    const elapsed = Date.now() - liveIssuedAt;
    assert.isBelow(
      elapsed,
      TERM_SECS * 1000,
      `cLive must still be live at reinsert: ${elapsed}ms elapsed of a ${TERM_SECS * 1000}ms term`
    );
    await reinsert(cLive);
    c = await program.account.circle.fetch(circle);
    assert.equal(Number(c.memberCount), 1, "the live member re-entered");
    const leaf: any = await program.account.epochLeaf.fetch(epochLeafPda(circle, 1, cLive));
    assert.equal(Number(leaf.leafIndex), 0, "explicit insertion index recorded");

    let threw = false;
    try { await reinsert(cLive); } catch { threw = true; }
    assert.isTrue(threw, "double reinsertion refused (EpochLeaf collision)");

    threw = false;
    try { await reinsert(cDead); } catch { threw = true; }
    assert.isTrue(threw, "an EXPIRED membership cannot re-enter — this is the good-standing filter");

    // 2026-08-11c HIGH guard: a member DIRECTLY ISSUED during the live epoch is
    // already in the rebuilt tree, so reinserting it would double-count it
    // (next_index/member_count inflation → quorum-inflation DoS). issue stamps
    // issued_at = now, which is >= epoch_started_at once the epoch has begun, so
    // reinsert must refuse it. (The confirm-during-epoch path is blocked by the
    // identical-seed EpochLeaf `init` collision exercised just above.)
    const cDuring = makeCommitment();
    await issue(circle, cDuring, anchor.web3.Keypair.generate().publicKey);
    threw = false;
    try { await reinsert(cDuring); } catch { threw = true; }
    assert.isTrue(threw, "a member issued DURING the current epoch cannot be reinserted (issued_at >= epoch_started_at)");
  });

  // --- F56: anchor publish + parentage rule --------------------------------
  it("publish_member_root anchors a genuine child; a foreign foundation is refused", async () => {
    const rootParent = anchor.web3.Keypair.generate().publicKey;
    const foundation = await initCircle(rootParent, "fed-found", 365 * 24 * 3600);
    const child = await initCircle(foundation, "fed-child", 365 * 24 * 3600);
    await issue(child, makeCommitment(), anchor.web3.Keypair.generate().publicKey);

    // The foundation must APPROVE the child before its root can be anchored.
    const fedChild = pda(Buffer.from("fedchild"), foundation.toBuffer(), child.toBuffer());
    await program.methods
      .approveFederationChild()
      .accounts({ foundation, circle: child, federationChild: fedChild, seat: seats[0].publicKey })
      .signers([seats[0]])
      .rpc();

    const anchorEntry = pda(Buffer.from("anchor"), foundation.toBuffer(), child.toBuffer());
    await program.methods
      .publishMemberRoot()
      .accounts({
        foundation,
        circle: child,
        federationChild: fedChild,
        memberTree: membersPda(child),
        recentRoots: null,
        anchorEntry,
        caller: payer.publicKey,
      })
      .rpc();
    const entry: any = await program.account.circleRootAnchor.fetch(anchorEntry);
    const tree: any = await program.account.memberTree.fetch(membersPda(child));
    assert.deepEqual(Buffer.from(entry.root), Buffer.from(tree.root), "anchored root == live root");

    // A self-seated foreign "foundation" cannot claim the child.
    const foreign = await initCircle(anchor.web3.Keypair.generate().publicKey, "fed-foreign", 365 * 24 * 3600);
    let threw = false;
    try {
      await program.methods
        .approveFederationChild()
        .accounts({ foundation: foreign, circle: child, federationChild: pda(Buffer.from("fedchild"), foreign.toBuffer(), child.toBuffer()), seat: seats[0].publicKey })
        .signers([seats[0]])
        .rpc();
    } catch { threw = true; }
    assert.isTrue(threw, "a foreign foundation cannot approve a child that doesn't name it as parent");
  });

  // --- F56: infiltration is refused without foundation approval -------------
  it("publish_member_root refuses an un-approved child (federation-infiltration fix)", async () => {
    const rootParent = anchor.web3.Keypair.generate().publicKey;
    const foundation = await initCircle(rootParent, "inf-found", 365 * 24 * 3600);
    // A rogue circle self-claims the real foundation as parent (permissionless).
    const rogue = await initCircle(foundation, "inf-rogue", 365 * 24 * 3600);
    await issue(rogue, makeCommitment(), anchor.web3.Keypair.generate().publicKey);

    // Parentage passes, but there is NO FederationChild approval — anchoring must fail.
    let threw = false;
    try {
      await program.methods
        .publishMemberRoot()
        .accounts({
          foundation,
          circle: rogue,
          federationChild: pda(Buffer.from("fedchild"), foundation.toBuffer(), rogue.toBuffer()),
          memberTree: membersPda(rogue),
          recentRoots: null,
          anchorEntry: pda(Buffer.from("anchor"), foundation.toBuffer(), rogue.toBuffer()),
          caller: payer.publicKey,
        })
        .rpc();
    } catch { threw = true; }
    assert.isTrue(threw, "a rogue self-claimed child with no foundation approval cannot be anchored");
  });

  // --- F56: the visit gate demands a real proof -----------------------------
  it("verify_fellow_member rejects a garbage proof against a genuine anchor", async () => {
    const rootParent = anchor.web3.Keypair.generate().publicKey;
    const foundation = await initCircle(rootParent, "vf-found", 365 * 24 * 3600);
    const home = await initCircle(foundation, "vf-home", 365 * 24 * 3600);
    const host = await initCircle(foundation, "vf-host", 365 * 24 * 3600);
    await issue(home, makeCommitment(), anchor.web3.Keypair.generate().publicKey);

    const fedChild = pda(Buffer.from("fedchild"), foundation.toBuffer(), home.toBuffer());
    await program.methods
      .approveFederationChild()
      .accounts({ foundation, circle: home, federationChild: fedChild, seat: seats[0].publicKey })
      .signers([seats[0]])
      .rpc();
    const anchorEntry = pda(Buffer.from("anchor"), foundation.toBuffer(), home.toBuffer());
    await program.methods
      .publishMemberRoot()
      .accounts({ foundation, circle: home, federationChild: fedChild, memberTree: membersPda(home), recentRoots: null, anchorEntry, caller: payer.publicKey })
      .rpc();

    const nullifier = makeCommitment();
    try {
      await program.methods
        .verifyFellowMember(
          [...nullifier],
          new Array(64).fill(0) as any,
          new Array(128).fill(0) as any,
          new Array(64).fill(0) as any
        )
        .accounts({
          foundation,
          homeCircle: home,
          hostCircle: host,
          anchorEntry,
          visitPass: pda(Buffer.from("visit"), host.toBuffer(), nullifier),
          payer: payer.publicKey,
        })
        .rpc();
      assert.fail("a garbage proof must not mint a VisitPass");
    } catch (e: any) {
      assert.include(String(e), "VoteProofInvalid", "refused at proof verification (anchor checks passed)");
    }
  });
});
