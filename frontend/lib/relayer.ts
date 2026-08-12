// F55 — client side of the relayer: build the instruction with the RELAYER as
// payer and hand it to /api/relay, so the member's wallet appears nowhere in
// the transaction. When no relayer is configured the callers fall back to
// self-paying — functional, but named on chain; the UI copy must say so
// (docs/member-voting.md, ADR 0005).

import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";

const TTL_MS = 60_000;
let cached: { at: number; relayer: PublicKey | null } | null = null;

/** The relayer's fee-payer key, or null when unconfigured/unreachable. */
export async function relayerPubkey(): Promise<PublicKey | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.relayer;
  try {
    const res = await fetch("/api/relay", { method: "GET" });
    const j = await res.json();
    const relayer = j?.configured && j?.relayer ? new PublicKey(j.relayer) : null;
    cached = { at: Date.now(), relayer };
    return relayer;
  } catch {
    cached = { at: Date.now(), relayer: null };
    return null;
  }
}

/** Submit one allowlisted instruction through the relayer. */
export async function relayInstruction(ix: TransactionInstruction): Promise<string> {
  const res = await fetch("/api/relay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      keys: ix.keys.map((k) => ({
        pubkey: k.pubkey.toBase58(),
        isSigner: k.isSigner,
        isWritable: k.isWritable,
      })),
      data: Buffer.from(ix.data).toString("base64"),
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.signature) throw new Error(j.error || "relay failed");
  return j.signature as string;
}

/**
 * F61 — submit an allowlisted instruction that ALSO needs one member signature,
 * with the relayer paying.
 *
 * This is the only path by which a shielded membership can act without its
 * member's wallet appearing on chain. The derived authority key signs here, in
 * the browser; only its signature crosses the wire. The relayer cannot forge it,
 * cannot reuse it (it is bound to this exact message and blockhash), and cannot
 * learn anything from it beyond the pubkey already in the account list.
 *
 * The blockhash is chosen HERE, not by the route, because a signature is over a
 * specific message and the message contains the blockhash. It comes from the
 * client's own RPC connection — the same cluster the route uses.
 */
export interface CosigningAuthority {
  publicKey: PublicKey;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
}

export async function relayCosigned(
  ix: TransactionInstruction,
  authority: Keypair | CosigningAuthority,
  conn: Connection
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const relayer = await relayerPubkey();
  if (!relayer) throw new Error("no relayer configured");

  let tx = new Transaction({ blockhash, lastValidBlockHeight, feePayer: relayer }).add(ix);
  if (authority instanceof Keypair) {
    tx.partialSign(authority);
  } else {
    // A connected wallet can co-sign too — used by `shield_membership`, whose
    // authority is by definition the member's ordinary wallet (only the current
    // owner may shield). Relaying it does not hide that wallet and is not
    // claimed to; it means a member whose wallet holds nothing can still shield.
    tx = await authority.signTransaction(tx);
  }
  const sig = tx.signatures.find((s) => s.publicKey.equals(authority.publicKey))?.signature;
  if (!sig) throw new Error("could not obtain the authority signature");

  const res = await fetch("/api/relay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      keys: ix.keys.map((k) => ({
        pubkey: k.pubkey.toBase58(),
        isSigner: k.isSigner,
        isWritable: k.isWritable,
      })),
      data: Buffer.from(ix.data).toString("base64"),
      authority: {
        pubkey: authority.publicKey.toBase58(),
        signature: Buffer.from(sig).toString("base64"),
        blockhash,
        lastValidBlockHeight,
      },
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.signature) throw new Error(j.error || "relay failed");
  return j.signature as string;
}
