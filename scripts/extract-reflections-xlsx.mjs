#!/usr/bin/env node
// Regenerates the built-in Daily Reflections FROM
// daily_reflexions/daily_reflexions.xlsx — the direction a human edit travels.
//
//   node scripts/extract-reflections-xlsx.mjs
//
// Two outputs, because the data is ~2.5 MB and must NOT sit in the client
// bundle (see the header of frontend/lib/daily-reflections-default.ts):
//
//   frontend/public/reflections.json    the data — fetched at runtime, cached
//                                       by the browser, same shape as the
//                                       glossary's public/glossary.json
//   frontend/lib/daily-reflections-default.ts
//                                       types + the tiny key list + the loader
//
// The workbook is the source of record for the content; the JSON is what the
// app reads. `build-reflections-xlsx.mjs` goes the other way (JSON -> xlsx) to
// refresh the human-readable mirror. Keep both, and be clear which you are
// running: the xlsx wins when a person has edited it, the JSON wins when a
// translation pass has merged into it.
//
// COLUMNS ARE MATCHED BY HEADER NAME, never by position. The glossary extractor
// learned this the expensive way: a spreadsheet column inserted or reordered by
// a well-meaning editor silently shifts every field one to the left, and the
// result looks like real data. If a required header is missing, this stops.
//
// OOXML is parsed by hand (zip + XML) so the repo needs no spreadsheet
// dependency — same approach as scripts/build-glossary.mjs.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));
const XLSX = resolve(HERE, "../daily_reflexions/daily_reflexions.xlsx");
const TS = resolve(HERE, "../frontend/lib/daily-reflections-default.ts");
const JSON_OUT = resolve(HERE, "../frontend/public/reflections.json");

// Sheet name -> app locale. English is the source of record; the rest land in
// REFLECTIONS_I18N. Sheets not listed here are ignored rather than guessed at.
const LOCALE_OF_SHEET = {
  English: "en",
  Francais: "fr",
  Espanol: "es",
  Sami: "se",
  Thai: "th",
  Hindi: "hi",
  Chinese: "zh",
  Deutsch: "de",
  Svenska: "sv",
  Norsk: "nb",
  Dansk: "da",
  Arabic: "ar",
  Lao: "lo",
  Dzongkha: "dz",
  Tibetan: "bo",
  Burmese: "my",
  Vietnamese: "vi",
  Tagalog: "tl",
  "Runa Simi": "qu",
};

// Header text -> field. Matched case-insensitively after trimming.
const FIELD_OF_HEADER = {
  date: "date",
  title: "title",
  content: "quote",
  "reflexion on the content": "reflection",
  "related 12 step": "step",
  "author & ref": "author",
  denomination: "denomination",
  source: "source",
};
const REQUIRED = ["date", "title", "content"];

// --- a minimal zip reader (stored + deflate) -------------------------------
function unzip(buf) {
  const files = {};
  // Walk the central directory from the End Of Central Directory record.
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("not a zip file (no EOCD)");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory entry");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString("utf8");
    // The local header's own name/extra lengths are authoritative for the offset.
    const lnlen = buf.readUInt16LE(lho + 26);
    const lelen = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lnlen + lelen;
    const raw = buf.slice(start, start + csize);
    files[name] = method === 0 ? raw : inflateRawSync(raw);
    p += 46 + nlen + elen + clen;
  }
  return files;
}

const unesc = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");

const stripTags = (s) => unesc(s.replace(/<[^>]+>/g, ""));

