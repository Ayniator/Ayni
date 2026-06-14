"use client";

import Link from "next/link";
import WalletButton from "./WalletButton";
import FoundationNavLink from "./FoundationNavLink";
import InboxNavLink from "./InboxNavLink";
import SettingsControls from "./SettingsControls";
import NetworkSelector from "./NetworkSelector";
import { useT } from "./SettingsProvider";

export default function Nav() {
  const t = useT();
  return (
    <header className="nav">
      <Link href="/" className="brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="AHA — Ancestral Humanity Anonymous" className="brand-logo" />
        AHA · Ayni
      </Link>
      <nav>
        <Link href="/">{t("nav.find")}</Link>
        <Link href="/reflections">{t("nav.reflections")}</Link>
        <Link href="/documents">{t("nav.documents")}</Link>
        <Link href="/board">{t("nav.board")}</Link>
        <Link href="/create">{t("nav.create")}</Link>
        <Link href="/me">{t("nav.me")}</Link>
        <InboxNavLink />
        <FoundationNavLink />
      </nav>
      <div className="nav-right">
        <SettingsControls />
        <WalletButton />
        <NetworkSelector />
      </div>
    </header>
  );
}
