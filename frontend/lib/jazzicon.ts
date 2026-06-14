// Deterministic Jazzicon-style SVG identicon generator.
//
// Pure, self-contained, no third-party identicon/jazzicon dependency. The same
// input string ALWAYS produces byte-identical SVG. Uses a hand-rolled SHA-256
// (so it stays synchronous and works identically in the browser and in Node).
//
//   generateJazziconSvg(address, 64) -> "<svg ...>...</svg>"
//   jazziconDataUri(address, 64)     -> "data:image/svg+xml;base64,..."

// ---------------------------------------------------------------------------
// SHA-256 (FIPS 180-4) over the UTF-8 bytes of the input. Returns 32 bytes.
// ---------------------------------------------------------------------------
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function utf8Bytes(str: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff) {
      // surrogate pair
      const c2 = str.charCodeAt(++i);
      c = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return out;
}

export function sha256Bytes(message: string): Uint8Array {
  const bytes = utf8Bytes(message);
  const l = bytes.length;
  const bitLen = l * 8;

  // pad
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  // 64-bit big-endian length (high 32 bits effectively 0 for our inputs)
  bytes.push(0, 0, 0, 0);
  bytes.push((bitLen >>> 24) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 8) & 0xff, bitLen & 0xff);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const w = new Array<number>(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] =
        (bytes[off + i * 4] << 24) |
        (bytes[off + i * 4 + 1] << 16) |
        (bytes[off + i * 4 + 2] << 8) |
        bytes[off + i * 4 + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }

  const out = new Uint8Array(32);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((hv, i) => {
    out[i * 4] = (hv >>> 24) & 0xff;
    out[i * 4 + 1] = (hv >>> 16) & 0xff;
    out[i * 4 + 2] = (hv >>> 8) & 0xff;
    out[i * 4 + 3] = hv & 0xff;
  });
  return out;
}

// ---------------------------------------------------------------------------
// HSL -> RGB (h in degrees 0..360, s & l in 0..1) -> "rgb(r,g,b)".
// ---------------------------------------------------------------------------
function hslToRgb(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp >= 0 && hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  const R = Math.round((r + m) * 255);
  const G = Math.round((g + m) * 255);
  const B = Math.round((b + m) * 255);
  return `rgb(${R},${G},${B})`;
}

const f1 = (n: number) => (Math.round(n * 10) / 10).toString(); // 1 decimal
const f2 = (n: number) => n.toFixed(2); // 2 decimals

/**
 * Generate a deterministic Jazzicon-style SVG for `address` (or any string).
 * The same input always yields byte-identical SVG markup.
 */
