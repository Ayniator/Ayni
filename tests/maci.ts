// F39 — MACI processing & tally, end to end on chain.
//
// Walks a whole round: ZK sign-up (commit–reveal), sealed commands including a
// key change that voids a coerced ballot, the permissionless freeze, the
// permissionless message-chain crank, the coordinator's committed tally, and
// the outcome landing on the member proposal under the SAME quorum/pass math
// the plain ballot uses.
//
// Needs the compiled member_vote circuit + ceremony key (build/), like tests/vote.ts.

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Ayni } from "../target/types/ayni";
import { assert } from "chai";
import * as fs from "fs";
import * as path from "path";
import nacl from "tweetnacl";
import { MemberTree, proveVote, to32BE } from "../app/voting/prove";
import {
  MACI_VOTE_NO,
  MACI_VOTE_YES,
  applyMaciQueue,
  coordinatorTally,
  encodeMaciCommand,
  hexOf,
  maciChainDigest,
  maciOutcome,
  maciSignupCommitment,
  maciSignupDigest,
  maciSignupExternalNullifier,
  padMaciCommand,
  sealMaciCommand,
} from "../frontend/lib/maci-command";

const g = globalThis as any;
if (!g.crypto || !g.crypto.subtle) g.crypto = require("crypto").webcrypto;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const beToBigint = (b: Uint8Array): bigint => {
  let v = 0n;
  for (const x of Array.from(b)) v = (v << 8n) | BigInt(x);
  return v;
};

