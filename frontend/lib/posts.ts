// F30 — member posts / bulletins. A member (a wallet that owns a live
// membership in the Circle) publishes text and/or an IPFS image, shown only
// within [start_date, end_date]. Any of the 7 Council seats may delete any post.

import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID, SigningWallet, programWith, readOnlyProgram } from "./member";

const seed = (s: string) => new TextEncoder().encode(s);

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

/** Publish a post. `membership` is the author's membership PDA in this Circle. */
export async function createPost(
  wallet: SigningWallet,
  circle: PublicKey,
  membership: PublicKey,
  text: string,
  imageCid: string,
  startDate: number,
  endDate: number
): Promise<string> {
  const program = programWith(wallet);
  const nonce = new anchor.BN(Date.now());
  return program.methods
    .createPost(nonce, text, imageCid, new anchor.BN(startDate), new anchor.BN(endDate))
    .accounts({
      circle,
      membership,
      post: postPda(circle, wallet.publicKey, nonce),
      author: wallet.publicKey,
    })
    .rpc();
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
