// Delist a Circle from the directory (close its CircleProfile). Run with the
// AHA deployer keypair, which is a Council seat of the seeded Circles.
//
//   node scripts/close-circle.js "AHA Berlin"
const anchor = require("@coral-xyz/anchor");
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const fs = require("fs");
const idl = require("../target/idl/ayni.json");

const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";
const KEYPAIR = process.env.HOME + "/.config/solana/aha-deployer.json";
const name = process.argv[2];
if (!name) { console.error('usage: node scripts/close-circle.js "AHA <name>"'); process.exit(1); }

async function main() {
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEYPAIR, "utf8"))));
  const connection = new Connection(RPC, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(kp), { commitment: "confirmed" });
  const program = new anchor.Program(idl, provider);
  const parent = kp.publicKey;

  const [circle] = PublicKey.findProgramAddressSync(
    [Buffer.from("circle"), parent.toBuffer(), Buffer.from(name)], program.programId);
  const [profile] = PublicKey.findProgramAddressSync(
    [Buffer.from("profile"), circle.toBuffer()], program.programId);

  const info = await connection.getAccountInfo(profile);
  if (!info) { console.log(`No profile for "${name}" (${profile.toBase58()}) — nothing to close.`); return; }

  await program.methods.closeCircleProfile()
    .accounts({ circle, profile, seat: kp.publicKey })
    .rpc();
  console.log(`Closed profile for "${name}": ${profile.toBase58()}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e.message || e); process.exit(1); });
