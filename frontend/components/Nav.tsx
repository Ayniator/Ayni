"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import BrandAyni from "./BrandAyni";
import NotificationsBell from "./NotificationsBell";
import WalletButton, { SolanaBadge } from "./WalletButton";
import FoundationNavLink from "./FoundationNavLink";
import InboxNavLink from "./InboxNavLink";
import SettingsControls from "./SettingsControls";
import NetworkSelector from "./NetworkSelector";
import { useT } from "./SettingsProvider";

export default function Nav() {
  const t = useT();
  // My Circle, Documents and Board are member surfaces: with no wallet
  // connected they can only render an empty or "connect first" state, so they
  // are hidden rather than shown as dead ends. `connected` is false on the
  // server AND on the first client render, so the two agree and there is no
  // hydration mismatch — the links appear once the adapter reports a wallet.
  const { connected } = useWallet();
  return (
    <header className="nav">
      <span className="brand-wrap">
        <Link href="/" className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="AHA — Ancestral Humanity Anonymous" className="brand-logo" />
          <span className="brand-aha">AHA</span>
          <span className="brand-powered">powered by</span>
        </Link>
        <BrandAyni />
      </span>
      <nav>
        <Link href="/">{t("nav.find")}</Link>
        {/* The inverse of the member surfaces below: "Start Here" is the
            newcomer's entry point, so it retires once a wallet is connected. */}
        {!connected && <Link href="/onboarding">{t("nav.start")}</Link>}
        <Link href="/reflections">{t("nav.reflections")}</Link>
        <TwelveMenu />
        {connected && <Link href="/me">{t("nav.me")}</Link>}
        <InboxNavLink />
        {connected && <Link href="/documents">{t("nav.documents")}</Link>}
        {connected && <Link href="/board">{t("nav.board")}</Link>}
        <Link href="/create">{t("nav.create")}</Link>
        <GetAppLink />
        <FoundationNavLink />
      </nav>
      <div className="nav-right">
        <NotificationsBell />
        <SettingsControls />
        <WalletButton />
        {/* The Solana mark sits with the cluster it names, not on the wallet. */}
        <SolanaBadge />
        <NetworkSelector />
      </div>
    </header>
  );
}

/** "Mobile App". Previously this label named the visitor's platform
 *  ("Get AHA for Android" / "…for iOS") via client-side detection. One neutral
 *  label is better: it cannot promise a store the visitor cannot reach, it does
 *  not shift after hydration, and the /get-app page is where the per-platform
 *  truth belongs. The old nav.getAppAndroid / nav.getAppIos keys are left in the
 *  dictionaries — still resolvable, no longer used here. */
function GetAppLink() {
  const t = useT();
  return <Link href="/get-app">{t("nav.mobileApp")}</Link>;
}

// "The 12" — the Steps and the Traditions. Opens on hover for pointers and on
// focus/click for keyboard and touch, so it is reachable without a mouse.
function TwelveMenu() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <span
      className="nav-menu"
      ref={wrap}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {/* The label is itself a link: clicking it lands on /twelve (the choice
          page), while hovering or focusing reveals the two destinations. */}
      <Link
        href="/twelve"
        className="nav-menu-btn"
        aria-haspopup="true"
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(false)}
      >
        {t("nav.twelve")} <span className="nav-caret" aria-hidden="true">▾</span>
      </Link>
      <span className={`nav-drop${open ? " is-open" : ""}`} role="menu">
        <Link href="/twelve-steps" role="menuitem" onClick={() => setOpen(false)}>
          {t("nav.twelveSteps")}
        </Link>
        <Link href="/twelve-traditions" role="menuitem" onClick={() => setOpen(false)}>
          {t("nav.twelveTraditions")}
        </Link>
      </span>
    </span>
  );
}
