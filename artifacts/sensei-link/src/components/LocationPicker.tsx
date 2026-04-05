import { useEffect, useRef, useState } from "react";
import { APIProvider, Map, AdvancedMarker } from "@vis.gl/react-google-maps";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MapPin, Crosshair, Loader2 } from "lucide-react";

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
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject();
    document.head.appendChild(script);
  });
}

async function reverseGeocode(lat: number, lng: number): Promise<{ city: string; country: string }> {
  if (!window.google?.maps) return { city: "", country: "India" };
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

export function LocationPicker({ lat, lng, city, country, onLocationChange }: LocationPickerProps) {
  const [mapsReady, setMapsReady] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [markerPos, setMarkerPos] = useState<{ lat: number; lng: number } | null>(
    lat != null && lng != null ? { lat, lng } : null,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

  useEffect(() => {
    if (!GOOGLE_MAPS_KEY) return;
    loadGoogleMapsScript(GOOGLE_MAPS_KEY)
      .then(() => setMapsReady(true))
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!mapsReady || !inputRef.current || autocompleteRef.current) return;
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
        comps.find((c) => c.types.includes("locality"))?.long_name ?? place.name ?? "";
      const newCountry =
        comps.find((c) => c.types.includes("country"))?.long_name ?? "India";
      onLocationChange({ lat: newLat, lng: newLng, city: newCity, country: newCountry });
    });
    autocompleteRef.current = ac;
  }, [mapsReady, onLocationChange]);

  function handleDetectLocation() {
    if (!navigator.geolocation) return;
    setDetecting(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const newLat = pos.coords.latitude;
        const newLng = pos.coords.longitude;
        setMarkerPos({ lat: newLat, lng: newLng });
        try {
          const { city: newCity, country: newCountry } = await reverseGeocode(newLat, newLng);
          onLocationChange({ lat: newLat, lng: newLng, city: newCity, country: newCountry });
        } catch {
          onLocationChange({ lat: newLat, lng: newLng, city: city ?? "", country: country ?? "India" });
        }
        setDetecting(false);
      },
      () => setDetecting(false),
    );
  }

  if (!GOOGLE_MAPS_KEY) {
    return (
      <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg border border-dashed border-border text-sm text-muted-foreground">
        <MapPin size={16} />
        <span>Location picker unavailable (VITE_GOOGLE_MAPS_API_KEY not set)</span>
      </div>
    );
  }

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
            className="pl-9"
            data-testid="location-search-input"
            autoComplete="off"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={handleDetectLocation}
          disabled={detecting}
          title="Use my current location"
          data-testid="detect-location-btn"
        >
          {detecting ? <Loader2 size={16} className="animate-spin" /> : <Crosshair size={16} />}
        </Button>
      </div>

      <div className="h-48 rounded-xl overflow-hidden border border-border">
        <APIProvider apiKey={GOOGLE_MAPS_KEY}>
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

      {markerPos && (
        <p className="text-xs text-muted-foreground">
          Coordinates: {markerPos.lat.toFixed(4)}, {markerPos.lng.toFixed(4)}
          {city && ` · ${city}`}
        </p>
      )}
    </div>
  );
}
