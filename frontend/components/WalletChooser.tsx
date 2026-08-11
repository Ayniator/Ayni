"use client";

// F67 — the wallet chooser shown at onboarding Step 1.
//
// Renders the vetted, self-custodial wallets from docs/wallets.json, each with
// its per-platform links (App Store / Play Store / web-or-extension).
//
// T6 (no endorsements): the list is shuffled with a UNIFORM Fisher–Yates on
// every mount, so no wallet ever holds a permanent first position. The shuffle
// draws ONLY from Math.random() — it is deliberately NOT seeded by, correlated
// with, or ordered by any user identifier (wallet address, IP, session, profile).
// Two members opening this screen see independent random orders; the same member
// reloading sees a fresh order. There is no "recommended" wallet.

import { useEffect, useState } from "react";
// docs/wallets.json is the single source of truth, re-reviewed each equinox; a
// copy is served at /wallets.json (frontend/public/) and fetched at runtime, so
// the recommendation can follow reality without a code change.
type Links = { ios?: string | null; android?: string | null; web?: string | null };
type Wallet = { id: string; name: string; custody: string; note?: string; links: Links };

/** Uniform Fisher–Yates. Source of randomness is Math.random() alone — never a
 *  user identifier. Returns a new array; does not mutate the input. */
function shuffle<T>(input: T[]): T[] {
  const a = input.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function WalletChooser() {
  // Fetch the config at runtime, then shuffle once after it lands (no hydration
  // mismatch — the list starts empty and fills on the client only).
  const [order, setOrder] = useState<Wallet[]>([]);
  useEffect(() => {
    fetch("/wallets.json").then((r) => r.json()).then((cfg) => setOrder(shuffle((cfg.wallets ?? []) as Wallet[]))).catch(() => {});
  }, []);

  return (
    <div className="wallet-chooser">
      <div className="grid" style={{ gap: 12 }}>
        {order.map((w) => (
          <div className="card" key={w.id} style={{ padding: 14 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <div className="name" style={{ fontSize: 16 }}>{w.name}</div>
              <span className="pill" title="You hold your own keys — nobody custodies your funds.">self-custody</span>
            </div>
            {w.note && <div className="muted sm" style={{ margin: "4px 0 8px" }}>{w.note}</div>}
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {w.links.ios && (
                <a className="btn btn-sm" href={w.links.ios} target="_blank" rel="noreferrer">iPhone / iPad ↗</a>
              )}
              {w.links.android && (
                <a className="btn btn-sm" href={w.links.android} target="_blank" rel="noreferrer">Android ↗</a>
              )}
              {w.links.web && (
                <a className="btn btn-sm" href={w.links.web} target="_blank" rel="noreferrer">Web / browser ↗</a>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="muted sm" style={{ marginTop: 10 }}>
        These are independent, self-custodial wallets. AHA does not endorse any one of them —
        the order above is shuffled every time this page loads. Pick whichever suits your phone
        or browser.
      </p>
    </div>
  );
}
