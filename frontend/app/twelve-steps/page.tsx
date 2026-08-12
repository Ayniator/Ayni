"use client";

// The Twelve Steps of AHA. A reading page: one Step per row, the numeral held in
// its own column so the eye can find a Step at a glance, and a measured line
// length so the text reads like a page rather than a wall.

import { useT } from "../../components/SettingsProvider";

const STEP_KEYS = Array.from({ length: 12 }, (_, i) => `twelve.step.${i + 1}`);

export default function TwelveSteps() {
  const t = useT();
  return (
    <>
      <h1 className="twelve-title">{t("twelve.steps.title")}</h1>
      <p className="lede twelve-lede">{t("twelve.steps.lede")}</p>

      <ol className="twelve-list">
        {STEP_KEYS.map((k, i) => (
          <li className="twelve-item card" key={k}>
            <span className="twelve-num" aria-hidden="true">{i + 1}</span>
            <p className="twelve-text">{t(k)}</p>
          </li>
        ))}
      </ol>

      <p className="muted sm twelve-foot">{t("twelve.steps.foot")}</p>
    </>
  );
}