describe("ayni — MACI processing & tally (F39)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Ayni as Program<Ayni>;
  const payer = provider.wallet as anchor.Wallet;
  const parent = anchor.web3.Keypair.generate().publicKey;
  const name = "maci-circle";
  const SECRETARY = 1;
  const VOTING_PERIOD = 45; // seconds — long enough to sign up, short enough to test

  const seats = Array.from({ length: 7 }, () => anchor.web3.Keypair.generate());
  const coordinatorBox = nacl.box.keyPair(); // the coordinator's decryption key
  const voters = [nacl.sign.keyPair(), nacl.sign.keyPair(), nacl.sign.keyPair()];

  const [circlePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("circle"), parent.toBuffer(), Buffer.from(name)],
    program.programId
  );
  const [memberTreePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("members"), circlePda.toBuffer()],
    program.programId
  );
  const PROPOSAL_NONCE = 39;
  const [proposalPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("mproposal"), circlePda.toBuffer(), new anchor.BN(PROPOSAL_NONCE).toArrayLike(Buffer, "le", 8)],
    program.programId
  );
  const [roundPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("maci"), proposalPda.toBuffer()],
    program.programId
  );
  const [statePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("macistate"), roundPda.toBuffer()],
    program.programId
  );
  const msgPda = (i: number) =>
    anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("macimsg"), roundPda.toBuffer(), new anchor.BN(i).toArrayLike(Buffer, "le", 8)],
      program.programId
    )[0];
  const signupPda = (pk: Uint8Array) =>
    anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("macisignup"), roundPda.toBuffer(), Buffer.from(pk)],
      program.programId
    )[0];

  const secrets = [111222333444555n, 222333444555666n, 333444555666777n];
  let tree: MemberTree;
  const leafIndex: number[] = [];
  const proofs: any[] = [];
  const published: { index: number; ephPubkey: Uint8Array; ciphertext: Uint8Array }[] = [];
  const plaintexts: Uint8Array[] = [];

  before(async () => {
    await Promise.all(
      seats.map(async (s) => {
        const sig = await provider.connection.requestAirdrop(s.publicKey, 2e9);
        await provider.connection.confirmTransaction(sig);
      })
    );
  });

  it("sets up a Circle with three members and a proposal", async () => {
    await program.methods
      .initializeCircle(parent, name, new anchor.BN(365 * 24 * 60 * 60), new anchor.BN(0), seats.map((s) => s.publicKey))
      .accounts({ circle: circlePda, parent, payer: payer.publicKey })
      .rpc();
    await program.methods
      .initializeMemberTree(20)
      .accounts({ circle: circlePda, memberTree: memberTreePda, seat: seats[0].publicKey })
      .signers([seats[0]])
      .rpc();

    tree = await MemberTree.create(20);
    for (const s of secrets) {
      const commitment = tree.h1(s);
      leafIndex.push(tree.insert(commitment));
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
          twoSponsor: anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("twosponsor"), circlePda.toBuffer()], program.programId)[0],
          secretary: seats[SECRETARY].publicKey,
        })
        .signers([seats[SECRETARY]])
        .rpc();
    }

    const mt = await program.account.memberTree.fetch(memberTreePda);
    assert.equal(Buffer.from(mt.root).toString("hex"), Buffer.from(to32BE(tree.root)).toString("hex"));

    // Proofs are generated BEFORE the round opens: the round PDA is
    // deterministic, so the sign-up external nullifier is known in advance and
    // the (slow) proving never eats into the voting window.
    const externalNullifier = beToBigint(await maciSignupExternalNullifier(roundPda.toBytes()));
    for (let i = 0; i < secrets.length; i++) {
      proofs.push(await proveVote(tree, secrets[i], leafIndex[i], externalNullifier, true));
    }

    await program.methods
      .createMemberProposal(new anchor.BN(PROPOSAL_NONCE), [...Buffer.alloc(32, 39)], new anchor.BN(VOTING_PERIOD))
      .accounts({ circle: circlePda, memberTree: memberTreePda, proposal: proposalPda, proposer: seats[0].publicKey })
      .signers([seats[0]])
      .rpc();
  });

  it("opens a round and takes the proposal off the plain ballot path", async () => {
    await program.methods
      .openMaciRound([...coordinatorBox.publicKey], new anchor.BN(0)) // 0s dispute window so the test can finalize
      .accounts({
        circle: circlePda,
        proposal: proposalPda,
        round: roundPda,
        state: statePda,
        seat: seats[0].publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([seats[0]])
      .rpc();

    const st: any = await (program.account as any).maciState.fetch(statePda);
    assert.equal(st.stage, 0, "stage OPEN");
    assert.equal(st.signupCount.toNumber(), 0);
    assert.equal(st.coordinatorAuthority.toBase58(), seats[0].publicKey.toBase58());

    // The proposal is now MACI-only: the plain ballot path refuses it, so the
    // two tallies can never be double-counted or raced against each other.
    const p = await program.account.memberProposal.fetch(proposalPda);
    assert.isTrue(p.finalized, "plain finalize/cast_vote are closed out");
    assert.isFalse(p.passed);

    let threw = false;
    try {
      const [vn] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vote_nullifier"), proposalPda.toBuffer(), Buffer.from(proofs[0].nullifier)],
        program.programId
      );
      await program.methods
        .castVote(true, proofs[0].nullifier, proofs[0].proofA, proofs[0].proofB, proofs[0].proofC)
        .accounts({ proposal: proposalPda, voteNullifier: vn, payer: payer.publicKey })
        .rpc();
    } catch {
      threw = true;
    }
    assert.isTrue(threw, "cast_vote must refuse a proposal that is under MACI");
  });

  it("registers three voices by ZK sign-up (commit–reveal)", async () => {
    const commitments: Uint8Array[] = [];
    for (let i = 0; i < voters.length; i++) {
      const c = await maciSignupCommitment(
        roundPda.toBytes(),
        Uint8Array.from(proofs[i].nullifier),
        voters[i].publicKey
      );
      commitments.push(c);
      await program.methods
        .maciSignupCommit([...c])
        .accounts({
          round: roundPda,
          state: statePda,
          commit: anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("macicommit"), roundPda.toBuffer(), Buffer.from(c)],
            program.programId
          )[0],
          payer: payer.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    }

    await sleep(1200); // the reveal must land in a strictly later slot

    for (let i = 0; i < voters.length; i++) {
      const nullifier = Uint8Array.from(proofs[i].nullifier);
      await program.methods
        .maciSignup([...voters[i].publicKey], proofs[i].nullifier, proofs[i].proofA, proofs[i].proofB, proofs[i].proofC)
        .accounts({
          round: roundPda,
          state: statePda,
          proposal: proposalPda,
          commit: anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("macicommit"), roundPda.toBuffer(), Buffer.from(commitments[i])],
            program.programId
          )[0],
          signupNullifier: anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("macinull"), roundPda.toBuffer(), Buffer.from(nullifier)],
            program.programId
          )[0],
          signup: signupPda(voters[i].publicKey),
          payer: payer.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    }

    const st: any = await (program.account as any).maciState.fetch(statePda);
    assert.equal(st.signupCount.toNumber(), 3);
    const expected = await maciSignupDigest(voters.map((v, i) => ({ pubkey: v.publicKey, index: i })));
    assert.equal(hexOf(Uint8Array.from(st.signupDigest)), hexOf(expected), "electorate digest matches");
  });

  it("refuses a second sign-up from the same member (one member, one voice)", async () => {
    const extra = nacl.sign.keyPair();
    const nullifier = Uint8Array.from(proofs[0].nullifier);
    const c = await maciSignupCommitment(roundPda.toBytes(), nullifier, extra.publicKey);
    await program.methods
      .maciSignupCommit([...c])
      .accounts({
        round: roundPda,
        state: statePda,
        commit: anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("macicommit"), roundPda.toBuffer(), Buffer.from(c)], program.programId)[0],
        payer: payer.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    await sleep(1200);

    let threw = false;
    try {
      await program.methods
        .maciSignup([...extra.publicKey], proofs[0].nullifier, proofs[0].proofA, proofs[0].proofB, proofs[0].proofC)
        .accounts({
          round: roundPda,
          state: statePda,
          proposal: proposalPda,
          commit: anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("macicommit"), roundPda.toBuffer(), Buffer.from(c)], program.programId)[0],
          signupNullifier: anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("macinull"), roundPda.toBuffer(), Buffer.from(nullifier)], program.programId)[0],
          signup: signupPda(extra.publicKey),
          payer: payer.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    } catch {
      threw = true;
    }
    assert.isTrue(threw, "the sign-up nullifier PDA already exists");
  });

  it("refuses a reveal whose key does not match its commitment (front-running guard)", async () => {
    const honest = nacl.sign.keyPair();
    const attacker = nacl.sign.keyPair();
    // A nullifier nobody has spent, so the ONLY thing that can refuse the reveal
    // is the commitment binding (the proof would fail later, but never gets there).
    const nullifier = new Uint8Array(32);
    nullifier.set([0x1f, 0x39, 0x39, 0x39]);
    const c = await maciSignupCommitment(roundPda.toBytes(), nullifier, honest.publicKey);
    const commitPda = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("macicommit"), roundPda.toBuffer(), Buffer.from(c)],
      program.programId
    )[0];
    await program.methods
      .maciSignupCommit([...c])
      .accounts({ round: roundPda, state: statePda, commit: commitPda, payer: payer.publicKey, systemProgram: anchor.web3.SystemProgram.programId })
      .rpc();
    await sleep(1200);

    let msg = "";
    try {
      await program.methods
        .maciSignup([...attacker.publicKey], [...nullifier], proofs[1].proofA, proofs[1].proofB, proofs[1].proofC)
        .accounts({
          round: roundPda,
          state: statePda,
          proposal: proposalPda,
          commit: commitPda,
          signupNullifier: anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("macinull"), roundPda.toBuffer(), Buffer.from(nullifier)], program.programId)[0],
          signup: signupPda(attacker.publicKey),
          payer: payer.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    } catch (e: any) {
      msg = String(e);
    }
    assert.include(msg, "MaciSignupMismatch", "a stolen proof cannot be re-aimed at another key");
  });

  it("publishes sealed commands, including a key change that voids a coerced ballot", async () => {
    // Voter 0: votes NO, then changes key and votes YES  → YES.
    // Voter 1: votes YES                                  → YES.
    // Voter 2: changes key and votes NO, then is coerced into a YES signed with
    //          the surrendered key                        → NO (the coerced one dies).
    const v0next = nacl.sign.keyPair();
    const v2next = nacl.sign.keyPair();
    const round = roundPda.toBytes();

    const commands: Uint8Array[] = [
      encodeMaciCommand({ stateKey: voters[0].publicKey, newKey: voters[0].publicKey, nonce: 1, vote: MACI_VOTE_NO }, round, voters[0].secretKey),
      encodeMaciCommand({ stateKey: voters[2].publicKey, newKey: v2next.publicKey, nonce: 1, vote: MACI_VOTE_NO }, round, voters[2].secretKey),
      encodeMaciCommand({ stateKey: voters[1].publicKey, newKey: voters[1].publicKey, nonce: 1, vote: MACI_VOTE_YES }, round, voters[1].secretKey),
      encodeMaciCommand({ stateKey: voters[2].publicKey, newKey: voters[2].publicKey, nonce: 2, vote: MACI_VOTE_YES }, round, voters[2].secretKey), // coerced, dead key
      encodeMaciCommand({ stateKey: voters[0].publicKey, newKey: v0next.publicKey, nonce: 2, vote: MACI_VOTE_YES }, round, voters[0].secretKey),
    ];

    for (let i = 0; i < commands.length; i++) {
      const padded = padMaciCommand(commands[i]);
      plaintexts.push(padded);
      const sealed = sealMaciCommand(padded, coordinatorBox.publicKey);
      await program.methods
        .publishMaciMessage([...sealed.ephPubkey], Buffer.from(sealed.ciphertext))
        .accounts({ round: roundPda, message: msgPda(i), payer: payer.publicKey, systemProgram: anchor.web3.SystemProgram.programId })
        .rpc();
      published.push({ index: i, ephPubkey: sealed.ephPubkey, ciphertext: sealed.ciphertext });
    }

    const r: any = await (program.account as any).maciRound.fetch(roundPda);
    assert.equal(r.messageCount.toNumber(), commands.length);
    assert.isFalse(r.processed, "the queue is still open");

    // Nothing on chain distinguishes the key change from an ordinary vote.
    const sizes = new Set(published.map((m) => m.ciphertext.length));
    assert.equal(sizes.size, 1, "every sealed command is the same size");
  });

  it("refuses to close before the deadline, then freezes the queue", async () => {
    let threw = false;
    try {
      await program.methods.closeMaciRound().accounts({ round: roundPda, state: statePda, caller: payer.publicKey }).rpc();
    } catch {
      threw = true;
    }
    assert.isTrue(threw, "nobody can shut the queue early to censor a late override");

    const p = await program.account.memberProposal.fetch(proposalPda);
    const now = Math.floor(Date.now() / 1000);
    const wait = Math.max(0, p.deadline.toNumber() - now) + 2;
    await sleep(wait * 1000);

    await program.methods.closeMaciRound().accounts({ round: roundPda, state: statePda, caller: payer.publicKey }).rpc();

    const st: any = await (program.account as any).maciState.fetch(statePda);
    assert.equal(st.stage, 1, "stage CLOSED");
    assert.equal(st.frozenMessageCount.toNumber(), published.length);

    // Late messages are refused — the frozen set is the tallied set.
    let late = false;
    try {
      const sealed = sealMaciCommand(padMaciCommand(new Uint8Array(32)), coordinatorBox.publicKey);
      await program.methods
        .publishMaciMessage([...sealed.ephPubkey], Buffer.from(sealed.ciphertext))
        .accounts({ round: roundPda, message: msgPda(published.length), payer: payer.publicKey, systemProgram: anchor.web3.SystemProgram.programId })
        .rpc();
    } catch {
      late = true;
    }
    assert.isTrue(late, "the queue is frozen");
  });

  it("folds the queue on chain, in order, with no replay and no skipping", async () => {
    const crank = (indices: number[]) =>
      program.methods
        .processMaciMessages(indices.length)
        .accounts({ round: roundPda, state: statePda, caller: payer.publicKey })
        .remainingAccounts(indices.map((i) => ({ pubkey: msgPda(i), isSigner: false, isWritable: false })))
        .rpc();

    // Out of order is rejected.
    let threw = false;
    try {
      await crank([1, 0]);
    } catch {
      threw = true;
    }
    assert.isTrue(threw, "a crank cannot reorder the queue");

    // Skipping ahead is rejected.
    threw = false;
    try {
      await crank([2, 3]);
    } catch {
      threw = true;
    }
    assert.isTrue(threw, "a crank cannot skip a message");

    // Two honest batches.
    await crank([0, 1]);
    let st: any = await (program.account as any).maciState.fetch(statePda);
    assert.equal(st.processedCount.toNumber(), 2);

    // Replaying the batch just folded is rejected.
    threw = false;
    try {
      await crank([0, 1]);
    } catch {
      threw = true;
    }
    assert.isTrue(threw, "a processed message cannot be processed twice");

    await crank([2, 3, 4]);
    st = await (program.account as any).maciState.fetch(statePda);
    assert.equal(st.processedCount.toNumber(), published.length);
    assert.equal(st.stage, 2, "stage PROCESSED");

    // Nothing more can be folded.
    threw = false;
    try {
      await crank([0]);
    } catch {
      threw = true;
    }
    assert.isTrue(threw);

    // The digest the PROGRAM folded matches the one anyone recomputes from the
    // public message accounts — this is the anti-censorship anchor.
    const expected = await maciChainDigest(roundPda.toBytes(), published);
    assert.equal(hexOf(Uint8Array.from(st.chainDigest)), hexOf(expected));
  });

  it("computes the tally off chain — the coerced YES is overridden by the key change", async () => {
    const signups = voters.map((v, i) => ({ pubkey: v.publicKey, index: i }));
    const tally = await coordinatorTally(roundPda.toBytes(), signups, published, coordinatorBox.secretKey);
    assert.deepEqual([tally.yes, tally.no], [2, 1], "the coerced YES was overridden by a key change");

    // An independent replay of the decrypted queue — an auditor's exact
    // procedure — reaches the same numbers.
    const replay = applyMaciQueue(
      signups,
      plaintexts.map((p, i) => ({ index: i, command: p.slice(2, 2 + ((p[0] << 8) | p[1])) })),
      roundPda.toBytes()
    );
    assert.deepEqual([replay.yes, replay.no], [tally.yes, tally.no]);

    // ...and the policy math the round WOULD apply is the plain ballot's.
    const p = await program.account.memberProposal.fetch(proposalPda);
    assert.isTrue(maciOutcome(tally.yes, tally.no, p.eligibleCount.toNumber(), 0, 0, 0, 0));

    // Sanity: the sealed queue really is what the chain folded.
    const st: any = await (program.account as any).maciState.fetch(statePda);
    assert.equal(
      hexOf(Uint8Array.from(st.chainDigest)),
      hexOf(await maciChainDigest(roundPda.toBytes(), published))
    );
    assert.equal(
      hexOf(Uint8Array.from(st.signupDigest)),
      hexOf(await maciSignupDigest(signups))
    );
  });

  it("REFUSES to record that tally on chain — the two consequential instructions are disabled", async () => {
    // Sentinel NRR-2026-08-12-f60-f61-maci (CRITICAL). The chain cannot verify a
    // MACI tally (no process/tally circuits — F44), so neither `commit_maci_tally`
    // nor `finalize_maci_round` may execute. This test is the tripwire: delete
    // either guard and it fails.
    const signups = voters.map((v, i) => ({ pubkey: v.publicKey, index: i }));
    const tally = await coordinatorTally(roundPda.toBytes(), signups, published, coordinatorBox.secretKey);

    let msg = "";
    try {
      await program.methods
        .commitMaciTally(new anchor.BN(tally.yes), new anchor.BN(tally.no), [...tally.plaintextDigest])
        .accounts({ round: roundPda, state: statePda, coordinator: seats[0].publicKey })
        .signers([seats[0]])
        .rpc();
    } catch (e: any) {
      msg = String(e);
    }
    assert.include(msg, "MaciTallyUnverified", "commit_maci_tally must stay disabled");

    msg = "";
    try {
      await program.methods
        .finalizeMaciRound()
        .accounts({
          round: roundPda,
          state: statePda,
          proposal: proposalPda,
          config: anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("config"), circlePda.toBuffer()], program.programId)[0],
          finalizer: payer.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    } catch (e: any) {
      msg = String(e);
    }
    assert.include(msg, "MaciTallyUnverified", "finalize_maci_round must stay disabled");

    // Nothing moved: no tally recorded, and above all no consequence reachable.
    const st: any = await (program.account as any).maciState.fetch(statePda);
    assert.equal(st.stage, 2, "the round stops at PROCESSED");
    assert.equal(st.tallyYes.toNumber(), 0);
    assert.equal(st.tallyNo.toNumber(), 0);
    assert.isFalse(st.passed);

    const r: any = await (program.account as any).maciRound.fetch(roundPda);
    assert.equal(hexOf(Uint8Array.from(r.tallyHash)), hexOf(new Uint8Array(32)), "no tally hash was written");

    const p = await program.account.memberProposal.fetch(proposalPda);
    assert.isFalse(p.passed, "install_elected_seat / refill_faucet stay fail-closed");
    assert.isTrue(p.finalized);
    assert.equal(p.yes.toNumber(), 0);
    assert.equal(p.no.toNumber(), 0);
  });

  it("pins both guards in the source (they may not be quietly deleted)", () => {
    const read = (f: string) =>
      fs.readFileSync(path.join(__dirname, "..", "programs", "ayni", "src", "instructions", f), "utf8");

    for (const f of ["commit_maci_tally.rs", "finalize_maci_round.rs"]) {
      assert.include(
        read(f),
        "return Err(AyniError::MaciTallyUnverified.into());",
        `${f} must refuse to execute until a ZK-verified tally ships (F44)`
      );
    }

    // The structural half of the fix: finalize_maci_round must never write the
    // proposal's outcome field, even if the guard above is one day removed.
    const finalize = read("finalize_maci_round.rs");
    assert.notInclude(finalize, "p.passed = ", "a MACI outcome must not reach MemberProposal.passed");
    assert.notInclude(finalize, "proposal.passed =", "a MACI outcome must not reach MemberProposal.passed");
  });
});
