// A Circle's meeting calendar: recurring patterns + exceptional one-off
// sessions, stored as JSON in the on-chain CircleMeetings account (so every
// member sees the same schedule). Set by any Council seat.

import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID, SigningWallet, programWith, readOnlyProgram } from "./member";

const seed = (s: string) => new TextEncoder().encode(s);

export const meetingsPda = (circle: PublicKey) =>
  PublicKey.findProgramAddressSync([seed("meetings"), circle.toBytes()], PROGRAM_ID)[0];

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// ordinal: 1..5 = first..fifth, -1 = last
export const ORDINALS: { value: number; label: string }[] = [
  { value: 1, label: "1st" }, { value: 2, label: "2nd" }, { value: 3, label: "3rd" },
  { value: 4, label: "4th" }, { value: 5, label: "5th" }, { value: -1, label: "last" },
];

export interface Recurrence {
  freq: "weekly" | "monthly";
  ordinal: number; // for monthly: which occurrence (1..5 or -1). ignored for weekly.
  weekday: number; // 0=Sun..6=Sat
  time: string; // "HH:MM"
  note?: string;
}
export interface Session {
  date: string; // "YYYY-MM-DD"
  time: string; // "HH:MM"
  title: string;
}
export interface Meetings {
  recurring: Recurrence[];
  sessions: Session[];
}

export const EMPTY_MEETINGS: Meetings = { recurring: [], sessions: [] };

export function describeRecurrence(r: Recurrence): string {
  const wd = WEEKDAYS[r.weekday] ?? "?";
  if (r.freq === "weekly") return `Every ${wd} at ${r.time}${r.note ? ` — ${r.note}` : ""}`;
  const ord = ORDINALS.find((o) => o.value === r.ordinal)?.label ?? `${r.ordinal}`;
  return `Every ${ord} ${wd} of the month at ${r.time}${r.note ? ` — ${r.note}` : ""}`;
}

export async function getMeetings(circle: string): Promise<Meetings> {
  const program = readOnlyProgram();
  try {
    const a: any = await (program.account as any).circleMeetings.fetch(meetingsPda(new PublicKey(circle)));
    const m = JSON.parse(a.data || "{}");
    return { recurring: m.recurring ?? [], sessions: m.sessions ?? [] };
  } catch {
    return { ...EMPTY_MEETINGS };
  }
}

export async function setMeetings(wallet: SigningWallet, circle: PublicKey, meetings: Meetings): Promise<string> {
  const program = programWith(wallet);
  const data = JSON.stringify({ recurring: meetings.recurring, sessions: meetings.sessions });
  return program.methods
    .setMeetings(data)
    .accounts({ circle, meetings: meetingsPda(circle), seat: wallet.publicKey })
    .rpc();
}

// --- Expansion to concrete upcoming events (for the calendar/agenda) ---

export interface CalEvent {
  when: Date;
  time: string;
  title: string;
  kind: "recurring" | "session";
}

/** The date of the Nth (ordinal) `weekday` in month `y`/`m` (m: 0-11), or null. */
function nthWeekday(y: number, m: number, weekday: number, ordinal: number): Date | null {
  if (ordinal === -1) {
    // last given weekday: walk back from the last day of the month
    const last = new Date(y, m + 1, 0);
    const diff = (last.getDay() - weekday + 7) % 7;
    return new Date(y, m, last.getDate() - diff);
  }
  const first = new Date(y, m, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  const day = 1 + offset + (ordinal - 1) * 7;
  const d = new Date(y, m, day);
  return d.getMonth() === m ? d : null; // 5th may not exist
}

function atTime(d: Date, time: string): Date {
  const [hh, mm] = (time || "00:00").split(":").map((x) => parseInt(x, 10) || 0);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm);
}

/** Concrete events from `now` over the next `monthsAhead`, sorted, capped. */
export function upcomingEvents(m: Meetings, now = new Date(), monthsAhead = 3, cap = 30): CalEvent[] {
  const out: CalEvent[] = [];
  const horizon = new Date(now.getFullYear(), now.getMonth() + monthsAhead + 1, 0, 23, 59);

  for (const r of m.recurring) {
    if (r.freq === "weekly") {
      // next `weekday` from today, then every 7 days to the horizon
      const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const offset = (r.weekday - d0.getDay() + 7) % 7;
      for (let d = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + offset); d <= horizon; d.setDate(d.getDate() + 7)) {
        const when = atTime(d, r.time);
        if (when >= now) out.push({ when, time: r.time, title: describeRecurrence(r), kind: "recurring" });
      }
    } else {
      for (let i = 0; i <= monthsAhead; i++) {
        const dt = new Date(now.getFullYear(), now.getMonth() + i, 1);
        const day = nthWeekday(dt.getFullYear(), dt.getMonth(), r.weekday, r.ordinal);
        if (!day) continue;
        const when = atTime(day, r.time);
        if (when >= now && when <= horizon) out.push({ when, time: r.time, title: describeRecurrence(r), kind: "recurring" });
      }
    }
  }

  for (const s of m.sessions) {
    if (!s.date) continue;
    const [y, mo, da] = s.date.split("-").map((x) => parseInt(x, 10));
    if (!y || !mo) continue;
    const when = atTime(new Date(y, mo - 1, da || 1), s.time);
    if (when >= now && when <= horizon) out.push({ when, time: s.time, title: s.title || "Special session", kind: "session" });
  }

  return out.sort((a, b) => a.when.getTime() - b.when.getTime()).slice(0, cap);
}
