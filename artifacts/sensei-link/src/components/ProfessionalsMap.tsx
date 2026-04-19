import { APIProvider, Map, Circle } from "@vis.gl/react-google-maps";
import { MapPin } from "lucide-react";

const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

interface ProfessionalsMapProps {
  searchLat?: number;
  searchLng?: number;
  radiusKm?: number;
}

const DEFAULT_CENTER = { lat: 20.5937, lng: 78.9629 };
const DEFAULT_ZOOM = 5;

export function ProfessionalsMap({
  searchLat,
  searchLng,
  radiusKm,
}: ProfessionalsMapProps) {
  if (!GOOGLE_MAPS_KEY) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-muted/40 rounded-xl border border-dashed border-border text-muted-foreground gap-2 p-6">
        <MapPin size={28} />
        <p className="text-sm font-medium">Map unavailable</p>
        <p className="text-xs text-center">Set VITE_GOOGLE_MAPS_API_KEY to enable the map view</p>
      </div>
    );
  }

  const center =
    searchLat !== undefined && searchLng !== undefined
      ? { lat: searchLat, lng: searchLng }
      : DEFAULT_CENTER;
  const zoom = searchLat !== undefined ? 10 : DEFAULT_ZOOM;

  return (
    <APIProvider apiKey={GOOGLE_MAPS_KEY}>
      <Map
        defaultCenter={center}
        defaultZoom={zoom}
        mapId="sensei-map"
        gestureHandling="greedy"
        disableDefaultUI={false}
        style={{ width: "100%", height: "100%", borderRadius: "0.75rem" }}
      >
        {searchLat !== undefined && searchLng !== undefined && radiusKm !== undefined && (
          <Circle
            center={{ lat: searchLat, lng: searchLng }}
            radius={radiusKm * 1000}
            strokeColor="#7c3aed"
            strokeOpacity={0.6}
            strokeWeight={2}
            fillColor="#7c3aed"
            fillOpacity={0.08}
          />
        )}
      </Map>
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="bg-card/90 backdrop-blur-sm border border-border rounded-lg px-4 py-2 text-sm text-muted-foreground shadow text-center max-w-xs">
          Specialist locations are shared only after a booking is confirmed
        </div>
      </div>
    </APIProvider>
  );
}
