import { assert } from "chai";
import * as fs from "fs";
import * as path from "path";
import nacl from "tweetnacl";
import {
  MBX_CT_LEN,
  MBX_PLAINTEXT_LEN,
  PrekeyBundle,
  InnerEnvelope,
  ackSignedBytes,
  getSignedBytes,
  mailboxGetWindow,
  innerSignedBytes,
  mailboxIdForWallet,
  mbxB64,
  mbxUnb64,
  mbxPad,
  mbxUnpad,
  openSealed,
  sealToBundle,
  spkSignedBytes,
  verifyBundle,
  verifyInner,
} from "../frontend/lib/mailboxCrypto";

// F63 (v1) — property tests of the off-chain mailbox crypto. Pure: no chain,
// no validator, no network — the module under test is the same one the relay
// route and the client transport share, so what passes here IS the contract.
describe("mailbox — F63 off-chain sealed-sender crypto", () => {
  // A "wallet": an Ed25519 signing pair (what signMessage uses).
  const wallet = nacl.sign.keyPair();
  const walletPub = wallet.publicKey;
  const sign = (m: Uint8Array) => nacl.sign.detached(m, wallet.secretKey);

  // The recipient's keys: IK (long-term) + SPK (rotating).
  const ik = nacl.box.keyPair();
  const spk = nacl.box.keyPair();
  const EPOCH = 3;

  const bundle: PrekeyBundle = {
    v: 1,
    wallet: "TESTWALLETBASE58PLACEHOLDERxxxxxxxxxxxxxxxx",
    ik: mbxB64(ik.publicKey),
    spk: mbxB64(spk.publicKey),
    epoch: EPOCH,
    sig: mbxB64(sign(spkSignedBytes(spk.publicKey, EPOCH))),
  };

  const sender = nacl.sign.keyPair();
  const makeInner = (body: string): InnerEnvelope => {
    const ts = 1_700_000_000;
    return {
      v: 3,
      from: "SENDERWALLETBASE58PLACEHOLDERxxxxxxxxxxxxxx",
      ts,
      body,
      sig: mbxB64(nacl.sign.detached(innerSignedBytes(ik.publicKey, ts, body), sender.secretKey)),
    };
  };

  it("bundle signature: genuine verifies, forged/rolled ones do not", () => {
    assert.isTrue(verifyBundle(bundle, walletPub), "genuine bundle verifies");
    assert.isFalse(verifyBundle({ ...bundle, epoch: EPOCH + 1 }, walletPub), "epoch tamper breaks the signature");
    assert.isFalse(verifyBundle({ ...bundle, spk: mbxB64(nacl.box.keyPair().publicKey) }, walletPub), "substituted prekey breaks the signature");
    assert.isFalse(verifyBundle(bundle, nacl.sign.keyPair().publicKey), "wrong wallet key does not verify");
  });

  it("seal → open roundtrip with the SPK secret; nothing but the right secret opens", () => {
    const env = sealToBundle(bundle, makeInner("hola hermano"), 0);
    assert.equal(mbxUnb64(env.ct).length, MBX_CT_LEN, "ciphertext is exactly the fixed length");
    assert.equal(env.spkEpoch, EPOCH);

    const opened = openSealed(env, [spk.secretKey]);
    assert.isNotNull(opened, "the SPK secret opens it");
    assert.equal(opened!.body, "hola hermano");
    assert.isTrue(verifyInner(opened!, ik.publicKey, sender.publicKey), "inner authorship verifies");

    assert.isNull(openSealed(env, [nacl.box.keyPair().secretKey]), "a wrong secret opens nothing");
    assert.isNull(openSealed(env, [ik.secretKey]), "the IK is NOT a fallback — deleted prekeys mean deleted mail (forward secrecy)");
    // Newest-first list with the right key later still works (rotation window).
    assert.isNotNull(openSealed(env, [nacl.box.keyPair().secretKey, spk.secretKey]));
  });

  it("fails loudly-silently on tamper: any flipped ciphertext bit yields null, never garbage", () => {
    const env = sealToBundle(bundle, makeInner("integrity"), 0);
    const ct = mbxUnb64(env.ct);
    ct[100] ^= 0x01;
    assert.isNull(openSealed({ ...env, ct: mbxB64(ct) }, [spk.secretKey]));
    const nonce = mbxUnb64(env.nonce);
    nonce[0] ^= 0x01;
    assert.isNull(openSealed({ ...env, nonce: mbxB64(nonce) }, [spk.secretKey]));
  });

  it("inner signature binds body, recipient and time — reattribution fails", () => {
    const env = sealToBundle(bundle, makeInner("bind me"), 0);
    const opened = openSealed(env, [spk.secretKey])!;
    assert.isFalse(verifyInner({ ...opened, body: "bind me!" }, ik.publicKey, sender.publicKey), "body tamper");
    assert.isFalse(verifyInner({ ...opened, ts: opened.ts + 1 }, ik.publicKey, sender.publicKey), "time tamper");
    assert.isFalse(verifyInner(opened, nacl.box.keyPair().publicKey, sender.publicKey), "different recipient IK");
    assert.isFalse(verifyInner(opened, ik.publicKey, nacl.sign.keyPair().publicKey), "claimed author is not the signer");
  });

  it("padding: every body length yields the same ciphertext size (no length signal)", () => {
    const sizes = new Set<number>();
    for (const body of ["a", "medium length message body", "x".repeat(700)]) {
      sizes.add(mbxUnb64(sealToBundle(bundle, makeInner(body), 0).ct).length);
    }
    assert.deepEqual([...sizes], [MBX_CT_LEN], "one size for all bodies");
    // pad/unpad inverse.
    const raw = new TextEncoder().encode("roundtrip");
    assert.equal(new TextDecoder().decode(mbxUnpad(mbxPad(raw))), "roundtrip");
    assert.equal(mbxPad(raw).length, MBX_PLAINTEXT_LEN);
  });

  it("mailbox ids are deterministic, WALLET-derived, and 32 hex chars", () => {
    const a = mailboxIdForWallet(walletPub);
    assert.equal(a, mailboxIdForWallet(walletPub));
    assert.match(a, /^[0-9a-f]{32}$/);
    assert.notEqual(a, mailboxIdForWallet(nacl.sign.keyPair().publicKey));
  });

  it("ack bytes are order-independent over ids (no replay ambiguity)", () => {
    const A = ackSignedBytes("ab".repeat(16), ["01".repeat(12), "02".repeat(12)]);
    const B = ackSignedBytes("ab".repeat(16), ["02".repeat(12), "01".repeat(12)]);
    assert.deepEqual(Buffer.from(A), Buffer.from(B));
  });

  it("read authorization: a get-signature verifies only for the right wallet, mailbox and window", () => {
    // The relay's `get` requires this exact construction (route.ts): the wallet
    // signs getSignedBytes(mailboxId, window); anyone else's signature, or a
    // stale window, is refused — so a member's envelope count/timing is not
    // readable by anyone who merely knows their address.
    const mbxId = mailboxIdForWallet(walletPub);
    const win = mailboxGetWindow(1_700_000_000);
    const good = nacl.sign.detached(getSignedBytes(mbxId, win), wallet.secretKey);
    assert.isTrue(nacl.sign.detached.verify(getSignedBytes(mbxId, win), good, walletPub), "the owner's signature verifies");
    assert.isFalse(
      nacl.sign.detached.verify(getSignedBytes(mbxId, win), good, nacl.sign.keyPair().publicKey),
      "a different wallet cannot present this signature"
    );
    assert.isFalse(
      nacl.sign.detached.verify(getSignedBytes(mbxId, win + 2), good, walletPub),
      "a far-past/future window is a different message (bounded replay)"
    );
    assert.isFalse(
      nacl.sign.detached.verify(getSignedBytes("ff".repeat(16), win), good, walletPub),
      "the signature is bound to this mailbox id"
    );
  });

  it("the crypto module has no network sink (static guarantee, same rule as sharding)", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "frontend", "lib", "mailboxCrypto.ts"), "utf8");
    for (const forbidden of ["fetch(", "XMLHttpRequest", "WebSocket", "sendBeacon", "axios", "http.request"]) {
      assert.notInclude(src, forbidden, `mailboxCrypto.ts must not contain ${forbidden}`);
    }
  });
});
