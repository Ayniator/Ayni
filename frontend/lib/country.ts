// On-chain access to a Circle's country (the CircleCountry sibling PDA,
// ["country", circle]). Set by any Council seat; powers the foundation
// directory's continent → country grouping. Kept out of CircleProfile so
// existing profiles need no migration.

import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID, SigningWallet, programWith, readOnlyProgram } from "./member";

const seed = (s: string) => new TextEncoder().encode(s);

export const circleCountryPda = (circle: PublicKey) =>
  PublicKey.findProgramAddressSync([seed("country"), circle.toBytes()], PROGRAM_ID)[0];

/** Set a Circle's ISO-3166-1 alpha-2 country code (any Council seat signs). */
export async function setCircleCountry(
  wallet: SigningWallet,
  circle: PublicKey,
  code: string
): Promise<string> {
  return programWith(wallet)
    .methods.setCircleCountry(code.toUpperCase())
    .accounts({ circle, country: circleCountryPda(circle), seat: wallet.publicKey })
    .rpc();
}

/** Map of Circle pubkey → country code, for every Circle that has set one. */
export async function listCircleCountries(): Promise<Record<string, string>> {
  const program = readOnlyProgram();
  const rows = await (program.account as any).circleCountry.all();
  const out: Record<string, string> = {};
  for (const r of rows) out[r.account.circle.toBase58()] = String(r.account.code || "").toUpperCase();
  return out;
}

/** This Circle's country code, or "" if none set. */
export async function getCircleCountry(circle: string): Promise<string> {
  const program = readOnlyProgram();
  try {
    const acc: any = await (program.account as any).circleCountry.fetch(circleCountryPda(new PublicKey(circle)));
    return String(acc.code || "").toUpperCase();
  } catch {
    return "";
  }
}
