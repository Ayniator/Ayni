// In-app notifications center (Dialect-style) — derived entirely from chain, no
// external service. Aggregates the events that matter to a connected wallet:
// Council votes it must cast/execute, open member votes, memberships expiring,
// and milestone chips it earned. Read-state is per-device (localStorage).
//
// (A future option is to also push these via Dialect Cloud / Blinks; the content
// model here — proposals/votes/expiry/chips — is what that would carry.)

import { PublicKey } from "@solana/web3.js";
import { findMyMemberships, listCircles } from "./member";
import { listCouncilProposals, listMemberProposals, mySeatIndices } from "./admin";
import { listProgressTokens, milestoneLabel } from "./peers";

export interface Notif { id: string; text: string; href: string; ts: number; kind: string }

const READ_KEY = "aha:notif-read";
function readSet(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try { return new Set(JSON.parse(localStorage.getItem(READ_KEY) || "[]")); } catch { return new Set(); }
}
export function markNotifsRead(ids: string[]) {
  if (typeof window === "undefined") return;
  const s = readSet();
  ids.forEach((i) => s.add(i));
  localStorage.setItem(READ_KEY, JSON.stringify([...s].slice(-500)));
}
export function unreadNotifs(list: Notif[]): number {
  const s = readSet();
  return list.filter((n) => !s.has(n.id)).length;
}
export function isNotifRead(id: string): boolean { return readSet().has(id); }

/** Build the notification feed for `me` (newest first). Best-effort per source. */
export async function buildNotifications(me: string): Promise<Notif[]> {
  const circles = await listCircles();
  const mine = await findMyMemberships(new PublicKey(me), circles);
  const myCircles = [...new Set(mine.map((m) => m.circle))];
  const seatCircles = circles.filter((c) => mySeatIndices(c.seats, me).length > 0);
  const now = Date.now() / 1000;
  const out: Notif[] = [];

  // Council proposals where I hold a seat: need my approval, or ready to execute.
  await Promise.all(
    seatCircles.map(async (c) => {
      const seats = mySeatIndices(c.seats, me);
      const props = await listCouncilProposals(c.pubkey, 8).catch(() => []);
      for (const p of props) {
        const iApproved = p.approvedSeats.some((s) => seats.includes(s));
        if (p.status === "running" && !iApproved)
          out.push({ id: `cv:${p.pubkey}`, text: `Vote needed in ${c.name}: ${p.summary}`, href: "/me", ts: p.createdAt, kind: "vote" });
        else if (p.status === "passed" && !p.executed && p.eligibleAt && now >= p.eligibleAt)
          out.push({ id: `ce:${p.pubkey}`, text: `Ready to execute in ${c.name}: ${p.summary}`, href: "/me", ts: p.eligibleAt, kind: "exec" });
      }
    })
  );

  // Open member votes in Circles I belong to.
  await Promise.all(
    myCircles.map(async (cp) => {
      const name = circles.find((c) => c.pubkey === cp)?.name ?? "your Circle";
      const props = await listMemberProposals(cp).catch(() => []);
      for (const p of props) if (p.status === "running")
        out.push({ id: `mp:${p.pubkey}`, text: `Member vote open in ${name}`, href: "/me", ts: p.deadline, kind: "membervote" });
    })
  );

  // Memberships expiring within 30 days.
  for (const m of mine)
    if (m.active && m.expiresAt - now < 30 * 86400)
      out.push({ id: `exp:${m.pubkey}:${m.expiresAt}`, text: `Your ${m.circleName} membership expires ${new Date(m.expiresAt * 1000).toLocaleDateString()}`, href: "/me", ts: m.expiresAt, kind: "expiry" });

  // Milestone chips awarded to me.
  await Promise.all(
    myCircles.map(async (cp) => {
      const name = circles.find((c) => c.pubkey === cp)?.name ?? "your Circle";
      const myCommits = new Set(mine.filter((m) => m.circle === cp).map((m) => m.commitment));
      const chips = await listProgressTokens(cp).catch(() => []);
      for (const ch of chips) if (myCommits.has(ch.member))
        out.push({ id: `chip:${cp}:${ch.member}:${ch.milestone}`, text: `🏅 You earned a ${milestoneLabel(ch.milestone)} chip in ${name}`, href: "/me", ts: ch.issuedAt, kind: "chip" });
    })
  );

  return out.sort((a, b) => b.ts - a.ts);
}
