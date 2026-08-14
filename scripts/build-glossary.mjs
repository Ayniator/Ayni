#!/usr/bin/env node
// Extracts glossary/glossary_v1.xlsx into frontend/public/glossary.json, the
// file the /glossary page fetches at runtime.
//
// Input  : glossary/glossary_v1.xlsx   (the human-editable source of record)
// Output : frontend/public/glossary.json
// Run    : node scripts/build-glossary.mjs
//
// Reads the OOXML package by hand — zip central directory + inflateRaw + a
// small XML scan — so the repo needs no spreadsheet dependency, the same
// stance scripts/build-reflections-xlsx.mjs takes for writing.
//
// The xlsx stays the source of record: edit it, re-run this, commit both. The
// page never parses the spreadsheet itself.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(ROOT, "glossary/glossary_v1.xlsx");
const OUT = resolve(ROOT, "frontend/public/glossary.json");

/* ---------------------------------------------------------------- zip reader */

/** Read a zip's central directory and return { name -> Buffer } (inflated). */
function unzip(buf) {
  // End of Central Directory: signature 0x06054b50, scanned from the tail
  // because the trailing comment is variable length.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip: no end-of-central-directory record");

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // central directory offset

  const files = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory entry");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);

    // Local header: name/extra lengths there can differ from the central copy,
    // so the data offset must be computed from the LOCAL header, not this one.
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);

    files[name] = method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/* ---------------------------------------------------------------- xlsx parse */

const unescapeXml = (s) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&"); // last, so "&amp;lt;" does not become "<"

/** sharedStrings.xml -> array of plain strings (rich-text runs concatenated). */
function sharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const runs = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unescapeXml(t[1]));
    out.push(runs.join(""));
  }
  return out;
}

const colOf = (ref) => {
  // "BC12" -> zero-based column index
  const letters = ref.match(/^[A-Z]+/)[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** A worksheet as an array of row-arrays of strings. */
function sheetRows(xml, strings) {
  const rows = [];
  for (const r of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const c of r[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = c[1];
      const ref = attrs.match(/r="([A-Z]+\d+)"/);
      const type = attrs.match(/t="([^"]+)"/)?.[1];
      const body = c[2];
      let value = "";
      if (type === "s") {
        const i = Number(unescapeXml(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "-1"));
        value = strings[i] ?? "";
      } else if (type === "inlineStr") {
        value = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unescapeXml(t[1])).join("");
      } else {
        value = unescapeXml(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "");
      }
      const idx = ref ? colOf(ref[1]) : cells.length;
      while (cells.length < idx) cells.push("");
      cells[idx] = value.trim();
    }
    rows.push(cells);
  }
  return rows;
}

/* ---------------------------------------------------------------------- main */

const zip = unzip(readFileSync(SRC));
const strings = sharedStrings(zip["xl/sharedStrings.xml"]?.toString("utf8"));

// Map sheet name -> target file via workbook.xml order + workbook.xml.rels.
const wbXml = zip["xl/workbook.xml"].toString("utf8");
const relsXml = zip["xl/_rels/workbook.xml.rels"].toString("utf8");
const relTarget = {};
for (const m of relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
  relTarget[m[1]] = m[2].replace(/^\/?xl\//, "");
}
const sheets = {};
for (const m of wbXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
  const path = "xl/" + relTarget[m[2]];
  if (zip[path]) sheets[unescapeXml(m[1])] = sheetRows(zip[path].toString("utf8"), strings);
}

const glossaryRows = sheets["Glossary"] || [];
if (!glossaryRows.length) throw new Error("no 'Glossary' sheet found");

// Header row names the columns; match by name so a column reorder in the
// spreadsheet cannot silently shift the data.
const header = glossaryRows[0].map((h) => h.toLowerCase().trim());
const col = (...names) => {
  for (const n of names) {
    const i = header.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
};
const iWord = col("words", "word", "term");
const iExpl = col("explanation", "definition", "meaning");
const iTag = col("tag", "tags");
const iRel = col("related to", "related", "see also");
if (iWord < 0 || iExpl < 0) throw new Error(`unexpected header: ${JSON.stringify(glossaryRows[0])}`);

const splitList = (s) =>
  (s || "")
    .split(/[;|]/)
    .map((x) => x.trim())
    .filter(Boolean);

const entries = [];
for (const row of glossaryRows.slice(1)) {
  const word = (row[iWord] || "").trim();
  const explanation = (row[iExpl] || "").trim();
  if (!word && !explanation) continue; // blank spacer row
  if (!word) continue; // an explanation with no term is unusable, drop loudly below
  entries.push({
    word,
    explanation,
    tags: iTag >= 0 ? splitList(row[iTag]) : [],
    related: iRel >= 0 ? splitList(row[iRel]) : [],
  });
}

// Tag legend sheet: "tag" -> "what it means", if present.
const legend = {};
for (const row of sheets["Tag legend"] || []) {
  const [k, v] = [(row[0] || "").trim(), (row[1] || "").trim()];
  if (!k || /^tag$/i.test(k)) continue;
  legend[k] = v;
}

const dropped = glossaryRows.length - 1 - entries.length;
const payload = {
  _comment:
    "GENERATED by scripts/build-glossary.mjs from glossary/glossary_v1.xlsx. " +
    "Do not hand-edit: edit the spreadsheet and re-run the script. Fetched at " +
    "runtime by frontend/app/glossary/page.tsx.",
  source: "glossary/glossary_v1.xlsx",
  count: entries.length,
  legend,
  entries,
};

writeFileSync(OUT, JSON.stringify(payload, null, 1));
const tags = new Set(entries.flatMap((e) => e.tags));
console.log(`sheets      : ${Object.keys(sheets).join(", ")}`);
console.log(`entries     : ${entries.length}${dropped ? ` (skipped ${dropped} blank/termless row(s))` : ""}`);
console.log(`distinct tag: ${tags.size}`);
console.log(`legend rows : ${Object.keys(legend).length}`);
console.log(`wrote       : ${OUT} (${(JSON.stringify(payload).length / 1024).toFixed(0)} KB)`);
