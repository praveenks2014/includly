import { Component, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { APIProvider, Map, AdvancedMarker } from "@vis.gl/react-google-maps";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MapPin, Crosshair, Loader2, AlertCircle } from "lucide-react";

const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

export interface PickedLocation {
  lat: number;
  lng: number;
  city: string;
  country: string;
}

interface LocationPickerProps {
  lat?: number;
  lng?: number;
  city?: string;
  country?: string;
  onLocationChange: (loc: PickedLocation) => void;
}

declare global {
  interface Window {
    google: typeof google;
  }
}

function loadGoogleMapsScript(apiKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.maps?.places) {
      resolve();
      return;
    }
    const existing = document.getElementById("google-maps-script");
    if (existing) {
      existing.addEventListener("load", () => resolve());
      return;
    }
    const script = document.createElement("script");
    script.id = "google-maps-script";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&loading=async`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google Maps script failed to load"));
    document.head.appendChild(script);
  });
}

async function reverseGeocodeGoogle(lat: number, lng: number): Promise<{ city: string; country: string }> {
  if (!window.google?.maps) throw new Error("Google Maps not available");
  const geocoder = new window.google.maps.Geocoder();
  const result = await geocoder.geocode({ location: { lat, lng } });
  const comps = result.results[0]?.address_components ?? [];
  const city =
    comps.find((c) => c.types.includes("locality"))?.long_name ??
    comps.find((c) => c.types.includes("administrative_area_level_2"))?.long_name ??
    "";
  const country = comps.find((c) => c.types.includes("country"))?.long_name ?? "India";
  return { city, country };
}

async function reverseGeocodeNominatim(lat: number, lng: number): Promise<{ city: string; country: string }> {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;
  const res = await fetch(url, { headers: { "Accept-Language": "en" } });
  if (!res.ok) throw new Error("Nominatim request failed");
  const data = await res.json() as {
    address?: {
      city?: string;
      town?: string;
      village?: string;
      county?: string;
      country?: string;
    };
  };
  const addr = data.address ?? {};
  const city = addr.city ?? addr.town ?? addr.village ?? addr.county ?? "";
  const country = addr.country ?? "India";
  return { city, country };
}

async function reverseGeocode(lat: number, lng: number): Promise<{ city: string; country: string }> {
  if (window.google?.maps) {
    try {
      return await reverseGeocodeGoogle(lat, lng);
    } catch {
      // fall through to Nominatim
    }
  }
  return reverseGeocodeNominatim(lat, lng);
}

type GmpPlaceSelectEvent = Event & {
  place: {
    fetchFields: (opts: { fields: string[] }) => Promise<void>;
    location?: google.maps.LatLng;
    displayName?: string;
    addressComponents?: Array<{ types: string[]; longText: string }>;
  };
};

class LocationPickerErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

function LocationPickerInner({ lat, lng, city, country, onLocationChange }: LocationPickerProps) {
  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [markerPos, setMarkerPos] = useState<{ lat: number; lng: number } | null>(
    lat != null && lng != null ? { lat, lng } : null,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  const [useNewApi, setUseNewApi] = useState(false);

  useEffect(() => {
    if (!GOOGLE_MAPS_KEY) return;
    loadGoogleMapsScript(GOOGLE_MAPS_KEY)
      .then(() => setMapsReady(true))
      .catch(() => setMapsError(true));
  }, []);

  useEffect(() => {
    if (!mapsReady || mountedRef.current) return;

    const places = window.google?.maps?.places as unknown as Record<string, unknown> | undefined;
    const PlaceAutocompleteElement = places?.["PlaceAutocompleteElement"] as
      | (new (opts: object) => HTMLElement & EventTarget)
      | undefined;

    if (PlaceAutocompleteElement && containerRef.current) {
      mountedRef.current = true;
      setUseNewApi(true);
      const el = new PlaceAutocompleteElement({ types: ["(cities)"] });
      containerRef.current.appendChild(el);

      el.addEventListener("gmp-placeselect", async (event: Event) => {
        const e = event as GmpPlaceSelectEvent;
        await e.place.fetchFields({ fields: ["location", "displayName", "addressComponents"] });

        if (!e.place.location) return;
        const newLat = e.place.location.lat();
        const newLng = e.place.location.lng();
        setMarkerPos({ lat: newLat, lng: newLng });

        const comps = e.place.addressComponents ?? [];
        const newCity =
          comps.find((c) => c.types.includes("locality"))?.longText ??
          e.place.displayName ??
          "";
        const newCountry =
          comps.find((c) => c.types.includes("country"))?.longText ?? "India";

        onLocationChange({ lat: newLat, lng: newLng, city: newCity, country: newCountry });
      });
    } else if (inputRef.current) {
      mountedRef.current = true;
      const ac = new window.google.maps.places.Autocomplete(inputRef.current, {
        types: ["(cities)"],
        fields: ["geometry", "name", "address_components"],
      });
      ac.addListener("place_changed", async () => {
        const place = ac.getPlace();
        if (!place.geometry?.location) return;
        const newLat = place.geometry.location.lat();
        const newLng = place.geometry.location.lng();
        setMarkerPos({ lat: newLat, lng: newLng });
        const comps = place.address_components ?? [];
        const newCity =
          comps.find((c: { types: string[] }) => c.types.includes("locality"))?.long_name ??
          place.name ??
          "";
        const newCountry =
          comps.find((c: { types: string[] }) => c.types.includes("country"))?.long_name ?? "India";
        onLocationChange({ lat: newLat, lng: newLng, city: newCity, country: newCountry });
      });
    }
  }, [mapsReady, onLocationChange]);

  function handleDetectLocation() {
    if (!navigator.geolocation) {
      setGpsError("Geolocation is not supported by your browser.");
      return;
    }
    setDetecting(true);
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const newLat = pos.coords.latitude;
        const newLng = pos.coords.longitude;
        setMarkerPos({ lat: newLat, lng: newLng });
        let resolvedCity = city ?? "";
        let resolvedCountry = country ?? "India";
        try {
          const result = await reverseGeocode(newLat, newLng);
          resolvedCity = result.city || resolvedCity;
          resolvedCountry = result.country || resolvedCountry;
        } catch {
          // fall through with existing city/country values
        }
        onLocationChange({ lat: newLat, lng: newLng, city: resolvedCity, country: resolvedCountry });
        setDetecting(false);
      },
      (err) => {
        setDetecting(false);
        if (err.code === err.PERMISSION_DENIED) {
          setGpsError("Location access was denied. Please allow location in your browser settings, or enter your city manually below.");
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setGpsError("Location unavailable. Please enter your city manually below.");
        } else {
          setGpsError("Could not detect location. Please enter your city manually below.");
        }
      },
      { timeout: 10000, maximumAge: 60000 },
    );
  }

  const noMapsAvailable = !GOOGLE_MAPS_KEY || mapsError;
  const center = markerPos ?? { lat: 20.5937, lng: 78.9629 };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground z-10 pointer-events-none" />
          <Input
            ref={inputRef}
            defaultValue={city}
            placeholder="Search your city..."
            className={`pl-9 ${useNewApi ? "hidden" : ""}`}
            data-testid="location-search-input"
            autoComplete="off"
          />
          <div
            ref={containerRef}
            className={`pl-9 ${useNewApi ? "" : "hidden"}`}
            data-testid={useNewApi ? "location-search-input" : undefined}
            style={{ minHeight: "2.5rem" }}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={handleDetectLocation}
          disabled={detecting}
          className="shrink-0 gap-1.5 text-sm"
          data-testid="detect-location-btn"
        >
          {detecting ? <Loader2 size={15} className="animate-spin" /> : <Crosshair size={15} />}
          {detecting ? "Detecting…" : "Use my location"}
        </Button>
      </div>

      {gpsError && (
        <div className="flex items-start gap-2 text-xs text-destructive">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span>{gpsError}</span>
        </div>
      )}

      {noMapsAvailable ? (
        <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg border border-dashed border-border text-sm text-muted-foreground">
          <MapPin size={16} />
          <span>
            {mapsError
              ? "Map unavailable — use the button above to detect your location or enter your city below."
              : "Map unavailable — enter your city and country in the fields below, or use the detect button above."}
          </span>
        </div>
      ) : (
        <div className="h-48 rounded-xl overflow-hidden border border-border">
          <APIProvider apiKey={GOOGLE_MAPS_KEY!}>
            <Map
              center={center}
              zoom={markerPos ? 12 : 4}
              mapId="sensei-picker-map"
              gestureHandling="greedy"
              disableDefaultUI
              style={{ width: "100%", height: "100%" }}
              onClick={async (e) => {
                if (!e.detail?.latLng) return;
                const newLat = e.detail.latLng.lat;
                const newLng = e.detail.latLng.lng;
                setMarkerPos({ lat: newLat, lng: newLng });
                try {
                  const { city: newCity, country: newCountry } = await reverseGeocode(newLat, newLng);
                  onLocationChange({ lat: newLat, lng: newLng, city: newCity, country: newCountry });
                } catch {
                  onLocationChange({ lat: newLat, lng: newLng, city: city ?? "", country: country ?? "India" });
                }
              }}
            >
              {markerPos && (
                <AdvancedMarker position={markerPos} title="Your location" />
              )}
            </Map>
          </APIProvider>
        </div>
      )}

      {markerPos && (
        <p className="text-xs text-muted-foreground">
          Coordinates: {markerPos.lat.toFixed(4)}, {markerPos.lng.toFixed(4)}
          {city && ` · ${city}`}
        </p>
      )}
    </div>
  );
}

export function LocationPicker(props: LocationPickerProps) {
  const fallback = (
    <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg border border-dashed border-border text-sm text-muted-foreground">
      <MapPin size={16} />
      <span>Map component unavailable — please enter your city and country below.</span>
    </div>
  );

  return (
    <LocationPickerErrorBoundary fallback={fallback}>
      <LocationPickerInner {...props} />
    </LocationPickerErrorBoundary>
  );
}
