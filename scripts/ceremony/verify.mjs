// scripts/ceremony/verify.mjs — verify a phase-2 zkey's contribution chain.
//
//   node scripts/ceremony/verify.mjs <circuit> <final.zkey> \
//     [--r1cs <p>] [--ptau <p>] [--init <p>] [--verbose]
//
// Runs the STRONGEST verification the available artifacts allow, and states
// exactly what a verifier machine additionally needs for the tiers it could
// not run (the repo gitignores build/*.r1cs and build/*.ptau, so a fresh
// checkout can only run tier 3/4 until those are supplied):
//
//   tier 1  r1cs + ptau            → snarkjs zKey.verifyFromR1cs: FULL
//           verification — the zkey provably belongs to THIS circuit and THIS
//           ptau, plus the whole contribution chain and beacon.
//   tier 2  init zkey + ptau       → zKey.verifyFromInit: full chain + key
//           consistency against the ceremony's starting zkey (trusts that the
//           init zkey matched the circuit — tier 1 proves that part).
//   tier 3  init zkey only         → everything in tier 2 EXCEPT the final
//           H-section/tau consistency check (the only step that reads the
//           ptau). Verifies: per-contribution transcript hashes, key/ratio
//           pairings, beacon reproduction, delta chain, and byte-equality of
//           the circuit-derived sections (IC/coeffs/A/B) against the init.
//   tier 4  final zkey only        → lists the embedded contribution chain
//           (names + hashes + circuit hash) for cross-checking against the
//           published transcript, and re-exports the verification key.
//           This is an UNVERIFIED listing, not a proof.
//
// Defaults: --r1cs build/<circuit>.r1cs, --ptau build/pot16_final.ptau,
//           --init ceremony/<circuit>/0000_init.zkey.

import { existsSync } from "node:fs";
import path from "node:path";
import {
  BUILD_DIR, CEREMONY_DIR, REPO_ROOT, formatHash, loadSnarkjs,
  loadSnarkjsInternals, makeLogger, parseArgs, requireCircuit,
  sha256File, snarkjsVersion, toHex,
} from "./common.mjs";

const args = parseArgs(process.argv.slice(2), {
  r1cs: true, ptau: true, init: true, verbose: false,
});
const [circuitName, zkeyPath] = args._;
if (!circuitName || !zkeyPath) {
  console.error(
    "usage: node scripts/ceremony/verify.mjs <circuit> <final.zkey> [--r1cs <p>] [--ptau <p>] [--init <p>]"
  );
  process.exit(2);
}
requireCircuit(circuitName);
if (!existsSync(zkeyPath)) {
  console.error(`✘ zkey not found: ${zkeyPath}`);
  process.exit(1);
}

const rel = (p) => path.relative(REPO_ROOT, path.resolve(p));
const r1cs = args.r1cs ?? path.join(BUILD_DIR, `${circuitName}.r1cs`);
const ptau = args.ptau ?? path.join(BUILD_DIR, "pot16_final.ptau");
const init = args.init ?? path.join(CEREMONY_DIR, circuitName, "0000_init.zkey");
const logger = makeLogger({ verbose: args.verbose });

console.log(`verify ${circuitName}: ${rel(zkeyPath)}`);
console.log(`  sha256 ${await sha256File(zkeyPath)}`);
console.log(`  artifacts: r1cs ${existsSync(r1cs) ? "✔ " + rel(r1cs) : "— missing"}` +
            ` | ptau ${existsSync(ptau) ? "✔ " + rel(ptau) : "— missing"}` +
            ` | init ${existsSync(init) ? "✔ " + rel(init) : "— missing"}`);

function explainMissing() {
  console.log(`
For FULL (tier 1) verification a verifier machine additionally needs:
  1. ${rel(r1cs)} — NOT in git (gitignored). Rebuild it deterministically:
       circom circuits/${circuitName}.circom --r1cs -l node_modules -o build/
     (circom 2.x per circuits/README.md; the exact circom version used for the
      shipped build must be pinned in the ceremony transcript, since a
      different compiler version can produce a different r1cs).
  2. ${rel(ptau)} — NOT in git. This is the phase-1 Powers of Tau file the
     zkeys were built from. circuits/README.md generated it locally, so it
     exists only on the original build machine; a real ceremony must publish
     the exact ptau (or restart from a public one — docs/ceremony.md §4).
  3. snarkjs ${snarkjsVersion()} (frontend/node_modules) and node 18+.
`);
}

let exitCode = 1;

