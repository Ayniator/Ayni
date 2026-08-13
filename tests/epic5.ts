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
      .accounts({ circle, memberMembership: membershipPda(memberC), policy: visPda(memberC), member: signer.publicKey, payer: signer.publicKey })
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
  const ENC_KEY_DOMAIN_V1 = Buffer.from("aha-vis-enc-v1"); // legacy, read-only
  const ENC_KEY_DOMAIN = Buffer.from("aha-vis-enc-v2");
  const ELEMENT_DOMAIN = Buffer.from("aha-vis-elem-v1");
  const DROP_DOMAIN = Buffer.from("aha-vis-drop-v1");
  const WRAP_DOMAIN = Buffer.from("aha-vis-wrap-v1");

  const viewingSecret = (who: string) => sha256(Buffer.from("test-viewing-secret:" + who));
  const ownerTagFor = (vk: Buffer, index = 0) => sha256(OWNER_TAG_DOMAIN, vk, circle.toBuffer(), u32le(index));
  const shieldedKey = (vk: Buffer, index = 0) =>
    anchor.web3.Keypair.fromSeed(sha256(OWNER_KEY_DOMAIN, vk, circle.toBuffer(), u32le(index)));
  // v2 folds the Circle in. v1 did not, which is the defect this pins: one
  // member in three Circles published the SAME `enc_pub` in all three, so a
  // memcmp on that field regrouped exactly what shielding had un-grouped.
  const encKey = (vk: Buffer, c: anchor.web3.PublicKey = circle) =>
    nacl.box.keyPair.fromSecretKey(sha256(ENC_KEY_DOMAIN, vk, c.toBuffer()));
  const legacyEncKey = (vk: Buffer) => nacl.box.keyPair.fromSecretKey(sha256(ENC_KEY_DOMAIN_V1, vk));
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
        payer: shieldOwner.publicKey,
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
        .accounts({ membership: membershipPda(cViewer), ownerTag: ownerTagPda(otherTag), member: strangerOwner.publicKey, payer: strangerOwner.publicKey })
        .signers([strangerOwner]).rpc(),
      "Unauthorized"
    );
    // Nor can a Council seat impose it.
    await expectFail(
      program.methods.shieldMembership([...otherTag], anchor.web3.Keypair.generate().publicKey)
        .accounts({ membership: membershipPda(cViewer), ownerTag: ownerTagPda(otherTag), member: seats[0].publicKey, payer: seats[0].publicKey })
        .signers([seats[0]]).rpc(),
      "Unauthorized"
    );
    // Shielding to the signing wallet would look done and change nothing.
    await expectFail(
      program.methods.shieldMembership([...otherTag], viewerOwner.publicKey)
        .accounts({ membership: membershipPda(cViewer), ownerTag: ownerTagPda(otherTag), member: viewerOwner.publicKey, payer: viewerOwner.publicKey })
        .signers([viewerOwner]).rpc(),
      "OwnerNotShielded"
    );
    // A zero tag is not an index.
    const zero = Buffer.alloc(32);
    await expectFail(
      program.methods.shieldMembership([...zero], anchor.web3.Keypair.generate().publicKey)
        .accounts({ membership: membershipPda(cViewer), ownerTag: ownerTagPda(zero), member: viewerOwner.publicKey, payer: viewerOwner.publicKey })
        .signers([viewerOwner]).rpc(),
      "InvalidOwnerTag"
    );
  });

  it("refuses to strand a membership that would then have no key at all", async () => {
    const tag = sha256(Buffer.from("strand-attempt"));
    await expectFail(
      program.methods.shieldMembership([...tag], anchor.web3.PublicKey.default)
        .accounts({ membership: membershipPda(cViewer), ownerTag: ownerTagPda(tag), member: viewerOwner.publicKey, payer: viewerOwner.publicKey })
        .signers([viewerOwner]).rpc(),
      "MembershipWouldBeUnusable"
    );
  });

  // -------------------------------------------------------------------------
  // F61 — A SHIELDED MEMBER LOSES NOTHING.
  //
  // The mechanism shipped before this suite existed, and it was useless: every
  // member-signed write assumed `owner == connected wallet`, so shielding
  // silently cost the member the ability to post, set visibility, choose a
  // wing, tie a cord or sponsor a newcomer. These tests are the contract that
  // it does not — each one is signed by the DERIVED key and paid for by a
  // DIFFERENT account, and the last one asserts the derived key never held a
  // lamport while doing it. That separation is not a convenience: funding a
  // derived "anonymous" key from a wallet the member is known by is a
  // single-hop transfer, the strongest clustering heuristic in chain analysis,
  // and a worse link than the one shielding removes.
  // -------------------------------------------------------------------------

  const cNewcomerF61 = makeCommitment();
  const postNonce = new anchor.BN(20260812);
  const postPda = (author: anchor.web3.PublicKey, nonce: anchor.BN) =>
    pda(Buffer.from("post"), circle.toBuffer(), author.toBuffer(), nonce.toArrayLike(Buffer, "le", 8));
  const wingPeerPda = (mentee: Buffer) => pda(Buffer.from("wingpeer"), circle.toBuffer(), mentee);
  const cordPda = (member: Buffer, step: number) =>
    pda(Buffer.from("quipu"), circle.toBuffer(), member, Buffer.from([step]));
  const attestPda = (newcomer: Buffer) => pda(Buffer.from("attest"), circle.toBuffer(), newcomer);

  it("a shielded member still sets their own visibility — derived key signs, someone else pays", async () => {
    await program.methods.setVisibility(2, 1, 0)
      .accounts({
        circle,
        memberMembership: membershipPda(cShielded),
        policy: visPda(cShielded),
        member: shieldedOwner.publicKey,
        payer: payer.publicKey,
      })
      .signers([shieldedOwner]).rpc();

    const p: any = await program.account.visibilityPolicy.fetch(visPda(cShielded));
    assert.deepEqual([p.avatar, p.quipu, p.bio], [2, 1, 0]);
  });

  it("a shielded member still posts, and the post names no wallet", async () => {
    await program.methods
      .createPost(postNonce, "one day at a time", "", new anchor.BN(0), new anchor.BN(4102444800))
      .accounts({
        circle,
        membership: membershipPda(cShielded),
        post: postPda(shieldedOwner.publicKey, postNonce),
        author: shieldedOwner.publicKey,
        payer: payer.publicKey,
      })
      .signers([shieldedOwner]).rpc();

    const post: any = await program.account.post.fetch(postPda(shieldedOwner.publicKey, postNonce));
    assert.equal(post.author.toBase58(), shieldedOwner.publicKey.toBase58());
    // The thing that matters: the wallet the member is known by is not in it.
    assert.notEqual(post.author.toBase58(), shieldOwner.publicKey.toBase58());
    const raw = (await provider.connection.getAccountInfo(postPda(shieldedOwner.publicKey, postNonce)))!.data;
    assert.isFalse(raw.includes(shieldOwner.publicKey.toBuffer()), "no wallet may appear in a shielded member's post");
  });

  it("a shielded member is still a usable sponsor: wing, cord, and admission attestation", async () => {
    // The viewer (unshielded) takes the shielded member as their wing.
    await program.methods.establishWingPeer()
      .accounts({
        circle,
        menteeMembership: membershipPda(cViewer),
        wingMembership: membershipPda(cShielded),
        wingPeer: wingPeerPda(cViewer),
        signer: viewerOwner.publicKey,
        payer: payer.publicKey,
      })
      .signers([viewerOwner]).rpc();

    // ...and the shielded member ties their cord — the one act only a sponsor
    // can perform. Before this round, shielding took it away.
    await program.methods.tieQuipuCord(1)
      .accounts({
        circle,
        memberMembership: membershipPda(cViewer),
        sponsorMembership: membershipPda(cShielded),
        wingPeer: wingPeerPda(cViewer),
        cord: cordPda(cViewer, 1),
        sponsor: shieldedOwner.publicKey,
        payer: payer.publicKey,
      })
      .signers([shieldedOwner]).rpc();
    const cord: any = await program.account.quipuCord.fetch(cordPda(cViewer, 1));
    assert.deepEqual([...cord.sponsor], [...cShielded]);

    // ...and sponsors a newcomer through the named admission path.
    await program.methods.attestAdmission([...cNewcomerF61])
      .accounts({
        circle,
        parrainMembership: membershipPda(cShielded),
        attestation: attestPda(cNewcomerF61),
        parrain: shieldedOwner.publicKey,
        payer: payer.publicKey,
      })
      .signers([shieldedOwner]).rpc();
    const att: any = await program.account.admissionAttestation.fetch(attestPda(cNewcomerF61));
    assert.deepEqual([...att.parrain], [...cShielded]);

    // ...and can end the bond, which creates nothing and so takes no payer.
    await program.methods.endWingPeer()
      .accounts({
        circle,
        wingPeer: wingPeerPda(cViewer),
        membership: membershipPda(cShielded),
        signer: shieldedOwner.publicKey,
      })
      .signers([shieldedOwner]).rpc();
    const wp: any = await program.account.wingPeer.fetch(wingPeerPda(cViewer));
    assert.isFalse(wp.active);
  });

  it("the derived key never held a lamport while doing any of it", async () => {
    // The invariant the whole design rests on. If this ever fails, someone has
    // made the shielded key pay for something, and the only practical way to
    // fund it is a transfer from the member's known wallet.
    assert.equal(await provider.connection.getBalance(shieldedOwner.publicKey), 0);
  });

  it("refuses a shielded member's write signed by the wallet they shielded away from", async () => {
    // The other half of "shielding actually did something": the old wallet must
    // no longer authorise this membership.
    await expectFail(
      program.methods
        .createPost(new anchor.BN(1), "should not land", "", new anchor.BN(0), new anchor.BN(4102444800))
        .accounts({
          circle,
          membership: membershipPda(cShielded),
          post: postPda(shieldOwner.publicKey, new anchor.BN(1)),
          author: shieldOwner.publicKey,
          payer: shieldOwner.publicKey,
        })
        .signers([shieldOwner]).rpc(),
      "Unauthorized"
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
        // The derived key AUTHORISES; the member's ordinary wallet PAYS. The
        // derived key is never airdropped anywhere in this file — that is the
        // assertion: a shielded membership must be usable by a key that has
        // never held a lamport, because funding it from a known wallet would
        // link the two harder than co-signing does.
        member: shieldedOwner.publicKey,
        payer: shieldOwner.publicKey,
      })
      .signers([shieldedOwner, shieldOwner]).rpc();

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

  it("never requires the shielded key to hold a lamport", async () => {
    // Sentinel NRR-2026-08-12-f60-f61-maci, Regression 2 (CRITICAL): the profile
    // write used `payer = member`, so the derived key had to be funded — and the
    // only way to fund it is a single-hop transfer from a wallet the member is
    // known by, which is a stronger deanonymisation link (the funding-source
    // heuristic) than the co-signature the design already admits to. Authority
    // and payer are now separate accounts. This asserts the key that authorised
    // every write above still has a zero balance.
    const bal = await provider.connection.getBalance(shieldedOwner.publicKey);
    assert.equal(bal, 0, "the shielded key must never need funding");
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

  it("F61-R3: a member's profile key differs per Circle — enc_pub is not a cross-Circle handle", () => {
    // THE DEFECT THIS PINS. `enc_pub` is published in the clear in every
    // MemberProfile. Under v1 it derived from the viewing secret ALONE, so one
    // member in three Circles wrote the SAME 32 bytes three times: a single
    // memcmp on that field relinked the memberships `ownerTag` had just
    // unlinked. Shielding moved the handle, it did not remove it.
    const other = anchor.web3.Keypair.generate().publicKey; // a different Circle
    const here = encKey(vkShield, circle).publicKey;
    const there = encKey(vkShield, other).publicKey;

    assert.notDeepEqual(
      Buffer.from(here),
      Buffer.from(there),
      "same member, two Circles, identical enc_pub — the cross-Circle handle is back"
    );

    // And the legacy derivation is exactly the thing that must never come back
    // as a WRITE path: it is Circle-blind by construction.
    const legacy = legacyEncKey(vkShield).publicKey;
    assert.deepEqual(
      Buffer.from(legacy),
      Buffer.from(legacyEncKey(vkShield).publicKey),
      "sanity: legacy derivation is deterministic"
    );
    assert.notDeepEqual(
      Buffer.from(legacy),
      Buffer.from(here),
      "v2 must not collapse back onto the Circle-blind v1 key"
    );

    // Distinct members stay distinct in the same Circle, so the binding did not
    // accidentally make the key a function of the Circle alone.
    assert.notDeepEqual(
      Buffer.from(encKey(vkViewer, circle).publicKey),
      Buffer.from(here),
      "two members in one Circle must not share a profile key"
    );
  });

  it("revokes by re-keying, not by naming anyone", async () => {
    // Bumping the epoch re-keys every element and moves every drop address. No
    // "access revoked for B" record is written, because none exists to write.
    const newBio = Buffer.from(nacl.randomBytes(200));
    const ownerEnc = encKey(vkShield);
    await program.methods.upsertMemberProfile([...ownerEnc.publicKey], EPOCH + 1, [...newBio], [...Buffer.alloc(64)])
      .accounts({ circle, memberMembership: membershipPda(cShielded), profile: profilePda(cShielded), member: shieldedOwner.publicKey, payer: shieldOwner.publicKey })
      .signers([shieldedOwner, shieldOwner]).rpc();

    const viewerEnc = encKey(vkViewer);
    const shared = nacl.scalarMult(viewerEnc.secretKey, ownerEnc.publicKey);
    // The drop the viewer already holds is at the OLD address; the new epoch's
    // address has nothing at it, and the old key opens none of the new bytes.
    await expectFail(program.account.visibilityKeyDrop.fetch(dropPda(dropIdFor(shared, cShielded, EPOCH + 1))) as any);

    // And an epoch may not be rolled back to resurrect the stranded drops.
    await expectFail(
      program.methods.upsertMemberProfile([...ownerEnc.publicKey], EPOCH, [...newBio], [...Buffer.alloc(64)])
        .accounts({ circle, memberMembership: membershipPda(cShielded), profile: profilePda(cShielded), member: shieldedOwner.publicKey, payer: shieldOwner.publicKey })
        .signers([shieldedOwner, shieldOwner]).rpc(),
      "EpochWentBackwards"
    );
  });
});
