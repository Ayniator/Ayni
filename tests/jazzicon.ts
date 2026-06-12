import { assert } from "chai";
import { generateJazziconSvg, jazziconDataUri, sha256Bytes } from "../frontend/lib/jazzicon";

// Pure unit test — no validator/provider needed.
describe("jazzicon identicon (deterministic)", () => {
  const addr = "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS";

  it("is byte-identical for the same input", () => {
    const a = generateJazziconSvg(addr, 64);
    const b = generateJazziconSvg(addr, 64);
    assert.strictEqual(a, b, "same address must produce identical SVG");
  });

  it("is case-insensitive on the address (lowercased seed)", () => {
    assert.strictEqual(
      generateJazziconSvg(addr.toUpperCase(), 48),
      generateJazziconSvg(addr.toLowerCase(), 48)
    );
  });

  it("differs for different inputs", () => {
    assert.notStrictEqual(generateJazziconSvg("alice", 64), generateJazziconSvg("bob", 64));
  });

  it("produces a well-formed circular SVG of the requested size", () => {
    const svg = generateJazziconSvg(addr, 80);
    assert.match(svg, /^<svg /);
    assert.include(svg, 'viewBox="0 0 100 100"');
    assert.include(svg, 'width="80" height="80"');
    assert.include(svg, 'clip-path="url(#circleClip)"');
    assert.include(svg, 'stroke="rgba(255,255,255,0.25)"'); // overlay ring
    assert.include(svg, "</svg>");
  });

  it("emits a base64 data URI", () => {
    const uri = jazziconDataUri(addr, 32);
    assert.match(uri, /^data:image\/svg\+xml;base64,/);
  });

  it("SHA-256 matches the known test vector for the empty string", () => {
    const hex = Buffer.from(sha256Bytes("")).toString("hex");
    assert.strictEqual(
      hex,
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });
});
