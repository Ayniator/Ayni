"use client";

import { useEffect, useState } from "react";
import Identicon from "../../components/Identicon";
import { listAllCircles, Circle } from "../../lib/solana";
import { fetchDailyReflection, Reflection, todayKey } from "../../lib/ipfs";

export default function Reflections() {
  const [circles, setCircles] = useState<Circle[]>([]);
  const [sel, setSel] = useState<string>("");
  const [reflection, setReflection] = useState<Reflection | null>(null);
  const [status, setStatus] = useState<string>("Loading Circles…");

  useEffect(() => {
    listAllCircles()
      .then((cs) => {
        const withDaily = cs.filter((c) => c.dailyReflectionsCid);
        setCircles(withDaily);
        if (withDaily.length) setSel(withDaily[0].pubkey);
        setStatus(withDaily.length ? "" : "No Circle has published Daily Reflections yet.");
      })
      .catch((e) => setStatus(String(e?.message || e)));
  }, []);

  useEffect(() => {
    const c = circles.find((x) => x.pubkey === sel);
    if (!c) return;
    setStatus("Fetching today's reflection from IPFS…");
    setReflection(null);
    fetchDailyReflection(c.dailyReflectionsCid)
      .then((r) => {
        setReflection(r);
        setStatus(r ? "" : `No entry for ${todayKey()} in this collection.`);
      })
      .catch((e) => setStatus("IPFS error: " + String(e?.message || e)));
  }, [sel, circles]);

  return (
    <>
      <h1>Daily Reflections</h1>
      <p className="lede">A thought for {todayKey()}, published by a Circle and pinned on IPFS.</p>

      {circles.length > 0 && (
        <div className="row" style={{ marginBottom: 16 }}>
          <Identicon seed={circles.find((c) => c.pubkey === sel)?.circle || sel} size={36} />
          <select value={sel} onChange={(e) => setSel(e.target.value)}>
            {circles.map((c) => (
              <option key={c.pubkey} value={c.pubkey}>
                {c.name || "Circle"} {c.city ? `· ${c.city}` : ""}
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
