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

// The slogan's "Core Shamanism" is an unobtrusive link — visually identical to
// the surrounding text (no underline, colour, or weight change), opening
// shamanism.org in a new tab. The phrase is kept verbatim in every locale, so
// splitting on it works regardless of the surrounding translation.
function SloganWithLink({ text }: { text: string }) {
  const TERM = "Core Shamanism";
  const i = text.indexOf(TERM);
  if (i === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <a
        href="https://www.shamanism.org/core-shamanism/"
        target="_blank"
        rel="noreferrer"
        className="stealth-link"
      >
        {TERM}
      </a>
      {text.slice(i + TERM.length)}
    </>
  );
}

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
      setError(t("home.errInsecure"));
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
        setError(t("home.errGeoFailed"));
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
      <p className="home-slogan"><SloganWithLink text={t("home.slogan")} /></p>
      <section className="hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/circle.png" alt={t("home.heroAlt")} className="hero-img" />
        <div className="hero-overlay">
          <h2 className="hero-h2">{t("home.title")}</h2>
          <p className="hero-sub">{t("home.sub")}</p>
        </div>
      </section>

      <p className="lede">
        {t("home.dirLede")}{" "}
        <button className="btn" onClick={locate} disabled={locating}>
          {locating ? t("home.locating") : located ? t("home.updateLocation") : t("home.useLocation")}
        </button>
      </p>
      <p className="muted sm" style={{ marginTop: -6 }}>
        {t("home.geoNote")}
      </p>

      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">{t("home.loadingCircles")}</p>}
      {!loading && circles.length === 0 && !error && (
        <p className="muted">{t("home.noProfiles")}</p>
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
                <Identicon seed={`AHA${c.circle}`} title={c.name || t("home.circleFallback")} size={46} />
                <div className="meta" style={{ flex: 1 }}>
                  <div className="name">{c.name || t("home.circleFallback")}</div>
                  <div className="sub">
                    {c.city}
                    {c.address ? ` · ${c.address}` : ""}
                  </div>
                </div>
                {located && <span className="pill">{c.distanceKm.toFixed(0)} {t("home.km")}</span>}
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
  const t = useT();
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
    { cid: circle.twelveStepsCid, label: t("home.docs12Steps") },
    { cid: circle.preambleCid, label: t("home.docsPreamble") },
    { cid: circle.dailyReflectionsCid, label: t("home.docsReflections") },
  ].filter((d) => d.cid);

  return (
    <div className="card circle-detail">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div className="row" style={{ gap: 12 }}>
          <Identicon seed={`AHA${circle.circle}`} title={circle.name || t("home.circleFallback")} size={48} />
          <div>
            <div className="name" style={{ fontSize: 18 }}>{circle.name || t("home.circleFallback")}</div>
            <div className="sub">{circle.city}{located ? ` · ${circle.distanceKm.toFixed(0)} ${t("home.kmAway")}` : ""}</div>
          </div>
        </div>
        <button className="btn btn-sm btn-ghost" onClick={onClose}>{t("home.close")}</button>
      </div>

      <div className="detail-grid">
        <div>
          <h4 style={{ margin: "0 0 4px" }}>{t("home.locationHeading")}</h4>
          <p className="muted sm" style={{ margin: 0 }}>
            {circle.address || "—"}<br />
            <span className="mono">{circle.lat.toFixed(5)}, {circle.lon.toFixed(5)}</span>
          </p>
          {docs.length > 0 && (
            <>
              <h4 style={{ margin: "12px 0 4px" }}>{t("home.documentsHeading")}</h4>
              <p className="sm" style={{ margin: 0 }}>
                {docs.map((d, i) => (
                  <span key={d.label}>{i > 0 ? " · " : ""}<a href={ipfsUrl(d.cid)} target="_blank" rel="noreferrer">{d.label}</a></span>
                ))}
              </p>
            </>
          )}
        </div>
        <div>
          <h4 style={{ margin: "0 0 4px" }}>{t("home.meetingsHeading")}</h4>
          {events === null && <p className="muted sm" style={{ margin: 0 }}>{t("home.loadingCalendar")}</p>}
          {events !== null && events.length === 0 && (
            <p className="muted sm" style={{ margin: 0 }}>{t("home.noMeetings")}</p>
          )}
          {(events ?? []).slice(0, 5).map((ev, i) => (
            <div key={i} className="cal-row">
              <span className={`cal-dot ${ev.kind}`} />
              <span className="cal-when">{ev.when.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · {ev.time}</span>
              <span className="sm">{ev.title}</span>
            </div>
          ))}

          <h4 style={{ margin: "12px 0 4px" }}>{t("home.boardHeading")}</h4>
          {posts === null && <p className="muted sm" style={{ margin: 0 }}>{t("home.loadingBoard")}</p>}
          {posts !== null && live.length === 0 && (
            <p className="muted sm" style={{ margin: 0 }}>{t("home.noNotices")}</p>
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
