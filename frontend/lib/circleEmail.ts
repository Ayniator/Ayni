// F25 — every Circle has a mandatory, automatically-assigned address on the AHA
// mail domain. The address is DERIVED (deterministic) from the Circle's name +
// PDA, so it exists for every Circle the moment it is created — no opt-out, no
// extra on-chain state. Real mailbox provisioning + sending happens server-side
// in app/api/circle-email/route.ts (SMTP); this module is the shared address
// derivation + a best-effort client trigger.

export const EMAIL_DOMAIN = process.env.NEXT_PUBLIC_AHA_EMAIL_DOMAIN || "aha.community";

/** A slug safe for an email local-part, from a Circle name. */
export function circleSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "circle"
  );
}

/**
 * The Circle's canonical address, e.g. `aha-bangkok-2pwirm@aha.community`.
 * The 6-char PDA suffix keeps two same-named Circles distinct.
 */
export function circleEmail(name: string, circlePubkey?: string, domain: string = EMAIL_DOMAIN): string {
  const suffix = circlePubkey ? "-" + circlePubkey.slice(0, 6).toLowerCase() : "";
  return `${circleSlug(name)}${suffix}@${domain}`;
}

export type CircleEmailKind = "provision" | "join";

export interface CircleEmailPayload {
  kind: CircleEmailKind;
  circleName: string;
  circlePubkey: string;
  memberAddress?: string | null; // for "join"
}

export interface CircleEmailResult {
  ok: boolean;
  configured?: boolean;
  to?: string;
  id?: string;
  message?: string;
  error?: string;
}

/**
 * Trigger the server route that emails the Circle address. Best-effort: never
 * throws, so it can't break the on-chain flow it follows. When SMTP isn't
 * configured the route returns `{ ok:false, configured:false }` and we surface
 * the would-be recipient honestly instead of pretending mail was sent.
 */
export async function notifyCircleEmail(payload: CircleEmailPayload): Promise<CircleEmailResult> {
  try {
    const res = await fetch("/api/circle-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return (await res.json()) as CircleEmailResult;
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/** A short, human sentence describing the email outcome for the UI. */
export function emailNote(r: CircleEmailResult): string {
  if (r.ok) return `Notified the Circle address (${r.to}).`;
  if (r.configured === false) return `Circle address ${r.to} assigned — mail server not configured, so no email was sent.`;
  return `Circle address ${r.to ?? ""} assigned — email could not be sent${r.error ? `: ${r.error}` : ""}.`;
}
