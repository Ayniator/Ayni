#!/usr/bin/env node
// Re-vendors @solana/wallet-adapter-react-ui/styles.css into
// frontend/app/wallet-adapter.css with every third-party asset reference
// stripped. Run after upgrading the wallet-adapter packages.
//
// Upstream's first line imports Google Fonts, which on this app would make every
// page hand Google the member's IP, User-Agent and a Referer naming the page.
// See the generated file's header and tests/sentinel/no-third-party-assets-check.sh.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../frontend/node_modules/@solana/wallet-adapter-react-ui/styles.css");
const OUT = resolve(HERE, "../frontend/app/wallet-adapter.css");

const kept = [];
const removed = [];
for (let line of readFileSync(SRC, "utf8").split("\n")) {
  if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(line)) { removed.push(line.trim()); continue; }
  if (line.includes("DM Sans")) {
    removed.push(line.trim());
    line = line.replace(/'DM Sans', ?/g, "").replace(/"DM Sans", ?/g, "");
  }
  kept.push(line);
}
const stray = kept.filter((l) => /url\(\s*['"]?https?:\/\//.test(l) || /^\s*@import/.test(l));
if (stray.length) {
  console.error("refusing to vendor: unhandled remote reference(s):\n  " + stray.join("\n  "));
  process.exit(1);
}
const header = readFileSync(OUT, "utf8").split("*/")[0] + "*/\n";
writeFileSync(OUT, header + kept.join("\n"));
console.log(`re-vendored ${OUT}`);
console.log(`  stripped ${removed.length} line(s):`);
for (const r of removed) console.log("   -", r.slice(0, 100));
