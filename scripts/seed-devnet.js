// Seed a few Circle directory profiles on devnet so "Find a Circle Near You"
// shows pins. Uses the configured AHA deployer keypair as payer + Council seat.
//
//   node scripts/seed-devnet.js
const anchor = require("@coral-xyz/anchor");
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const fs = require("fs");
const path = require("path");
const idl = require("../target/idl/ayni.json");

const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";
const KEYPAIR = process.env.HOME + "/.config/solana/aha-deployer.json";

// lat/lon in microdegrees (degrees * 1e6).
const CITIES = [
  { name: "AHA Cusco", city: "Cusco, Peru", address: "Plaza de Armas", lat: -13531900, lon: -71967500 },
  { name: "AHA Lisbon", city: "Lisbon, Portugal", address: "Alfama", lat: 38722300, lon: -9139300 },
  { name: "AHA Bangkok", city: "Bangkok, Thailand", address: "PHCM+XP (13.7224, 100.5837)", lat: 13722405, lon: 100583672 },
  { name: "AHA Chiang Mai", city: "Chiang Mai, Thailand", address: "WWCH+HQ Mae Raem, Mae Rim District", lat: 18921528, lon: 98929417 },
];

async function main() {
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEYPAIR, "utf8"))));
  const connection = new Connection(RPC, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(kp), { commitment: "confirmed" });
  const program = new anchor.Program(idl, provider);
  const parent = kp.publicKey; // the AHA wallet is the foundation root seed
  const ONE_YEAR = new anchor.BN(365 * 24 * 60 * 60);

  // 7 distinct seats; seat[0] is the AHA wallet (so it can sign upserts).
  //
  // The other six USED TO BE `Keypair.generate().publicKey` with the private key
  // discarded in memory. That made every Circle this script creates permanently
  // ungovernable: threshold is 4-of-7 and only ONE seat could ever sign, so no
  // proposal could pass — not even the RotateSeat that would fix it. All 13
  // Circles seeded on devnet before this change are in that state and cannot be
  // recovered; their six placeholder seats show 0 SOL because nobody could ever
  // fund them.
  //
  // These are demo pins for the "Find a Circle Near You" map, so they do not
  // need governance — but a seat is an authority, and creating one nobody can
  // hold is not a placeholder, it is a hole. The keys are written to disk (0600)
  // alongside the Foundation's, and reused on re-run.
  const seatsDir = process.env.SEAT_KEYS_DIR || path.join(process.env.HOME, "aha-seat-keys");
  fs.mkdirSync(seatsDir, { recursive: true, mode: 0o700 });
  const others = ["demo-2", "demo-3", "demo-4", "demo-5", "demo-6", "demo-7"].map((n) => {
    const file = path.join(seatsDir, `${n}.json`);
    if (fs.existsSync(file)) {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8")))).publicKey;
    }
    const gen = Keypair.generate();
    fs.writeFileSync(file, JSON.stringify(Array.from(gen.secretKey)), { mode: 0o600 });
    return gen.publicKey;
  });
  const seats = [kp.publicKey, ...others];
  console.log(`seat keys: ${seatsDir}`);

  for (const c of CITIES) {
    const [circle] = PublicKey.findProgramAddressSync(
      [Buffer.from("circle"), parent.toBuffer(), Buffer.from(c.name)], program.programId);
    const [profile] = PublicKey.findProgramAddressSync(
      [Buffer.from("profile"), circle.toBuffer()], program.programId);

    const exists = await connection.getAccountInfo(circle);
    if (!exists) {
      await program.methods
        .initializeCircle(parent, c.name, ONE_YEAR, new anchor.BN(0), seats)
        .accounts({ circle, parent, payer: kp.publicKey })
        .rpc();
      console.log(`circle created: ${c.name}  ${circle.toBase58()}`);
    } else {
      console.log(`circle exists:  ${c.name}  ${circle.toBase58()}`);
    }

    await program.methods
      .upsertCircleProfile(c.lat, c.lon, c.name, c.city, c.address, "", "", "")
      .accounts({ circle, profile, seat: kp.publicKey })
      .rpc();
    console.log(`  profile set @ (${c.lat / 1e6}, ${c.lon / 1e6})  ${c.city}`);
  }
  console.log("\nDone. Refresh http://localhost:3000 — the app reads devnet by default.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
