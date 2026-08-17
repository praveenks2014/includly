// Display-normalization + last-resort coordinate fallback ONLY — never a
// matching/scoring input. Precise coordinates from an actual geocoder
// selection are always preferred; this table only (a) cleans up city-name
// spelling variants (Bangalore/Bengaluru etc.) and Photon's occasional
// mandal/taluk-instead-of-city results, and (b) gives manually-typed city
// text an approximate coordinate when no geocoder selection ever happened.
// See CityAutocomplete.tsx's parseFeature()/resolveManualCity() for how
// this gets used, and geo.ts (api-server) for the completely separate
// scoring-side LocationSource concept this deliberately mirrors in name
// only — this table is never read server-side.

export type LocationSource = "geocoded" | "city_center_approx" | "unresolved";

export interface KnownCity {
  canonical: string;
  aliases: string[];
  lat: number;
  lng: number;
}

// 31 major metros/state capitals/IT hubs — a starting scope, not exhaustive;
// reviewed and approved 2026-08-17. Extend as real usage data shows gaps.
export const KNOWN_CITIES: KnownCity[] = [
  { canonical: "Mumbai", aliases: ["Bombay"], lat: 19.0760, lng: 72.8777 },
  { canonical: "Delhi", aliases: ["New Delhi"], lat: 28.7041, lng: 77.1025 },
  { canonical: "Bangalore", aliases: ["Bengaluru"], lat: 12.9716, lng: 77.5946 },
  { canonical: "Hyderabad", aliases: ["Secunderabad"], lat: 17.3850, lng: 78.4867 },
  { canonical: "Chennai", aliases: ["Madras"], lat: 13.0827, lng: 80.2707 },
  { canonical: "Kolkata", aliases: ["Calcutta"], lat: 22.5726, lng: 88.3639 },
  { canonical: "Pune", aliases: ["Poona"], lat: 18.5204, lng: 73.8567 },
  { canonical: "Ahmedabad", aliases: [], lat: 23.0225, lng: 72.5714 },
  { canonical: "Jaipur", aliases: [], lat: 26.9124, lng: 75.7873 },
  { canonical: "Surat", aliases: [], lat: 21.1702, lng: 72.8311 },
  { canonical: "Lucknow", aliases: [], lat: 26.8467, lng: 80.9462 },
  { canonical: "Kanpur", aliases: [], lat: 26.4499, lng: 80.3319 },
  { canonical: "Nagpur", aliases: [], lat: 21.1458, lng: 79.0882 },
  { canonical: "Indore", aliases: [], lat: 22.7196, lng: 75.8577 },
  { canonical: "Bhopal", aliases: [], lat: 23.2599, lng: 77.4126 },
  { canonical: "Vadodara", aliases: ["Baroda"], lat: 22.3072, lng: 73.1812 },
  { canonical: "Coimbatore", aliases: [], lat: 11.0168, lng: 76.9558 },
  { canonical: "Kochi", aliases: ["Cochin"], lat: 9.9312, lng: 76.2673 },
  { canonical: "Thiruvananthapuram", aliases: ["Trivandrum"], lat: 8.5241, lng: 76.9366 },
  { canonical: "Mysore", aliases: ["Mysuru"], lat: 12.2958, lng: 76.6394 },
  { canonical: "Chandigarh", aliases: [], lat: 30.7333, lng: 76.7794 },
  { canonical: "Gurgaon", aliases: ["Gurugram"], lat: 28.4595, lng: 77.0266 },
  { canonical: "Noida", aliases: [], lat: 28.5355, lng: 77.3910 },
  { canonical: "Nashik", aliases: [], lat: 20.0059, lng: 73.7910 },
  { canonical: "Visakhapatnam", aliases: ["Vizag"], lat: 17.6868, lng: 83.2185 },
  { canonical: "Patna", aliases: [], lat: 25.5941, lng: 85.1376 },
  { canonical: "Ranchi", aliases: [], lat: 23.3441, lng: 85.3096 },
  { canonical: "Guwahati", aliases: [], lat: 26.1445, lng: 91.7362 },
  { canonical: "Bhubaneswar", aliases: [], lat: 20.2961, lng: 85.8245 },
  { canonical: "Puducherry", aliases: ["Pondicherry"], lat: 11.9416, lng: 79.8083 },
  { canonical: "Prayagraj", aliases: ["Allahabad"], lat: 25.4358, lng: 81.8463 },
];

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

// Exact match (case/whitespace-insensitive) against canonical name or any alias.
export function findKnownCity(name: string): KnownCity | null {
  const n = normalize(name);
  if (!n) return null;
  for (const city of KNOWN_CITIES) {
    if (normalize(city.canonical) === n) return city;
    if (city.aliases.some((a) => normalize(a) === n)) return city;
  }
  return null;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const NEAREST_CITY_MAX_KM = 75;

// Nearest KNOWN_CITIES entry to a real coordinate, within NEAREST_CITY_MAX_KM.
// Only meaningful when the coordinate itself is real (a geocoder selection) —
// never call this with an approximated/unresolved point.
export function nearestKnownCity(lat: number, lng: number): KnownCity | null {
  let best: KnownCity | null = null;
  let bestKm = Infinity;
  for (const city of KNOWN_CITIES) {
    const km = haversineKm(lat, lng, city.lat, city.lng);
    if (km < bestKm) {
      bestKm = km;
      best = city;
    }
  }
  return best && bestKm <= NEAREST_CITY_MAX_KM ? best : null;
}

export interface ManualCityResolution {
  city: string;
  lat: number | null;
  lng: number | null;
  locationSource: LocationSource;
}

// Resolves free-typed text (no geocoder selection, e.g. Photon unavailable
// or the user just typed and never picked a suggestion) against the known-
// cities table. Tries the full string, then each comma-separated segment
// (last first, since "Area, City" is the common typed format) so "Gandipet,
// Hyderabad" resolves via its city segment even though the full string
// doesn't match. Never fabricates a coordinate for anything it can't
// confidently match — city_center_approx only, or an explicit unresolved.
export function resolveManualCity(text: string): ManualCityResolution {
  const trimmed = text.trim();
  // Even a full exact match ("Hyderabad" typed verbatim) is still a
  // city-center approximation, never "geocoded" — that source is reserved
  // for an actual Photon selection with a real point, which manual entry
  // by definition never has.
  const direct = findKnownCity(trimmed);
  if (direct) {
    return { city: direct.canonical, lat: direct.lat, lng: direct.lng, locationSource: "city_center_approx" };
  }
  const segments = trimmed.split(",").map((s) => s.trim()).filter(Boolean).reverse();
  for (const segment of segments) {
    const match = findKnownCity(segment);
    if (match) {
      return { city: match.canonical, lat: match.lat, lng: match.lng, locationSource: "city_center_approx" };
    }
  }
  return { city: trimmed, lat: null, lng: null, locationSource: "unresolved" };
}
