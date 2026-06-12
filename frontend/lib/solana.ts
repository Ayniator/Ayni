// Read-only on-chain access for the AHA directory. One getProgramAccounts call
// (via Anchor's account.all(), filtered by the CircleProfile discriminator)
// returns every Circle that has published a profile — fast enough for thousands.
// For very large deployments, swap this for an indexer with the same shape.

import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import idl from "./ayni.json";

export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";

export interface Circle {
  pubkey: string; // the CircleProfile PDA
  circle: string; // the Circle account it describes
  lat: number; // degrees
  lon: number; // degrees
  name: string;
  city: string;
  address: string;
  twelveStepsCid: string;
  preambleCid: string;
  dailyReflectionsCid: string;
}

function readOnlyProgram(): anchor.Program {
  const connection = new Connection(RPC_URL, "confirmed");
  // A provider with no wallet — fine for account reads.
  const provider = new anchor.AnchorProvider(
    connection,
    {
      publicKey: PublicKey.default,
      signTransaction: async (t: any) => t,
      signAllTransactions: async (t: any) => t,
    } as any,
    { commitment: "confirmed" }
  );
  return new anchor.Program(idl as anchor.Idl, provider);
}

/** Every Circle with a published directory profile. One RPC round-trip. */
export async function listAllCircles(): Promise<Circle[]> {
  const program = readOnlyProgram();
  const rows = await (program.account as any).circleProfile.all();
  return rows.map((r: any) => ({
    pubkey: r.publicKey.toBase58(),
    circle: r.account.circle.toBase58(),
    lat: r.account.latMicrodeg / 1e6,
    lon: r.account.lonMicrodeg / 1e6,
    name: r.account.name,
    city: r.account.city,
    address: r.account.address,
    twelveStepsCid: r.account.twelveStepsCid,
    preambleCid: r.account.preambleCid,
    dailyReflectionsCid: r.account.dailyReflectionsCid,
  }));
}

/** Great-circle distance in kilometres (haversine). */
export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export interface CircleWithDistance extends Circle {
  distanceKm: number;
}

/** The `k` nearest circles to (lat, lon), closest first. */
export function nearest(circles: Circle[], lat: number, lon: number, k = 10): CircleWithDistance[] {
  return circles
    .map((c) => ({ ...c, distanceKm: distanceKm(lat, lon, c.lat, c.lon) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, k);
}
