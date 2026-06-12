"use client";

import { useEffect, useState } from "react";
import Identicon from "../../components/Identicon";
import { listAllCircles, Circle } from "../../lib/solana";
import { ipfsUrl, fetchIpfsText } from "../../lib/ipfs";

type DocKey = "twelveStepsCid" | "preambleCid" | "dailyReflectionsCid";
const DOCS: { key: DocKey; label: string }[] = [
  { key: "twelveStepsCid", label: "The 12 Steps" },
  { key: "preambleCid", label: "Preamble" },
  { key: "dailyReflectionsCid", label: "Daily Reflections (collection)" },
];

export default function Documents() {
  const [circles, setCircles] = useState<Circle[]>([]);
  const [status, setStatus] = useState("Loading Circles…");
  const [open, setOpen] = useState<{ cid: string; label: string } | null>(null);
  const [body, setBody] = useState<string>("");

  useEffect(() => {
    listAllCircles()
      .then((cs) => {
        setCircles(cs);
        setStatus(cs.length ? "" : "No Circles have published documents yet.");
      })
      .catch((e) => setStatus(String(e?.message || e)));
  }, []);

  async function preview(cid: string, label: string) {
    setOpen({ cid, label });
    setBody("Fetching from IPFS…");
    try {
      const txt = await fetchIpfsText(cid);
      setBody(txt.slice(0, 20000));
    } catch (e: any) {
      setBody("Could not fetch this document: " + String(e?.message || e));
    }
  }

  return (
    <>
      <h1>Documents</h1>
      <p className="lede">
        Shared material — the 12 Steps, the Preamble, Daily Reflections — pinned on IPFS, with the
        CID committed on-chain by each Circle&apos;s Council.
      </p>

      {status && <p className="muted">{status}</p>}

      <div className="grid">
        {circles.map((c) => {
          const available = DOCS.filter((d) => (c as any)[d.key]);
          if (!available.length) return null;
          return (
            <div className="card" key={c.pubkey}>
              <div className="row" style={{ marginBottom: 8 }}>
                <Identicon seed={c.circle} size={40} />
                <div className="meta">
                  <div className="name">{c.name || "Circle"}</div>
                  <div className="sub">{c.city}</div>
                </div>
              </div>
              <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
                {available.map((d) => {
                  const cid = (c as any)[d.key] as string;
                  return (
                    <span key={d.key} className="row" style={{ gap: 6 }}>
                      <button className="btn" onClick={() => preview(cid, `${d.label} — ${c.name}`)}>
                        {d.label}
                      </button>
                      <a href={ipfsUrl(cid)} target="_blank" rel="noreferrer" title="Open on IPFS gateway">
                        ↗
                      </a>
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {open && (
        <div className="card" style={{ marginTop: 18 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>{open.label}</strong>
            <a href={ipfsUrl(open.cid)} target="_blank" rel="noreferrer">
              {open.cid.slice(0, 12)}… ↗
            </a>
          </div>
          <pre className="doc">{body}</pre>
        </div>
      )}
    </>
  );
}
