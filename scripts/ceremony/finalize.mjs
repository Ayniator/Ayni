// scripts/ceremony/finalize.mjs — apply the random beacon and export the
// candidate verification key. PRINT-ONLY towards programs/: this script never
// writes outside the gitignored ceremony/ directory.
//
//   node scripts/ceremony/finalize.mjs <circuit> <last.zkey> \
//     --beacon <hex> [--iterations 10] [--source "<where the beacon came from>"] \
//     [--actor "<coordinator>"]
//
// The beacon closes the ceremony: a public, unpredictable-in-advance value
// (rule in docs/ceremony.md §5: the blockhash of a pre-announced future Solana
// slot) is applied as a final deterministic "contribution", so the LAST human
// contributor cannot bias the key by choosing their contribution adaptively.
// --beacon takes that value as a hex string (a Solana blockhash is base58 —
// convert: `node -e "const b=require('bs58');console.log(Buffer.from(b.decode ?
// b.decode(process.argv[1]) : b.default.decode(process.argv[1])).toString('hex'))" <blockhash>`).
// --source is recorded in the transcript so anyone can re-derive the value.
//
// Outputs (ceremony/<circuit>/):
//   <circuit>_final.zkey        — beacon applied (the ceremony result)
//   <circuit>_vkey.json         — exported verification key
//   <circuit>_verifying_key.rs.candidate — vk_to_rust.js output, const renamed
// plus a printed unified diff against programs/ayni/src/<verifying_key*.rs>
// showing exactly what the (separate, Sentinel-gated) swap round would change.

import { existsSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  CEREMONY_DIR, REPO_ROOT, formatHash, loadSnarkjs, makeLogger,
  parseArgs, requireCircuit, sha256File, toHex,
} from "./common.mjs";
import { appendEntry } from "./transcript.mjs";

const args = parseArgs(process.argv.slice(2), {
  beacon: true, iterations: true, source: true, actor: true, verbose: false,
});
const [circuitName, lastZkey] = args._;

if (!circuitName || !lastZkey || !args.beacon) {
  console.error(
    'usage: node scripts/ceremony/finalize.mjs <circuit> <last.zkey> --beacon <hex> ' +
    '[--iterations 10] [--source "beacon provenance"] [--actor "<coordinator>"]'
  );
  process.exit(2);
}
const cfg = requireCircuit(circuitName);
if (!existsSync(lastZkey)) {
  console.error(`✘ input zkey not found: ${lastZkey}`);
  process.exit(1);
}
const beaconHex = args.beacon.toLowerCase();
if (!/^[0-9a-f]+$/.test(beaconHex) || beaconHex.length % 2 !== 0 || beaconHex.length < 32) {
  console.error("✘ --beacon must be a hex string (even length, ≥16 bytes; a Solana blockhash is 32 bytes)");
  process.exit(1);
}
const iterations = Number(args.iterations ?? 10);
if (!Number.isInteger(iterations) || iterations < 10 || iterations > 63) {
  console.error("✘ --iterations must be an integer in [10, 63] (2^n beacon hash iterations)");
  process.exit(1);
}
const source = args.source ?? "UNRECORDED — record the beacon source!";
const actor = args.actor ?? "coordinator";
const rel = (p) => path.relative(REPO_ROOT, path.resolve(p));

const dir = path.join(CEREMONY_DIR, circuitName);
const outZkey = path.join(dir, `${circuitName}_final.zkey`);
const outVkey = path.join(dir, `${circuitName}_vkey.json`);
const outCandidate = path.join(dir, `${cfg.rs}.candidate`);

if (existsSync(outZkey)) {
  console.error(`✘ ${rel(outZkey)} already exists — this ceremony round was already finalized.`);
  process.exit(1);
}

const snarkjs = loadSnarkjs();
const logger = makeLogger({ verbose: args.verbose });

// ---- 1. beacon ------------------------------------------------------------
console.log(`applying beacon to ${rel(lastZkey)} …`);
console.log(`  beacon: ${beaconHex}`);
console.log(`  source: ${source}`);
const beaconName = `beacon (${source})`;
const contributionHash = await snarkjs.zKey.beacon(
  path.resolve(lastZkey), outZkey, beaconName, beaconHex, iterations, logger
);
const hashHex = toHex(contributionHash);
const outSha = await sha256File(outZkey);
console.log(`  out: ${rel(outZkey)}  (sha256 ${outSha})`);
console.log(formatHash(contributionHash, "  Beacon contribution hash:"));

