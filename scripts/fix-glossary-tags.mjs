#!/usr/bin/env node
// One-off spelling repair applied to glossary/glossary_v1.xlsx IN PLACE.
//
//   "Budhism"       -> "Buddhism"     (a tag, splitting those terms off the
//                                      real Buddhism facet on /glossary)
//   "Freemassonery" -> "Freemasonry"  (a tag, misspelled)
//
// Kept as a script rather than done by hand because the xlsx is the source of
// record: a reviewer can re-run this and see exactly what changed, and the
// commit diff of a binary file shows nothing useful on its own.
//
// Rewrites only xl/sharedStrings.xml; every other zip entry is copied through
// byte-for-byte, so nothing about the workbook's structure, formatting or row
// count moves. Re-run scripts/build-glossary.mjs afterwards to regenerate
// frontend/public/glossary.json.
//
// Idempotent: running it twice changes nothing the second time.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync, deflateRawSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = resolve(ROOT, "glossary/glossary_v1.xlsx");

const FIXES = [
  ["Budhism", "Buddhism"],
  ["Freemassonery", "Freemasonry"],
];

const buf = readFileSync(FILE);

/* Read the central directory: name -> {method, data, ...}. */
let eocd = -1;
for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
  if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
}
if (eocd < 0) throw new Error("not a zip");
const count = buf.readUInt16LE(eocd + 10);
let p = buf.readUInt32LE(eocd + 16);

const entries = [];
for (let n = 0; n < count; n++) {
  const method = buf.readUInt16LE(p + 10);
  const compSize = buf.readUInt32LE(p + 20);
  const nameLen = buf.readUInt16LE(p + 28);
  const extraLen = buf.readUInt16LE(p + 30);
  const commentLen = buf.readUInt16LE(p + 32);
  const localOff = buf.readUInt32LE(p + 42);
  const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
  const lNameLen = buf.readUInt16LE(localOff + 26);
  const lExtraLen = buf.readUInt16LE(localOff + 28);
  const start = localOff + 30 + lNameLen + lExtraLen;
  const raw = buf.subarray(start, start + compSize);
  entries.push({ name, data: method === 0 ? Buffer.from(raw) : inflateRawSync(raw) });
  p += 46 + nameLen + extraLen + commentLen;
}

const target = entries.find((e) => e.name === "xl/sharedStrings.xml");
if (!target) throw new Error("no sharedStrings.xml");
let xml = target.data.toString("utf8");
let changed = 0;
for (const [from, to] of FIXES) {
  // Word-boundary so "Buddhism" is never re-matched and nothing longer is hit.
  const re = new RegExp(`\\b${from}\\b`, "g");
  const before = xml;
  xml = xml.replace(re, to);
  const n = (before.match(re) || []).length;
  if (n) console.log(`  ${from} -> ${to}: ${n} occurrence(s)`);
  changed += n;
}
if (!changed) {
  console.log("nothing to fix (already corrected)");
  process.exit(0);
}
target.data = Buffer.from(xml, "utf8");

/* Write a fresh zip (all deflated). */
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();
const crc32 = (b) => {
  let c = ~0;
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
};

const locals = [];
const central = [];
let offset = 0;
for (const e of entries) {
  const name = Buffer.from(e.name, "utf8");
  const comp = deflateRawSync(e.data, { level: 9 });
  const crc = crc32(e.data);

  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);      // version needed
  lh.writeUInt16LE(0x0800, 6);  // UTF-8 names
  lh.writeUInt16LE(8, 8);       // deflate
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(comp.length, 18);
  lh.writeUInt32LE(e.data.length, 22);
  lh.writeUInt16LE(name.length, 26);
  locals.push(lh, name, comp);

  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0);
  ch.writeUInt16LE(20, 4);
  ch.writeUInt16LE(20, 6);
  ch.writeUInt16LE(0x0800, 8);
  ch.writeUInt16LE(8, 10);
  ch.writeUInt32LE(crc, 16);
  ch.writeUInt32LE(comp.length, 20);
  ch.writeUInt32LE(e.data.length, 24);
  ch.writeUInt16LE(name.length, 28);
  ch.writeUInt32LE(offset, 42);
  central.push(ch, name);

  offset += 30 + name.length + comp.length;
}
const localBuf = Buffer.concat(locals);
const centralBuf = Buffer.concat(central);
const eocdBuf = Buffer.alloc(22);
eocdBuf.writeUInt32LE(0x06054b50, 0);
eocdBuf.writeUInt16LE(entries.length, 8);
eocdBuf.writeUInt16LE(entries.length, 10);
eocdBuf.writeUInt32LE(centralBuf.length, 12);
eocdBuf.writeUInt32LE(localBuf.length, 16);

writeFileSync(FILE, Buffer.concat([localBuf, centralBuf, eocdBuf]));
console.log(`rewrote ${FILE} (${entries.length} zip entries preserved)`);
