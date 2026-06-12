// Read-only IPFS access via a public gateway. CIDs are published on-chain by the
// Council (on the CircleProfile); the app only fetches.

export const IPFS_GATEWAY =
  process.env.NEXT_PUBLIC_IPFS_GATEWAY || "https://w3s.link/ipfs/";

export function ipfsUrl(cid: string, path = ""): string {
  if (!cid) return "";
  const clean = cid.replace(/^ipfs:\/\//, "");
  return `${IPFS_GATEWAY}${clean}${path ? "/" + path.replace(/^\//, "") : ""}`;
}

export async function fetchIpfsText(cid: string, path = ""): Promise<string> {
  const url = ipfsUrl(cid, path);
  if (!url) throw new Error("empty CID");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`IPFS ${res.status}`);
  return res.text();
}

export async function fetchIpfsJson<T = any>(cid: string, path = ""): Promise<T> {
  const txt = await fetchIpfsText(cid, path);
  return JSON.parse(txt) as T;
}

// ---- Daily Reflections format ----------------------------------------------
// The daily_reflections_cid points to a JSON object keyed by "MM-DD":
//   { "01-01": { "title": "...", "quote": "...", "source": "...", "reflection": "..." }, ... }
// (A leap-day "02-29" entry is optional.)
export interface Reflection {
  title: string;
  quote: string;
  source: string;
  reflection: string;
}

export function todayKey(d = new Date()): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}

export async function fetchDailyReflection(cid: string, key = todayKey()): Promise<Reflection | null> {
  if (!cid) return null;
  const all = await fetchIpfsJson<Record<string, Reflection>>(cid);
  return all[key] ?? null;
}