appendEntry({
  circuit: circuitName,
  action: "beacon",
  actor,
  file: rel(outZkey),
  sha256: outSha,
  contributionHash: hashHex,
  note: `beacon ${beaconHex} (2^${iterations} iterations); source: ${source}`,
});

// ---- 2. export verification key ------------------------------------------
const vk = await snarkjs.zKey.exportVerificationKey(outZkey);
writeFileSync(outVkey, JSON.stringify(vk, null, 1) + "\n");
console.log(`\nverification key → ${rel(outVkey)}  (sha256 ${await sha256File(outVkey)})`);

appendEntry({
  circuit: circuitName,
  action: "export",
  actor,
  file: rel(outVkey),
  sha256: await sha256File(outVkey),
  note: "verification key exported from the finalized zkey",
});

// ---- 3. candidate Rust + diff vs programs/ (PRINT-ONLY) -------------------
// Reuse the repo's canonical converter (scripts/vk_to_rust.js) so byte
// conventions stay identical, then apply the same const rename the shipped
// verifying_key_ack.rs / verifying_key_vote.rs carry.
const gen = spawnSync(
  process.execPath, [path.join(REPO_ROOT, "scripts", "vk_to_rust.js"), outVkey],
  { encoding: "utf8" }
);
if (gen.status !== 0) {
  console.error(`✘ vk_to_rust.js failed:\n${gen.stderr}`);
  process.exit(1);
}
const candidate = gen.stdout.replace(
  "pub const VERIFYING_KEY:", `pub const ${cfg.constName}:`
);
writeFileSync(outCandidate, candidate);
console.log(`candidate Rust VK → ${rel(outCandidate)}`);

const target = path.join(REPO_ROOT, "programs", "ayni", "src", cfg.rs);
console.log(`\n===== diff (current programs/ayni/src/${cfg.rs} → ceremony candidate) =====`);
if (!existsSync(target)) {
  console.log(`(no current ${cfg.rs} — whole candidate is new)`);
} else {
  const d = spawnSync("diff", ["-u", target, outCandidate], { encoding: "utf8" });
  if (d.status === 0) {
    console.log("(identical — the ceremony produced the same key; this should not happen after real contributions)");
  } else if (d.status === 1) {
    console.log(d.stdout);
  } else {
    console.error(`diff failed: ${d.stderr}`);
  }
}
console.log("===== end diff =====");

// Field-level summary: a phase-2-only ceremony must change ONLY delta (and
// nothing else); alpha/beta/gamma/IC changing would mean the circuit or
// phase 1 changed underneath us.
try {
  const cur = JSON.parse(
    spawnSync(process.execPath, ["-e", `
      const fs=require('fs');
      const rs=fs.readFileSync(process.argv[1],'utf8');
      const grab=(name)=>{const m=rs.match(new RegExp(name+':\\\\s*\\\\[([^\\\\]]*)\\\\]'));return m?m[1].replace(/u8/g,'').replace(/\\\\s/g,''):null;};
      console.log(JSON.stringify({alpha:grab('vk_alpha_g1'),beta:grab('vk_beta_g2'),gamma:grab('vk_gamme_g2'),delta:grab('vk_delta_g2')}));
    `, target], { encoding: "utf8" }).stdout
  );
  const cand = JSON.parse(
    spawnSync(process.execPath, ["-e", `
      const fs=require('fs');
      const rs=fs.readFileSync(process.argv[1],'utf8');
      const grab=(name)=>{const m=rs.match(new RegExp(name+':\\\\s*\\\\[([^\\\\]]*)\\\\]'));return m?m[1].replace(/u8/g,'').replace(/\\\\s/g,''):null;};
      console.log(JSON.stringify({alpha:grab('vk_alpha_g1'),beta:grab('vk_beta_g2'),gamma:grab('vk_gamme_g2'),delta:grab('vk_delta_g2')}));
    `, outCandidate], { encoding: "utf8" }).stdout
  );
  const cmp = (k) => (cur[k] === cand[k] ? "unchanged" : "CHANGED");
  console.log(`\nfield summary: alpha ${cmp("alpha")}, beta ${cmp("beta")}, gamma ${cmp("gamma")}, delta ${cmp("delta")}`);
  console.log("(expected for a phase-2 ceremony: only delta changes; IC is unchanged)");
} catch { /* summary is best-effort */ }

console.log(`
NOTE — nothing under programs/ or frontend/ was modified. Swapping the live
key is a SEPARATE, Sentinel-gated, program-redeploy round: docs/ceremony.md §7.
Next: verify the finalized zkey —
  node scripts/ceremony/verify.mjs ${circuitName} ${rel(outZkey)}
`);

process.exit(0);
