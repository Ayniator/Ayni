"use client";

// F93 — "Get AHA": how to install the native shell, and what is honestly
// available today.
//
// The page says the awkward thing out loud rather than showing a dead store
// badge: there is no Play Store or App Store listing yet, and the iOS archive
// CI produces is unsigned, so it cannot be installed without your own Apple
// signing identity. Android has a real, installable artifact. Pretending
// otherwise would send people hunting for a button that does not exist.

import { ReactNode, useEffect, useState } from "react";
import { useT } from "../../components/SettingsProvider";
import { Platform, detectPlatform } from "../../lib/platform";

const REPO = "https://github.com/Ayniator/Ayni";
const ACTIONS = `${REPO}/actions/workflows/mobile.yml`;

// Inline markup travels INSIDE the translated string as markers rather than
// splitting a sentence into t("…Pre") + <code/> + t("…Suf") fragments. The
// fragments are what break in translation: this page is a set of instructions,
// and a verb-final language (my, bo, lo, qu) cannot reassemble "Open the" +
// link + "and pick…" into a sentence anyone would say. One sentence, one key.
//   `code`  → <code>    *strong* → <strong>    _em_ → <em>    [link] → the
// single external link on the page, so the marker needs no URL of its own.
function rich(s: string, href?: string): ReactNode[] {
  return s.split(/(`[^`]+`|\*[^*]+\*|_[^_]+_|\[[^\]]+\])/g).map((part, i) => {
    const inner = part.slice(1, -1);
    if (part.startsWith("`")) return <code key={i}>{inner}</code>;
    if (part.startsWith("*")) return <strong key={i}>{inner}</strong>;
    if (part.startsWith("_")) return <em key={i}>{inner}</em>;
    if (part.startsWith("[") && href)
      return (
        <a key={i} href={href} target="_blank" rel="noreferrer">
          {inner}
        </a>
      );
    return part;
  });
}

export default function GetApp() {
  const t = useT();
  const [platform, setPlatform] = useState<Platform>("web");
  useEffect(() => setPlatform(detectPlatform()), []);

  return (
    <>
      <h1>{t("getapp.title")}</h1>
      <p className="lede">{t("getapp.lede")}</p>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("getapp.standTitle")}</h3>
        <p style={{ marginBottom: 8 }}>{rich(t("getapp.standIntro"))}</p>
        <ul className="sm" style={{ margin: 0 }}>
          <li>{rich(t("getapp.androidItem"))}</li>
          <li>{rich(t("getapp.iosItem"))}</li>
        </ul>
      </div>

      {platform !== "ios" && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t("getapp.installTitle")}</h3>
          <ol className="sm" style={{ margin: 0 }}>
            <li>{rich(t("getapp.step1"), ACTIONS)}</li>
            <li>{rich(t("getapp.step2"))}</li>
            <li>{rich(t("getapp.step3"))}</li>
            <li>{rich(t("getapp.step4"))}</li>
          </ol>
          <p className="muted sm" style={{ marginBottom: 0 }}>
            {t("getapp.ghNote")}
          </p>
        </div>
      )}

      {platform === "ios" && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t("getapp.iosTitle")}</h3>
          <p style={{ marginBottom: 8 }}>{t("getapp.iosBody1")}</p>
          <p style={{ marginBottom: 0 }}>{rich(t("getapp.iosBody2"))}</p>
        </div>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("getapp.buildTitle")}</h3>
        <p style={{ margin: 0 }}>{rich(t("getapp.buildBody"))}</p>
      </div>

      <p className="muted sm">{t("getapp.privacy")}</p>
    </>
  );
}
