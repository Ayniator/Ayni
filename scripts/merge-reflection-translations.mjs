#!/usr/bin/env node
// Merges translated Daily Reflections from a translation-workflow journal into
// the `i18n` map of frontend/public/reflections.json (the dataset the app
// fetches; it is deliberately not in the client bundle).
//
//   node scripts/merge-reflection-translations.mjs <journal.jsonl> [--partial]
//
// By default only locales with a FULL set of entries are merged, so a tab in the
// regenerated workbook is never half-English. Pass --partial to include locales
// that are still in progress (the app already degrades per-field to English, so
// partial data is safe to ship — it is only the workbook that reads oddly).

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(HERE, "../frontend/public/reflections.json");

const journal = process.argv[2];
const allowPartial = process.argv.includes("--partial");
if (!journal) {
  console.error("usage: merge-reflection-translations.mjs <journal.jsonl> [--partial]");
  process.exit(1);
}

const payload = JSON.parse(readFileSync(DATA, "utf8"));
const en = payload.en;
if (!en || !Object.keys(en).length) throw new Error("no English entries in " + DATA);
const enKeys = Object.keys(en);

// Collect per-locale entries; halves of the same locale merge together.
const byLang = {};
for (const line of readFileSync(journal, "utf8").split("\n").filter(Boolean)) {
  let o;
  try { o = JSON.parse(line); } catch { continue; }
  if (o.type !== "result" || !o.result?.lang || !o.result?.entries) continue;
  byLang[o.result.lang] = Object.assign(byLang[o.result.lang] || {}, o.result.entries);
}

const merged = {};
const report = [];
for (const [lang, entries] of Object.entries(byLang)) {
  const have = enKeys.filter((k) => entries[k]?.title || entries[k]?.quote).length;
  const complete = have >= enKeys.length;
  report.push(`${lang}:${have}/${enKeys.length}${complete ? "" : " (partial)"}`);
  if (!complete && !allowPartial) continue;
  // Keep only known keys, and only the four translatable fields — citations
  // (author, source, step) stay in their original form by design.
  const clean = {};
  for (const k of enKeys) {
    const e = entries[k];
    if (!e) continue;
    const o = {};
    for (const f of ["title", "quote", "reflection", "denomination"]) {
      if (typeof e[f] === "string" && (e[f] || f === "reflection")) o[f] = e[f];
    }
    if (Object.keys(o).length) clean[k] = o;
  }
  merged[lang] = clean;
}

// Order to match the language switcher.
const ORDER = ["fr", "es", "se", "th", "hi", "zh", "de", "sv", "nb", "da", "ar", "lo", "dz", "bo", "my", "vi", "tl", "qu"];
const ordered = {};
for (const c of ORDER) if (merged[c]) ordered[c] = merged[c];
for (const c of Object.keys(merged)) if (!ordered[c]) ordered[c] = merged[c];

// `keys` is rewritten from the English map rather than carried over, so the two
// halves of the file can never disagree about which days exist.
payload.i18n = ordered;
payload.keys = enKeys.slice().sort();
writeFileSync(DATA, JSON.stringify(payload, null, 2) + "\n", "utf8");

console.log("coverage: " + report.sort().join("  "));
console.log(`merged ${Object.keys(ordered).length} locale(s) into ${DATA}${allowPartial ? " (including partial)" : ""}`);
