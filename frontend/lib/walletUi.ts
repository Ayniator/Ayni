// Pure helpers for the /wallet page (F87, Epic E12): SPL token constants,
// manual instruction encodings, PDA derivations, amount parsing, and defensive
// Metaplex-metadata parsing. No React, no network calls — every function here
// is pure so the page owns all I/O.
//
// @solana/spl-token is deliberately NOT a dependency; the two instructions we
// need (SPL Token `Transfer` and ATA `CreateIdempotent`) are tiny and their
// byte layouts are stable, documented parts of the on-chain programs. Each
// encoding below cites the exact layout it implements.

import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { ipfsUrl } from "./ipfs";

// ---------------------------------------------------------------------------
// Well-known program ids (mainnet == devnet == testnet for all four).
// ---------------------------------------------------------------------------

/** SPL Token (legacy) program. */
export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

/** Token-2022 (Token Extensions) program. */
export const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
);

/** SPL Associated Token Account program. */
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

/** Metaplex Token Metadata program. */
export const METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** "4Nd1…Wxyz" — the app's usual short-address form. */
export function shortAddr(addr: string, n = 4): string {
  if (addr.length <= n * 2 + 1) return addr;
  return `${addr.slice(0, n)}…${addr.slice(-n)}`;
}

/** Lamports → "1.2345" (trailing zeros trimmed), matching /me's formatting. */
export function formatSol(lamports: number | bigint): string {
  const n = Number(lamports) / 1e9;
  return n.toFixed(4).replace(/\.?0+$/, "") || "0";
}

/** Base units (bigint) → decimal string honoring `decimals` (no float drift). */
export function formatBaseUnits(amount: bigint, decimals: number): string {
  if (decimals === 0) return amount.toString();
  const s = amount.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals);
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/**
 * Parse a user-typed decimal amount into integer base units.
 * Returns null on anything that isn't a plain positive decimal with at most
 * `decimals` fractional digits. All-BigInt: no floating point ever touches
 * the amount that gets signed.
 */
export function parseAmountToBaseUnits(input: string, decimals: number): bigint | null {
  const s = input.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  if (frac.length > decimals) return null; // more precision than the mint has
  try {
    return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
  } catch {
    return null;
  }
}

/** Parse a base-58 address; null if invalid. */
export function parsePublicKey(input: string): PublicKey | null {
  try {
    return new PublicKey(input.trim());
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Byte encoding
// ---------------------------------------------------------------------------

/** A u64 little-endian, built without Buffer.writeBigUInt64LE for portability. */
export function u64le(n: bigint): Uint8Array {
  if (n < 0n || n > 0xffffffffffffffffn) throw new Error("u64 out of range");
  const out = new Uint8Array(8);
  let v = n;
  for (let i = 0; i < 8; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

// ---------------------------------------------------------------------------
// PDAs
// ---------------------------------------------------------------------------

/**
 * The associated token account for (owner, mint) under a given token program.
 * ATA program spec: PDA seeds = [owner, token_program_id, mint] under the
 * Associated Token Account program.
 */
export function deriveAta(
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBytes(), tokenProgram.toBytes(), mint.toBytes()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

/**
 * The Metaplex metadata PDA for a mint.
 * Token Metadata spec: seeds = ["metadata", metadata_program_id, mint].
 */
export function metadataPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("metadata"), METADATA_PROGRAM_ID.toBytes(), mint.toBytes()],
    METADATA_PROGRAM_ID
  )[0];
}

// ---------------------------------------------------------------------------
// Instructions (manual encodings — layouts cited from the on-chain programs)
// ---------------------------------------------------------------------------

/**
 * SPL Token `Transfer` (TokenInstruction #3), single-owner form.
 *
 * Data (9 bytes):   [ 3u8 ][ amount: u64 LE ]
 * Accounts:         0. source token account   — writable
 *                   1. destination token acct — writable
 *                   2. owner (authority)      — signer
 *
 * Token-2022 keeps the identical discriminator, data layout and account order
 * for `Transfer` (it is deprecated there in favour of TransferChecked but
 * still executes for mints without transfer-fee extensions) — only the
 * program id differs, so the caller passes it in.
 */
export function splTransferIx(
  source: PublicKey,
  destination: PublicKey,
  owner: PublicKey,
  amount: bigint,
  tokenProgram: PublicKey
): TransactionInstruction {
  const data = new Uint8Array(9);
  data[0] = 3; // Transfer
  data.set(u64le(amount), 1);
  return new TransactionInstruction({
    programId: tokenProgram,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

/**
 * ATA `CreateIdempotent` (AssociatedTokenAccountInstruction #1) — creates the
 * (owner, mint) associated token account if absent, succeeds as a no-op if it
 * already exists (safe against races between our existence check and landing).
 *
 * Data (1 byte):    [ 1u8 ]
 * Accounts:         0. payer                    — signer, writable
 *                   1. associated token account — writable
 *                   2. wallet (the ATA's owner)
 *                   3. token mint
 *                   4. system program
 *                   5. token program (legacy or Token-2022, matching the mint)
 */
export function createAtaIdempotentIx(
  payer: PublicKey,
  ata: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(new Uint8Array([1])), // CreateIdempotent
  });
}

// ---------------------------------------------------------------------------
// Metaplex metadata parsing (defensive, no Borsh dependency)
// ---------------------------------------------------------------------------

export interface NftMetadata {
  name: string;
  symbol: string;
  uri: string;
}

/**
 * Parse the head of a Token Metadata account. Layout (Metadata v1):
 *   key: u8 (1)  |  update_authority: 32  |  mint: 32
 *   data.name:   u32 LE length + bytes (Metaplex pads with \0 inside)
 *   data.symbol: u32 LE length + bytes
 *   data.uri:    u32 LE length + bytes
 * We only need name/symbol/uri; everything after is ignored. Every read is
 * bounds-checked; any inconsistency returns null instead of throwing.
 */
export function parseNftMetadata(data: Uint8Array): NftMetadata | null {
  try {
    let off = 1 + 32 + 32; // key + update_authority + mint
    const str = (): string | null => {
      if (off + 4 > data.length) return null;
      const len = data[off] | (data[off + 1] << 8) | (data[off + 2] << 16) | (data[off + 3] << 24);
      off += 4;
      if (len < 0 || len > 1000 || off + len > data.length) return null;
      const bytes = data.slice(off, off + len);
      off += len;
      // Trim the \0 padding Metaplex stores inside fixed-width strings.
      return new TextDecoder().decode(bytes).replace(/\0+$/g, "").trim();
    };
    const name = str();
    const symbol = str();
    const uri = str();
    if (name === null || symbol === null || uri === null) return null;
    return { name, symbol, uri };
  } catch {
    return null;
  }
}

/**
 * Resolve an NFT metadata/image URI to something fetchable: https as-is,
 * ipfs:// via the app's gateway (lib/ipfs.ts), anything else rejected.
 */
export function resolveAssetUrl(uri: string): string {
  const u = (uri || "").trim();
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  if (/^ipfs:\/\//i.test(u)) return ipfsUrl(u);
  return "";
}
