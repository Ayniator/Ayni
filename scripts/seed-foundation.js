// Create the AHA Foundation (World Service) Circle on devnet with its real
// named-servant seats, so the web app's Foundation / 7th-Tradition features have
// a governable root circle.
//
// Seats (index order): [Treasurer, Scribe-Secretary, Rhythm Keeper, Elder N/E/S/W].
//   - The 3 named servants are the addresses below (override with TREASURER=,
//     SCRIBE=, RHYTHM= env vars).
//   - Elder North = the deployer wallet (so it can sign the member-tree setup and
//     gives 4 controllable seats = the 4-of-7 threshold).
//   - Elders East/South/West = generated placeholders (rotate them via 4-of-7).
//
//   node scripts/seed-foundation.js
const anchor = require("@coral-xyz/anchor");
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const fs = require("fs");
const idl = require("../target/idl/ayni.json");

const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";
const KEYPAIR = process.env.HOME + "/.config/solana/aha-deployer.json";
// Note: do NOT read process.env.NAME — on Windows/WSL it's the hostname.
const NAME = process.env.FOUNDATION_NAME || "AHA Foundation";

// The named servants (initial addresses).
const TREASURER = process.env.TREASURER || "AHAQjDz6KbRvJcju2Wa7FLceEEgSZ9Yaq3KiFGFFaXT8";
const SCRIBE = process.env.SCRIBE || "AHAYZpbUKPWjsCvwyqn5Y6dhV1MFcYWSVGYuNoU17MBV";
const RHYTHM = process.env.RHYTHM || "AHAxVqcCgDJx56y9xt9TheyvyoPwuBEjmyJnTUL1wt7u";

async function main() {
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEYPAIR, "utf8"))));
  const connection = new Connection(RPC, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(kp), { commitment: "confirmed" });
  const program = new anchor.Program(idl, provider);
  const parent = kp.publicKey; // foundation root seed
  const ONE_YEAR = new anchor.BN(365 * 24 * 60 * 60);

  // Elder North = deployer (bootstraps the member tree + a 4th controllable seat).
  const elderNorth = kp.publicKey;
  const eldersESW = Array.from({ length: 3 }, () => Keypair.generate().publicKey);
  const seats = [
    new PublicKey(TREASURER),   // 0 Treasurer
    new PublicKey(SCRIBE),      // 1 Scribe-Secretary
    new PublicKey(RHYTHM),      // 2 Rhythm Keeper
    elderNorth,                 // 3 Elder North (deployer)
    ...eldersESW,               // 4,5,6 Elder East/South/West (placeholders)
  ];

  // Seats must be distinct.
  const seen = new Set(seats.map((s) => s.toBase58()));
  if (seen.size !== 7) throw new Error("Seats are not all distinct (the deployer must not also be a named servant).");

  const [circle] = PublicKey.findProgramAddressSync(
    [Buffer.from("circle"), parent.toBuffer(), Buffer.from(NAME)], program.programId);
  const [memberTree] = PublicKey.findProgramAddressSync(
    [Buffer.from("members"), circle.toBuffer()], program.programId);

  if (!(await connection.getAccountInfo(circle))) {
    await program.methods
      .initializeCircle(parent, NAME, ONE_YEAR, new anchor.BN(7 * 24 * 60 * 60), seats)
      .accounts({ circle, parent, payer: kp.publicKey })
      .rpc();
    console.log(`foundation created: ${NAME}  ${circle.toBase58()}`);
  } else {
    console.log(`foundation exists:  ${NAME}  ${circle.toBase58()}`);
  }

  if (!(await connection.getAccountInfo(memberTree))) {
    await program.methods
      .initializeMemberTree(20)
      .accounts({ circle, memberTree, seat: elderNorth }) // deployer (Elder North) signs
      .rpc();
    console.log("member tree initialized (depth 20)");
  }

  const ROLES = ["Treasurer", "Scribe-Secretary", "Rhythm Keeper", "Elder North", "Elder East", "Elder South", "Elder West"];
  console.log("\nSeats:");
  seats.forEach((s, i) => console.log(`  ${ROLES[i].padEnd(16)} ${s.toBase58()}${s.equals(kp.publicKey) ? "  (deployer)" : ""}`));
  console.log(`\nSet in frontend/.env.local:\nNEXT_PUBLIC_FOUNDATION_CIRCLE=${circle.toBase58()}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
