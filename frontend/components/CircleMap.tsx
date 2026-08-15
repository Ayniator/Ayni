"use client";

import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import { generateJazziconSvg } from "../lib/jazzicon";
import { CircleWithDistance } from "../lib/solana";
import { ipfsUrl } from "../lib/ipfs";
import { useT } from "./SettingsProvider";

// Use the Circle's identicon as its map marker — no external icon assets.
//
// This is for CIRCLES only. The visitor's own position used to use it too, with
// the seed "__you__", which was wrong twice over: an identicon is a stand-in for
// an identity, and "where I am standing" is not one; and because the seed was
// its own literal rather than anything to do with the member, the pattern never
// matched the wallet avatar on My Circle, so it looked like a bug even to
// someone who accepted the idea. The visitor now gets a plain bookmark pin.
function icon(seed: string) {
  return L.divIcon({
    html: `<div style="width:40px;height:40px;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,.4)">${generateJazziconSvg(
      seed,
      40
    )}</div>`,
    className: "",
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -20],
  });
}

// "You are here" — a static asset served from our OWN origin. A marker fetched
// from a third-party host would carry the visitor's IP and a Referer naming this
// page to whoever runs it, which for a page that has just read your location is
// exactly the wrong request to make.
//
// Built once at module scope rather than per render: L.icon is immutable and
// rebuilding it on every render churns Leaflet's DOM for nothing.
const youAreHereIcon = L.icon({
  iconUrl: "/img/you-are-here.svg",
  iconSize: [32, 40],
  iconAnchor: [16, 40], // the pin's tip, so it points AT the coordinate
  popupAnchor: [0, -38],
  className: "aha-here-marker",
});

// Leaflet ≥1.9 prepends a Ukrainian flag to the "Leaflet" attribution link.
// AHA neither supports nor opposes any cause, so replace the prefix with a
// plain Leaflet link (no flag).
function PlainAttribution() {
  const map = useMap();
  useEffect(() => {
    map.attributionControl?.setPrefix(
      '<a href="https://leafletjs.com" target="_blank" rel="noreferrer">Leaflet</a>'
    );
  }, [map]);
  return null;
}

function Recenter({ lat, lon, zoom }: { lat: number; lon: number; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo([lat, lon], zoom ?? map.getZoom(), { duration: 0.6 });
  }, [lat, lon, zoom, map]);
  return null;
}

export default function CircleMap({
  center,
  circles,
  focus,
}: {
  center: { lat: number; lon: number };
  circles: CircleWithDistance[];
  focus?: { lat: number; lon: number } | null;
}) {
  const t = useT();
  const hereLabel = t("home.youAreHere");
  return (
    <MapContainer center={[center.lat, center.lon]} zoom={6} className="map" scrollWheelZoom>
      <TileLayer
        attribution='&copy; OpenStreetMap contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <PlainAttribution />
      {/* Fly to a clicked circle when one is focused, else follow the user's center. */}
      <Recenter lat={focus?.lat ?? center.lat} lon={focus?.lon ?? center.lon} zoom={focus ? 13 : undefined} />
      {/* The visitor's own position. Both the popup and the marker's alt text
          come from one translated string — the label was hardcoded English
          before, which meant every non-English visitor met one untranslated
          word on an otherwise localised page. */}
      <Marker position={[center.lat, center.lon]} icon={youAreHereIcon} alt={hereLabel}>
        <Popup>{hereLabel}</Popup>
      </Marker>
      {circles.map((c) => (
        <Marker key={c.pubkey} position={[c.lat, c.lon]} icon={icon(`AHA${c.circle}`)}>
          <Popup>
            <strong>{c.name || "Circle"}</strong>
            <br />
            {c.city}
            {c.address ? <br /> : null}
            {c.address}
            <br />
            <em>{c.distanceKm.toFixed(1)} km away</em>
            {c.twelveStepsCid ? (
              <>
                <br />
                <a href={ipfsUrl(c.twelveStepsCid)} target="_blank" rel="noreferrer">
                  12 Steps
                </a>
              </>
            ) : null}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
