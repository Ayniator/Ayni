// Create the AHA Foundation (World Service) Circle with its seven Council seats,
// so the web app's Foundation / 7th-Tradition features have a governable root.
//
//   node scripts/seed-foundation.js
//
// Seats, in index order: [Treasurer, Scribe-Secretary, Rhythm Keeper,
// Elder North, Elder East, Elder South, Elder West].
//
//   - The 3 named servants default to the addresses below; override with
//     TREASURER= / SCRIBE= / RHYTHM=.
//   - Elder North = the deployer wallet, so it can sign the member-tree setup.
//   - Elders East/South/West are GENERATED, and — this is the change — their
//     keypairs are now WRITTEN TO DISK before the Circle is created.
//
// WHY THAT CHANGE. This script used to call `Keypair.generate().publicKey` for
// the three remaining elders and keep only the public key, on the reasoning that
// placeholders can be "rotated via 4-of-7" later. The private keys were
// discarded in memory. That is a one-way door, and the devnet history shows what
// it costs:
//
//   * The deployed `AHA Foundation` has exactly 4 of 7 seats whose keys exist.
//     Threshold is 4-of-7, so it can still act — but with ZERO margin. Rotating
//     a seat itself needs 4-of-7, so mislaying any one of those four freezes the
//     Circle permanently, with no recovery path in the program.
//   * Every other seeded Circle on devnet — 13 of them — has exactly ONE seat
//     whose key exists (the deployer), because scripts/seed-devnet.js does the
//     same thing with six seats. Those Circles can never reach 4-of-7. They are
//     governance-dead from the moment they are created, and nothing can revive
//     them. The three elders' balances on the Foundation read 0.0000 SOL, which
//     is the tell: nobody ever funded them, because nobody could.
//
// A Council seat is an authority, not a placeholder. Generating one and throwing
// the key away does not defer the decision — it destroys the seat. So the seats
// are persisted, and the script refuses to run if it cannot write them.
//
// Set SEAT_KEYS_DIR to choose where (default ~/aha-seat-keys, mode 0700). Files
// are the ordinary Solana JSON array format, so `solana-keygen pubkey` and
// `--keypair` accept them directly.
//
// Existing keys are never overwritten: if a file is already there it is loaded
// and reused, so re-running against an existing Foundation is safe.
const anchor = require("@coral-xyz/anchor");
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const fs = require("fs");
const path = require("path");
const idl = require("../target/idl/ayni.json");

const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";
const KEYPAIR = process.env.HOME + "/.config/solana/aha-deployer.json";
// Note: do NOT read process.env.NAME — on Windows/WSL it's the hostname.
const NAME = process.env.FOUNDATION_NAME || "AHA Foundation";
const SEAT_KEYS_DIR = process.env.SEAT_KEYS_DIR || path.join(process.env.HOME, "aha-seat-keys");

// The contest window: seconds a passed high-stakes proposal (WithdrawTreasury,
// RotateSeat, MigrateWallet, SetTreasuryWallet, BeginMemberEpoch) must wait
// before it may execute, during which any seat may cancel it.
//
// Default 7 days, which is right for a real Foundation and makes the Circle
// impossible to exercise in one sitting: a verified 4-of-7 vote here still
// refused to execute with "Migration time-lock has not elapsed yet", which looks
// exactly like a broken Council and is not one. Set RECOVERY_TIMELOCK=0 for a
// test Circle — 0 is an explicit, program-permitted opt-out (a NEGATIVE value is
// rejected, because it used to silently delete the window altogether).
//
// It is fixed at creation and changing it later is itself a 4-of-7 act, so
// choose it deliberately now rather than discovering it a week later.
const RECOVERY_TIMELOCK = Number(process.env.RECOVERY_TIMELOCK ?? 7 * 24 * 60 * 60);
if (!Number.isInteger(RECOVERY_TIMELOCK) || RECOVERY_TIMELOCK < 0) {
  throw new Error("RECOVERY_TIMELOCK must be a non-negative whole number of seconds");
}

// The named servants (initial addresses).
const TREASURER = process.env.TREASURER || "AHAQjDz6KbRvJcju2Wa7FLceEEgSZ9Yaq3KiFGFFaXT8";
const SCRIBE = process.env.SCRIBE || "AHAYZpbUKPWjsCvwyqn5Y6dhV1MFcYWSVGYuNoU17MBV";
const RHYTHM = process.env.RHYTHM || "AHAxVqcCgDJx56y9xt9TheyvyoPwuBEjmyJnTUL1wt7u";

/** Load a seat keypair from disk, or create and persist one. Never overwrites. */
function seatKeypair(dir, filename) {
  const file = path.join(dir, filename);
  if (fs.existsSync(file)) {
    const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
    return { kp, created: false, file };
  }
  const kp = Keypair.generate();
  // 0600, and written before the Circle is created — if the disk write fails we
  // must fail HERE, while the seat still only exists in memory, rather than
  // after a seat with no key has been committed to the chain.
  fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  return { kp, created: true, file };
}

