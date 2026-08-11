"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Identicon from "../components/Identicon";
import { useT } from "../components/SettingsProvider";
import { listAllCircles, cachedCircles, nearest, Circle, CircleWithDistance } from "../lib/solana";
import { ipfsUrl } from "../lib/ipfs";
import { Post, listPosts } from "../lib/posts";
import { CalEvent, getMeetings, upcomingEvents } from "../lib/meetings";

// Leaflet touches `window`, so load the map client-side only.
const CircleMap = dynamic(() => import("../components/CircleMap"), {
  ssr: false,
  loading: () => <div className="map" />,
});

const DEFAULT_CENTER = { lat: 20, lon: 0 }; // world view until we have a location

export default function Home() {
  const t = useT();
  const [circles, setCircles] = useState<Circle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [located, setLocated] = useState(false);
  const [locating, setLocating] = useState(false);
  const [selected, setSelected] = useState<CircleWithDistance | null>(null);
  const [posts, setPosts] = useState<Post[] | null>(null);

  // When a circle is selected, load its latest board posts.
  useEffect(() => {
    setPosts(null);
    if (!selected) return;
    let cancelled = false;
    listPosts(selected.circle)
      .then((p) => { if (!cancelled) setPosts(p); })
      .catch(() => { if (!cancelled) setPosts([]); });
    return () => { cancelled = true; };
  }, [selected]);

  useEffect(() => {
    // Show the last-known list instantly, then refresh from the chain.
    const cached = cachedCircles();
    if (cached.length) {
      setCircles(cached);
      setLoading(false);
    }
    listAllCircles()
      .then(setCircles)
      .catch((e) => {
        if (!cached.length) setError(String(e?.message || e));
      })
      .finally(() => setLoading(false));
  }, []);

  // Deep link from the foundation directory: /?circle=<Circle pubkey> centers
  // the map on that Circle and opens its detail card.
  useEffect(() => {
    if (!circles.length) return;
    const want = new URLSearchParams(window.location.search).get("circle");
    if (!want) return;
    const match = circles.find((c) => c.circle === want);
    if (match) {
      setCenter({ lat: match.lat, lon: match.lon });
      setSelected({ ...match, distanceKm: 0 });
    }
  }, [circles]);

  // Location comes ONLY from the browser's Geolocation API, and only after the
  // visitor presses the button (F71 / Sentinel R6): no IP-geolocation service,
  // no third-party lookup — the position stays in this browser and is used
  // locally to sort Circles by distance. Without permission the map simply
  // shows the neutral world view (DEFAULT_CENTER).
  function locate() {
    setError(null);
    const secure = typeof window !== "undefined" && window.isSecureContext;
    if (!navigator.geolocation || !secure) {
      setError("Your browser's location API needs a secure context (https or localhost). You can still browse the world map — nothing about you is sent anywhere.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCenter({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setLocated(true);
        setLocating(false);
      },
      () => {
        setError("Couldn't get your location. Allow location access and try again — or just browse the map.");
        setLocating(false);
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
    );
  }

  const ranked: CircleWithDistance[] = useMemo(
    () => nearest(circles, center.lat, center.lon, 25),
    [circles, center]
  );

  return (
    <>
      <h1 className="home-title">Ancestral Humanity Anonymous</h1>
      <section className="hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/circle.png" alt="A fellowship Circle gathered in rhythm" className="hero-img" />
        <div className="hero-overlay">
          <h2 className="hero-h2">{t("home.title")}</h2>
          <p className="hero-sub">{t("home.sub")}</p>
        </div>
      </section>

      <p className="lede">
        Every Circle that has published a profile, straight from the chain.{" "}
        <button className="btn" onClick={locate} disabled={locating}>
          {locating ? "Locating…" : located ? "Update my location" : "Use my location"}
        </button>
      </p>
      <p className="muted sm" style={{ marginTop: -6 }}>
        Your position is read by your browser only and used locally to sort Circles by
        distance — it is never sent to us or to any third party.
      </p>

      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Loading Circles from the chain…</p>}
      {!loading && circles.length === 0 && !error && (
        <p className="muted">No Circles have published a directory profile yet.</p>
      )}

      <div className="grid two">
        <CircleMap
          center={center}
          circles={ranked}
          focus={selected ? { lat: selected.lat, lon: selected.lon } : null}
        />

        <div className="list">
          {ranked.map((c) => (
            <div
              className={`card clickable ${selected?.pubkey === c.pubkey ? "selected" : ""}`}
              key={c.pubkey}
              onClick={() => setSelected(c)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter") setSelected(c); }}
            >
              <div className="row">
                <Identicon seed={`AHA${c.circle}`} title={c.name || "Circle"} size={46} />
                <div className="meta" style={{ flex: 1 }}>
                  <div className="name">{c.name || "Circle"}</div>
                  <div className="sub">
                    {c.city}
                    {c.address ? ` · ${c.address}` : ""}
                  </div>
                </div>
                {located && <span className="pill">{c.distanceKm.toFixed(0)} km</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {selected && <CircleDetail circle={selected} located={located} posts={posts} onClose={() => setSelected(null)} />}
    </>
  );
}

const dayMonth = (u: number) => new Date(u * 1000).toLocaleDateString();

function CircleDetail({
  circle,
  located,
  posts,
  onClose,
}: {
  circle: CircleWithDistance;
  located: boolean;
  posts: Post[] | null;
  onClose: () => void;
}) {
  const [events, setEvents] = useState<CalEvent[] | null>(null);
  useEffect(() => {
    setEvents(null);
    let cancelled = false;
    getMeetings(circle.circle)
      .then((m) => { if (!cancelled) setEvents(upcomingEvents(m)); })
      .catch(() => { if (!cancelled) setEvents([]); });
    return () => { cancelled = true; };
  }, [circle.circle]);

  const live = (posts ?? []).filter((p) => p.live);
  const docs: { cid: string; label: string }[] = [
    { cid: circle.twelveStepsCid, label: "12 Steps" },
    { cid: circle.preambleCid, label: "Preamble" },
    { cid: circle.dailyReflectionsCid, label: "Daily Reflections" },
  ].filter((d) => d.cid);

  return (
    <div className="card circle-detail">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div className="row" style={{ gap: 12 }}>
          <Identicon seed={`AHA${circle.circle}`} title={circle.name || "Circle"} size={48} />
          <div>
            <div className="name" style={{ fontSize: 18 }}>{circle.name || "Circle"}</div>
            <div className="sub">{circle.city}{located ? ` · ${circle.distanceKm.toFixed(0)} km away` : ""}</div>
          </div>
        </div>
        <button className="btn btn-sm btn-ghost" onClick={onClose}>Close</button>
      </div>

      <div className="detail-grid">
        <div>
          <h4 style={{ margin: "0 0 4px" }}>Location</h4>
          <p className="muted sm" style={{ margin: 0 }}>
            {circle.address || "—"}<br />
            <span className="mono">{circle.lat.toFixed(5)}, {circle.lon.toFixed(5)}</span>
          </p>
          {docs.length > 0 && (
            <>
              <h4 style={{ margin: "12px 0 4px" }}>Documents</h4>
              <p className="sm" style={{ margin: 0 }}>
                {docs.map((d, i) => (
                  <span key={d.label}>{i > 0 ? " · " : ""}<a href={ipfsUrl(d.cid)} target="_blank" rel="noreferrer">{d.label}</a></span>
                ))}
              </p>
            </>
          )}
        </div>
        <div>
          <h4 style={{ margin: "0 0 4px" }}>Upcoming meetings</h4>
          {events === null && <p className="muted sm" style={{ margin: 0 }}>Loading the calendar…</p>}
          {events !== null && events.length === 0 && (
            <p className="muted sm" style={{ margin: 0 }}>No scheduled meetings published yet.</p>
          )}
          {(events ?? []).slice(0, 5).map((ev, i) => (
            <div key={i} className="cal-row">
              <span className={`cal-dot ${ev.kind}`} />
              <span className="cal-when">{ev.when.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · {ev.time}</span>
              <span className="sm">{ev.title}</span>
            </div>
          ))}

          <h4 style={{ margin: "12px 0 4px" }}>Latest from the board</h4>
          {posts === null && <p className="muted sm" style={{ margin: 0 }}>Loading the board…</p>}
          {posts !== null && live.length === 0 && (
            <p className="muted sm" style={{ margin: 0 }}>No current notices.</p>
          )}
          {live.slice(0, 4).map((p) => (
            <div key={p.pubkey} className="board-note">
              {p.text && <div className="sm" style={{ whiteSpace: "pre-wrap" }}>{p.text}</div>}
              {p.imageCid && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={ipfsUrl(p.imageCid)} alt="" style={{ maxWidth: "100%", borderRadius: 8, marginTop: 4 }} />
              )}
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{dayMonth(p.startDate)}–{dayMonth(p.endDate)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