function main() {
  const files = unzip(readFileSync(XLSX));
  const txt = (n) => (files[n] ? files[n].toString("utf8") : "");

  // Shared strings, if the writer used them.
  const shared = [];
  const sx = txt("xl/sharedStrings.xml");
  if (sx) for (const m of sx.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(stripTags(m[1]));

  // Sheet name -> part path, via the workbook rels.
  const wb = txt("xl/workbook.xml");
  const rels = txt("xl/_rels/workbook.xml.rels");
  const relMap = {};
  for (const m of rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) relMap[m[1]] = m[2];
  const sheets = [];
  for (const m of wb.matchAll(/<sheet[^>]*name="([^"]*)"[^>]*r:id="([^"]*)"/g)) {
    const target = relMap[m[2]] || "";
    sheets.push([unesc(m[1]), "xl/" + target.replace(/^\/?xl\//, "").replace(/^\//, "")]);
  }

  const cellsOf = (row) => {
    const out = {};
    for (const m of row.matchAll(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)) {
      const c = m[0];
      const ref = /r="([A-Z]+)\d+"/.exec(c);
      if (!ref) continue;
      const t = /t="([^"]+)"/.exec(c);
      const is = /<is>([\s\S]*?)<\/is>/.exec(c);
      const v = /<v>([\s\S]*?)<\/v>/.exec(c);
      let val = "";
      if (is) val = stripTags(is[1]);
      else if (v) {
        const raw = unesc(v[1]);
        val = t && t[1] === "s" && /^\d+$/.test(raw) ? shared[Number(raw)] ?? "" : raw;
      }
      out[ref[1]] = val.trim();
    }
    return out;
  };

  const byLocale = {};
  const report = [];

  for (const [name, path] of sheets) {
    const locale = LOCALE_OF_SHEET[name];
    if (!locale || !files[path]) continue;
    const doc = files[path].toString("utf8");
    const rows = [...doc.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((m) => m[1]);
    if (rows.length === 0) continue;

    // Column letter -> field, from the HEADER ROW.
    const header = cellsOf(rows[0]);
    const colField = {};
    for (const [col, text] of Object.entries(header)) {
      const f = FIELD_OF_HEADER[text.toLowerCase().trim()];
      if (f) colField[col] = f;
    }
    const have = new Set(Object.values(colField));
    const missing = REQUIRED.filter((f) => !have.has(FIELD_OF_HEADER[f] ?? f));
    if (missing.length) {
      throw new Error(
        `sheet "${name}": required column(s) not found by header: ${missing.join(", ")}\n` +
          `  headers seen: ${Object.values(header).join(" | ")}`
      );
    }

    const entries = {};
    let skipped = 0;
    for (const row of rows.slice(1)) {
      const c = cellsOf(row);
      const rec = {};
      for (const [col, field] of Object.entries(colField)) rec[field] = c[col] ?? "";
      const date = (rec.date || "").trim();
      // "MM-DD" only. A blank or malformed date is a spreadsheet artefact (a
      // trailing empty row, a note); skipping it silently is right, but the
      // count is reported so a mis-parse cannot hide as "a few blanks".
      if (!/^\d{2}-\d{2}$/.test(date)) {
        if (Object.values(rec).some((v) => v)) skipped++;
        continue;
      }
      if (!rec.title && !rec.quote) { skipped++; continue; }
      const e = {
        title: rec.title || "",
        quote: rec.quote || "",
        reflection: rec.reflection || "",
        author: rec.author || "",
        denomination: rec.denomination || "",
        source: rec.source || "",
      };
      const step = (rec.step || "").trim();
      if (step) e.step = step;
      // Later rows win on a duplicate date, and duplicates are reported.
      if (entries[date]) skipped++;
      entries[date] = e;
    }
    byLocale[locale] = entries;
    report.push({ sheet: name, locale, entries: Object.keys(entries).length, skipped });
  }

  const en = byLocale.en;
  if (!en || Object.keys(en).length === 0) throw new Error("no English entries found");

  // Non-English locales carry ONLY the dates English has: an entry with no
  // English counterpart could never be shown (the page picks the day from the
  // English set and falls back per field), so shipping it would be dead weight
  // that reads as coverage.
  const orphans = {};
  for (const [loc, map] of Object.entries(byLocale)) {
    if (loc === "en") continue;
    const extra = Object.keys(map).filter((d) => !(d in en));
    if (extra.length) orphans[loc] = extra;
    for (const d of extra) delete map[d];
  }

  // Translations carry only the PROSE fields. author / source / step are
  // citations — "John 1:1" is the same reference in every language, and a
  // "translated" citation is either identical (noise in the diff) or wrong (a
  // mangled reference nobody can look up). This mirrors the contract the
  // previous generated file documented, and dropping it would quietly change
  // what a translator is being asked for.
  const TRANSLATED_FIELDS = ["title", "quote", "reflection", "denomination"];
  const i18n = {};
  for (const [loc, map] of Object.entries(byLocale)) {
    if (loc === "en") continue;
    const out = {};
    for (const [date, e] of Object.entries(map)) {
      const t = {};
      for (const f of TRANSLATED_FIELDS) {
        // Only keep a field that actually differs from English: an identical
        // string is not a translation, and storing it doubles the file for
        // nothing while making "translated" mean less on the page.
        if (e[f] && e[f] !== (en[date]?.[f] ?? "")) t[f] = e[f];
      }
      if (Object.keys(t).length) out[date] = t;
    }
    i18n[loc] = out;
  }

  const keys = Object.keys(en).sort();

  // The data file. Everything the page can show lives here and NOWHERE in the
  // bundle: `keys` is duplicated into it (the TS module carries the same list)
  // so a consumer that has only the JSON — the Sentinel gate, the workbook
  // rebuild — needs no second source.
  writeFileSync(JSON_OUT, JSON.stringify({ en, i18n, keys }, null, 2) + "\n", "utf8");

  const out = `// GENERATED from daily_reflexions/daily_reflexions.xlsx — the platform's built-in
// Daily Reflections, shown on /reflections when no Circle has published an entry
// for the chosen day. Content is sourced material (scripture, philosophy,
// literature) and is intentionally kept in its original language where no
// translation exists; the page falls back per field to English.
//
// Regenerate with:  node scripts/extract-reflections-xlsx.mjs
// Do not hand-edit — edit the workbook and re-run.
//
// ⚠ WEIGHT — why the entries are not in this file. The dataset is ~2.5 MB and
// /reflections is a client component, so an inlined \`DEFAULT_REFLECTIONS\`
// object shipped all of it to every browser on every visit, including the ~99.7%
// of days nobody asked for and the 18 locales the reader does not speak. The
// data now lives in \`frontend/public/reflections.json\` and is fetched once, on
// demand, exactly as the glossary does it. What stays here is what is cheap and
// what the render path needs synchronously: the types and the date list (the
// calendar's dots). Do not re-inline the entries.
//
// Keyed "MM-DD". ${keys.length} dated entries across all 12 months. When a day has no
// exact entry, the page falls back to the nearest available date (circular
// distance), so a partial year still shows something every day.

export interface DefaultReflection {
  title: string;
  quote: string;
  reflection: string;
  author: string;
  denomination: string;
  source: string;
  step?: string;
}

/** What a translation may carry. Citation fields (author, source, step) are
 *  deliberately absent: a reference reads the same in every language, and a
 *  "translated" citation is either identical or unusable. */
export type TranslatedReflection = Partial<
  Pick<DefaultReflection, "title" | "quote" | "reflection" | "denomination">
>;

/** Every date that has an entry, sorted. Small enough to ship (a few kB), and
 *  the calendar needs it during the first render to draw its dots — fetching it
 *  would make the grid flicker for no saving worth having. */
export const REFLECTION_KEYS: string[] = ${JSON.stringify(keys)};

/** The fetched payload: English entries, plus per-locale translations keyed by
 *  locale then "MM-DD". A missing locale, date or field falls back to the
 *  English entry — so a partial translation is safe to ship and degrades field
 *  by field rather than all at once. A field identical to English is omitted
 *  rather than duplicated. */
export interface ReflectionData {
  en: Record<string, DefaultReflection>;
  i18n: Record<string, Record<string, TranslatedReflection>>;
}

// One in-flight/settled promise per page load: every caller shares the single
// fetch, and the browser cache handles repeat visits. A failure clears the
// cache so the next attempt retries rather than inheriting a dead promise.
let pending: Promise<ReflectionData> | null = null;

/** Load the built-in Daily Reflections dataset (once). */
export async function loadReflections(): Promise<ReflectionData> {
  if (!pending) {
    pending = fetch("/reflections.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("reflections.json: " + r.status))))
      .then((d) => ({ en: d?.en ?? {}, i18n: d?.i18n ?? {} }))
      .catch((e) => {
        pending = null;
        throw e;
      });
  }
  return pending;
}
`;

  writeFileSync(TS, out, "utf8");

  console.log("Daily Reflections extracted from the workbook:\n");
  for (const r of report) {
    const extra = orphans[r.locale]?.length ?? 0;
    console.log(
      `  ${r.sheet.padEnd(12)} ${r.locale.padEnd(3)} ${String(r.entries).padStart(4)} entries` +
        (r.skipped ? `  (${r.skipped} skipped)` : "") +
        (extra ? `  (${extra} dropped: no English counterpart)` : "")
    );
  }
  console.log(`\n  English is the source of record: ${Object.keys(en).length} dates.`);
  console.log(`  Wrote ${JSON_OUT}`);
  console.log(`  Wrote ${TS}`);
}

main();
