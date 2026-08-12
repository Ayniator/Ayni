import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Ayni } from "../target/types/ayni";
import { assert } from "chai";
import { createHash } from "crypto";
import nacl from "tweetnacl";

// Epic 5 — per-element visibility. A member sets their own avatar/quipu/bio
// audience (0 chosen, 1 my-circle default, 2 all-members); absent ⇒ my-circle;
// only the member may set it; tiers are range-checked. No-ZK paths only.
describe("ayni — per-element visibility (Epic 5)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Ayni as Program<Ayni>;
  const payer = provider.wallet as anchor.Wallet;
  const parent = anchor.web3.Keypair.generate().publicKey;
  const name = "vis-circle";
  const ONE_YEAR = new anchor.BN(365 * 24 * 60 * 60);

  const seats = Array.from({ length: 7 }, () => anchor.web3.Keypair.generate());
  const SECRETARY = 1;
  const memberOwner = anchor.web3.Keypair.generate();
  const strangerOwner = anchor.web3.Keypair.generate();
  // A third member, used only by the shielding tests so they cannot disturb the
  // policy tests above (which still sign with the plain `memberOwner` wallet).
  const shieldOwner = anchor.web3.Keypair.generate();
  const viewerOwner = anchor.web3.Keypair.generate();

  const makeCommitment = () => { const b = anchor.web3.Keypair.generate().publicKey.toBuffer(); b[0] &= 0x1f; return b; };
  const cMember = makeCommitment();
  const cStranger = makeCommitment();
  const cShielded = makeCommitment();
  const cViewer = makeCommitment();

  const pda = (...s: (Buffer | Uint8Array)[]) =>
    anchor.web3.PublicKey.findProgramAddressSync([...s] as Buffer[], program.programId)[0];
  const circle = pda(Buffer.from("circle"), parent.toBuffer(), Buffer.from(name));
  const memberTree = pda(Buffer.from("members"), circle.toBuffer());
  const twoSponsor = pda(Buffer.from("twosponsor"), circle.toBuffer());
  const membershipPda = (c: Buffer) => pda(Buffer.from("membership"), circle.toBuffer(), c);
  const visPda = (c: Buffer) => pda(Buffer.from("visibility"), circle.toBuffer(), c);

  const noGuardians = [anchor.web3.PublicKey.default, anchor.web3.PublicKey.default];
  const expectFail = async (p: Promise<any>, code?: string) => {
    try { await p; } catch (e: any) {
      if (code) { const s = (e?.error?.errorCode?.code ?? "") + " " + (e?.message ?? "") + " " + JSON.stringify(e?.logs ?? []); assert.include(s, code, `expected ${code}`); }
      return;
    }
    assert.fail(`expected failure${code ? ` with ${code}` : ""}`);
  };

  const issue = (commitment: Buffer, owner: anchor.web3.PublicKey) =>
    program.methods.issueMembership([...commitment], owner, noGuardians, false)
      .accounts({ circle, membership: membershipPda(commitment), memberTree, personhood: null, openMembership: null, twoSponsor, secretary: seats[SECRETARY].publicKey })
      .signers([seats[SECRETARY]]).rpc();

  const setVis = (memberC: Buffer, av: number, q: number, bio: number, signer: anchor.web3.Keypair) =>
    program.methods.setVisibility(av, q, bio)
      .accounts({ circle, memberMembership: membershipPda(memberC), policy: visPda(memberC), member: signer.publicKey })
      .signers([signer]).rpc();

  before(async () => {
    await Promise.all([...seats, memberOwner, strangerOwner, shieldOwner, viewerOwner].map(async (k) => {
      const sig = await provider.connection.requestAirdrop(k.publicKey, 1e9);
      await provider.connection.confirmTransaction(sig);
    }));
    await program.methods.initializeCircle(parent, name, ONE_YEAR, new anchor.BN(0), seats.map((s) => s.publicKey))
      .accounts({ circle, parent, payer: payer.publicKey }).rpc();
    await program.methods.initializeMemberTree(20).accounts({ circle, memberTree, seat: seats[0].publicKey }).signers([seats[0]]).rpc();
    await issue(cMember, memberOwner.publicKey);
    await issue(cStranger, strangerOwner.publicKey);
    await issue(cShielded, shieldOwner.publicKey);
    await issue(cViewer, viewerOwner.publicKey);
  });

  it("has no policy account by default (absent ⇒ my circle)", async () => {
    await expectFail(program.account.visibilityPolicy.fetch(visPda(cMember)) as any);
  });

  it("lets the member set their per-element visibility", async () => {
    await setVis(cMember, 2, 1, 0, memberOwner); // avatar all, quipu circle, bio chosen
    const p: any = await program.account.visibilityPolicy.fetch(visPda(cMember));
    assert.equal(p.avatar, 2);
    assert.equal(p.quipu, 1);
    assert.equal(p.bio, 0);
    assert.deepEqual([...p.member], [...cMember]);
  });

  it("lets the member change it again", async () => {
    await setVis(cMember, 1, 1, 1, memberOwner);
    const p: any = await program.account.visibilityPolicy.fetch(visPda(cMember));
    assert.equal(p.avatar, 1); assert.equal(p.bio, 1);
  });

  it("rejects a tier above 2", async () => {
    await expectFail(setVis(cMember, 3, 1, 1, memberOwner), "InvalidVisibilityTier");
  });

  it("refuses anyone but the member to set their visibility", async () => {
    // The stranger signs against the member's membership — but holds none of its keys.
    await expectFail(setVis(cMember, 0, 0, 0, strangerOwner), "Unauthorized");
    // A seat cannot impose it either.
    await expectFail(setVis(cMember, 0, 0, 0, seats[0]), "Unauthorized");
  });

  // -------------------------------------------------------------------------
  // F61 — de-enumerating `Membership.owner`, and F60 Phase-2 — the encrypted
  // read path. These tests pin two things that are easy to break silently:
  // that a third party can no longer list a wallet's memberships, and that the
  // member themselves still can.
  // -------------------------------------------------------------------------

  const sha256 = (...parts: Buffer[]) => createHash("sha256").update(Buffer.concat(parts)).digest();
  const u32le = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n, 0); return b; };
  const u16le = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n, 0); return b; };

  // The derivation contract, copied verbatim from frontend/lib/visibilityCrypto.ts.
  // Copied on purpose rather than imported: if either side ever drifts, these
  // tests fail, which is exactly what should happen — a member whose tag no
  // longer matches cannot find their own membership.
  const OWNER_TAG_DOMAIN = Buffer.from("aha-owner-tag-v1");
  const OWNER_KEY_DOMAIN = Buffer.from("aha-owner-key-v1");
  const ENC_KEY_DOMAIN = Buffer.from("aha-vis-enc-v1");
  const ELEMENT_DOMAIN = Buffer.from("aha-vis-elem-v1");
  const DROP_DOMAIN = Buffer.from("aha-vis-drop-v1");
  const WRAP_DOMAIN = Buffer.from("aha-vis-wrap-v1");

  const viewingSecret = (who: string) => sha256(Buffer.from("test-viewing-secret:" + who));
  const ownerTagFor = (vk: Buffer, index = 0) => sha256(OWNER_TAG_DOMAIN, vk, circle.toBuffer(), u32le(index));
  const shieldedKey = (vk: Buffer, index = 0) =>
    anchor.web3.Keypair.fromSeed(sha256(OWNER_KEY_DOMAIN, vk, circle.toBuffer(), u32le(index)));
  const encKey = (vk: Buffer) => nacl.box.keyPair.fromSecretKey(sha256(ENC_KEY_DOMAIN, vk));
  const elementKey = (vk: Buffer, commitment: Buffer, element: number, epoch: number) =>
    sha256(ELEMENT_DOMAIN, vk, circle.toBuffer(), commitment, Buffer.from([element]), u16le(epoch));
  const dropIdFor = (shared: Uint8Array, commitment: Buffer, epoch: number) =>
    sha256(DROP_DOMAIN, Buffer.from(shared), commitment, u16le(epoch));

  const ownerTagPda = (tag: Buffer) => pda(Buffer.from("mownr"), tag);
  const profilePda = (c: Buffer) => pda(Buffer.from("mprofile"), circle.toBuffer(), c);
  const dropPda = (id: Buffer) => pda(Buffer.from("vdrop"), id);

  const OWNER_OFFSET = 89; // 8 disc + 32 circle + 32 commitment + 8 + 8 + 1
  const membershipsOwnedBy = (wallet: anchor.web3.PublicKey) =>
    program.account.membership.all([{ memcmp: { offset: OWNER_OFFSET, bytes: wallet.toBase58() } }]);

  const vkShield = viewingSecret("shielded-member");
  const vkViewer = viewingSecret("viewer");
  const shieldTag = ownerTagFor(vkShield);
  const shieldedOwner = shieldedKey(vkShield);
  const EPOCH = 1;

  it("leaves a plain membership enumerable by wallet — the leak this closes", async () => {
    // The baseline, asserted rather than assumed: before shielding, ANYONE can
    // list every membership a wallet holds with a single memcmp filter. No key,
    // no permission, no relationship to the member.
    const rows = await membershipsOwnedBy(shieldOwner.publicKey);
    assert.equal(rows.length, 1, "the wallet's membership is findable by a stranger");
    assert.deepEqual([...rows[0].account.commitment], [...cShielded]);
  });

  it("shields the membership: the wallet stops being a memcmp index", async () => {
    await program.methods.shieldMembership([...shieldTag], shieldedOwner.publicKey)
      .accounts({
        membership: membershipPda(cShielded),
        ownerTag: ownerTagPda(shieldTag),
        member: shieldOwner.publicKey,
      })
      .signers([shieldOwner]).rpc();

    // The whole finding: a third party scanning for that wallet now gets nothing.
    const rows = await membershipsOwnedBy(shieldOwner.publicKey);
    assert.equal(rows.length, 0, "the roster must no longer be enumerable by wallet");

    // And the value that replaced it is not the wallet.
    const m: any = await program.account.membership.fetch(membershipPda(cShielded));
    assert.notEqual(m.owner.toBase58(), shieldOwner.publicKey.toBase58());
    assert.equal(m.owner.toBase58(), shieldedOwner.publicKey.toBase58());
  });

  it("still lets the member resolve their own membership, from the secret alone", async () => {
    // The member holds no list. They re-derive the tag from their viewing
    // secret, read the PDA at that address, and get their membership back —
    // which is the only reason removing the wallet from `owner` is affordable.
    const tag = ownerTagFor(viewingSecret("shielded-member"));
    const entry: any = await program.account.ownerTag.fetch(ownerTagPda(tag));
    assert.equal(entry.membership.toBase58(), membershipPda(cShielded).toBase58());

    const m: any = await program.account.membership.fetch(entry.membership);
    assert.deepEqual([...m.commitment], [...cShielded]);
  });

  it("gives a stranger nothing to scan: the index entry holds no wallet", async () => {
    // Everything an observer can read off the index, read exhaustively.
    const all = await program.account.ownerTag.all();
    assert.isAtLeast(all.length, 1);
    for (const row of all) {
      const keys = Object.keys(row.account);
      assert.deepEqual(keys.sort(), ["bump", "membership"], "an OwnerTag must expose nothing else");
      // No wallet of any test actor appears anywhere in the account.
      const raw = (await provider.connection.getAccountInfo(row.publicKey))!.data;
      for (const w of [shieldOwner, viewerOwner, memberOwner, strangerOwner, ...seats]) {
        assert.isFalse(raw.includes(w.publicKey.toBuffer()), "no wallet may appear in the index");
      }
    }
    // And the tag itself cannot be derived from anything public: a stranger who
    // knows the wallet, the Circle and the commitment still cannot reach it.
    const guess = sha256(OWNER_TAG_DOMAIN, shieldOwner.publicKey.toBuffer(), circle.toBuffer(), u32le(0));
    await expectFail(program.account.ownerTag.fetch(ownerTagPda(guess)) as any);
  });

  it("refuses a stranger, a seat, and a no-op shield", async () => {
    const otherTag = sha256(Buffer.from("some other tag"));
    // A stranger cannot shield someone else's membership out from under them.
    await expectFail(
      program.methods.shieldMembership([...otherTag], anchor.web3.Keypair.generate().publicKey)
        .accounts({ membership: membershipPda(cViewer), ownerTag: ownerTagPda(otherTag), member: strangerOwner.publicKey })
        .signers([strangerOwner]).rpc(),
      "Unauthorized"
    );
    // Nor can a Council seat impose it.
    await expectFail(
      program.methods.shieldMembership([...otherTag], anchor.web3.Keypair.generate().publicKey)
        .accounts({ membership: membershipPda(cViewer), ownerTag: ownerTagPda(otherTag), member: seats[0].publicKey })
        .signers([seats[0]]).rpc(),
      "Unauthorized"
    );
    // Shielding to the signing wallet would look done and change nothing.
    await expectFail(
      program.methods.shieldMembership([...otherTag], viewerOwner.publicKey)
        .accounts({ membership: membershipPda(cViewer), ownerTag: ownerTagPda(otherTag), member: viewerOwner.publicKey })
        .signers([viewerOwner]).rpc(),
      "OwnerNotShielded"
    );
    // A zero tag is not an index.
    const zero = Buffer.alloc(32);
    await expectFail(
      program.methods.shieldMembership([...zero], anchor.web3.Keypair.generate().publicKey)
        .accounts({ membership: membershipPda(cViewer), ownerTag: ownerTagPda(zero), member: viewerOwner.publicKey })
        .signers([viewerOwner]).rpc(),
      "InvalidOwnerTag"
    );
  });

  it("refuses to strand a membership that would then have no key at all", async () => {
    const tag = sha256(Buffer.from("strand-attempt"));
    await expectFail(
      program.methods.shieldMembership([...tag], anchor.web3.PublicKey.default)
        .accounts({ membership: membershipPda(cViewer), ownerTag: ownerTagPda(tag), member: viewerOwner.publicKey })
        .signers([viewerOwner]).rpc(),
      "MembershipWouldBeUnusable"
    );
  });

  it("serves the bio as ciphertext, and opens it only for a viewer who was given the key", async () => {
    // The member publishes. Note WHO signs: the shielded key, not a wallet —
    // the membership no longer answers to one.
    const bioKey = elementKey(vkShield, cShielded, 1 /* ELEMENT_BIO */, EPOCH);
    const plain = Buffer.alloc(160);
    const body = Buffer.from("one day at a time");
    plain.writeUInt16LE(body.length, 0);
    body.copy(plain, 2);
    const nonce = Buffer.from(nacl.randomBytes(24));
    const bioCt = Buffer.concat([nonce, Buffer.from(nacl.secretbox(plain, nonce, bioKey))]);
    assert.equal(bioCt.length, 200, "the on-chain bio is fixed-length by construction");

    const ownerEnc = encKey(vkShield);
    await program.methods.upsertMemberProfile([...ownerEnc.publicKey], EPOCH, [...bioCt], [...Buffer.alloc(64)])
      .accounts({
        circle,
        memberMembership: membershipPda(cShielded),
        profile: profilePda(cShielded),
        member: shieldedOwner.publicKey,
      })
      .signers([shieldedOwner]).rpc();

    // Anyone may READ the account. What they get is noise.
    const prof: any = await program.account.memberProfile.fetch(profilePda(cShielded));
    assert.equal(prof.bioCt.length, 200);
    const strangerKey = Buffer.alloc(32, 7);
    assert.isNull(
      nacl.secretbox.open(Uint8Array.from(prof.bioCt.slice(24)), Uint8Array.from(prof.bioCt.slice(0, 24)), strangerKey),
      "a stranger's key must open nothing"
    );

    // The member grants one viewer the bio key (and NOT the avatar key), sealed
    // to the shared secret and dropped at an address only those two can compute.
    const viewerEnc = encKey(vkViewer);
    const shared = nacl.scalarMult(ownerEnc.secretKey, viewerEnc.publicKey);
    const wrap = sha256(WRAP_DOMAIN, Buffer.from(shared));
    const keys = Buffer.alloc(64);
    bioKey.copy(keys, 0); // avatar half stays zero — a partial grant, same size
    const dnonce = Buffer.from(nacl.randomBytes(24));
    const sealed = Buffer.concat([dnonce, Buffer.from(nacl.secretbox(keys, dnonce, wrap))]);
    assert.equal(sealed.length, 104);
    const dropId = dropIdFor(shared, cShielded, EPOCH);

    await program.methods.grantVisibilityKey([...dropId], [...sealed], EPOCH)
      .accounts({ keyDrop: dropPda(dropId), payer: viewerOwner.publicKey, systemProgram: anchor.web3.SystemProgram.programId })
      .signers([viewerOwner]).rpc();

    // The viewer, from their own secret: derive the shared secret, derive the
    // address, open the drop, open the bio.
    const vShared = nacl.scalarMult(viewerEnc.secretKey, Uint8Array.from(prof.encPub));
    const vDrop: any = await program.account.visibilityKeyDrop.fetch(dropPda(dropIdFor(vShared, cShielded, prof.epoch)));
    const opened = nacl.secretbox.open(
      Uint8Array.from(vDrop.sealed.slice(24)),
      Uint8Array.from(vDrop.sealed.slice(0, 24)),
      sha256(WRAP_DOMAIN, Buffer.from(vShared))
    )!;
    assert.isNotNull(opened);
    const gotBio = Buffer.from(opened.slice(0, 32));
    const gotAvatar = Buffer.from(opened.slice(32, 64));
    assert.deepEqual([...gotBio], [...bioKey]);
    assert.isTrue(gotAvatar.every((b) => b === 0), "an ungranted element travels as zeroes");

    const text = nacl.secretbox.open(Uint8Array.from(prof.bioCt.slice(24)), Uint8Array.from(prof.bioCt.slice(0, 24)), gotBio)!;
    const len = Buffer.from(text).readUInt16LE(0);
    assert.equal(Buffer.from(text.slice(2, 2 + len)).toString(), "one day at a time");
  });

  it("leaves an outsider with an address they cannot compute — hidden ≡ absent", async () => {
    // A third member of the same Circle, in the audience of nothing: their
    // derived drop address simply has no account at it. There is no "denied"
    // response to distinguish from "nothing published".
    const outsiderEnc = encKey(viewingSecret("outsider"));
    const prof: any = await program.account.memberProfile.fetch(profilePda(cShielded));
    const shared = nacl.scalarMult(outsiderEnc.secretKey, Uint8Array.from(prof.encPub));
    await expectFail(program.account.visibilityKeyDrop.fetch(dropPda(dropIdFor(shared, cShielded, prof.epoch))) as any);
  });

  it("publishes no audience graph: a key drop names neither party", async () => {
    const all = await program.account.visibilityKeyDrop.all();
    assert.isAtLeast(all.length, 1);
    for (const row of all) {
      assert.deepEqual(Object.keys(row.account).sort(), ["bump", "epoch", "sealed"]);
      const raw = (await provider.connection.getAccountInfo(row.publicKey))!.data;
      for (const w of [shieldOwner, viewerOwner, shieldedOwner, memberOwner, strangerOwner]) {
        assert.isFalse(raw.includes(w.publicKey.toBuffer()), "a drop must not name a granter or a recipient");
      }
      for (const c of [cShielded, cViewer, cMember]) {
        assert.isFalse(raw.includes(c), "a drop must not name a commitment either");
      }
    }
  });

  it("revokes by re-keying, not by naming anyone", async () => {
    // Bumping the epoch re-keys every element and moves every drop address. No
    // "access revoked for B" record is written, because none exists to write.
    const newBio = Buffer.from(nacl.randomBytes(200));
    const ownerEnc = encKey(vkShield);
    await program.methods.upsertMemberProfile([...ownerEnc.publicKey], EPOCH + 1, [...newBio], [...Buffer.alloc(64)])
      .accounts({ circle, memberMembership: membershipPda(cShielded), profile: profilePda(cShielded), member: shieldedOwner.publicKey })
      .signers([shieldedOwner]).rpc();

    const viewerEnc = encKey(vkViewer);
    const shared = nacl.scalarMult(viewerEnc.secretKey, ownerEnc.publicKey);
    // The drop the viewer already holds is at the OLD address; the new epoch's
    // address has nothing at it, and the old key opens none of the new bytes.
    await expectFail(program.account.visibilityKeyDrop.fetch(dropPda(dropIdFor(shared, cShielded, EPOCH + 1))) as any);

    // And an epoch may not be rolled back to resurrect the stranded drops.
    await expectFail(
      program.methods.upsertMemberProfile([...ownerEnc.publicKey], EPOCH, [...newBio], [...Buffer.alloc(64)])
        .accounts({ circle, memberMembership: membershipPda(cShielded), profile: profilePda(cShielded), member: shieldedOwner.publicKey })
        .signers([shieldedOwner]).rpc(),
      "EpochWentBackwards"
    );
  });
});
