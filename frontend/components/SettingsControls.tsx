"use client";

import { LANGS } from "../lib/i18n";
import { useSettings } from "./SettingsProvider";

export default function SettingsControls() {
  const { lang, setLang, theme, toggleTheme, t } = useSettings();

  return (
    <div className="settings-ctl">
      <button
        className="theme-toggle"
        onClick={toggleTheme}
        title={theme === "light" ? t("ctl.theme.toDark") : t("ctl.theme.toLight")}
        aria-label={theme === "light" ? t("ctl.theme.toDark") : t("ctl.theme.toLight")}
      >
        {theme === "light" ? <Moon /> : <Sun />}
      </button>
      <select
        className="lang-select"
        value={lang}
        onChange={(e) => setLang(e.target.value)}
        aria-label={t("ctl.language")}
        title={t("ctl.language")}
      >
        {LANGS.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// Switching to dark → show a moon; switching to light → show a sun.
function Moon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Sun() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" fill="currentColor" />
      {Array.from({ length: 8 }).map((_, i) => {
        const a = (i * Math.PI) / 4;
        const x1 = 12 + Math.cos(a) * 7.2, y1 = 12 + Math.sin(a) * 7.2;
        const x2 = 12 + Math.cos(a) * 9.6, y2 = 12 + Math.sin(a) * 9.6;
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />;
      })}
    </svg>
  );
}
