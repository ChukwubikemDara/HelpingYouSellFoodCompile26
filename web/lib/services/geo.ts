/** Great-circle distance for GET /deals distance_m. */

const EARTH_RADIUS_M = 6_371_008.8;

const rad = (degrees: number) => (degrees * Math.PI) / 180;

/** Haversine distance in metres between two lat/lng points, rounded to an integer. */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(EARTH_RADIUS_M * c);
}
