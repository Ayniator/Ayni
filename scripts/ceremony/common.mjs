// scripts/ceremony/common.mjs — shared helpers for the F44 phase-2 ceremony
// tooling. Plain node 18, no repo-root deps: snarkjs resolves from
// frontend/node_modules (same pattern as tests/recovery-keys.test.mjs).
//
// These scripts NEVER write to programs/ or frontend/ — all output goes to the
// gitignored ceremony/ working directory.

import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), "..", ".."
);
export const CEREMONY_DIR = path.join(REPO_ROOT, "ceremony");
export const BUILD_DIR = path.join(REPO_ROOT, "build");
export const FRONTEND_NM = path.join(REPO_ROOT, "frontend", "node_modules");

// Circuit registry.
//  - baseline: the CURRENT shipped (single-party) final zkey the new ceremony
//    chain extends by default (init.mjs Mode A), committed in build/.
//  - rs / constName: the Rust verifying key embedded in the program.
//    scripts/vk_to_rust.js always emits `VERIFYING_KEY`; the ack/vote files
//    rename the const, so candidate generation must apply the same rename.
export const CIRCUITS = {
  lineage_grant: {
    baseline: path.join(BUILD_DIR, "lineage_grant_final.zkey"),
    vkeyJson: path.join(BUILD_DIR, "lineage_grant_vkey.json"),
    rs: "verifying_key.rs",
    constName: "VERIFYING_KEY",
  },
  ack_disclose: {
    baseline: path.join(BUILD_DIR, "ack_disclose_final.zkey"),
    vkeyJson: path.join(BUILD_DIR, "ack_disclose_vkey.json"),
    rs: "verifying_key_ack.rs",
    constName: "VERIFYING_KEY_ACK",
  },
  member_vote: {
    baseline: path.join(BUILD_DIR, "member_vote_final.zkey"),
    vkeyJson: path.join(BUILD_DIR, "member_vote_vkey.json"),
    rs: "verifying_key_vote.rs",
    constName: "VERIFYING_KEY_VOTE",
  },
};

export function requireCircuit(name) {
  if (!CIRCUITS[name]) {
    console.error(
      `unknown circuit "${name}" — expected one of: ${Object.keys(CIRCUITS).join(", ")}`
    );
    process.exit(2);
  }
  return CIRCUITS[name];
}

const frontendRequire = createRequire(path.join(REPO_ROOT, "frontend", "package.json"));

export function loadSnarkjs() {
  return frontendRequire("snarkjs"); // CJS build (build/main.cjs) under node 18
}

export function snarkjsVersion() {
  try {
    // snarkjs's "exports" map hides package.json from require(); read it directly.
    const pkg = path.join(FRONTEND_NM, "snarkjs", "package.json");
    return JSON.parse(readFileSync(pkg, "utf8")).version;
  } catch {
    return "unknown";
  }
}

export function toolVersions() {
  return `node ${process.version}, snarkjs ${snarkjsVersion()}`;
}

export async function sha256File(file) {
  const h = createHash("sha256");
  await new Promise((resolve, reject) => {
    createReadStream(file)
      .on("data", (d) => h.update(d))
      .on("end", resolve)
      .on("error", reject);
  });
  return h.digest("hex");
}

export const toHex = (u8) => Buffer.from(u8).toString("hex");

// Same shape snarkjs prints: 16 bytes per line, 4-byte groups.
export function formatHash(u8, caption) {
  const hex = toHex(u8);
  const lines = [];
  for (let i = 0; i < hex.length; i += 32) {
    lines.push(
      "\t\t" + (hex.slice(i, i + 32).match(/.{1,8}/g) || []).join(" ")
    );
  }
  return (caption ? caption + "\n" : "") + lines.join("\n");
}

export function makeLogger({ verbose = false } = {}) {
  return {
    debug: verbose ? (m) => console.log(`[dbg] ${m}`) : () => {},
    info: (m) => console.log(`  ${m}`),
    warn: (m) => console.warn(`  [warn] ${m}`),
    error: (m) => console.error(`  [error] ${m}`),
  };
}

export function ensureCeremonyDir(circuit) {
  const dir = circuit ? path.join(CEREMONY_DIR, circuit) : CEREMONY_DIR;
  mkdirSync(dir, { recursive: true });
  return dir;
}

// Infer the circuit a zkey path belongs to (ceremony/<circuit>/… or a
// build/<circuit>_… filename); returns undefined when it cannot tell.
export function inferCircuit(file) {
  const abs = path.resolve(file);
  for (const name of Object.keys(CIRCUITS)) {
    if (abs.startsWith(path.join(CEREMONY_DIR, name) + path.sep)) return name;
    if (path.basename(abs).startsWith(name)) return name;
  }
  return undefined;
}

// Minimal --flag parser: parseArgs(argv, { name: true, entropy: true })
// (true = takes a value; false = boolean). Returns { _: positionals, ...flags }.
export function parseArgs(argv, spec) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (!(key in spec)) {
        console.error(`unknown flag --${key}`);
        process.exit(2);
      }
      if (spec[key]) {
        out[key] = argv[++i];
        if (out[key] === undefined) {
          console.error(`--${key} needs a value`);
          process.exit(2);
        }
      } else out[key] = true;
    } else out._.push(a);
  }
  return out;
}

// Dynamic ESM imports of snarkjs internals (used only by verify.mjs tier-4
// contribution listing; the public CJS API does not expose the MPC section).
export async function loadSnarkjsInternals() {
  const src = path.join(FRONTEND_NM, "snarkjs", "src");
  const u = (p) => pathToFileURL(p).href;
  const zkeyUtils = await import(u(path.join(src, "zkey_utils.js")));
  const curves = await import(u(path.join(src, "curves.js")));
  const binFileUtils = await import(
    u(path.join(FRONTEND_NM, "@iden3", "binfileutils", "src", "binfileutils.js"))
  );
  const snarkjsRequire = createRequire(path.join(FRONTEND_NM, "snarkjs", "package.json"));
  const { blake2b } = snarkjsRequire("@noble/hashes/blake2b");
  return { zkeyUtils, curves, binFileUtils, blake2b };
}
