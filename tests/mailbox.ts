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

// F103 (ADR 0002 Stage 1) — hybrid X25519 + ML-KEM-768 sealing. Same module,
// same property-test rules: what passes here IS the contract the relay and the
// client share.
describe("mailbox — F103 hybrid post-quantum sealing", () => {
  const { ml_kem768 } = require("@noble/post-quantum/ml-kem.js");
  const {
    MLKEM_CT_LEN,
    MLKEM_PUB_LEN,
    MLKEM_SEC_LEN,
    spkSignedBytesV2,
  } = require("../frontend/lib/mailboxCrypto");

  const wallet = nacl.sign.keyPair();
  const walletPub = wallet.publicKey;
  const sign = (m: Uint8Array) => nacl.sign.detached(m, wallet.secretKey);

  const ik = nacl.box.keyPair();
  const spk = nacl.box.keyPair();
  const pq = ml_kem768.keygen();
  const EPOCH = 7;

  const bundleV2: PrekeyBundle = {
    v: 2,
    wallet: "TESTWALLETBASE58PLACEHOLDERxxxxxxxxxxxxxxxx",
    ik: mbxB64(ik.publicKey),
    spk: mbxB64(spk.publicKey),
    pqk: mbxB64(pq.publicKey),
    epoch: EPOCH,
    sig: mbxB64(sign(spkSignedBytesV2(spk.publicKey, pq.publicKey, EPOCH))),
  };

  const secretSet = { sec: spk.secretKey, pub: spk.publicKey, pqSec: pq.secretKey, pqPub: pq.publicKey };

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

  it("ML-KEM-768 sizes are pinned (a drifting dependency fails loudly)", () => {
    assert.equal(pq.publicKey.length, MLKEM_PUB_LEN);
    assert.equal(pq.secretKey.length, MLKEM_SEC_LEN);
    const { cipherText } = ml_kem768.encapsulate(pq.publicKey);
    assert.equal(cipherText.length, MLKEM_CT_LEN);
  });

  it("v2 bundle signature covers spk AND pqk — strip/swap/downgrade all fail", () => {
    assert.isTrue(verifyBundle(bundleV2, walletPub), "genuine v2 bundle verifies");
    assert.isFalse(
      verifyBundle({ ...bundleV2, pqk: mbxB64(ml_kem768.keygen().publicKey) }, walletPub),
      "substituted KEM key breaks the signature"
    );
    assert.isFalse(verifyBundle({ ...bundleV2, epoch: EPOCH + 1 }, walletPub), "epoch tamper breaks it");
    // Downgrade: relabel the v2 bundle as v1 (dropping pqk from the signed
    // bytes). The v1 verifier must NOT accept a signature made over v2 bytes.
    const { pqk: _drop, ...rest } = bundleV2;
    assert.isFalse(verifyBundle({ ...rest, v: 1 } as PrekeyBundle, walletPub), "v2→v1 downgrade fails");
    // And a v1 bundle carrying an uncovered pqk is refused outright.
    const v1spk = nacl.box.keyPair();
    const v1ok: PrekeyBundle = {
      v: 1,
      wallet: bundleV2.wallet,
      ik: bundleV2.ik,
      spk: mbxB64(v1spk.publicKey),
      epoch: 1,
      sig: mbxB64(sign(spkSignedBytes(v1spk.publicKey, 1))),
    };
    assert.isTrue(verifyBundle(v1ok, walletPub), "plain v1 still verifies (back-compat)");
    assert.isFalse(verifyBundle({ ...v1ok, pqk: mbxB64(pq.publicKey) }, walletPub), "v1 with smuggled pqk is refused");
  });

  it("hybrid seal → open roundtrip; ciphertext length unchanged (no size signal)", () => {
    const env = sealToBundle(bundleV2, makeInner("post-quantum hola"), 0);
    assert.equal(env.v, 2, "a v2 bundle yields a v2 envelope");
    assert.equal(mbxUnb64(env.ct).length, MBX_CT_LEN, "same fixed ciphertext length as v1");
    assert.equal(mbxUnb64(env.kct!).length, MLKEM_CT_LEN, "carries exactly one KEM ciphertext");
    const opened = openSealed(env, [secretSet]);
    assert.isNotNull(opened, "both secrets together open it");
    assert.equal(opened!.body, "post-quantum hola");
    assert.isTrue(verifyInner(opened!, ik.publicKey, sender.publicKey));
  });

  it("NEITHER secret alone opens a hybrid envelope — the point of hybrid", () => {
    const env = sealToBundle(bundleV2, makeInner("both or nothing"), 0);
    // x25519 secret alone (bare legacy shape): must fail — no KEM secret.
    assert.isNull(openSealed(env, [spk.secretKey]), "x25519 secret alone opens nothing");
    // Right x25519, WRONG KEM secret: implicit rejection → wrong key → null.
    const otherPq = ml_kem768.keygen();
    assert.isNull(
      openSealed(env, [{ sec: spk.secretKey, pub: spk.publicKey, pqSec: otherPq.secretKey, pqPub: otherPq.publicKey }]),
      "wrong KEM secret opens nothing"
    );
    // Wrong x25519, right KEM secret: must also fail.
    const otherX = nacl.box.keyPair();
    assert.isNull(
      openSealed(env, [{ sec: otherX.secretKey, pub: otherX.publicKey, pqSec: pq.secretKey, pqPub: pq.publicKey }]),
      "wrong x25519 secret opens nothing"
    );
  });

  it("tampering with the KEM ciphertext or transcript yields null, never garbage", () => {
    const env = sealToBundle(bundleV2, makeInner("bind the transcript"), 0);
    const kct = mbxUnb64(env.kct!);
    kct[7] ^= 0x01;
    assert.isNull(openSealed({ ...env, kct: mbxB64(kct) }, [secretSet]), "flipped KEM ct bit");
    const eph = mbxUnb64(env.eph);
    eph[3] ^= 0x01;
    assert.isNull(openSealed({ ...env, eph: mbxB64(eph) }, [secretSet]), "flipped ephemeral pub bit");
    // Mix-and-match: the kct of one envelope with the rest of another.
    const env2 = sealToBundle(bundleV2, makeInner("a different letter"), 0);
    assert.isNull(openSealed({ ...env, kct: env2.kct }, [secretSet]), "cross-envelope KEM ct");
    // Version confusion: relabeling a v2 envelope as v1 must not open via box.
    assert.isNull(openSealed({ ...env, v: 1, kct: undefined }, [secretSet]), "v2→v1 envelope downgrade");
  });

  it("a v1 bundle still seals v1, and a mixed secret list opens both (rollout)", () => {
    const v1spk = nacl.box.keyPair();
    const v1bundle: PrekeyBundle = {
      v: 1,
      wallet: bundleV2.wallet,
      ik: bundleV2.ik,
      spk: mbxB64(v1spk.publicKey),
      epoch: 1,
      sig: mbxB64(sign(spkSignedBytes(v1spk.publicKey, 1))),
    };
    const envV1 = sealToBundle(v1bundle, makeInner("legacy path"), 0);
    assert.equal(envV1.v, 1, "a v1 bundle yields a v1 envelope");
    assert.isUndefined(envV1.kct, "no KEM ciphertext on a v1 envelope");
    // One secret list holding a hybrid epoch and a legacy epoch opens each.
    const mixed = [secretSet, { sec: v1spk.secretKey, pub: v1spk.publicKey }];
    assert.isNotNull(openSealed(envV1, mixed), "legacy envelope opens from the mixed list");
    const envV2 = sealToBundle(bundleV2, makeInner("hybrid path"), 0);
    assert.isNotNull(openSealed(envV2, mixed), "hybrid envelope opens from the mixed list");
  });

  it("padding property survives: every body length yields one v2 ciphertext size", () => {
    const sizes = new Set<number>();
    const kctSizes = new Set<number>();
    for (const body of ["a", "medium length message body", "x".repeat(700)]) {
      const env = sealToBundle(bundleV2, makeInner(body), 0);
      sizes.add(mbxUnb64(env.ct).length);
      kctSizes.add(mbxUnb64(env.kct!).length);
    }
    assert.deepEqual([...sizes], [MBX_CT_LEN], "one ct size for all bodies");
    assert.deepEqual([...kctSizes], [MLKEM_CT_LEN], "one KEM ct size for all bodies");
  });
});
