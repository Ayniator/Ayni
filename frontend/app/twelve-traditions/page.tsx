"use client";

// The Twelve Traditions of AHA — the Circle's constitution. Same reading layout
// as the Steps (numeral column + measured text), with a warmer accent so the two
// pages are siblings rather than twins.

import { useT } from "../../components/SettingsProvider";

const TRADITION_KEYS = Array.from({ length: 12 }, (_, i) => `twelve.tradition.${i + 1}`);

export default function TwelveTraditions() {
  const t = useT();
  return (
    <>
      <h1 className="twelve-title">{t("twelve.traditions.title")}</h1>
      <p className="lede twelve-lede">{t("twelve.traditions.lede")}</p>

      <ol className="twelve-list twelve-traditions">
        {TRADITION_KEYS.map((k, i) => (
          <li className="twelve-item card" key={k}>
            <span className="twelve-num" aria-hidden="true">{i + 1}</span>
            <p className="twelve-text">{t(k)}</p>
          </li>
        ))}
      </ol>

      <p className="muted sm twelve-foot">{t("twelve.traditions.foot")}</p>
    </>
  );
}
