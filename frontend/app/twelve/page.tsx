"use client";

// "The 12" landing page — what a member sees after choosing The 12 in the nav
// but before picking the Steps or the Traditions. The title names the page and
// the lede says what the two sets are for; the emblem sits under them, and the
// two doors under it.

import Link from "next/link";
import { useT } from "../../components/SettingsProvider";

export default function Twelve() {
  const t = useT();
  return (
    <div className="twelve-hub">
      <h1 className="twelve-title">{t("nav.twelve")}</h1>
      <p className="lede twelve-hub-lede">{t("twelve.hub.lede")}</p>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/images/A-H-A.png" alt="" className="twelve-hub-art" aria-hidden="true" />

      <div className="twelve-hub-doors">
        <Link href="/twelve-steps" className="card twelve-door">
          <span className="twelve-door-num" aria-hidden="true">12</span>
          <span className="twelve-door-body">
            <span className="twelve-door-title">{t("nav.twelveSteps")}</span>
            <span className="twelve-door-sub">{t("twelve.hub.stepsSub")}</span>
          </span>
        </Link>
        <Link href="/twelve-traditions" className="card twelve-door twelve-door-alt">
          <span className="twelve-door-num" aria-hidden="true">12</span>
          <span className="twelve-door-body">
            <span className="twelve-door-title">{t("nav.twelveTraditions")}</span>
            <span className="twelve-door-sub">{t("twelve.hub.traditionsSub")}</span>
          </span>
        </Link>
        {/* The glossary is reference material, not a path to walk, so it sits as
            a third door rather than in the hero pair — but it is reachable here
            as well as under Resources in the nav, at the user's request. */}
        <Link href="/glossary" className="card twelve-door twelve-door-ref">
          <span className="twelve-door-num twelve-door-az" aria-hidden="true">A–Z</span>
          <span className="twelve-door-body">
            <span className="twelve-door-title">{t("nav.glossary")}</span>
            <span className="twelve-door-sub">{t("twelve.hub.glossarySub")}</span>
          </span>
        </Link>
      </div>
    </div>
  );
}
