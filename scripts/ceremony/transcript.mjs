// scripts/ceremony/transcript.mjs — append-only ceremony transcript.
//
// Every ceremony step (init, contribute, beacon, export, verify) is recorded
// in ceremony/TRANSCRIPT.md: who, when (UTC), which file, its sha256, the
// snarkjs contribution hash where applicable, and tool versions. The other
// ceremony scripts import appendEntry(); it is also a standalone CLI so a step
// performed by hand (e.g. plain `snarkjs zkey contribute` on an air-gapped
// machine) can be recorded after the fact:
//
//   node scripts/ceremony/transcript.mjs --circuit member_vote \
//     --action contribute --actor "Circle Lima" \
//     --file ceremony/member_vote/0003.zkey \
//     --hash <contribution-hash-hex> --note "air-gapped laptop, entropy: dice"
//
// The transcript is Markdown on purpose: it is the human-auditable artifact
// that gets published alongside the final zkey (see docs/ceremony.md §6).

import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CEREMONY_DIR, ensureCeremonyDir, parseArgs, sha256File, toolVersions,
} from "./common.mjs";

export const TRANSCRIPT_PATH = path.join(CEREMONY_DIR, "TRANSCRIPT.md");

const HEADER = `# Ayni phase-2 ceremony transcript

Append-only log of every ceremony step. See docs/ceremony.md for the runbook.
Each contribution hash below is the blake2b-512 snarkjs prints for that
contribution; each sha256 is the hash of the named file at the time of the step.

Verify independently with:
\`node scripts/ceremony/verify.mjs <circuit> <final.zkey>\`

---
`;

/**
 * Append one step to ceremony/TRANSCRIPT.md (creating it with a header the
 * first time). All fields are strings; missing optionals are omitted.
 *
 * @param {object} e
 * @param {string} e.circuit   circuit name (or "-" for ceremony-wide steps)
 * @param {string} e.action    init | contribute | beacon | export | verify | note
 * @param {string} e.actor     who performed the step
 * @param {string} [e.file]    file produced/verified (repo-relative preferred)
 * @param {string} [e.sha256]  sha256 of that file
 * @param {string} [e.contributionHash] snarkjs blake2b-512 contribution hash (hex)
 * @param {string} [e.note]
 */
export function appendEntry(e) {
  ensureCeremonyDir();
  if (!existsSync(TRANSCRIPT_PATH)) writeFileSync(TRANSCRIPT_PATH, HEADER);
  const ts = new Date().toISOString();
  const lines = [
    ``,
    `## ${ts} — ${e.circuit} — ${e.action}`,
    ``,
    `- actor: ${e.actor}`,
  ];
  if (e.file) lines.push(`- file: ${e.file}`);
  if (e.sha256) lines.push(`- sha256: \`${e.sha256}\``);
  if (e.contributionHash)
    lines.push(`- contribution hash (blake2b-512): \`${e.contributionHash}\``);
  lines.push(`- tools: ${toolVersions()}`);
  if (e.note) lines.push(`- note: ${e.note}`);
  lines.push(``);
  appendFileSync(TRANSCRIPT_PATH, lines.join("\n"));
  return TRANSCRIPT_PATH;
}

// ---- CLI ------------------------------------------------------------------
const isCli =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  const args = parseArgs(process.argv.slice(2), {
    circuit: true, action: true, actor: true,
    file: true, hash: true, note: true,
  });
  if (!args.circuit || !args.action || !args.actor) {
    console.error(
      "usage: node scripts/ceremony/transcript.mjs --circuit <c|-> --action <a> " +
      '--actor "<who>" [--file <path>] [--hash <contribution-hash>] [--note "..."]'
    );
    process.exit(2);
  }
  const entry = {
    circuit: args.circuit,
    action: args.action,
    actor: args.actor,
    file: args.file,
    contributionHash: args.hash,
    note: args.note,
  };
  if (args.file && existsSync(args.file)) {
    entry.sha256 = await sha256File(args.file);
  }
  const p = appendEntry(entry);
  console.log(`transcript entry appended → ${p}`);
}
