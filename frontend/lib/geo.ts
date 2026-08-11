// Local-only coordinate validation (F71 / Sentinel R6). This module used to
// reverse-geocode via OpenStreetMap Nominatim ("is this point on land?"); that
// sent user-entered coordinates to a third-party service, so it was removed.
// Coordinates are now entered and validated entirely in the browser — nothing
// leaves the device.

export function validCoord(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
}
