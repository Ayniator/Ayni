// scripts/ceremony/contribute.mjs — one participant's phase-2 contribution.
//
//   node scripts/ceremony/contribute.mjs <in.zkey> <out.zkey> \
//     --name "<contributor>" [--entropy "<extra entropy string>"] [--verbose]
//
// Entropy: 64 bytes from crypto.randomBytes (CSPRNG) are ALWAYS used; an
// optional --entropy string is appended so a participant can mix in their own
// source (dice rolls, a sentence typed with eyes closed, …). The combined
// entropy is passed to snarkjs and never written anywhere. The security of the
// whole ceremony holds if at least ONE contributor's entropy was honest and
// destroyed (docs/ceremony.md §2).
//
// Prints the blake2b-512 contribution hash — the value the participant must
// publish/announce out-of-band and that goes in the transcript. When the out
// file is under ceremony/<circuit>/ the transcript entry is appended
// automatically.

import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import {
  REPO_ROOT, formatHash, inferCircuit, loadSnarkjs, makeLogger,
  parseArgs, sha256File, toHex,
} from "./common.mjs";
import { appendEntry } from "./transcript.mjs";

const args = parseArgs(process.argv.slice(2), {
  name: true, entropy: true, verbose: false, "no-transcript": false,
});
const [inZkey, outZkey] = args._;

if (!inZkey || !outZkey || !args.name) {
  console.error(
    'usage: node scripts/ceremony/contribute.mjs <in.zkey> <out.zkey> --name "<contributor>" [--entropy "<extra>"]'
  );
  process.exit(2);
}
if (!existsSync(inZkey)) {
  console.error(`✘ input zkey not found: ${inZkey}`);
  process.exit(1);
}
if (existsSync(outZkey)) {
  console.error(`✘ ${outZkey} already exists — refusing to overwrite a ceremony artifact.`);
  process.exit(1);
}

const rel = (p) => path.relative(REPO_ROOT, path.resolve(p));

// Strong local entropy: 64 CSPRNG bytes, plus whatever the participant typed.
let entropy = toHex(randomBytes(64)) + (args.entropy ?? "");

console.log(`contribution by "${args.name}"`);
console.log(`  in : ${rel(inZkey)}  (sha256 ${await sha256File(inZkey)})`);

const snarkjs = loadSnarkjs();
const contributionHash = await snarkjs.zKey.contribute(
  path.resolve(inZkey),
  path.resolve(outZkey),
  args.name,
  entropy,
  makeLogger({ verbose: args.verbose })
);
entropy = null; // drop the reference; the toxic waste must not outlive this process

const hashHex = toHex(contributionHash);
const outSha = await sha256File(outZkey);

console.log(`  out: ${rel(outZkey)}  (sha256 ${outSha})`);
console.log(formatHash(contributionHash, `  Contribution hash (publish this out-of-band):`));
console.log(`  hex: ${hashHex}`);

const circuit = inferCircuit(outZkey);
if (circuit && !args["no-transcript"]) {
  appendEntry({
    circuit,
    action: "contribute",
    actor: args.name,
    file: rel(outZkey),
    sha256: outSha,
    contributionHash: hashHex,
    note: args.entropy !== undefined
      ? "entropy: crypto.randomBytes(64) + participant-supplied string"
      : "entropy: crypto.randomBytes(64)",
  });
  console.log(`  transcript entry appended (ceremony/TRANSCRIPT.md)`);
} else if (!args["no-transcript"]) {
  console.log(
    `  [warn] could not infer circuit from path — record this step manually:\n` +
    `         node scripts/ceremony/transcript.mjs --circuit <c> --action contribute ` +
    `--actor "${args.name}" --file ${rel(outZkey)} --hash ${hashHex}`
  );
}

// snarkjs keeps ffjavascript worker threads alive; exit explicitly.
process.exit(0);
