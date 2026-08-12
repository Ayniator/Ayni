// F39 — the MACI state machine, in isolation.
//
// No validator, no chain: these exercise the rules that decide a MACI outcome,
// which is exactly the part the chain CANNOT check (the commands are sealed to
// the coordinator). If this file is wrong, an honest coordinator produces a
// wrong tally and nobody can tell it from a dishonest one — so the properties
// asserted here are load-bearing, not decorative.
//
// Run: npx ts-mocha -p ./tsconfig.json tests/maci-machine.ts

import { assert } from "chai";
import nacl from "tweetnacl";
import {
  MACI_CMD_LEN,
  MACI_COMMAND_LEN,
  MACI_CT_LEN,
  MACI_VOTE_ABSTAIN,
  MACI_VOTE_NO,
  MACI_VOTE_YES,
  MaciQueueEntry,
  MaciSignupRecord,
  applyMaciQueue,
  coordinatorTally,
  decodeMaciCommand,
  encodeMaciCommand,
  hexOf,
  maciOutcome,
  maciQuorumThreshold,
  maciTallyHash,
  maciVotePasses,
  openMaciCiphertext,
  padMaciCommand,
  sealMaciCommand,
  unpadMaciCommand,
  verifyMaciCommand,
} from "../frontend/lib/maci-command";

// Node 18 only exposes Web Crypto globally behind a flag; Anchor.toml sets it
// for `anchor test`, but this suite must also run on its own.
const g = globalThis as any;
if (!g.crypto || !g.crypto.subtle) g.crypto = require("crypto").webcrypto;

const ROUND = new Uint8Array(32).fill(9);

/** Build a signed command as a queue entry (already "decrypted"). */
function cmd(
  index: number,
  stateKey: Uint8Array,
  signSecret: Uint8Array,
  newKey: Uint8Array,
  nonce: number,
  vote: number
): MaciQueueEntry {
  return {
    index,
    command: encodeMaciCommand({ stateKey, newKey, nonce, vote }, ROUND, signSecret),
  };
}

describe("F39 — MACI command format", () => {
  it("round-trips a signed command and rejects a tampered one", () => {
    const kp = nacl.sign.keyPair();
    const other = nacl.sign.keyPair();
    const bytes = encodeMaciCommand(
      { stateKey: kp.publicKey, newKey: other.publicKey, nonce: 3, vote: MACI_VOTE_YES },
      ROUND,
      kp.secretKey
    );
    assert.equal(bytes.length, MACI_COMMAND_LEN);

    const parsed = decodeMaciCommand(bytes)!;
    assert.isNotNull(parsed);
    assert.equal(hexOf(parsed.stateKey), hexOf(kp.publicKey));
    assert.equal(hexOf(parsed.newKey), hexOf(other.publicKey));
    assert.equal(parsed.nonce, 3);
    assert.equal(parsed.vote, MACI_VOTE_YES);
    assert.isTrue(verifyMaciCommand(parsed, ROUND, kp.publicKey));
    assert.isFalse(verifyMaciCommand(parsed, ROUND, other.publicKey), "wrong signer must not verify");

    const otherRound = new Uint8Array(32).fill(8);
    assert.isFalse(verifyMaciCommand(parsed, otherRound, kp.publicKey), "command is bound to its round");

    const tampered = bytes.slice();
    tampered[76] = MACI_VOTE_NO; // flip the vote
    assert.isFalse(verifyMaciCommand(decodeMaciCommand(tampered)!, ROUND, kp.publicKey));
  });

  it("pads every command to one constant size and seals it opaquely", () => {
    const kp = nacl.sign.keyPair();
    const coord = nacl.box.keyPair();
    const bytes = encodeMaciCommand(
      { stateKey: kp.publicKey, newKey: kp.publicKey, nonce: 1, vote: MACI_VOTE_NO },
      ROUND,
      kp.secretKey
    );
    const padded = padMaciCommand(bytes);
    assert.equal(padded.length, MACI_CMD_LEN, "size must leak nothing");

    const sealed = sealMaciCommand(padded, coord.publicKey);
    assert.equal(sealed.ciphertext.length, MACI_CT_LEN);

    const opened = openMaciCiphertext(sealed.ciphertext, sealed.ephPubkey, coord.secretKey)!;
    assert.isNotNull(opened);
    assert.equal(hexOf(unpadMaciCommand(opened)!), hexOf(bytes));

    const stranger = nacl.box.keyPair();
    assert.isNull(
      openMaciCiphertext(sealed.ciphertext, sealed.ephPubkey, stranger.secretKey),
      "only the coordinator can open a command"
    );
  });

  it("treats malformed commands as invalid rather than fatal", () => {
    assert.isNull(decodeMaciCommand(new Uint8Array(10)));
    const kp = nacl.sign.keyPair();
    const bytes = encodeMaciCommand(
      { stateKey: kp.publicKey, newKey: kp.publicKey, nonce: 1, vote: MACI_VOTE_YES },
      ROUND,
      kp.secretKey
    );
    const badMagic = bytes.slice();
    badMagic[0] = 0;
    assert.isNull(decodeMaciCommand(badMagic));
    const badVote = bytes.slice();
    badVote[76] = 7;
    assert.isNull(decodeMaciCommand(badVote));
  });
});