try {
  if (existsSync(r1cs) && existsSync(ptau)) {
    // ---- tier 1: full verification ---------------------------------------
    console.log(`\ntier 1 — full verification against r1cs + ptau …`);
    const snarkjs = loadSnarkjs();
    const ok = await snarkjs.zKey.verifyFromR1cs(
      path.resolve(r1cs), path.resolve(ptau), path.resolve(zkeyPath), logger
    );
    console.log(ok ? "\nRESULT: FULL PASS — zkey chain valid for this circuit and ptau."
                   : "\nRESULT: INVALID — zkey does NOT verify.");
    exitCode = ok ? 0 : 1;
  } else if (existsSync(init) && existsSync(ptau)) {
    // ---- tier 2: chain vs init zkey --------------------------------------
    console.log(`\ntier 2 — chain verification against init zkey + ptau …`);
    const snarkjs = loadSnarkjs();
    const ok = await snarkjs.zKey.verifyFromInit(
      path.resolve(init), path.resolve(ptau), path.resolve(zkeyPath), logger
    );
    if (ok) {
      console.log("\nRESULT: PASS (from init) — contribution chain valid from the ceremony baseline.");
      console.log("Note: that the baseline itself matches the circuit is tier 1's job.");
    } else console.log("\nRESULT: INVALID — chain does NOT verify against the init zkey.");
    explainMissing();
    exitCode = ok ? 0 : 1;
  } else if (existsSync(init)) {
    // ---- tier 3: everything except the ptau-dependent H-section check ----
    // snarkjs runs the H/tau consistency check LAST and only that step opens
    // the ptau file; every other check (contribution transcript hashes,
    // same-ratio pairings, beacon reproduction, delta chain, IC/coeffs/A/B
    // byte-equality vs init, L-section ratio) has already passed if the ptau
    // open is what fails. We exploit that ordering deliberately.
    console.log(`\ntier 3 — chain verification against init zkey (no ptau) …`);
    const snarkjs = loadSnarkjs();
    let ok = false, partial = false;
    try {
      ok = await snarkjs.zKey.verifyFromInit(
        path.resolve(init), path.resolve(ptau), path.resolve(zkeyPath), logger
      );
    } catch (e) {
      // Only the missing-ptau open may be excused; anything else is a real error.
      const msg = String(e && e.message || e);
      const isEnoent = e?.code === "ENOENT" || msg.includes("ENOENT");
      const isPtau = msg.includes(path.resolve(ptau)) || e?.path === path.resolve(ptau);
      if (isEnoent && isPtau) partial = true;
      else throw e;
    }
    if (ok) {
      console.log("\nRESULT: PASS (from init).");
      exitCode = 0;
    } else if (partial) {
      console.log(
        "\nRESULT: PARTIAL PASS — verified without the ptau:\n" +
        "  ✔ per-contribution transcript hashes (hash chain intact)\n" +
        "  ✔ per-contribution key pairings (G1/G2 same-ratio)\n" +
        "  ✔ beacon contribution reproduced from its public beacon hash\n" +
        "  ✔ delta chain consistent → final vk_delta matches the contributions\n" +
        "  ✔ IC / coefficient / A / B sections byte-identical to the init zkey\n" +
        "  ✔ L-section delta ratio consistent\n" +
        "  ✘ NOT verified: H-section consistency with the Powers of Tau\n" +
        "    (the one check that reads the ptau file)."
      );
      exitCode = 0;
    } else {
      console.log("\nRESULT: INVALID — a chain check failed before the ptau was needed.");
      exitCode = 1;
    }
    explainMissing();
  } else {
    // ---- tier 4: unverified listing --------------------------------------
    console.log(`\ntier 4 — no r1cs/ptau/init available: listing embedded chain (UNVERIFIED) …`);
    const { zkeyUtils, curves, binFileUtils, blake2b } = await loadSnarkjsInternals();
    const { fd, sections } = await binFileUtils.readBinFile(path.resolve(zkeyPath), "zkey", 2);
    const header = await zkeyUtils.readHeader(fd, sections, false);
    const curve = await curves.getCurveFromQ(header.q);
    const mpc = await zkeyUtils.readMPCParams(fd, curve, sections);
    await fd.close();

    console.log(`  protocol: ${header.protocol}, nVars ${header.nVars}, nPublic ${header.nPublic}, domainSize ${header.domainSize}`);
    console.log(formatHash(mpc.csHash, "  Circuit hash (csHash):"));
    console.log(`  contributions: ${mpc.contributions.length}`);
    mpc.contributions.forEach((c, i) => {
      const h = blake2b.create({ dkLen: 64 });
      zkeyUtils.hashPubKey(h, curve, c);
      const kind = c.type === 1
        ? `beacon (hash ${toHex(c.beaconHash)}, iterExp ${c.numIterationsExp})`
        : "contribution";
      console.log(`   #${i + 1} ${c.name || "(unnamed)"} — ${kind}`);
      console.log(`       hash ${toHex(h.digest())}`);
    });

    const snarkjs = loadSnarkjs();
    const vk = await snarkjs.zKey.exportVerificationKey(path.resolve(zkeyPath));
    console.log(`  verification key re-exported OK (nPublic ${vk.nPublic}).`);
    console.log(
      "\nRESULT: LISTING ONLY — nothing above is cryptographically verified.\n" +
      "Cross-check the names/hashes against the published transcript, then\n" +
      "obtain the artifacts below to actually verify."
    );
    explainMissing();
    exitCode = 0;
  }
} catch (e) {
  console.error(`✘ verification error: ${e?.stack || e}`);
  exitCode = 1;
}

process.exit(exitCode);
