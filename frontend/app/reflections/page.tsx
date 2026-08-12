"use client";

import { useEffect, useState } from "react";
import Identicon from "../../components/Identicon";
import { listAllCircles, cachedCircles, Circle } from "../../lib/solana";
import { fetchDailyReflection, Reflection, todayKey } from "../../lib/ipfs";
import { getLocalReflections, localReflectionFor } from "../../lib/foundation";
import { useT } from "../../components/SettingsProvider";

export default function Reflections() {
  const t = useT();
  const [circles, setCircles] = useState<Circle[]>([]);
  const [sel, setSel] = useState<string>("");
  const [reflection, setReflection] = useState<Reflection | null>(null);
  const [status, setStatus] = useState<string>(t("reflections.loadingCircles"));

  useEffect(() => {
    // A circle qualifies if it has a published reflections CID OR a locally
    // composed (foundation) collection. Render the cached list instantly.
    const pickDaily = (cs: Circle[]) => {
      const withDaily = cs.filter((c) => c.dailyReflectionsCid || Object.keys(getLocalReflections(c.circle)).length > 0);
      setCircles(withDaily);
      if (withDaily.length && !sel) setSel(withDaily[0].pubkey);
      setStatus(withDaily.length ? "" : t("reflections.noneYet"));
    };
    const cached = cachedCircles();
    if (cached.length) pickDaily(cached);
    listAllCircles().then(pickDaily).catch((e) => { if (!cached.length) setStatus(String(e?.message || e)); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const c = circles.find((x) => x.pubkey === sel);
    if (!c) return;
    // Local (foundation-composed) reflection wins and is instant.
    const local = localReflectionFor(c.circle, todayKey());
    if (local) {
      setReflection(local);
      setStatus("");
      return;
    }
    setStatus(t("reflections.fetching"));
    setReflection(null);
    if (!c.dailyReflectionsCid) {
      setStatus(`${t("reflections.noEntryPre")} ${todayKey()} ${t("reflections.noEntryYet")}`);
      return;
    }
    fetchDailyReflection(c.dailyReflectionsCid)
      .then((r) => {
        setReflection(r);
        setStatus(r ? "" : `${t("reflections.noEntryPre")} ${todayKey()} ${t("reflections.noEntryInCollection")}`);
      })
      .catch((e) => setStatus(t("reflections.ipfsError") + String(e?.message || e)));
  }, [sel, circles]);

  return (
    <>
      <h1>{t("reflections.title")}</h1>
      <p className="lede">{t("reflections.ledePre")} {todayKey()}{t("reflections.ledeSuffix")}</p>

      {circles.length > 0 && (
        <div className="row" style={{ marginBottom: 16 }}>
          <Identicon seed={circles.find((c) => c.pubkey === sel)?.circle || sel} size={36} />
          <select value={sel} onChange={(e) => setSel(e.target.value)}>
            {circles.map((c) => (
              <option key={c.pubkey} value={c.pubkey}>
                {c.name || t("reflections.circleFallback")} {c.city ? `· ${c.city}` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {reflection ? (
        <div className="card reflection">
          <h2>{reflection.title}</h2>
          <blockquote>“{reflection.quote}”</blockquote>
          <div className="source">— {reflection.source}</div>
          <p style={{ marginTop: 14 }}>{reflection.reflection}</p>
        </div>
      ) : (
        <p className="muted">{status}</p>
      )}
    </>
  );
}
