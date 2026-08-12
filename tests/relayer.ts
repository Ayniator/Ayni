import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Ayni } from "../target/types/ayni";
import { assert } from "chai";
import * as fs from "fs";
import * as path from "path";
import {
  RELAY_ALLOWLIST,
  validateRelayRequest,
  RelayRequest,
} from "../frontend/lib/relayPolicy";

// F55 — the relayer. Two halves:
//  (1) the pure admission policy (lib/relayPolicy.ts): pinned discriminators
//      asserted against the freshly built IDL, and the refusal matrix — the
//      relayer signs attacker-supplied bytes with a funded key, so what it
//      refuses IS the security boundary;
//  (2) the on-chain contract the whole design rests on: an allowlisted
//      instruction accepts an ARBITRARY third-party fee-payer (the relayer),
//      with no wallet of the acting member anywhere in the transaction.
describe("ayni — F55 relayer policy + third-party fee-payer contract", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Ayni as Program<Ayni>;
  const connection = provider.connection;

  const RELAYER = anchor.web3.Keypair.generate();
  const relayer58 = RELAYER.publicKey.toBase58();

  const idl = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "target", "idl", "ayni.json"), "utf8"));
  const idlDisc = (name: string): string =>
    Buffer.from(idl.instructions.find((i: any) => i.name === name).discriminator).toString("hex");
  const idlAccountCount = (name: string): number =>
    idl.instructions.find((i: any) => i.name === name).accounts.length;

  const meta = (pubkey: string, isSigner = false, isWritable = false) => ({ pubkey, isSigner, isWritable });
  const k = () => anchor.web3.Keypair.generate().publicKey.toBase58();

  function goodCastVote(): RelayRequest {
    const disc = Buffer.from(idl.instructions.find((i: any) => i.name === "cast_vote").discriminator);
    const data = Buffer.concat([disc, Buffer.alloc(1 + 32 + 64 + 128 + 64)]);
    return {
      keys: [meta(k(), false, true), meta(k(), false, true), meta(relayer58, true, true), meta(k())],
      data: data.toString("base64"),
    };
  }

  // --- (1) the pure policy --------------------------------------------------
  it("every pinned discriminator and account count matches the built IDL", () => {
    for (const [disc, entry] of Object.entries(RELAY_ALLOWLIST)) {
      assert.equal(disc, idlDisc(entry.name), `${entry.name}: discriminator drifted from the IDL`);
      assert.equal(entry.accountCount, idlAccountCount(entry.name), `${entry.name}: account count drifted from the IDL`);
    }
  });

  it("accepts a well-formed allowlisted request with the relayer as sole signer", () => {
    const v = validateRelayRequest(goodCastVote(), relayer58);
    // `authority: null` is the F61 addition: a sole-signer instruction reports
    // that nobody but the relayer signed it, which is what the route relies on
    // to refuse a co-signature it was not expecting.
    assert.deepEqual(v, { ok: true, name: "cast_vote", authority: null });
  });

  it("refuses everything outside the boundary", () => {
    const fail = (req: RelayRequest, why: string) => {
      const v = validateRelayRequest(req, relayer58);
      assert.isFalse(v.ok, why);
    };

    // A non-allowlisted instruction (real one, wrong privileges: withdraw_treasury).
    const wd = Buffer.concat([
      Buffer.from(idl.instructions.find((i: any) => i.name === "withdraw_treasury").discriminator),
      Buffer.alloc(64),
    ]);
    fail({ keys: [meta(relayer58, true, true)], data: wd.toString("base64") }, "non-allowlisted instruction");

    // Payer swapped for a non-relayer key.
    const swapped = goodCastVote();
    swapped.keys[2] = meta(k(), true, true);
    fail(swapped, "payer is not the relayer");

    // A second signer smuggled in — the relayer must never co-sign.
    const extra = goodCastVote();
    extra.keys[0] = { ...extra.keys[0], isSigner: true };
    fail(extra, "extra signer");

    // Wrong account count.
    const short = goodCastVote();
    short.keys.pop();
    fail(short, "account count");

    // Wrong data length (payload padded by one byte).
    const long = goodCastVote();
    long.data = Buffer.concat([Buffer.from(long.data, "base64"), Buffer.alloc(1)]).toString("base64");
    fail(long, "data length");

    // Garbage pubkey.
    const bad = goodCastVote();
    bad.keys[0] = meta("not-a-pubkey!!");
    fail(bad, "invalid pubkey");

    // Truncated data (no discriminator).
    fail({ keys: [], data: Buffer.alloc(4).toString("base64") }, "short data");
  });

  // --- (1b) F61: the ONE permitted co-signer --------------------------------
  //
  // A shielded membership's authority is a derived key with zero lamports which
  // must never be funded, so it has to be able to sign while the relayer pays.
  // The boundary is "the relayer pays, and at most one PINNED account
  // authorises" — these tests are that boundary, not a happy path.

  const disc = (name: string) => Buffer.from(idl.instructions.find((i: any) => i.name === name).discriminator);

  /** A well-formed set_visibility relay request: 6 accounts, member at 3, relayer at 4. */
  function goodSetVisibility(): RelayRequest {
    return {
      keys: [meta(k()), meta(k()), meta(k(), false, true), meta(k(), true), meta(relayer58, true, true), meta(k())],
      data: Buffer.concat([disc("set_visibility"), Buffer.from([1, 1, 1])]).toString("base64"),
    };
  }

  it("accepts a co-signed request and reports which account authorised it", () => {
    const req = goodSetVisibility();
    const v = validateRelayRequest(req, relayer58);
    assert.isTrue(v.ok);
    assert.equal((v as any).name, "set_visibility");
    assert.equal((v as any).authority, req.keys[3].pubkey, "the authority must be the pinned index, reported back");
  });

  it("sole-signer instructions still refuse a co-signer — the original rule is untouched", () => {
    const extra = goodCastVote();
    extra.keys[0] = { ...extra.keys[0], isSigner: true };
    assert.isFalse(validateRelayRequest(extra, relayer58).ok);
  });

  it("refuses the relayer as the authority — its signature may only ever mean 'paid'", () => {
    const req = goodSetVisibility();
    req.keys[3] = meta(relayer58, true);
    assert.isFalse(validateRelayRequest(req, relayer58).ok, "the relayer must never authorise");
  });

  it("refuses a co-signed request with the authority slot unsigned", () => {
    const req = goodSetVisibility();
    req.keys[3] = meta(req.keys[3].pubkey, false);
    assert.isFalse(validateRelayRequest(req, relayer58).ok);
  });

  it("refuses a THIRD signer — one co-signer, at one index, and no more", () => {
    const req = goodSetVisibility();
    req.keys[0] = { ...req.keys[0], isSigner: true };
    assert.isFalse(validateRelayRequest(req, relayer58).ok);
  });

  it("end_wing_peer: the relayer pays the fee and must appear in NO account", () => {
    const ok: RelayRequest = {
      keys: [meta(k()), meta(k(), false, true), meta(k()), meta(k(), true)],
      data: disc("end_wing_peer").toString("base64"),
    };
    const v = validateRelayRequest(ok, relayer58);
    assert.isTrue(v.ok, "fee-payer-only relays are allowed");

    // ...and a caller may not aim one of its accounts at the relayer's own key.
    const smuggled = { ...ok, keys: [meta(relayer58), ...ok.keys.slice(1)] };
    assert.isFalse(validateRelayRequest(smuggled, relayer58).ok);
  });

  it("create_post: variable-length data is bounded by the program's own limits", () => {
    const body = (textLen: number, cidLen: number) =>
      Buffer.concat([
        disc("create_post"),
        Buffer.alloc(8), // nonce
        Buffer.alloc(4 + textLen), // text (borsh len + bytes)
        Buffer.alloc(4 + cidLen), // image_cid
        Buffer.alloc(16), // start_date + end_date
      ]);
    const req = (b: Buffer): RelayRequest => ({
      keys: [meta(k()), meta(k()), meta(k(), false, true), meta(k(), true), meta(relayer58, true, true), meta(k())],
      data: b.toString("base64"),
    });
    assert.isTrue(validateRelayRequest(req(body(0, 0)), relayer58).ok, "an empty post is within bounds");
    assert.isTrue(validateRelayRequest(req(body(500, 64)), relayer58).ok, "the program's maxima are within bounds");
    assert.isFalse(validateRelayRequest(req(body(501, 64)), relayer58).ok, "one byte over Post::MAX_TEXT is refused");
  });

  it("every co-signed entry pins a signer index the IDL agrees is a signer", () => {
    // Guards against the quietest possible skew: an entry whose authorityIndex
    // points at a non-signer account would make the relayer refuse every real
    // request, and the client would silently fall back to self-paying — which
    // is exactly the disclosure the entry exists to prevent.
    for (const entry of Object.values(RELAY_ALLOWLIST)) {
      const accounts = idl.instructions.find((i: any) => i.name === entry.name).accounts;
      if (entry.authorityIndex !== undefined) {
        assert.isTrue(accounts[entry.authorityIndex].signer === true, `${entry.name}: authorityIndex is not a signer in the IDL`);
        assert.notEqual(entry.authorityIndex, entry.payerIndex, `${entry.name}: authority and payer must be different accounts`);
      }
      if (entry.payerIndex !== null) {
        assert.isTrue(accounts[entry.payerIndex].signer === true, `${entry.name}: payerIndex is not a signer in the IDL`);
        assert.isTrue(accounts[entry.payerIndex].writable === true, `${entry.name}: a payer must be writable`);
      }
    }
  });

  // --- (2) the on-chain contract -------------------------------------------
  it("send_message accepts a third-party fee-payer: the relayer pays, the sender appears nowhere", async () => {
    await connection.confirmTransaction(await connection.requestAirdrop(RELAYER.publicKey, 2e9));

    const recipient = anchor.web3.Keypair.generate().publicKey;
    const id = new anchor.BN(Buffer.from(anchor.web3.Keypair.generate().secretKey.slice(0, 8)).toString("hex"), 16);
    const idLe = id.toArrayLike(Buffer, "le", 8);
    const msgPda = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("msg"), recipient.toBuffer(), idLe],
      program.programId
    )[0];

    // Encode the instruction data manually: anchor's TS methods-builder uses a
    // fixed 1000-byte scratch buffer, historically too small for the old
    // 1040-byte ciphertext —
    // and hand-rolling it doubles as a check of the exact wire layout the
    // relay policy pins (discriminator + fixed-size args).
    const disc = Buffer.from(idl.instructions.find((i: any) => i.name === "send_message").discriminator);
    const data = Buffer.concat([
      disc,
      idLe,                              // id: u64 le
      recipient.toBuffer(),              // recipient: pubkey
      Buffer.alloc(32, 7),               // eph_pubkey
      Buffer.alloc(24, 9),               // nonce
      Buffer.alloc(8),                   // expires_at: i64 le (0)
      (() => { const l = Buffer.alloc(4); l.writeUInt32LE(528); return l; })(),
      Buffer.alloc(528),                 // ciphertext
    ]);
    assert.equal(data.length, RELAY_ALLOWLIST[disc.toString("hex")].dataLen, "manual encoding matches the policy's pinned length");
    const ix = new anchor.web3.TransactionInstruction({
      programId: program.programId,
      keys: [
        { pubkey: msgPda, isSigner: false, isWritable: true },
        { pubkey: RELAYER.publicKey, isSigner: true, isWritable: true },
        { pubkey: anchor.web3.SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    // Exactly what the /api/relay route does: relayer builds, signs alone, pays.
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const tx = new anchor.web3.Transaction({ blockhash, lastValidBlockHeight, feePayer: RELAYER.publicKey }).add(ix);
    tx.sign(RELAYER);

    // The member's wallet signs NOTHING and appears NOWHERE.
    const signers = tx.signatures.map((s) => s.publicKey.toBase58());
    assert.deepEqual(signers, [relayer58], "the relayer is the only signer");

    const sig = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight });

    const m: any = await program.account.message.fetch(msgPda);
    assert.ok(new anchor.web3.PublicKey(m.recipient).equals(recipient), "message landed for the recipient");
  });
});
