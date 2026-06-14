"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { DEFAULT_LANG, Key, RTL, translate } from "../lib/i18n";

type Theme = "light" | "dark";

interface Settings {
  lang: string;
  setLang: (l: string) => void;
  theme: Theme;
  toggleTheme: () => void;
  t: (key: Key) => string;
}

const Ctx = createContext<Settings | null>(null);

const LANG_KEY = "aha:lang";
const THEME_KEY = "aha:theme";

function applyDoc(lang: string, theme: Theme) {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  el.dataset.theme = theme;
  el.lang = lang;
  el.dir = RTL.has(lang) ? "rtl" : "ltr";
}

export default function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState(DEFAULT_LANG);
  const [theme, setTheme] = useState<Theme>("light");

  // Hydrate from localStorage (the inline script in <head> already painted the
  // right theme to avoid a flash; this syncs React state).
  useEffect(() => {
    const l = localStorage.getItem(LANG_KEY) || DEFAULT_LANG;
    const tm = (localStorage.getItem(THEME_KEY) as Theme) || "light";
    setLangState(l);
    setTheme(tm);
    applyDoc(l, tm);
  }, []);

  const setLang = useCallback((l: string) => {
    setLangState(l);
    localStorage.setItem(LANG_KEY, l);
    applyDoc(l, (localStorage.getItem(THEME_KEY) as Theme) || "light");
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === "light" ? "dark" : "light";
      localStorage.setItem(THEME_KEY, next);
      applyDoc(localStorage.getItem(LANG_KEY) || DEFAULT_LANG, next);
      return next;
    });
  }, []);

  const t = useCallback((key: Key) => translate(lang, key), [lang]);

  return <Ctx.Provider value={{ lang, setLang, theme, toggleTheme, t }}>{children}</Ctx.Provider>;
}

export function useSettings(): Settings {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSettings must be used within SettingsProvider");
  return c;
}

/** Convenience: just the translator. */
export function useT(): (key: Key) => string {
  return useSettings().t;
}
