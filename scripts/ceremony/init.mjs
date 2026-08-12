// scripts/ceremony/init.mjs — start a phase-2 ceremony round.
//
//   node scripts/ceremony/init.mjs [circuit ...] [--fresh] [--r1cs <p>] [--ptau <p>] [--actor "<who>"]
//
// Default circuits: all three (member_vote, lineage_grant, ack_disclose).
//
// Two modes (docs/ceremony.md §3):
//
//   Mode A (default) — EXTEND the current chain. Copies the shipped
//   single-party build/<circuit>_final.zkey to ceremony/<circuit>/0000_init.zkey
//   and new contributions extend its contribution chain. Quick, needs nothing
//   beyond the repo — but the baseline's own provenance (r1cs + the original
//   locally-generated pot16_final.ptau) is what it is; see the runbook.
//
//   Mode B (--fresh) — RESTART phase 2 from a groth16 setup over the circuit's
//   r1cs and a well-attested public ptau (recommended for mainnet). Requires
//   --r1cs (or build/<circuit>.r1cs) and --ptau (or build/pot16_final.ptau);
//   the r1cs must be rebuilt with circom if absent (gitignored).
//
// Output goes only to the gitignored ceremony/ directory.

import { copyFileSync, existsSync } from "node:fs";
import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  BUILD_DIR, CIRCUITS, REPO_ROOT, ensureCeremonyDir, loadSnarkjs,
  makeLogger, parseArgs, requireCircuit, sha256File, toolVersions,
} from "./common.mjs";
import { appendEntry } from "./transcript.mjs";

const args = parseArgs(process.argv.slice(2), {
  fresh: false, r1cs: true, ptau: true, actor: true, verbose: false,
});
const circuits = args._.length ? args._ : Object.keys(CIRCUITS);
const actor = args.actor ?? "coordinator";
const rel = (p) => path.relative(REPO_ROOT, p);

let failed = 0;

for (const name of circuits) {
  const cfg = requireCircuit(name);
  const dir = ensureCeremonyDir(name);
  const initZkey = path.join(dir, "0000_init.zkey");

  if (existsSync(initZkey)) {
    console.error(`✘ ${name}: ${rel(initZkey)} already exists — refusing to overwrite an in-progress ceremony. Move ceremony/${name}/ away to restart.`);
    failed++;
    continue;
  }

  let mode, source;
  if (args.fresh) {
    const r1cs = args.r1cs ?? path.join(BUILD_DIR, `${name}.r1cs`);
    const ptau = args.ptau ?? path.join(BUILD_DIR, "pot16_final.ptau");
    if (!existsSync(r1cs) || !existsSync(ptau)) {
      console.error(
        `✘ ${name}: Mode B (--fresh) needs the r1cs and ptau.\n` +
        `    r1cs: ${rel(r1cs)} ${existsSync(r1cs) ? "(found)" : "(MISSING — compile circuits/" + name + ".circom with circom 2.x, see circuits/README.md §1)"}\n` +
        `    ptau: ${rel(ptau)} ${existsSync(ptau) ? "(found)" : "(MISSING — use a public well-attested ptau, see docs/ceremony.md §4)"}`
      );
      failed++;
      continue;
    }
    console.log(`${name}: groth16 setup (${rel(r1cs)} + ${rel(ptau)}) → ${rel(initZkey)} …`);
    const snarkjs = loadSnarkjs();
    await snarkjs.zKey.newZKey(r1cs, ptau, initZkey, makeLogger({ verbose: args.verbose }));
    mode = "B (fresh groth16 setup)";
    source = `${rel(r1cs)} + ${rel(ptau)}`;
  } else {
    if (!existsSync(cfg.baseline)) {
      console.error(`✘ ${name}: baseline ${rel(cfg.baseline)} not found`);
      failed++;
      continue;
    }
    copyFileSync(cfg.baseline, initZkey);
    mode = "A (extend current chain)";
    source = rel(cfg.baseline);
  }

  const sha = await sha256File(initZkey);
  const manifest = {
    circuit: name,
    mode,
    source,
    initZkey: rel(initZkey),
    initSha256: sha,
    startedAt: new Date().toISOString(),
    tools: toolVersions(),
  };
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  appendEntry({
    circuit: name,
    action: "init",
    actor,
    file: rel(initZkey),
    sha256: sha,
    note: `mode ${mode}; baseline: ${source}`,
  });

  console.log(`✔ ${name}: ceremony initialised (mode ${mode})`);
  console.log(`    ${rel(initZkey)}`);
  console.log(`    sha256 ${sha}`);
  console.log(`  next: node scripts/ceremony/contribute.mjs ${rel(initZkey)} ceremony/${name}/0001.zkey --name "<contributor>"`);
}

process.exit(failed ? 1 : 0);
