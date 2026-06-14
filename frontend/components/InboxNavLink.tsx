"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { listInbox, unreadCount } from "../lib/messaging";

/** "Inbox" nav link with a red badge showing the unread (non-expired) count. */
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
  return (
    <Link href="/inbox" className="inbox-link">
      Inbox
      {count > 0 && <span className="inbox-badge">{count > 99 ? "99+" : count}</span>}
    </Link>
  );
}