describe("F39 — MACI state machine (override, replay, ordering)", () => {
  it("a later command overrides an earlier vote from the same voter", () => {
    const k1 = nacl.sign.keyPair();
    const signups: MaciSignupRecord[] = [{ pubkey: k1.publicKey, index: 0 }];
    const queue = [
      cmd(0, k1.publicKey, k1.secretKey, k1.publicKey, 1, MACI_VOTE_YES),
      cmd(1, k1.publicKey, k1.secretKey, k1.publicKey, 2, MACI_VOTE_NO),
    ];
    const r = applyMaciQueue(signups, queue, ROUND);
    assert.deepEqual([r.yes, r.no], [0, 1], "the last valid command wins");
  });

  it("a key change invalidates every later command signed with the surrendered key", () => {
    // The coercion scenario, exactly. The voter signs up with k1, then — away
    // from the coercer — publishes a key change to k2 carrying their true NO.
    // Later, under coercion, they hand over k1 and are made to sign a YES.
    const k1 = nacl.sign.keyPair();
    const k2 = nacl.sign.keyPair();
    const signups: MaciSignupRecord[] = [{ pubkey: k1.publicKey, index: 0 }];

    const queue = [
      cmd(0, k1.publicKey, k1.secretKey, k2.publicKey, 1, MACI_VOTE_NO), // true vote + rekey
      cmd(1, k1.publicKey, k1.secretKey, k1.publicKey, 2, MACI_VOTE_YES), // coerced, signed by k1
    ];
    const r = applyMaciQueue(signups, queue, ROUND);
    assert.deepEqual([r.yes, r.no], [0, 1], "the coerced vote is silently void");
    assert.deepEqual(r.applied, [0]);
    assert.deepEqual(r.dropped, [1]);

    // ...and the voter can still change their mind afterwards, with k2.
    const queue2 = queue.concat([cmd(2, k1.publicKey, k2.secretKey, k2.publicKey, 3, MACI_VOTE_YES)]);
    const r2 = applyMaciQueue(signups, queue2, ROUND);
    assert.deepEqual([r2.yes, r2.no], [1, 0], "the real key still controls the vote");
  });

  it("a later key change overrides an earlier vote (the task's canonical case)", () => {
    const k1 = nacl.sign.keyPair();
    const k2 = nacl.sign.keyPair();
    const signups: MaciSignupRecord[] = [{ pubkey: k1.publicKey, index: 0 }];
    const queue = [
      cmd(0, k1.publicKey, k1.secretKey, k1.publicKey, 1, MACI_VOTE_YES),
      cmd(1, k1.publicKey, k1.secretKey, k2.publicKey, 2, MACI_VOTE_NO),
    ];
    const r = applyMaciQueue(signups, queue, ROUND);
    assert.deepEqual([r.yes, r.no], [0, 1]);
    // The rotation took effect: k1 can no longer speak for this voter.
    const r2 = applyMaciQueue(
      signups,
      queue.concat([cmd(2, k1.publicKey, k1.secretKey, k1.publicKey, 3, MACI_VOTE_YES)]),
      ROUND
    );
    assert.deepEqual([r2.yes, r2.no], [0, 1], "the surrendered key is dead");
  });

  it("a replayed message cannot change anything (nonce must strictly increase)", () => {
    const k1 = nacl.sign.keyPair();
    const signups: MaciSignupRecord[] = [{ pubkey: k1.publicKey, index: 0 }];
    const one = cmd(0, k1.publicKey, k1.secretKey, k1.publicKey, 1, MACI_VOTE_YES);
    const replay: MaciQueueEntry = { index: 1, command: one.command };
    const two = cmd(2, k1.publicKey, k1.secretKey, k1.publicKey, 2, MACI_VOTE_NO);
    const replayTwo: MaciQueueEntry = { index: 3, command: two.command };

    const r = applyMaciQueue(signups, [one, replay, two, replayTwo], ROUND);
    assert.deepEqual([r.yes, r.no], [0, 1]);
    assert.deepEqual(r.applied, [0, 2], "each nonce is spent exactly once");
    assert.deepEqual(r.dropped, [1, 3]);
  });

  it("re-ordering the queue does not change the tally", () => {
    const voters = [nacl.sign.keyPair(), nacl.sign.keyPair(), nacl.sign.keyPair()];
    const rotated = nacl.sign.keyPair();
    const signups: MaciSignupRecord[] = voters.map((v, i) => ({ pubkey: v.publicKey, index: i }));

    // A mixed, realistic queue: overrides, a key change, a dead-key command,
    // an abstention, and one message from a voter who never signed up.
    const stranger = nacl.sign.keyPair();
    const build = (): Uint8Array[] => [
      encodeMaciCommand({ stateKey: voters[0].publicKey, newKey: voters[0].publicKey, nonce: 1, vote: MACI_VOTE_YES }, ROUND, voters[0].secretKey),
      encodeMaciCommand({ stateKey: voters[0].publicKey, newKey: rotated.publicKey, nonce: 2, vote: MACI_VOTE_NO }, ROUND, voters[0].secretKey),
      encodeMaciCommand({ stateKey: voters[0].publicKey, newKey: voters[0].publicKey, nonce: 3, vote: MACI_VOTE_YES }, ROUND, voters[0].secretKey), // dead key
      encodeMaciCommand({ stateKey: voters[1].publicKey, newKey: voters[1].publicKey, nonce: 1, vote: MACI_VOTE_YES }, ROUND, voters[1].secretKey),
      encodeMaciCommand({ stateKey: voters[2].publicKey, newKey: voters[2].publicKey, nonce: 1, vote: MACI_VOTE_ABSTAIN }, ROUND, voters[2].secretKey),
      encodeMaciCommand({ stateKey: stranger.publicKey, newKey: stranger.publicKey, nonce: 1, vote: MACI_VOTE_YES }, ROUND, stranger.secretKey),
    ];

    const asQueue = (cmds: Uint8Array[]): MaciQueueEntry[] =>
      cmds.map((c, i) => ({ index: i, command: c }));

    const base = applyMaciQueue(signups, asQueue(build()), ROUND);
    assert.deepEqual([base.yes, base.no, base.abstain], [1, 1, 1]);

    // Every permutation of publication order must yield the same totals: the
    // ordering that decides the outcome is the voter's own nonce, which no
    // sequencer, relayer or coordinator can touch.
    const perms = [
      [5, 4, 3, 2, 1, 0],
      [2, 0, 5, 1, 4, 3],
      [1, 2, 0, 4, 5, 3],
      [3, 1, 4, 0, 2, 5],
    ];
    for (const p of perms) {
      const cmds = build();
      const shuffled = p.map((i) => cmds[i]);
      const r = applyMaciQueue(signups, asQueue(shuffled), ROUND);
      assert.deepEqual(
        [r.yes, r.no, r.abstain],
        [base.yes, base.no, base.abstain],
        "tally must be a function of the message SET, not its order"
      );
    }
  });

  it("commands from unregistered keys and unopenable ciphertexts are ignored", () => {
    const k1 = nacl.sign.keyPair();
    const stranger = nacl.sign.keyPair();
    const signups: MaciSignupRecord[] = [{ pubkey: k1.publicKey, index: 0 }];
    const r = applyMaciQueue(
      signups,
      [
        { index: 0, command: null }, // could not be decrypted
        cmd(1, stranger.publicKey, stranger.secretKey, stranger.publicKey, 1, MACI_VOTE_YES),
        cmd(2, k1.publicKey, stranger.secretKey, k1.publicKey, 1, MACI_VOTE_YES), // wrong signer
        cmd(3, k1.publicKey, k1.secretKey, k1.publicKey, 1, MACI_VOTE_NO),
      ],
      ROUND
    );
    assert.deepEqual([r.yes, r.no], [0, 1]);
    assert.deepEqual(r.dropped, [0, 1, 2]);
  });

  it("a voter who never commands is an abstention, counted in neither column", () => {
    const voters = [nacl.sign.keyPair(), nacl.sign.keyPair()];
    const signups: MaciSignupRecord[] = voters.map((v, i) => ({ pubkey: v.publicKey, index: i }));
    const r = applyMaciQueue(
      signups,
      [cmd(0, voters[0].publicKey, voters[0].secretKey, voters[0].publicKey, 1, MACI_VOTE_YES)],
      ROUND
    );
    assert.deepEqual([r.yes, r.no, r.abstain], [1, 0, 1]);
  });
});

