"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Identicon from "../components/Identicon";
import { listAllCircles, nearest, Circle, CircleWithDistance } from "../lib/solana";

// Leaflet touches `window`, so load the map client-side only.
const CircleMap = dynamic(() => import("../components/CircleMap"), {
  ssr: false,
  loading: () => <div className="map" />,
});

const DEFAULT_CENTER = { lat: 20, lon: 0 }; // world view until we have a location

export default function Home() {
  const [circles, setCircles] = useState<Circle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [located, setLocated] = useState(false);

  useEffect(() => {
    listAllCircles()
      .then(setCircles)
      .catch((e) => setError(String(e?.message || e)))
      .finally(() => setLoading(false));
  }, []);

  function locate() {
    if (!navigator.geolocation) {
      setError("Geolocation is not available in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCenter({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setLocated(true);
      },
      (e) => setError("Location permission denied: " + e.message),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  const ranked: CircleWithDistance[] = useMemo(
    () => nearest(circles, center.lat, center.lon, 25),
    [circles, center]
  );

  return (
    <>
      <h1>Find a Circle Near You</h1>
      <p className="lede">
        Every Circle that has published a profile, straight from the chain.{" "}
        <button className="btn" onClick={locate}>
          {located ? "Update my location" : "Use my location"}
        </button>
      </p>

      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Loading Circles from the chain…</p>}
      {!loading && circles.length === 0 && !error && (
        <p className="muted">No Circles have published a directory profile yet.</p>
      )}

      <div className="grid two">
        <CircleMap center={center} circles={ranked} />

        <div className="list">
          {ranked.map((c) => (
            <div className="card" key={c.pubkey}>
              <div className="row">
                <Identicon seed={c.circle} size={46} />
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
    </>
  );
}
