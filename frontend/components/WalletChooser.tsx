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
import { useT } from "./SettingsProvider";
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
  const t = useT();
  // Fetch the config at runtime, then shuffle once after it lands (no hydration
  // mismatch — the list starts empty and fills on the client only).
  const [order, setOrder] = useState<Wallet[]>([]);

  // Per-wallet notes are data (docs/wallets.json), so their translations live
  // under literal keys — the switch keeps every t() call literal for the
  // sentinel i18n gate; an unknown id falls back to the JSON's English note.
  function walletNote(id: string, fallback: string): string {
    switch (id) {
      case "phantom": return t("wallet.note.phantom");
      case "solflare": return t("wallet.note.solflare");
      case "glow": return t("wallet.note.glow");
      case "trust": return t("wallet.note.trust");
      case "jupiter": return t("wallet.note.jupiter");
      default: return fallback;
    }
  }
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
              <span className="pill" title={t("wallet.selfCustodyTitle")}>{t("wallet.selfCustody")}</span>
            </div>
            {w.note && <div className="muted sm" style={{ margin: "4px 0 8px" }}>{walletNote(w.id, w.note)}</div>}
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {w.links.ios && (
                <a className="btn btn-sm" href={w.links.ios} target="_blank" rel="noreferrer">{t("wallet.ios")}</a>
              )}
              {w.links.android && (
                <a className="btn btn-sm" href={w.links.android} target="_blank" rel="noreferrer">{t("wallet.android")}</a>
              )}
              {w.links.web && (
                <a className="btn btn-sm" href={w.links.web} target="_blank" rel="noreferrer">{t("wallet.web")}</a>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="muted sm" style={{ marginTop: 10 }}>{t("wallet.footer")}</p>
    </div>
  );
}