describe("F39 — coordinator tally + audit digests", () => {
  it("produces a tally and a hash any third party can recompute", async () => {
    const coord = nacl.box.keyPair();
    const voters = [nacl.sign.keyPair(), nacl.sign.keyPair()];
    const signups: MaciSignupRecord[] = voters.map((v, i) => ({ pubkey: v.publicKey, index: i }));

    const plain = [
      encodeMaciCommand({ stateKey: voters[0].publicKey, newKey: voters[0].publicKey, nonce: 1, vote: MACI_VOTE_YES }, ROUND, voters[0].secretKey),
      encodeMaciCommand({ stateKey: voters[1].publicKey, newKey: voters[1].publicKey, nonce: 1, vote: MACI_VOTE_NO }, ROUND, voters[1].secretKey),
    ];
    const messages = plain.map((p, i) => {
      const s = sealMaciCommand(padMaciCommand(p), coord.publicKey);
      return { index: i, ephPubkey: s.ephPubkey, ciphertext: s.ciphertext };
    });

    const tally = await coordinatorTally(ROUND, signups, messages, coord.secretKey);
    assert.deepEqual([tally.yes, tally.no], [1, 1]);

    // An auditor holding the same public data + the decryption witness derives
    // the identical hash. A coordinator that published different numbers for
    // the same queue would not match.
    const again = await coordinatorTally(ROUND, signups, messages, coord.secretKey);
    assert.equal(hexOf(again.tallyHash), hexOf(tally.tallyHash));

    const forged = await maciTallyHash({
      round: ROUND,
      chainDigest: tally.chainDigest,
      signupDigest: tally.signupDigest,
      signupCount: signups.length,
      yes: 2,
      no: 0,
      plaintextDigest: tally.plaintextDigest,
    });
    assert.notEqual(hexOf(forged), hexOf(tally.tallyHash), "a different claim is a different hash");
  });

  it("the digest changes if a single message is dropped, added or moved", async () => {
    const coord = nacl.box.keyPair();
    const k = nacl.sign.keyPair();
    const signups: MaciSignupRecord[] = [{ pubkey: k.publicKey, index: 0 }];
    const mk = (nonce: number, vote: number) => {
      const p = encodeMaciCommand({ stateKey: k.publicKey, newKey: k.publicKey, nonce, vote }, ROUND, k.secretKey);
      return sealMaciCommand(padMaciCommand(p), coord.publicKey);
    };
    const a = mk(1, MACI_VOTE_YES);
    const b = mk(2, MACI_VOTE_NO);
    const full = [
      { index: 0, ephPubkey: a.ephPubkey, ciphertext: a.ciphertext },
      { index: 1, ephPubkey: b.ephPubkey, ciphertext: b.ciphertext },
    ];
    const censored = [full[0]];
    const swapped = [
      { index: 0, ephPubkey: b.ephPubkey, ciphertext: b.ciphertext },
      { index: 1, ephPubkey: a.ephPubkey, ciphertext: a.ciphertext },
    ];

    const t1 = await coordinatorTally(ROUND, signups, full, coord.secretKey);
    const t2 = await coordinatorTally(ROUND, signups, censored, coord.secretKey);
    const t3 = await coordinatorTally(ROUND, signups, swapped, coord.secretKey);

    assert.notEqual(hexOf(t1.chainDigest), hexOf(t2.chainDigest), "censoring changes the chain digest");
    assert.notEqual(hexOf(t1.chainDigest), hexOf(t3.chainDigest), "reordering changes the chain digest");
    // ...but the OUTCOME is unchanged by reordering: nonces decide.
    assert.deepEqual([t1.yes, t1.no], [t3.yes, t3.no]);
    // A censored override, by contrast, changes the result — which is why the
    // chain, not the coordinator, computes the chain digest.
    assert.deepEqual([t2.yes, t2.no], [1, 0]);
    assert.deepEqual([t1.yes, t1.no], [0, 1]);
  });
});

