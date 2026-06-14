"use client";

import { useT } from "./SettingsProvider";

export default function Footer() {
  const t = useT();
  return (
    <footer className="footer">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/aha.png" alt="" className="footer-emblem" />
      <div>{t("footer.line")}</div>
      <div><a href="/docs.html">How it works ↗</a></div>
    </footer>
  );
}