async function main() {
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEYPAIR, "utf8"))));
  const connection = new Connection(RPC, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(kp), { commitment: "confirmed" });
  const program = new anchor.Program(idl, provider);
  const parent = kp.publicKey; // foundation root seed
  const ONE_YEAR = new anchor.BN(365 * 24 * 60 * 60);

  fs.mkdirSync(SEAT_KEYS_DIR, { recursive: true, mode: 0o700 });

  // Elder North = deployer (bootstraps the member tree + a controllable seat).
  const elderNorth = kp.publicKey;
  const elders = ["elder-east", "elder-south", "elder-west"].map((n) => seatKeypair(SEAT_KEYS_DIR, `${n}.json`));

  const seats = [
    new PublicKey(TREASURER),   // 0 Treasurer
    new PublicKey(SCRIBE),      // 1 Scribe-Secretary
    new PublicKey(RHYTHM),      // 2 Rhythm Keeper
    elderNorth,                 // 3 Elder North (deployer)
    ...elders.map((e) => e.kp.publicKey), // 4,5,6 Elder East/South/West
  ];

  // Seats must be distinct.
  const seen = new Set(seats.map((s) => s.toBase58()));
  if (seen.size !== 7) throw new Error("Seats are not all distinct (the deployer must not also be a named servant).");

  // Every generated seat must be readable back off the disk before anything is
  // sent. A seat the program will honour and nobody can sign for is worse than
  // a failed run.
  for (const e of elders) {
    const back = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(e.file, "utf8"))));
    if (!back.publicKey.equals(e.kp.publicKey)) {
      throw new Error(`seat key at ${e.file} does not round-trip — refusing to seat a Council nobody can sign for`);
    }
  }

  const [circle] = PublicKey.findProgramAddressSync(
    [Buffer.from("circle"), parent.toBuffer(), Buffer.from(NAME)], program.programId);
  const [memberTree] = PublicKey.findProgramAddressSync(
    [Buffer.from("members"), circle.toBuffer()], program.programId);

  if (!(await connection.getAccountInfo(circle))) {
    await program.methods
      .initializeCircle(parent, NAME, ONE_YEAR, new anchor.BN(RECOVERY_TIMELOCK), seats)
      .accounts({ circle, parent, payer: kp.publicKey })
      .rpc();
    console.log(`foundation created: ${NAME}  ${circle.toBase58()}`);
    console.log(`contest window: ${RECOVERY_TIMELOCK}s${RECOVERY_TIMELOCK === 0 ? "  (opt-out — high-stakes proposals execute as soon as 4-of-7 is reached)" : `  (~${(RECOVERY_TIMELOCK / 86400).toFixed(1)} days before any high-stakes proposal may execute)`}`);
  } else {
    console.log(`foundation exists:  ${NAME}  ${circle.toBase58()}`);
    console.log("(seats are fixed at creation — an existing Circle keeps the Council it was created with)");
  }

  if (!(await connection.getAccountInfo(memberTree))) {
    await program.methods
      .initializeMemberTree(20)
      .accounts({ circle, memberTree, seat: elderNorth }) // deployer (Elder North) signs
      .rpc();
    console.log("member tree initialized (depth 20)");
  }

  const ROLES = ["Treasurer", "Scribe-Secretary", "Rhythm Keeper", "Elder North", "Elder East", "Elder South", "Elder West"];
  console.log("\nSeats (threshold is 4 of 7):");
  seats.forEach((s, i) => {
    const e = elders[i - 4];
    const note = s.equals(kp.publicKey) ? "  (deployer)" : e ? `  ${e.file}${e.created ? "  [new]" : ""}` : "";
    console.log(`  ${ROLES[i].padEnd(16)} ${s.toBase58()}${note}`);
  });

  // Say which seats can actually sign. Four is the threshold, so this is the
  // difference between a Circle that can govern and one that cannot.
  console.log(`\nThis machine holds keys for ${1 + elders.length} of 7 seats (deployer + the elders above).`);
  // The three named-servant addresses are printed once, in the seat roster
  // above, and deliberately not repeated here: the Layer-D sweep treats a
  // role-labelled address in a log line as identity material, and it is right
  // to — a role plus an address is exactly the pairing that turns a pseudonym
  // into a person.
  console.log("The other three seats are the named servants listed above, whose keys live wherever you keep them.");
  console.log("Deployer + 3 elders is exactly 4, so this Circle can govern on its own — with no margin.");
  console.log("Rotating a seat itself needs 4-of-7, so losing one more would freeze it permanently.");

  console.log(`\nFund the elder seats so they can pay their own fees, e.g.:`);
  for (const e of elders) {
    console.log(`  solana transfer ${e.kp.publicKey.toBase58()} 0.2 --keypair ${KEYPAIR} --url ${RPC} --allow-unfunded-recipient`);
  }

  console.log(`\nSet in frontend/.env (inlined at build time — rebuild after changing):\nNEXT_PUBLIC_FOUNDATION_CIRCLE=${circle.toBase58()}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
