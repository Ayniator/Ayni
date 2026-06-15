// MACI (coercion-resistant voting) — submission-layer client. The on-chain
// message queue (open_maci_round / publish_maci_message) is implemented; the
// coordinator service + process/tally ZK circuits are specified in docs/maci.md
// and remain the (large) outstanding work. These helpers let a coordinator and a
// future voting UI register a round and post sealed commands today.

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import nacl from "tweetnacl";
import { PROGRAM_ID, SigningWallet, programWith, readOnlyProgram } from "./member";

const seed = (s: string) => new TextEncoder().encode(s);
const CMD_LEN = 160;        // padded MACI command plaintext
const CT_LEN = CMD_LEN + 16; // + NaCl box MAC = 176 (== MaciMessage::CT_LEN)

export const maciRoundPda = (proposal: PublicKey) =>
  PublicKey.findProgramAddressSync([seed("maci"), proposal.toBytes()], PROGRAM_ID)[0];

export const maciMessagePda = (round: PublicKey, index: number | bigint) => {
  const le = new Uint8Array(8);
  new DataView(le.buffer).setBigUint64(0, BigInt(index), true);
  return PublicKey.findProgramAddressSync([seed("macimsg"), round.toBytes(), le], PROGRAM_ID)[0];
};

/** Any Council seat opens a MACI round over a member proposal. `coordinator` is
 *  the x25519 public key voters seal their commands to. */
export async function openMaciRound(
  wallet: SigningWallet,
  circle: PublicKey,
  proposal: PublicKey,
  coordinator: Uint8Array
): Promise<string> {
  return programWith(wallet)
    .methods.openMaciRound([...coordinator])
    .accounts({ circle, proposal, round: maciRoundPda(proposal), seat: wallet.publicKey, systemProgram: SystemProgram.programId })
    .rpc();
}

export interface MaciRoundInfo { coordinator: Uint8Array; messageCount: number; processed: boolean }

export async function getMaciRound(proposal: string): Promise<MaciRoundInfo | null> {
  try {
    const a: any = await (readOnlyProgram().account as any).maciRound.fetch(maciRoundPda(new PublicKey(proposal)));
    return { coordinator: Uint8Array.from(a.coordinator), messageCount: Number(a.messageCount), processed: Boolean(a.processed) };
  } catch {
    return null;
  }
}

/** Pad a raw MACI command to the fixed plaintext length (2-byte length prefix). */
function pad(cmd: Uint8Array): Uint8Array {
  if (cmd.length + 2 > CMD_LEN) throw new Error("MACI command too long.");
  const out = new Uint8Array(CMD_LEN);
  out[0] = (cmd.length >> 8) & 0xff;
  out[1] = cmd.length & 0xff;
  out.set(cmd, 2);
  return out;
}

/** Seal a command to the round's coordinator (fresh ephemeral key) and publish
 *  it. The plaintext is whatever the MACI command format encodes (a vote or a
 *  key-change); it's opaque on-chain. Returns the tx signature. */
export async function publishMaciCommand(
  wallet: SigningWallet,
  proposal: PublicKey,
  coordinator: Uint8Array,
  command: Uint8Array
): Promise<string> {
  const round = maciRoundPda(proposal);
  const info = await getMaciRound(proposal.toBase58());
  if (!info) throw new Error("No MACI round for this proposal.");
  const eph = nacl.box.keyPair();
  // A fresh ephemeral key per message means a constant (zero) nonce is safe (the
  // (key, nonce) pair is never reused), and avoids needing a nonce field on-chain.
  // The coordinator opens with: box.open(ct, ZERO_NONCE, eph_pubkey, coordinatorSecret).
  const ct = nacl.box(pad(command), new Uint8Array(24), coordinator, eph.secretKey);
  if (ct.length !== CT_LEN) throw new Error("internal: MACI ciphertext length mismatch");
  return programWith(wallet)
    .methods.publishMaciMessage([...eph.publicKey], Buffer.from(ct))
    .accounts({ round, message: maciMessagePda(round, info.messageCount), payer: wallet.publicKey, systemProgram: SystemProgram.programId })
    .rpc();
}
