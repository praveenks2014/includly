/**
 * Straight-line (haversine) distance in km. Extracted from
 * shadowTeacherScoring.ts so it can be reused wherever a display-only
 * distance figure is needed (e.g. candidate cards) — not a substitute for
 * real routing/travel-time, which is a separate, bigger decision.
 */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Provenance of a coordinate pair. No column tracks this anywhere yet — every
// current caller passes "geocoded" as a known-accurate placeholder. Exists so
// call sites (and a future locationSource DB column, once one exists) can
// pass real provenance without changing this signature. "unresolved" short-
// circuits scoreDistance below to null, same as a missing coordinate — never
// let a guess masquerade as a real distance.
export type LocationSource = "geocoded" | "city_center_approx" | "unresolved";

// Vertical-agnostic distance-based score: any two (lat, lng, source) points,
// reused by shadow-teacher (teacher<->school) today and, once wired, by
// tutor/therapist (pro<->child-home), in-clinic bookings (pro<->clinic), and
// therapy centres (parent<->centre). Deliberately does NOT know what the two
// points represent — that's the caller's job. Returns null (never a guessed
// number) when either point is missing or unresolved, so the caller can fall
// back to its own city-string comparison; source doesn't yet change the
// bucket thresholds below, only whether a score is attempted at all.
export function scoreDistance(
  originLat: number | null,
  originLng: number | null,
  originSource: LocationSource | undefined,
  destLat: number | null,
  destLng: number | null,
  destSource: LocationSource | undefined,
): number | null {
  if (originLat == null || originLng == null || destLat == null || destLng == null) return null;
  if (originSource === "unresolved" || destSource === "unresolved") return null;
  const km = haversineKm(originLat, originLng, destLat, destLng);
  if (km <= 5) return 30;
  if (km <= 10) return 20;
  if (km <= 20) return 10;
  return 0;
}
