"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { listInbox, unreadCount } from "../lib/messaging";

/** The badge's display rules, extracted so they can actually be tested.
 *
 *  The badge itself renders only for a CONNECTED wallet, which no browser test
 *  in this repo can be — so an e2e assertion on it would pass whether or not
 *  the rules held. These two pure functions are the whole contract:
 *
 *    - hidden at zero (and never for a negative or non-finite count);
 *    - capped at "99+" so a large number cannot widen the nav;
 *    - the accessible name carries the count, because the badge itself is
 *      aria-hidden and a bare number read aloud is meaningless.
 *
 *  Covered by tests/badge-count.test.mjs. */
export const BADGE_MAX = 99;

export function badgeText(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  const n = Math.floor(count);
  return n > BADGE_MAX ? `${BADGE_MAX}+` : String(n);
}

export function messagesLabel(count: number): string {
  const shown = badgeText(count);
  return shown ? `My Messages, ${Math.floor(count)} unread` : "My Messages";
}

/** "My Messages" nav link with a red badge showing the unread (non-expired) count. */
export default function InboxNavLink() {
  const { publicKey } = useWallet();
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    if (!publicKey) { setCount(0); return; }
    listInbox(publicKey.toBase58())
      .then((m) => setCount(unreadCount(m)))
      .catch(() => {});
  }, [publicKey]);

  useEffect(() => {
    refresh();
    const onRead = () => refresh();
    window.addEventListener("aha:inbox-read", onRead);
    const t = setInterval(refresh, 60_000); // light poll
    return () => { window.removeEventListener("aha:inbox-read", onRead); clearInterval(t); };
  }, [refresh]);

  if (!publicKey) return null;
  // aria-label carries the count so a screen reader announces "My Messages,
  // 3 unread" rather than reading a bare number adrift from its label.
  const shown = badgeText(count);
  return (
    <Link href="/inbox" className="inbox-link" aria-label={messagesLabel(count)}>
      My Messages
      {shown && <span className="inbox-badge" aria-hidden="true">{shown}</span>}
    </Link>
  );
}