export function generateJazziconSvg(address: string, size = 64): string {
  const h = sha256Bytes(address.toLowerCase());

  // Addresses starting with "AHA" render in the PURPLE/VIOLET family (the AHA
  // accent) instead of the full hue wheel — and this constrains the ENTIRE
  // palette (background AND every shape), so the whole coin reads purple and
  // never orange/yellow. Case-insensitive (like the hashed seed). (Regression:
  // see tests/jazzicon.ts.)
  const isAha = address.toUpperCase().startsWith("AHA");

  // 1. Palette of 8 vivid colors.
  const colors: string[] = [];
  for (let i = 0; i < 8; i++) {
    // Non-AHA: full 0–360 hue wheel. AHA: 255–305 (violet → purple → magenta).
    const hue = isAha ? 255 + (h[i] / 255) * 50 : (h[i] * 360) / 255;
    const sat = 0.7 + (h[i + 8] / 255) * 0.3;
    const light = 0.45 + (h[i + 16] / 255) * 0.2;
    colors.push(hslToRgb(hue, sat, light));
  }

  // Background gradient stops (already purple for AHA via the palette above).
  const bg0 = colors[0];
  const bg1 = colors[1];

  // 2. Gradients: 4 diagonal linear + 1 radial background.
  let defs = `<clipPath id="circleClip"><circle cx="50" cy="50" r="50"/></clipPath>`;
  for (let i = 0; i < 4; i++) {
    const a = colors[(2 * i) % 8];
    const b = colors[(2 * i + 1) % 8];
    defs +=
      `<linearGradient id="grad${i}" x1="0%" y1="0%" x2="100%" y2="100%">` +
      `<stop offset="0%" stop-color="${a}" stop-opacity="0.9"/>` +
      `<stop offset="100%" stop-color="${b}" stop-opacity="0.9"/>` +
      `</linearGradient>`;
  }
  defs +=
    `<radialGradient id="bgGrad" cx="50%" cy="50%" r="75%">` +
    `<stop offset="0%" stop-color="${bg0}" stop-opacity="1"/>` +
    `<stop offset="100%" stop-color="${bg1}" stop-opacity="1"/>` +
    `</radialGradient>`;

  // 3. Shape layers (4..6).
  const numLayers = 4 + (h[24] % 3);
  let shapes = "";
  for (let i = 0; i < numLayers; i++) {
    let idx = 25 + i * 4;
    if (idx >= 28) idx = i * 4; // stay within the 32-byte hash window
    const pattern = h[idx] % 4;
    const rotation = (h[idx + 1] * 360) / 255;
    const opacity = f2(0.6 + (h[idx + 3] / 255) * 0.4);
    const gradId = `grad${i % 4}`;

    if (pattern === 0) {
      const cx = 30 + (h[idx] % 40);
      const cy = 30 + (h[idx + 1] % 40);
      const r = 20 + (h[idx + 2] % 30);
      shapes += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${gradId})" opacity="${opacity}"/>`;
    } else if (pattern === 1) {
      const n = 5 + (h[idx] % 3);
      const pts: string[] = [];
      for (let p = 0; p < n; p++) {
        const angle = (p / n) * 2 * Math.PI;
        const radius = 30 + (h[(idx + p) % 32] % 20);
        const x = 50 + radius * Math.cos(angle);
        const y = 50 + radius * Math.sin(angle);
        pts.push(`${f1(x)},${f1(y)}`);
      }
      shapes += `<polygon points="${pts.join(" ")}" fill="url(#${gradId})" opacity="${opacity}"/>`;
    } else if (pattern === 2) {
      const cx = 30 + (h[idx] % 40);
      const cy = 30 + (h[idx + 1] % 40);
      const rx = 15 + (h[idx + 2] % 25);
      const ry = 10 + (h[idx + 3] % 20);
      shapes +=
        `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" ` +
        `transform="rotate(${f2(rotation)} ${cx} ${cy})" fill="url(#${gradId})" opacity="${opacity}"/>`;
    } else {
      const x = 20 + (h[idx] % 40);
      const y = 20 + (h[idx + 1] % 40);
      const w = 20 + (h[idx + 2] % 30);
      const hh = 20 + (h[idx + 3] % 30);
      shapes +=
        `<rect x="${x}" y="${y}" width="${w}" height="${hh}" rx="10" ry="10" ` +
        `transform="rotate(${f2(rotation)} 50 50)" fill="url(#${gradId})" opacity="${opacity}"/>`;
    }
  }

  // 4. Assemble.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}">` +
    `<defs>${defs}</defs>` +
    `<g clip-path="url(#circleClip)">` +
    `<circle cx="50" cy="50" r="50" fill="url(#bgGrad)"/>` +
    shapes +
    `</g>` +
    `<circle cx="50" cy="50" r="49" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="1.5"/>` +
    `</svg>`
  );
}

/** Base64 `data:` URI of the identicon SVG (for `<img src=...>`). */
export function jazziconDataUri(address: string, size = 64): string {
  const svg = generateJazziconSvg(address, size);
  const b64 =
    typeof Buffer !== "undefined"
      ? Buffer.from(svg, "utf8").toString("base64")
      : btoa(unescape(encodeURIComponent(svg)));
  return `data:image/svg+xml;base64,${b64}`;
}
