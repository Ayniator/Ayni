#!/usr/bin/env node
// Merges translated Daily Reflections from a translation-workflow journal into
// REFLECTIONS_I18N in frontend/lib/daily-reflections-default.ts.
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
const TS = resolve(HERE, "../frontend/lib/daily-reflections-default.ts");

const journal = process.argv[2];
const allowPartial = process.argv.includes("--partial");
if (!journal) {
  console.error("usage: merge-reflection-translations.mjs <journal.jsonl> [--partial]");
  process.exit(1);
}

const src = readFileSync(TS, "utf8");
const enMatch = src.match(/DEFAULT_REFLECTIONS: Record<string, DefaultReflection> = (\{[\s\S]*?\n\});/);
if (!enMatch) throw new Error("DEFAULT_REFLECTIONS not found");
const en = eval("(" + enMatch[1] + ")");
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

const body = JSON.stringify(ordered, null, 2);
const out = src.replace(
  /export const REFLECTIONS_I18N: Record<string, Record<string, TranslatedReflection>> = \{[\s\S]*?\};\s*$/,
  `export const REFLECTIONS_I18N: Record<string, Record<string, TranslatedReflection>> = ${body};\n`
);
if (out === src) throw new Error("REFLECTIONS_I18N block not found / not replaced");
writeFileSync(TS, out);

console.log("coverage: " + report.sort().join("  "));
console.log(`merged ${Object.keys(ordered).length} locale(s) into REFLECTIONS_I18N${allowPartial ? " (including partial)" : ""}`);