describe("F39 — MACI outcome uses the same policy math as the plain ballot", () => {
  it("mirrors quorum_threshold / vote_passes / member_vote_outcome", () => {
    // Defaults (0 denominators): quorum = ceil(eligible/3) min 1, pass = yes > no.
    assert.equal(maciQuorumThreshold(10, 0, 0), 4);
    assert.equal(maciQuorumThreshold(9, 0, 0), 3);
    assert.equal(maciQuorumThreshold(0, 0, 0), 1);
    assert.equal(maciQuorumThreshold(10, 1, 2), 5);
    assert.equal(maciQuorumThreshold(10, 1, 100), 1, "quorum is never zero");

    assert.isTrue(maciVotePasses(2, 1, 0, 0));
    assert.isFalse(maciVotePasses(1, 1, 0, 0), "a tie is not a majority");
    assert.isTrue(maciVotePasses(2, 1, 2, 3), "exactly two-thirds clears a two-thirds bar");
    assert.isFalse(maciVotePasses(3, 2, 2, 3));

    // Quorum failure beats a landslide.
    assert.isFalse(maciOutcome(2, 0, 12, 0, 0, 0, 0), "turnout 2 < quorum 4");
    assert.isTrue(maciOutcome(4, 0, 12, 0, 0, 0, 0));
    assert.isFalse(maciOutcome(0, 0, 3, 0, 0, 0, 0), "an all-abstain round cannot pass");
    assert.isTrue(maciOutcome(3, 1, 9, 0, 0, 2, 3));
    assert.isFalse(maciOutcome(3, 2, 9, 0, 0, 2, 3));
  });
});
