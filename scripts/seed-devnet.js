// Seed a few Circle directory profiles on devnet so "Find a Circle Near You"
// shows pins. Uses the configured AHA deployer keypair as payer + Council seat.
//
//   node scripts/seed-devnet.js
const anchor = require("@coral-xyz/anchor");
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const fs = require("fs");
const idl = require("../target/idl/ayni.json");

const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";
const KEYPAIR = process.env.HOME + "/.config/solana/aha-deployer.json";

// lat/lon in microdegrees (degrees * 1e6).
const CITIES = [
  { name: "AHA Cusco", city: "Cusco, Peru", address: "Plaza de Armas", lat: -13531900, lon: -71967500 },
  { name: "AHA Lisbon", city: "Lisbon, Portugal", address: "Alfama", lat: 38722300, lon: -9139300 },
  { name: "AHA Berlin", city: "Berlin, Germany", address: "Kreuzberg", lat: 52520000, lon: 13405000 },
];

async function main() {
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEYPAIR, "utf8"))));
  const connection = new Connection(RPC, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(kp), { commitment: "confirmed" });
  const program = new anchor.Program(idl, provider);
  const parent = kp.publicKey; // the AHA wallet is the foundation root seed
  const ONE_YEAR = new anchor.BN(365 * 24 * 60 * 60);

  // 7 distinct seats; seat[0] is the AHA wallet (so it can sign upserts).
  const others = Array.from({ length: 6 }, () => Keypair.generate().publicKey);
  const seats = [kp.publicKey, ...others];

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
