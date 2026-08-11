import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Ayni } from "../target/types/ayni";
import { assert } from "chai";

// Federation authority (F34) — regression tests for the two CRITICAL findings
// the security audit confirmed and this round fixed:
//
//   1. execute/propose_child_close never checked child.parent == foundation, so
//      an attacker who stood up a Circle they seat 4-of-7 themselves could close
//      ANY Circle (even the root) and steal its rent.
//   2. execute_child_rotation accepted child.parent == foundation.parent (both
//      attacker-controlled), letting a hostile self-seated Circle seize any
//      Circle's Council.
//
// The fix binds every child-rotation/close to GENUINE direct parentage
// (child.parent == foundation.key()) at propose time (Anchor constraint) and re-
// asserts at execute. These tests prove the legit parent still governs its child
// and a foreign "foundation" is refused.
describe("ayni — federation authority is bound to real parentage (F34, audit fix)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Ayni as Program<Ayni>;
  const payer = provider.wallet as anchor.Wallet;

  const root = anchor.web3.Keypair.generate().publicKey; // F's parent
  const fSeats = Array.from({ length: 7 }, () => anchor.web3.Keypair.generate());
  const vSeats = Array.from({ length: 7 }, () => anchor.web3.Keypair.generate());
  const aSeats = Array.from({ length: 7 }, () => anchor.web3.Keypair.generate());

  const circlePda = (parent: anchor.web3.PublicKey, name: string) =>
    anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("circle"), parent.toBuffer(), Buffer.from(name)],
      program.programId
    )[0];

  const F = circlePda(root, "found-F");
  const V = circlePda(F, "victim-V"); // V.parent == F  (a genuine child of F)
  const A = circlePda(root, "attacker-A"); // attacker-controlled Circle

  const childVotePda = (child: anchor.web3.PublicKey, nonce: number) =>
    anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("childvote"), child.toBuffer(), new anchor.BN(nonce).toArrayLike(Buffer, "le", 8)],
      program.programId
    )[0];
  const childClosePda = (child: anchor.web3.PublicKey, nonce: number) =>
    anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("childclose"), child.toBuffer(), new anchor.BN(nonce).toArrayLike(Buffer, "le", 8)],
      program.programId
    )[0];

  const DAY = 24 * 60 * 60;

  const initCircle = (pda: anchor.web3.PublicKey, parent: anchor.web3.PublicKey, name: string, seats: anchor.web3.Keypair[]) =>
    program.methods
      .initializeCircle(parent, name, new anchor.BN(365 * DAY), new anchor.BN(0), seats.map((s) => s.publicKey))
      .accounts({ circle: pda, parent, payer: payer.publicKey })
      .rpc();

  before(async () => {
    await Promise.all(
      [...fSeats, ...aSeats].map(async (s) => {
        const sig = await provider.connection.requestAirdrop(s.publicKey, 1e9);
        await provider.connection.confirmTransaction(sig);
      })
    );
    await initCircle(F, root, "found-F", fSeats);
    await initCircle(V, F, "victim-V", vSeats); // parent = F
    await initCircle(A, root, "attacker-A", aSeats); // attacker's own Circle
  });

  it("the real parent (F) CAN rotate its direct child V's seats", async () => {
    const nonce = 1;
    const vote = childVotePda(V, nonce);
    const newSeats = Array.from({ length: 7 }, () => anchor.web3.Keypair.generate().publicKey);
    await program.methods
      .proposeChildRotation(new anchor.BN(nonce), newSeats, new anchor.BN(2 * DAY))
      .accounts({ foundation: F, child: V, vote, proposer: fSeats[0].publicKey })
      .signers([fSeats[0]])
      .rpc();
    for (const i of [1, 2, 3]) {
      await program.methods
        .approveChildRotation()
        .accounts({ foundation: F, vote, seat: fSeats[i].publicKey })
        .signers([fSeats[i]])
        .rpc();
    }
    await program.methods
      .executeChildRotation()
      .accounts({ foundation: F, vote, child: V, executor: fSeats[0].publicKey })
      .signers([fSeats[0]])
      .rpc();
    const v = await program.account.circle.fetch(V);
    assert.ok(v.council.seats[0].equals(newSeats[0]), "F rotated V's seats");
  });

  it("a FOREIGN 'foundation' (A) CANNOT even open a rotation vote against V", async () => {
    const nonce = 2;
    const vote = childVotePda(V, nonce);
    const newSeats = aSeats.map((s) => s.publicKey);
    let threw = false;
    try {
      await program.methods
        .proposeChildRotation(new anchor.BN(nonce), newSeats, new anchor.BN(2 * DAY))
        .accounts({ foundation: A, child: V, vote, proposer: aSeats[0].publicKey })
        .signers([aSeats[0]])
        .rpc();
    } catch {
      threw = true; // constraint child.parent == foundation.key() fails (V.parent == F != A)
    }
    assert.isTrue(threw, "an unrelated Circle must not be able to rotate V's Council");
  });

  it("a FOREIGN 'foundation' (A) CANNOT even open a close vote against V", async () => {
    const nonce = 3;
    const vote = childClosePda(V, nonce);
    let threw = false;
    try {
      await program.methods
        .proposeChildClose(new anchor.BN(nonce), new anchor.BN(2 * DAY))
        .accounts({ foundation: A, child: V, vote, proposer: aSeats[0].publicKey })
        .signers([aSeats[0]])
        .rpc();
    } catch {
      threw = true; // same parentage constraint: cannot close a Circle you are not the parent of
    }
    assert.isTrue(threw, "an unrelated Circle must not be able to close V (rent theft blocked)");
  });
});
