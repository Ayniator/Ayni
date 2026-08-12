"use client";

import Link from "next/link";
import BrandAyni from "./BrandAyni";
import NotificationsBell from "./NotificationsBell";
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
        <Link href="/onboarding">{t("nav.start")}</Link>
        <Link href="/me">{t("nav.me")}</Link>
        <InboxNavLink />
        <Link href="/reflections">{t("nav.reflections")}</Link>
        <Link href="/documents">{t("nav.documents")}</Link>
        <Link href="/board">{t("nav.board")}</Link>
        <Link href="/create">{t("nav.create")}</Link>
        <FoundationNavLink />
      </nav>
      <div className="nav-right">
        <NotificationsBell />
        <SettingsControls />
        <WalletButton />
        <NetworkSelector />
      </div>
    </header>
  );
}
