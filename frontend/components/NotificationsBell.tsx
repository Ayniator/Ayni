"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { buildNotifications, unreadNotifs } from "../lib/notifications";

/** Nav bell with a red badge for unread governance/membership notifications. */
export default function NotificationsBell() {
  const { publicKey } = useWallet();
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    if (!publicKey) { setCount(0); return; }
    buildNotifications(publicKey.toBase58())
      .then((n) => setCount(unreadNotifs(n)))
      .catch(() => {});
  }, [publicKey]);

  useEffect(() => {
    refresh();
    const onRead = () => refresh();
    window.addEventListener("aha:notifs-read", onRead);
    const t = setInterval(refresh, 90_000); // light poll
    return () => { window.removeEventListener("aha:notifs-read", onRead); clearInterval(t); };
  }, [refresh]);

  if (!publicKey) return null;
  return (
    <Link href="/notifications" className="inbox-link" title="Notifications" aria-label="Notifications">
      🔔
      {count > 0 && <span className="inbox-badge">{count > 99 ? "99+" : count}</span>}
    </Link>
  );
}
