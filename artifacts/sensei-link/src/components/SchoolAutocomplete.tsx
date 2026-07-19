import { useState, useRef, useEffect, useCallback } from "react";
import { School, Loader2, WifiOff } from "lucide-react";
import { Input } from "@/components/ui/input";

export interface SchoolResult {
  displayText: string;
  name: string;
  city: string | null;
  state: string | null;
  lat: number;
  lng: number;
}

interface PhotonProperties {
  name: string;
  city?: string;
  county?: string;
  state?: string;
  country?: string;
}

interface PhotonFeature {
  properties: PhotonProperties;
  geometry: { coordinates: [number, number] };
}

const INDIA_BBOX = "68.1766451354,8.07,97.4025614766,35.5133714285";
const PHOTON_URL = "https://photon.komoot.io/api/";
const DEBOUNCE_MS = 300;
const TIMEOUT_MS = 5000;

// Free-text POI search for schools is meaningfully less reliable than the
// city/place search CityAutocomplete does — Photon frequently returns a
// confident-looking top hit in the wrong city or state entirely for common
// school names (tested against real names before building this). So unlike
// CityAutocomplete, this component NEVER auto-selects a top result — the
// parent must explicitly pick one specific disambiguated suggestion (name +
// city + state shown together) before any lat/lng is captured. Typing
// without selecting saves the school name as free text only, with no
// distance ever computed from it.
function parseFeature(f: PhotonFeature): SchoolResult {
  const p = f.properties;
  const [lng, lat] = f.geometry.coordinates;
  const city = p.city ?? p.county ?? null;
  const parts: string[] = [p.name];
  if (city) parts.push(city);
  if (p.state) parts.push(p.state);
  return { displayText: parts.join(", "), name: p.name, city, state: p.state ?? null, lat, lng };
}

export interface SchoolAutocompleteProps {
  value?: string;
  onSelect: (result: SchoolResult) => void;
  onManualChange: (name: string) => void;
  placeholder?: string;
}

export function SchoolAutocomplete({
  value = "",
  onSelect,
  onManualChange,
  placeholder = "Search school name (e.g. Delhi Public School R K Puram)…",
}: SchoolAutocompleteProps) {
  const [query, setQuery] = useState(value);
  const [suggestions, setSuggestions] = useState<SchoolResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [photonFailed, setPhotonFailed] = useState(false);
  const [hasSelected, setHasSelected] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasInteractedRef = useRef(false);

  useEffect(() => {
    if (hasInteractedRef.current) return;
    setQuery(value);
  }, [value]);

  const fetchSuggestions = useCallback(async (q: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    setIsLoading(true);
    try {
      const url = `${PHOTON_URL}?q=${encodeURIComponent(q)}&limit=6&lang=en&bbox=${INDIA_BBOX}`;
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`Photon ${res.status}`);
      const data = await res.json() as { features: PhotonFeature[] };
      const results = data.features
        .filter((f) => !f.properties.country || f.properties.country === "India")
        .map(parseFeature);
      setSuggestions(results);
      setShowDropdown(true);
      if (results.length > 0) setPhotonFailed(false);
    } catch (err) {
      clearTimeout(timer);
      if ((err as Error).name === "AbortError") return;
      console.warn("SchoolAutocomplete: Photon unavailable — falling back to manual input", err);
      setPhotonFailed(true);
      setSuggestions([]);
      setShowDropdown(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  function scheduleSearch(q: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSuggestions([]);
    setShowDropdown(false);
    if (q.trim().length < 3) return;
    debounceRef.current = setTimeout(() => void fetchSuggestions(q), DEBOUNCE_MS);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    hasInteractedRef.current = true;
    const q = e.target.value;
    setQuery(q);
    setHasSelected(false);
    scheduleSearch(q);
    onManualChange(q);
  }

  function handleSelect(result: SchoolResult) {
    hasInteractedRef.current = true;
    setQuery(result.displayText);
    setSuggestions([]);
    setShowDropdown(false);
    setHasSelected(true);
    onSelect(result);
  }

  function handleBlur() {
    setTimeout(() => setShowDropdown(false), 150);
  }

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  const attribution = (
    <p className="text-[10px] text-gray-400 mt-1.5">
      ©{" "}
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-gray-500 transition-colors"
      >
        OpenStreetMap contributors
      </a>
      . Pick the exact match below — a distance is only shown once you select one.
    </p>
  );

  if (photonFailed) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg">
          <WifiOff size={12} className="shrink-0" />
          <span>School search unavailable — please type the school name below. No distance will be shown.</span>
        </div>
        <div className="relative">
          <School
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
          />
          <Input
            value={query}
            onChange={(e) => {
              hasInteractedRef.current = true;
              setQuery(e.target.value);
              onManualChange(e.target.value);
            }}
            placeholder="School name"
            className="pl-9 h-12 text-base"
            autoComplete="off"
          />
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef}>
      <div className="relative">
        <School
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none z-10"
        />
        {isLoading && (
          <Loader2
            size={14}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin z-10"
          />
        )}
        {!isLoading && hasSelected && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-teal-500 z-10" />
        )}
        <Input
          value={query}
          onChange={handleInputChange}
          onFocus={() => {
            if (suggestions.length > 0) setShowDropdown(true);
          }}
          onBlur={handleBlur}
          placeholder={placeholder}
          className="pl-9 pr-8 h-12 text-base"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />

        {showDropdown && (
          <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
            {suggestions.length === 0 ? (
              <div className="px-4 py-3 text-sm text-gray-400">No matches found — keep typing to save the name only, no distance shown.</div>
            ) : (
              <ul role="listbox">
                {suggestions.map((s, i) => (
                  <li key={i} role="option" aria-selected={false}>
                    <button
                      type="button"
                      className="w-full text-left px-4 py-3 hover:bg-teal-50 active:bg-teal-100 focus:bg-teal-50 focus:outline-none transition-colors flex items-start gap-3 min-h-[52px] border-b border-gray-50 last:border-0"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelect(s);
                      }}
                    >
                      <School size={13} className="shrink-0 text-teal-500 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 leading-tight truncate">{s.name}</p>
                        {(s.city || s.state) && (
                          <p className="text-xs text-gray-500 mt-0.5 truncate">{[s.city, s.state].filter(Boolean).join(", ")}</p>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      {attribution}
    </div>
  );
}
