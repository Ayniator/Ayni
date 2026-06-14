// Coarse "is this point on land?" check via OpenStreetMap Nominatim reverse
// geocoding. On land, Nominatim returns an address with a country; over open
// water it returns no country (or an error). Best-effort — used to WARN, not block.

export interface LandCheck {
  ok: boolean; // true = looks like land
  label: string; // human description (place name or "open water")
  unknown?: boolean; // couldn't determine (network/rate-limit)
}

export function validCoord(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
}

export async function checkOnLand(lat: number, lon: number): Promise<LandCheck> {
  if (!validCoord(lat, lon)) return { ok: false, label: "invalid coordinate" };
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return { ok: true, unknown: true, label: "couldn't verify (continuing)" };
    const j = await res.json();
    const country = j?.address?.country;
    if (country) {
      const place = [j.address.city, j.address.town, j.address.village, j.address.state, country].filter(Boolean)[0];
      return { ok: true, label: place ? `${place}, ${country}` : country };
    }
    // No country → likely open water / unmapped.
    const water = /ocean|sea|bay|gulf|strait|channel/i.test(j?.display_name || j?.name || "");
    return { ok: false, label: water ? j.display_name : "open water (no land found here)" };
  } catch {
    return { ok: true, unknown: true, label: "couldn't verify (continuing)" };
  }
}
