"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { Notif, buildNotifications, markNotifsRead } from "../../lib/notifications";

const icon = (k: string) =>
  (({ vote: "🗳️", exec: "⚙️", membervote: "🗳️", expiry: "⏳", chip: "🏅" }) as Record<string, string>)[k] ?? "🔔";

export default function Notifications() {
  const { publicKey, connected } = useWallet();
  const [items, setItems] = useState<Notif[] | null>(null);

  useEffect(() => {
    if (!publicKey) { setItems([]); return; }
    let cancelled = false;
    buildNotifications(publicKey.toBase58())
      .then((n) => {
        if (cancelled) return;
        setItems(n);
        markNotifsRead(n.map((x) => x.id)); // viewing marks them seen
        window.dispatchEvent(new Event("aha:notifs-read"));
      })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, [publicKey]);

  return (
    <>
      <h1>Notifications</h1>
      <p className="lede">Votes that need you, memberships expiring, and milestones — straight from the chain.</p>

      {!connected && <div className="card"><p className="muted" style={{ margin: 0 }}>Connect a wallet to see your notifications.</p></div>}
      {connected && items === null && <p className="muted">Loading…</p>}
      {connected && items && items.length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>You&apos;re all caught up. 🎉</p></div>}

      {connected && items && items.length > 0 && (
        <div className="members">
          {items.map((n) => (
            <Link key={n.id} href={n.href} className="member" style={{ textDecoration: "none", color: "inherit" }}>
              <span style={{ fontSize: 18, width: 24, textAlign: "center" }}>{icon(n.kind)}</span>
              <div className="meta" style={{ flex: 1, minWidth: 0 }}>
                <div className="name" style={{ fontWeight: 500 }}>{n.text}</div>
                <div className="sub">{n.ts ? new Date(n.ts * 1000).toLocaleString() : ""}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
