// F28 end-to-end: a REAL anonymous Groth16 ballot elects and installs a Council
// seat against the deployed devnet program. Proves create_member_proposal →
// link_seat_election → cast_vote (real VK) → finalize → install_elected_seat.
//
// Run (uses ~/.config/solana/aha-deployer.json as Secretary; needs build/ ZK
// artifacts + frontend/lib/ayni.json):
//   RPC_URL=<devnet rpc> node_modules/.bin/ts-node \
//     --compiler-options '{"module":"commonjs","target":"es2020","esModuleInterop":true}' \
//     tests/f28-election.ts
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";
import * as crypto from "crypto";
import { MemberTree, proveVote, to32BE } from "../app/voting/prove";
const enc = (s: string) => Buffer.from(s);
const eh = (seat: number, cand: PublicKey) => crypto.createHash("sha256").update(Buffer.concat([enc("AHA-elect"), Buffer.from([seat]), cand.toBuffer()])).digest();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: any[]) => { console.log(a.join(" ")); };
(async () => {
  const idl = JSON.parse(fs.readFileSync("frontend/lib/ayni.json", "utf8"));
  const conn = new Connection(process.env.RPC_URL || "https://api.devnet.solana.com", "confirmed");
  const dep = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.HOME + "/.config/solana/aha-deployer.json", "utf8"))));
  const program: any = new anchor.Program(idl, new anchor.AnchorProvider(conn, new anchor.Wallet(dep), { commitment: "confirmed" }));
  const PID = new PublicKey(idl.address);
  const pda = (...s: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(s, PID)[0];
  const seats = [Keypair.generate().publicKey, dep.publicKey, ...Array.from({ length: 5 }, () => Keypair.generate().publicKey)];
  const name = "AHA Election " + Math.floor(Date.now() / 1000).toString(36);
  const circle = pda(enc("circle"), dep.publicKey.toBuffer(), enc(name));
  const tree2 = pda(enc("members"), circle.toBuffer());
  await program.methods.initializeCircle(dep.publicKey, name, new anchor.BN(365 * 24 * 3600), new anchor.BN(0), seats).accounts({ circle, parent: dep.publicKey, payer: dep.publicKey }).rpc();
  await program.methods.initializeMemberTree(20).accounts({ circle, memberTree: tree2, seat: dep.publicKey }).rpc();
  // THREE members, TWO ballots: the 2f5a7c4 governance fix added
  // MIN_ELECTORATE=3 (a smaller electorate needs a parent-Circle seat co-sign,
  // and this run's parent is the deployer pubkey, not a Circle) and
  // MIN_TURNOUT=2 (one person alone is never a group conscience — a single
  // YES no longer passes).
  const tree = await MemberTree.create(20);
  const secrets = [BigInt("424242424242"), BigInt("515151515151"), BigInt("636363636363")];
  const leafIndex: number[] = [];
  for (const s of secrets) {
    const commitment = tree.h1(s);
    leafIndex.push(tree.insert(commitment));
    const cBytes = Buffer.from(to32BE(commitment));
    await program.methods.issueMembership([...cBytes], PublicKey.default, [PublicKey.default, PublicKey.default], false).accounts({ circle, membership: pda(enc("membership"), circle.toBuffer(), cBytes), memberTree: tree2, personhood: null, openMembership: null, twoSponsor: pda(enc("twosponsor"), circle.toBuffer()), secretary: dep.publicKey }).rpc();
  }
  log("members issued, eligible=3");
  const candidate = Keypair.generate().publicKey;
  const seatIdx = 3;
  const nonce = Date.now();
  const proposal = pda(enc("mproposal"), circle.toBuffer(), new anchor.BN(nonce).toArrayLike(Buffer, "le", 8));
  await program.methods.createMemberProposal(new anchor.BN(nonce), [...eh(seatIdx, candidate)], new anchor.BN(45)).accounts({ circle, memberTree: tree2, proposal, proposer: dep.publicKey, parentCircle: null, parentSeat: null }).rpc();
  const election = pda(enc("election"), proposal.toBuffer());
  await program.methods.linkSeatElection(seatIdx, candidate).accounts({ circle, proposal, election, payer: dep.publicKey, systemProgram: SystemProgram.programId }).rpc();
  log("proposal created + linked (seat", seatIdx + ")");
  for (const [i, s] of [secrets[0], secrets[1]].entries()) {
    const { nullifier, proofA, proofB, proofC } = await proveVote(tree, s, leafIndex[i], BigInt(nonce), true);
    await program.methods.castVote(true, nullifier, proofA, proofB, proofC).accounts({ proposal, voteNullifier: pda(enc("vote_nullifier"), proposal.toBuffer(), Buffer.from(nullifier)), payer: dep.publicKey }).rpc();
  }
  const p1 = await program.account.memberProposal.fetch(proposal);
  log("real ZK YES ballots cast → yes:", p1.yes.toNumber());
  const deadline = Number(p1.deadline) * 1000;
  await sleep(Math.max(0, deadline - Date.now() + 3000));
  const cfg = pda(enc("config"), circle.toBuffer());
  await program.methods.finalizeMemberProposal().accounts({ proposal, config: cfg, finalizer: dep.publicKey, systemProgram: SystemProgram.programId }).rpc();
  const p2 = await program.account.memberProposal.fetch(proposal);
  log("finalized → passed:", p2.passed);
  await program.methods.installElectedSeat().accounts({ circle, proposal, election, caller: dep.publicKey }).rpc();
  const c = await program.account.circle.fetch(circle);
  const inst = c.council.seats[seatIdx].toBase58();
  log("install → seat", seatIdx, "=", inst.slice(0, 8), inst === candidate.toBase58() ? "MATCHES ✓" : "MISMATCH ✗");
  // A swallowed failure was a Sentinel WARNING (NRR-2026-08-17-f102): the
  // script must EXIT NON-ZERO on any miss, so a runner can tell pass from fail.
  if (!p2.passed) { log("FAIL: proposal did not pass"); process.exit(1); }
  if (inst !== candidate.toBase58()) { log("FAIL: seat not installed"); process.exit(1); }
  log("DONE");
})().catch((e) => { log("FAIL:", e.message || e); process.exit(1); });
