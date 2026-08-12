// F30 — member posts / bulletins. A member (a wallet that owns a live
// membership in the Circle) publishes text and/or an IPFS image, shown only
// within [start_date, end_date]. Any of the 7 Council seats may delete any post.

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { PROGRAM_ID, SigningWallet, membershipPda, programWith, readOnlyProgram } from "./member";
import { memberAuthority, sendMemberTx } from "./shielded";

const seed = (s: string) => new TextEncoder().encode(s);
const toBytes = (hex: string) => Uint8Array.from((hex.match(/.{1,2}/g) ?? []).map((b) => parseInt(b, 16)));

export const postPda = (circle: PublicKey, author: PublicKey, nonce: anchor.BN) =>
  PublicKey.findProgramAddressSync(
    [seed("post"), circle.toBytes(), author.toBytes(), nonce.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  )[0];

export interface Post {
  pubkey: string;
  circle: string;
  author: string;
  nonce: string;
  createdAt: number;
  startDate: number;
  endDate: number;
  imageCid: string;
  text: string;
  live: boolean; // now within [start,end]
}

export async function listPosts(circle: string): Promise<Post[]> {
  const program = readOnlyProgram();
  const rows = await (program.account as any).post.all([{ memcmp: { offset: 8, bytes: circle } }]);
  const now = Date.now() / 1000;
  return rows
    .map((r: any): Post => {
      const a = r.account;
      const startDate = Number(a.startDate);
      const endDate = Number(a.endDate);
      return {
        pubkey: r.publicKey.toBase58(),
        circle: a.circle.toBase58(),
        author: a.author.toBase58(),
        nonce: a.nonce.toString(),
        createdAt: Number(a.createdAt),
        startDate,
        endDate,
        imageCid: a.imageCid,
        text: a.text,
        live: now >= startDate && now <= endDate,
      };
    })
    .sort((x: Post, y: Post) => y.createdAt - x.createdAt);
}

/**
 * Publish a post.
 *
 * `commitmentHex` is the author's membership commitment in this Circle — the
 * post is authorised by whichever key that membership answers to, which for a
 * SHIELDED membership is the derived key, not the connected wallet. Before F61
 * this function assumed `owner == wallet` and a shielded member simply could not
 * post; now the right signer is resolved and the fee/rent are relayed when a
 * relayer exists, so the wallet need not appear at all.
 *
 * Note what changes on chain for a shielded author: `Post.author` becomes the
 * derived key. Posts by one member in one Circle remain groupable with each
 * other and with their `Membership` (whose `owner` holds the same value) — that
 * was always true — but the value no longer names a wallet anyone knows them by.
 */
export async function createPost(
  wallet: SigningWallet,
  circle: PublicKey,
  commitmentHex: string,
  text: string,
  imageCid: string,
  startDate: number,
  endDate: number
): Promise<{ signature: string; relayed: boolean }> {
  const auth = await memberAuthority(wallet, circle, commitmentHex);
  const program = programWith(wallet);
  const nonce = new anchor.BN(Date.now());
  return sendMemberTx(wallet, auth, (payer) =>
    program.methods
      .createPost(nonce, text, imageCid, new anchor.BN(startDate), new anchor.BN(endDate))
      .accounts({
        circle,
        membership: membershipPda(circle, toBytes(commitmentHex)),
        post: postPda(circle, auth.authority, nonce),
        author: auth.authority,
        payer,
        systemProgram: SystemProgram.programId,
      })
      .instruction()
  );
}

/** Any Council seat deletes a post. */
export async function deletePost(
  wallet: SigningWallet,
  circle: PublicKey,
  post: PublicKey
): Promise<string> {
  return programWith(wallet)
    .methods.deletePost()
    .accounts({ circle, post, seat: wallet.publicKey })
    .rpc();
}
