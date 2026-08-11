// F55 — client side of the relayer: build the instruction with the RELAYER as
// payer and hand it to /api/relay, so the member's wallet appears nowhere in
// the transaction. When no relayer is configured the callers fall back to
// self-paying — functional, but named on chain; the UI copy must say so
// (docs/member-voting.md, ADR 0005).

import { PublicKey, TransactionInstruction } from "@solana/web3.js";

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
