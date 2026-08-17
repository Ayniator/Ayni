import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Ayni } from "../target/types/ayni";
import { assert } from "chai";
import * as crypto from "crypto";
import { buildPoseidon } from "circomlibjs";

// Epic 0 — the gas faucet: first gas for the neophyte. No-ZK paths only (the
// jar, the Treasurer cap, the parrain-triggered one-shot grant, and the
// refill-vote guards); the fully passed anonymous-vote refill needs a real ZK
// ballot and is covered by the f28-style devnet flow (see tests/f28-election.ts).
describe("ayni — gas faucet (Epic 0)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Ayni as Program<Ayni>;
  const payer = provider.wallet as anchor.Wallet;
  // The parent is a REAL Circle, not a bare pubkey. Circle A has one member,
  // which is below MIN_ELECTORATE, so opening a member ballot there requires a
  // seat of the parent Circle to co-sign — the outside party a captured seat
  // cannot manufacture. Giving the parent its OWN distinct Council (below)
  // keeps that genuinely external rather than the same wallets wearing two hats.
  const grandparent = anchor.web3.Keypair.generate().publicKey;
  const parentName = "faucet-parent";
  const parentSeats = Array.from({ length: 7 }, () => anchor.web3.Keypair.generate());

  const nameA = "faucet-circle-a";
  const nameB = "faucet-circle-b";
  const ONE_YEAR = new anchor.BN(365 * 24 * 60 * 60);

  const DEFAULT_GRANT = 1_500_000; // FAUCET_DEFAULT_GRANT_LAMPORTS
  const CAP = 2_000_000; // FAUCET_MAX_GRANT_LAMPORTS

  // 7 distinct seats: [Treasurer, Secretary, RhythmKeeper, Elder N/E/S/W].
  const seats = Array.from({ length: 7 }, () => anchor.web3.Keypair.generate());
  const TREASURER = 0;
  const SECRETARY = 1;

  const stranger = anchor.web3.Keypair.generate(); // holds no seat, no membership

  // Members of circle A (wallet-bound, no ZK needed for these paths).
  const parrainOwner = anchor.web3.Keypair.generate();
  const neo1Owner = anchor.web3.Keypair.generate();
  const neo2Owner = anchor.web3.Keypair.generate();
  const neo3Owner = anchor.web3.Keypair.generate();
  const unsetGuardian = anchor.web3.Keypair.generate(); // guardian of the owner-less neophyte
  const imposterOwner = anchor.web3.Keypair.generate();

  // 32-byte stand-ins for Poseidon identity commitments (top bits cleared so
  // they are < the BN254 field modulus, as the other suites do).
  const makeCommitment = () => {
    const b = anchor.web3.Keypair.generate().publicKey.toBuffer();
    b[0] &= 0x1f;
    return b;
  };
  const cParrain = makeCommitment();
  const cNeo1 = makeCommitment();
  const cNeo2 = makeCommitment();
  const cNeo3 = makeCommitment();
  const cUnset = makeCommitment();
  const cImposter = makeCommitment();

  // F35-R2 — the wing's "tree of one".
  //
  // `activate_faucet_zk` no longer accepts a proof against the Circle's member
  // tree; it accepts one against the depth-20 root whose ONLY leaf is
  // `wing_peer.wing`. This is the JS mirror of `merkle::single_leaf_root`
  // (same zeros convention as `merkle.rs` and as the browser's
  // `MemberTree.create(20)`), so the tests can name the exact root the program
  // will compute — and, just as importantly, the roots it must REFUSE.
  let _poseidon: any = null;
  const singleLeafRoot = async (leaf: Buffer): Promise<Buffer> => {
    if (!_poseidon) _poseidon = await buildPoseidon();
    const F = _poseidon.F;
    const h2 = (a: bigint, b: bigint): bigint => F.toObject(_poseidon([a, b]));
    let cur = BigInt("0x" + Buffer.from(leaf).toString("hex"));
    let z = BigInt(0); // zeros[0]  (no `0n` literal: tsconfig targets ES6)
    for (let i = 0; i < 20; i++) {
      cur = h2(cur, z);
      z = h2(z, z); // zeros[i + 1]
    }
    return Buffer.from(cur.toString(16).padStart(64, "0"), "hex");
  };

  const pda = (...seeds: (Buffer | Uint8Array)[]) =>
    anchor.web3.PublicKey.findProgramAddressSync([...seeds] as Buffer[], program.programId)[0];

  const parent = pda(Buffer.from("circle"), grandparent.toBuffer(), Buffer.from(parentName));

  const circleA = pda(Buffer.from("circle"), parent.toBuffer(), Buffer.from(nameA));
  const circleB = pda(Buffer.from("circle"), parent.toBuffer(), Buffer.from(nameB));
  const memberTreeA = pda(Buffer.from("members"), circleA.toBuffer());
  const jarA = pda(Buffer.from("faucet"), circleA.toBuffer());
  const jarB = pda(Buffer.from("faucet"), circleB.toBuffer());
  const treasuryA = pda(Buffer.from("treasury"), circleA.toBuffer());
  const treasuryB = pda(Buffer.from("treasury"), circleB.toBuffer());
  const membershipPda = (commitment: Buffer) =>
    pda(Buffer.from("membership"), circleA.toBuffer(), commitment);
  const wingPeerPda = (menteeCommitment: Buffer) =>
    pda(Buffer.from("wingpeer"), circleA.toBuffer(), menteeCommitment);
  // Circle-scoped: one grant per membership commitment, per Circle.
  const grantNullifierPda = (neophyteCommitment: Buffer, circle = circleA) =>
    pda(Buffer.from("faucetnull"), circle.toBuffer(), neophyteCommitment);
  const proposalPda = (nonce: number) =>
    pda(Buffer.from("mproposal"), circleA.toBuffer(), new anchor.BN(nonce).toArrayLike(Buffer, "le", 8));
  const fillMarkerPda = (proposal: anchor.web3.PublicKey) =>
    pda(Buffer.from("faucetfill"), proposal.toBuffer());
  const configA = pda(Buffer.from("config"), circleA.toBuffer());

  // Canonical refill commitment, mirrored from refill_faucet.rs:
  // sha256("AHA-faucet-refill" || circle_pubkey || amount_le_8bytes).
  const refillHash = (circle: anchor.web3.PublicKey, amount: number | bigint) => {
    const le = Buffer.alloc(8);
    le.writeBigUInt64LE(BigInt(amount));
    return crypto
      .createHash("sha256")
      .update(Buffer.concat([Buffer.from("AHA-faucet-refill"), circle.toBuffer(), le]))
      .digest();
  };

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const balance = (pk: anchor.web3.PublicKey) => provider.connection.getBalance(pk);

  // Expect a send to fail; when `code` is given, assert the Anchor error code.
  const expectFail = async (p: Promise<any>, code?: string) => {
    try {
      await p;
    } catch (e: any) {
      if (code) {
        const s =
          (e?.error?.errorCode?.code ?? "") +
          " " +
          (e?.message ?? "") +
          " " +
          JSON.stringify(e?.logs ?? []);
        assert.include(s, code, `expected error ${code}`);
      }
      return;
    }
    assert.fail(`expected the transaction to fail${code ? ` with ${code}` : ""}`);
  };

  const noGuardians = [anchor.web3.PublicKey.default, anchor.web3.PublicKey.default];

  const issue = (commitment: Buffer, owner: anchor.web3.PublicKey, guardians = noGuardians) =>
    program.methods
      .issueMembership([...commitment], owner, guardians, false)
      .accounts({
        circle: circleA,
        membership: membershipPda(commitment),
        memberTree: memberTreeA,
        personhood: null,
        openMembership: null, // gated Circle: omit the marker explicitly
        twoSponsor: pda(Buffer.from("twosponsor"), circleA.toBuffer()),
        secretary: seats[SECRETARY].publicKey,
      })
      .signers([seats[SECRETARY]])
      .rpc();

  // The neophyte designates their parrain (wing) — signed by a key the neophyte holds.
  // F98 wired the karma accounts into establish_wing_peer; the award PDA is
  // seeded by the SORTED commitment pair (mirrors KarmaAward::lo/hi).
  const designateWing = (menteeCommitment: Buffer, signer: anchor.web3.Keypair) => {
    const [kLo, kHi] =
      Buffer.compare(menteeCommitment, cParrain) <= 0 ? [menteeCommitment, cParrain] : [cParrain, menteeCommitment];
    return program.methods
      .establishWingPeer()
      .accounts({
        circle: circleA,
        menteeMembership: membershipPda(menteeCommitment),
        wingMembership: membershipPda(cParrain),
        wingPeer: wingPeerPda(menteeCommitment),
        karmaParams: pda(Buffer.from("karmaparams"), circleA.toBuffer()),
        karmaAward: pda(Buffer.from("karmaaward"), circleA.toBuffer(), kLo, kHi),
        menteeKarma: pda(Buffer.from("karma"), circleA.toBuffer(), menteeCommitment),
        wingKarma: pda(Buffer.from("karma"), circleA.toBuffer(), cParrain),
        signer: signer.publicKey,
        payer: signer.publicKey,
      })
      .signers([signer])
      .rpc();
  };

  const activate = (
    neophyteCommitment: Buffer,
    parrainMembershipCommitment: Buffer,
    recipient: anchor.web3.PublicKey,
    signer: anchor.web3.Keypair
  ) =>
    program.methods
      .activateFaucet()
      .accounts({
        circle: circleA,
        parrainMembership: membershipPda(parrainMembershipCommitment),
        neophyteMembership: membershipPda(neophyteCommitment),
        wingPeer: wingPeerPda(neophyteCommitment),
        grantNullifier: grantNullifierPda(neophyteCommitment),
        jar: jarA,
        recipient,
        parrain: signer.publicKey,
      })
      .signers([signer])
      .rpc();

  // F35 → Epic 2: the ANONYMOUS activation path. Builds the instruction with a
  // caller-supplied root/nullifier/proof; the real-proof e2e lives with the
  // browser-ZK suite (tests/vote.ts), so what is exercised here is the gate
  // order, the shared one-shot, and the account SHAPE — which is the whole
  // Traditions point: no parrain account of any kind may appear.
  const activateZkIx = (
    neophyteCommitment: Buffer,
    recipient: anchor.web3.PublicKey,
    root: Buffer,
    recentRoots: anchor.web3.PublicKey | null = null
  ) =>
    program.methods
      .activateFaucetZk(
        [...root] as any,
        [...makeCommitment()] as any, // nullifier — the PROOF is what must match
        new Array(64).fill(0) as any,
        new Array(128).fill(0) as any,
        new Array(64).fill(0) as any
      )
      .accounts({
        circle: circleA,
        memberTree: memberTreeA,
        recentRoots,
        neophyteMembership: membershipPda(neophyteCommitment),
        wingPeer: wingPeerPda(neophyteCommitment),
        grantNullifier: grantNullifierPda(neophyteCommitment),
        jar: jarA,
        recipient,
        payer: payer.publicKey,
      });

  const transferTo = async (to: anchor.web3.PublicKey, lamports: number) => {
    const tx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: to, lamports })
    );
    await provider.sendAndConfirm(tx);
  };

  before(async () => {
    // Everyone who signs pays their own rent/fees, so fund them.
    const funded = [
      ...seats,
      ...parentSeats,
      stranger,
      parrainOwner,
      neo1Owner,
      neo2Owner,
      neo3Owner,
      unsetGuardian,
      imposterOwner,
    ];
    await Promise.all(
      funded.map(async (k) => {
        const sig = await provider.connection.requestAirdrop(k.publicKey, 1e9);
        await provider.connection.confirmTransaction(sig);
      })
    );

    // The parent Circle itself, with its own Council — it exists so circle A
    // (one member, below MIN_ELECTORATE) has an outside seat able to co-sign a
    // member ballot.
    await program.methods
      .initializeCircle(grandparent, parentName, ONE_YEAR, new anchor.BN(0), parentSeats.map((s) => s.publicKey))
      .accounts({ circle: parent, parent: grandparent, payer: payer.publicKey })
      .rpc();

    // Two circles under the same parent — the isolation fixture.
    await program.methods
      .initializeCircle(parent, nameA, ONE_YEAR, new anchor.BN(0), seats.map((s) => s.publicKey))
      .accounts({ circle: circleA, parent, payer: payer.publicKey })
      .rpc();
    await program.methods
      .initializeCircle(parent, nameB, ONE_YEAR, new anchor.BN(0), seats.map((s) => s.publicKey))
      .accounts({ circle: circleB, parent, payer: payer.publicKey })
      .rpc();
    await program.methods
      .initializeMemberTree(20)
      .accounts({ circle: circleA, memberTree: memberTreeA, seat: seats[0].publicKey })
      .signers([seats[0]])
      .rpc();

    // Circle A memberships: a parrain and their neophytes, an owner-less
    // neophyte (guardian-held), and an imposter member who sponsors no one.
    await issue(cParrain, parrainOwner.publicKey);
    await issue(cNeo1, neo1Owner.publicKey);
    await issue(cNeo2, neo2Owner.publicKey);
    await issue(cNeo3, neo3Owner.publicKey);
    await issue(cUnset, anchor.web3.PublicKey.default, [unsetGuardian.publicKey, anchor.web3.PublicKey.default]);
    await issue(cImposter, imposterOwner.publicKey);

    // Each neophyte designates the SAME parrain as their wing.
    await designateWing(cNeo1, neo1Owner);
    await designateWing(cNeo2, neo2Owner);
    await designateWing(cNeo3, neo3Owner);
    await designateWing(cUnset, unsetGuardian);
  });

  // --- 1. init_faucet ---------------------------------------------------------

  it("rejects init_faucet from a non-seat", async () => {
    await expectFail(
      program.methods
        .initFaucet()
        .accounts({ circle: circleA, jar: jarA, seat: stranger.publicKey })
        .signers([stranger])
        .rpc(),
      "NotCouncilSeat"
    );
  });

  it("lets any Council seat create the jar with the default grant", async () => {
    await program.methods
      .initFaucet()
      .accounts({ circle: circleA, jar: jarA, seat: seats[3].publicKey }) // an Elder, not a named servant
      .signers([seats[3]])
      .rpc();

    const jar = await program.account.faucetJar.fetch(jarA);
    assert.ok(jar.circle.equals(circleA));
    assert.equal(jar.grantLamports.toNumber(), DEFAULT_GRANT);
    assert.equal(jar.granted.toNumber(), 0);
  });

  // (set_faucet_amount tuning tests moved to the end — a successful amount
  // change stamps the cooldown clock, which must not precede the grant tests.)

  // --- 7 (runs before funding). Underfunded jar --------------------------------

  it("refuses a grant while the jar holds only its rent floor (FaucetInsufficient)", async () => {
    const jarBefore = await balance(jarA); // rent-exempt minimum only
    await expectFail(activate(cNeo1, cParrain, neo1Owner.publicKey, parrainOwner), "FaucetInsufficient");

    // The jar's rent floor was preserved and nothing was paid or counted.
    assert.equal(await balance(jarA), jarBefore, "jar untouched by the refused grant");
    const jar = await program.account.faucetJar.fetch(jarA);
    assert.equal(jar.granted.toNumber(), 0);
  });

  // --- 3. Happy path ----------------------------------------------------------

  it("pays the neophyte exactly one uniform grant, triggered by their parrain", async () => {
    // Anyone may top the jar up by plain transfer (donation).
    await transferTo(jarA, 10_000_000);

    const neoBefore = await balance(neo1Owner.publicKey);
    const jarBefore = await balance(jarA);

    await activate(cNeo1, cParrain, neo1Owner.publicKey, parrainOwner);

    assert.equal(
      (await balance(neo1Owner.publicKey)) - neoBefore,
      DEFAULT_GRANT,
      "neophyte received exactly grant_lamports"
    );
    assert.equal(jarBefore - (await balance(jarA)), DEFAULT_GRANT, "jar paid exactly grant_lamports");
    const jar = await program.account.faucetJar.fetch(jarA);
    assert.equal(jar.granted.toNumber(), 1);
  });

  // --- 4. One-shot ------------------------------------------------------------

  it("refuses a second grant for the same neophyte, ever (nullifier collision)", async () => {
    // The ["faucetnull", circle, commitment] PDA already exists — `init` IS the refusal.
    await expectFail(activate(cNeo1, cParrain, neo1Owner.publicKey, parrainOwner));
    const jar = await program.account.faucetJar.fetch(jarA);
    assert.equal(jar.granted.toNumber(), 1, "no second grant counted");
  });

  // --- 5. Only the parrain ----------------------------------------------------

  it("refuses activation by a member who is not the neophyte's wing (NotParrain)", async () => {
    // The imposter is a genuine member and signs with their OWN membership —
    // but the neophyte's WingPeer names the parrain, not them.
    await expectFail(activate(cNeo2, cImposter, neo2Owner.publicKey, imposterOwner), "NotParrain");
  });

  it("refuses activation by a Council seat who is not the wing", async () => {
    // A seat has no faucet power at all: it holds no key of the wing membership.
    await expectFail(activate(cNeo2, cParrain, neo2Owner.publicKey, seats[TREASURER]), "Unauthorized");
  });

  // --- 6. Recipient checks ----------------------------------------------------

  it("refuses a grant for a neophyte with no wallet bound (NeophyteWalletUnset)", async () => {
    await expectFail(activate(cUnset, cParrain, unsetGuardian.publicKey, parrainOwner), "NeophyteWalletUnset");
  });

  it("refuses paying any wallet other than the neophyte's own (WalletMismatch)", async () => {
    const elsewhere = anchor.web3.Keypair.generate().publicKey;
    await expectFail(activate(cNeo2, cParrain, elsewhere, parrainOwner), "WalletMismatch");
  });

  // --- 7. activate_faucet_zk — the anonymous path (F35 → Epic 2) --------------
  //
  // The Traditions fix: the grant no longer requires the parrain to sign, so the
  // transaction cannot publish "this wallet sponsors that neophyte".
  //
  // F35-R2 restores the OTHER half — mandatory sponsorship. The proof's `root`
  // must equal `single_leaf_root(wing_peer.wing)`, a value the PROGRAM computes,
  // so the only witness that can satisfy it is the wing's own secret. Every case
  // below except the last is refused at that gate, BEFORE any pairing work,
  // which is exactly why they can be pinned here with zero proof bytes: the root
  // argument alone decides them. The real-proof e2e (a genuine wing proof that
  // verifies) is the browser-ZK suite's job.
  //
  // THE EXCLUSIVITY RULE, restated because the whole fix depends on it: the wing
  // root REPLACES the member-tree / F54-ring gate and must never join it. If the
  // program ever accepted `member_tree.root || recent_roots || wing_root`, the
  // self-endorsement hole would be exactly as wide as before — a self-endorsing
  // neophyte would simply keep sending the tree root, which is precisely what
  // "refuses the CURRENT MEMBER TREE root" below submits.

  it("the anonymous activation names NO parrain — not a wallet, not a commitment", async () => {
    const treeRoot = Buffer.from(
      (await program.account.memberTree.fetch(memberTreeA)).root as any as number[]
    );
    const ix = await activateZkIx(cNeo2, neo2Owner.publicKey, treeRoot).instruction();
    const keys = ix.keys.map((k) => k.pubkey.toBase58());

    // The parrain's membership PDA, their commitment-derived accounts and their
    // wallet are all absent. The ONLY membership in the transaction is the
    // neophyte's, and the only signer is the fee-payer (a relayer in production).
    assert.notInclude(keys, membershipPda(cParrain).toBase58(), "no parrain membership account");
    assert.notInclude(keys, parrainOwner.publicKey.toBase58(), "no parrain wallet");
    assert.include(keys, membershipPda(cNeo2).toBase58(), "the neophyte's own membership is present");
    assert.equal(
      ix.keys.filter((k) => k.isSigner).length,
      1,
      "exactly one signer — the fee-payer, whose signature means only 'paid the fee'"
    );
    assert.isTrue(ix.keys[8].isSigner, "and it sits at the payer index the relay policy pins");
  });

  it("names the wing only ARITHMETICALLY — the F35-R2 disclosure, stated in a test", async () => {
    // Honest about what F35-R2 costs: `root` is now a deterministic public
    // function of the wing's commitment, so an observer can precompute it over
    // the commitment set and read the endorser off the transaction. The
    // commitment was already world-readable in `WingPeer` (which is in this
    // transaction anyway); what is new is that the act becomes a record.
    // The WALLET layer — the whole F35 win — is untouched, as the case above pins.
    const wingRoot = await singleLeafRoot(cParrain);
    const ix = await activateZkIx(cNeo2, neo2Owner.publicKey, wingRoot).instruction();
    assert.isTrue(
      ix.data.subarray(8, 40).equals(wingRoot),
      "the root argument IS single_leaf_root(wing) — the disclosure is real and deliberate"
    );
    assert.notInclude(
      ix.keys.map((k) => k.pubkey.toBase58()),
      membershipPda(cParrain).toBase58(),
      "and still no wing membership account"
    );
  });

  // --- 7a. MANDATORY SPONSORSHIP (F35-R2) — the regression this round closes ---

  it("REFUSES the current MEMBER TREE root — i.e. every proof the old path accepted", async () => {
    // This is the exclusivity case. Under F35-as-shipped this root was THE
    // accepted one, and any tree member could release any neophyte's grant.
    const treeRoot = Buffer.from(
      (await program.account.memberTree.fetch(memberTreeA)).root as any as number[]
    );
    const jarBefore = await balance(jarA);
    await expectFail(
      activateZkIx(cNeo2, neo2Owner.publicKey, treeRoot).rpc(),
      "EndorsementNotByWing"
    );
    assert.equal(await balance(jarA), jarBefore, "the jar paid nothing");
  });

  it("REFUSES a NON-WING member's endorsement (their own tree of one)", async () => {
    // cImposter is a full, tree-inserted member of this Circle — and is nobody's
    // wing. Even proving perfectly for themselves, they cannot release cNeo2's
    // first gas: the program computes the expected root from cNeo2's bond, and
    // that names cParrain.
    const imposterRoot = await singleLeafRoot(cImposter);
    const jarBefore = await balance(jarA);
    await expectFail(
      activateZkIx(cNeo2, neo2Owner.publicKey, imposterRoot).rpc(),
      "EndorsementNotByWing"
    );
    assert.equal(await balance(jarA), jarBefore, "the jar paid nothing");
  });

  it("REFUSES a SELF-ENDORSEMENT — the neophyte's own tree of one", async () => {
    // THE regression. `establish_wing_peer` refuses `mentee == wing`, so the
    // bond's wing can never be cNeo2 itself; `single_leaf_root` is injective
    // (pinned in proptests), so cNeo2's own root can never equal it.
    const selfRoot = await singleLeafRoot(cNeo2);
    const jarBefore = await balance(jarA);
    await expectFail(
      activateZkIx(cNeo2, neo2Owner.publicKey, selfRoot).rpc(),
      "EndorsementNotByWing"
    );
    assert.equal(await balance(jarA), jarBefore, "the jar paid nothing");
  });

  it("REFUSES a self-endorsement dressed as a tree proof (the same hole, other clothes)", async () => {
    // cNeo3 is in the member tree and holds their own secret; under the old gate
    // this exact submission was valid and paid. It is now refused at the root.
    const treeRoot = Buffer.from(
      (await program.account.memberTree.fetch(memberTreeA)).root as any as number[]
    );
    await expectFail(
      activateZkIx(cNeo3, neo3Owner.publicKey, treeRoot).rpc(),
      "EndorsementNotByWing"
    );
  });

  it("lets ONLY the wing's root reach the pairing (garbage proof ⇒ VoteProofInvalid)", async () => {
    // The positive half of the gate: with the wing's tree-of-one root the
    // instruction gets past `EndorsementNotByWing` and fails on the PROOF —
    // which is what proves the gate accepts the wing and only the wing. A real
    // wing proof verifying here is the browser-ZK suite's e2e.
    const wingRoot = await singleLeafRoot(cParrain);
    const jarBefore = await balance(jarA);
    await expectFail(activateZkIx(cNeo2, neo2Owner.publicKey, wingRoot).rpc(), "VoteProofInvalid");
    assert.equal(await balance(jarA), jarBefore, "the jar paid nothing");
  });

  // NOTE on the F54 ring: it is no longer consulted by this instruction at all,
  // and the two directions of that invariant are pinned elsewhere rather than
  // here (this suite never cranks `note_root`, so it has no RecentRoots account
  // to pass): the program cannot READ a ring root into the endorsement (the gate
  // is a single equality against `single_leaf_root(wing)` — see the tree-root
  // refusals above), and a wing-derived root must never be WRITTEN into the ring
  // (`merkle::single_leaf_root`'s doc invariant, plus the proptest
  // `wing_root_is_never_a_real_member_tree_root`). `attest_admission_zk`'s
  // soundness rests entirely on every ring entry being a genuine member-tree root.

  it("shares the one-shot with the named path — the two forms cannot be stacked", async () => {
    // cNeo1 already took its grant through `activate_faucet`; the SAME
    // ["faucetnull", circle, commitment] PDA refuses the anonymous form too,
    // at account validation, before the root gate.
    const wingRoot = await singleLeafRoot(cParrain);
    await expectFail(activateZkIx(cNeo1, neo1Owner.publicKey, wingRoot).rpc());
    const jar = await program.account.faucetJar.fetch(jarA);
    assert.equal(jar.granted.toNumber(), 1, "still exactly one grant for that neophyte");
  });

  it("still refuses a recipient that is not the neophyte's own wallet", async () => {
    const wingRoot = await singleLeafRoot(cParrain);
    const elsewhere = anchor.web3.Keypair.generate().publicKey;
    await expectFail(activateZkIx(cNeo2, elsewhere, wingRoot).rpc(), "WalletMismatch");
  });

  it("still refuses a neophyte with no wallet bound", async () => {
    const wingRoot = await singleLeafRoot(cParrain);
    await expectFail(
      activateZkIx(cUnset, unsetGuardian.publicKey, wingRoot).rpc(),
      "NeophyteWalletUnset"
    );
  });

  // --- 8. refill_faucet guards -------------------------------------------------

  it("refuses a refill from an unfinalized proposal", async () => {
    await transferTo(treasuryA, 5_000_000);

    const amount = 1_000_000;
    const nonce = 1;
    const proposal = proposalPda(nonce);
    // Even with the CORRECT canonical hash, an open (unfinalized) vote moves nothing.
    await program.methods
      .createMemberProposal(new anchor.BN(nonce), [...refillHash(circleA, amount)], new anchor.BN(3600))
      .accounts({
        circle: circleA, memberTree: memberTreeA, proposal, proposer: seats[0].publicKey,
        // Circle A has ONE member, below MIN_ELECTORATE, so a seat of the
        // parent Circle co-signs. parentSeats are distinct wallets from
        // seats, so this is a genuinely external second party.
        parentCircle: parent, parentSeat: parentSeats[0].publicKey,
      })
      .signers([seats[0], parentSeats[0]])
      .rpc();

    const treasuryBefore = await balance(treasuryA);
    const jarBefore = await balance(jarA);
    await expectFail(
      program.methods
        .refillFaucet(new anchor.BN(amount))
        .accounts({
          circle: circleA,
          proposal,
          fillMarker: fillMarkerPda(proposal),
          treasury: treasuryA,
          jar: jarA,
          caller: payer.publicKey,
        })
        .rpc(),
      "ThresholdNotMet"
    );
    assert.equal(await balance(treasuryA), treasuryBefore, "treasury untouched");
    assert.equal(await balance(jarA), jarBefore, "jar untouched");
  });

  it("refuses a refill whose proposal did not commit to the canonical refill hash", async () => {
    const amount = 1_000_000;
    const nonce = 2;
    const proposal = proposalPda(nonce);
    // A finalized proposal carrying an UNRELATED description hash.
    await program.methods
      .createMemberProposal(new anchor.BN(nonce), [...Buffer.alloc(32, 9)], new anchor.BN(1))
      .accounts({
        circle: circleA, memberTree: memberTreeA, proposal, proposer: seats[0].publicKey,
        // Circle A has ONE member, below MIN_ELECTORATE, so a seat of the
        // parent Circle co-signs. parentSeats are distinct wallets from
        // seats, so this is a genuinely external second party.
        parentCircle: parent, parentSeat: parentSeats[0].publicKey,
      })
      .signers([seats[0], parentSeats[0]])
      .rpc();
    await sleep(2000);
    await program.methods
      .finalizeMemberProposal()
      .accounts({ proposal, config: configA, finalizer: payer.publicKey })
      .rpc();
    const p = await program.account.memberProposal.fetch(proposal);
    assert.isTrue(p.finalized);

    const treasuryBefore = await balance(treasuryA);
    const jarBefore = await balance(jarA);
    // NOTE on the observed code: without ballots this zero-turnout proposal is
    // finalized but NOT passed, so the program's first guard (finalized && passed
    // → ThresholdNotMet) fires before the hash comparison. Exercising the
    // WrongProposalAction branch itself — a genuinely PASSED vote whose
    // description_hash mismatches — requires a real anonymous ZK ballot.
    // TODO: covered by the f28-style devnet flow (tests/f28-election.ts): run
    // create_member_proposal with refillHash(circle, amount) → cast_vote (real
    // Groth16 ballot) → finalize → refill_faucet, and its wrong-hash twin.
    await expectFail(
      program.methods
        .refillFaucet(new anchor.BN(amount))
        .accounts({
          circle: circleA,
          proposal,
          fillMarker: fillMarkerPda(proposal),
          treasury: treasuryA,
          jar: jarA,
          caller: payer.publicKey,
        })
        .rpc()
    );
    assert.equal(await balance(treasuryA), treasuryBefore, "treasury untouched");
    assert.equal(await balance(jarA), jarBefore, "jar untouched");
  });

  // --- 9. Jar isolation --------------------------------------------------------

  it("keeps a circle A grant away from circle B's jar and both treasuries", async () => {
    // Circle B gets its own funded jar; both treasuries hold funds.
    await program.methods
      .initFaucet()
      .accounts({ circle: circleB, jar: jarB, seat: seats[0].publicKey })
      .signers([seats[0]])
      .rpc();
    await transferTo(jarB, 3_000_000);
    await transferTo(treasuryB, 5_000_000);

    const jarBBefore = await balance(jarB);
    const treasuryABefore = await balance(treasuryA);
    const treasuryBBefore = await balance(treasuryB);
    const jarABefore = await balance(jarA);
    const neoBefore = await balance(neo3Owner.publicKey);

    await activate(cNeo3, cParrain, neo3Owner.publicKey, parrainOwner);

    assert.equal((await balance(neo3Owner.publicKey)) - neoBefore, DEFAULT_GRANT);
    assert.equal(jarABefore - (await balance(jarA)), DEFAULT_GRANT, "only circle A's jar paid");
    assert.equal(await balance(jarB), jarBBefore, "circle B's jar untouched");
    assert.equal(await balance(treasuryA), treasuryABefore, "circle A treasury untouched");
    assert.equal(await balance(treasuryB), treasuryBBefore, "circle B treasury untouched");
  });

  // --- 2. set_faucet_amount ---------------------------------------------------

  it("lets the Treasurer tune the grant within the cap — and only the Treasurer, only within it", async () => {
    // Treasurer, at the cap: allowed.
    await program.methods
      .setFaucetAmount(new anchor.BN(CAP))
      .accounts({ circle: circleA, jar: jarA, treasurer: seats[TREASURER].publicKey })
      .signers([seats[TREASURER]])
      .rpc();
    const jar = await program.account.faucetJar.fetch(jarA);
    assert.equal(jar.grantLamports.toNumber(), CAP);

    // One lamport above the absolute on-chain maximum: refused by the program.
    await expectFail(
      program.methods
        .setFaucetAmount(new anchor.BN(CAP + 1))
        .accounts({ circle: circleA, jar: jarA, treasurer: seats[TREASURER].publicKey })
        .signers([seats[TREASURER]])
        .rpc(),
      "FaucetCapExceeded"
    );

    // Zero: also refused (0 < lamports <= cap).
    await expectFail(
      program.methods
        .setFaucetAmount(new anchor.BN(0))
        .accounts({ circle: circleA, jar: jarA, treasurer: seats[TREASURER].publicKey })
        .signers([seats[TREASURER]])
        .rpc(),
      "FaucetCapExceeded"
    );

    // A non-Treasurer seat: refused.
    await expectFail(
      program.methods
        .setFaucetAmount(new anchor.BN(1_000_000))
        .accounts({ circle: circleA, jar: jarA, treasurer: seats[SECRETARY].publicKey })
        .signers([seats[SECRETARY]])
        .rpc(),
      "Unauthorized"
    );

    // A non-seat: refused.
    await expectFail(
      program.methods
        .setFaucetAmount(new anchor.BN(1_000_000))
        .accounts({ circle: circleA, jar: jarA, treasurer: stranger.publicKey })
        .signers([stranger])
        .rpc(),
      "Unauthorized"
    );
  });

  // --- 10. Grant uniformity is enforced, not merely intended -------------------
  //
  // Runs LAST on purpose: the retune below freezes circle A's jar for the
  // cooldown, so any activation after this point is expected to fail.

  it("stops a Treasurer from aiming a distinctive amount at one neophyte", async () => {
    // The attack: set a unique value, let the target's parrain activate, restore
    // it — the target's wallet now carries a correlatable incoming amount that
    // singles them out on the public chain. The cooldown is what prevents it.
    const distinctive = DEFAULT_GRANT - 3; // 1_499_997 — unmistakable on-chain
    await program.methods
      .setFaucetAmount(new anchor.BN(distinctive))
      .accounts({ circle: circleA, jar: jarA, treasurer: seats[TREASURER].publicKey })
      .signers([seats[TREASURER]])
      .rpc();

    const jar = await program.account.faucetJar.fetch(jarA);
    assert.equal(jar.grantLamports.toNumber(), distinctive);
    assert.isAbove(jar.amountChangedAt.toNumber(), 0, "the retune was stamped");

    // cNeo2 is a real neophyte of this parrain who has never been granted.
    await expectFail(
      activate(cNeo2, cParrain, neo2Owner.publicKey, parrainOwner),
      "FaucetAmountCooling"
    );

    // Re-submitting the SAME amount must not re-arm the cooldown, or a Treasurer
    // could stall the faucet indefinitely by resubmitting the current value.
    await program.methods
      .setFaucetAmount(new anchor.BN(distinctive))
      .accounts({ circle: circleA, jar: jarA, treasurer: seats[TREASURER].publicKey })
      .signers([seats[TREASURER]])
      .rpc();
    const again = await program.account.faucetJar.fetch(jarA);
    assert.equal(
      again.amountChangedAt.toNumber(),
      jar.amountChangedAt.toNumber(),
      "a no-op rewrite left the cooldown stamp alone"
    );
  });

  // NOT COVERED HERE — needs a real Groth16 ballot, so it belongs to the
  // devnet flow in tests/f28-election.ts:
  //   * refill_faucet's on-chain ceiling (FaucetRefillTooLarge, amount >
  //     grant_lamports * FAUCET_MAX_REFILL_GRANTS). The ceiling is checked only
  //     after `finalized && passed`, and a proposal cannot pass without real
  //     anonymous votes, so no no-ZK test can reach that branch.
  //   * the happy-path refill (treasury → jar) and its one-shot fill marker.
});
