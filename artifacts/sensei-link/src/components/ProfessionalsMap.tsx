import { APIProvider, Map, AdvancedMarker, Pin, Circle } from "@vis.gl/react-google-maps";
import type { ProfessionalSearchResult } from "@workspace/api-client-react";
import { MapPin } from "lucide-react";
import { useState } from "react";
import { SPECIALTY_OPTIONS } from "@/lib/specialties";

const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

interface ProfessionalsMapProps {
  professionals: ProfessionalSearchResult[];
  searchLat?: number;
  searchLng?: number;
  radiusKm?: number;
  onMarkerClick?: (id: number) => void;
}

const DEFAULT_CENTER = { lat: 20.5937, lng: 78.9629 };
const DEFAULT_ZOOM = 5;

function specialtyColor(specialty: string): string {
  const colors: Record<string, string> = {
    shadow_teacher: "#7c3aed",
    special_tutor: "#2563eb",
    occupational_therapy: "#059669",
    speech_therapy: "#d97706",
    psychiatrist: "#dc2626",
    developmental_pediatrician: "#0891b2",
    neurologist: "#7c2d12",
  };
  return colors[specialty] ?? "#6b7280";
}

function specialtyLabel(specialty: string): string {
  return SPECIALTY_OPTIONS.find((o) => o.value === specialty)?.label ?? specialty;
}

export function ProfessionalsMap({
  professionals,
  searchLat,
  searchLng,
  radiusKm,
  onMarkerClick,
}: ProfessionalsMapProps) {
  const [tooltip, setTooltip] = useState<number | null>(null);

  if (!GOOGLE_MAPS_KEY) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-muted/40 rounded-xl border border-dashed border-border text-muted-foreground gap-2 p-6">
        <MapPin size={28} />
        <p className="text-sm font-medium">Map unavailable</p>
        <p className="text-xs text-center">Set VITE_GOOGLE_MAPS_API_KEY to enable the map view</p>
      </div>
    );
  }

  const hasGeoResults = professionals.some((p) => p.latitude != null && p.longitude != null);
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

        {professionals
          .filter((p) => p.latitude != null && p.longitude != null)
          .map((p) => (
            <AdvancedMarker
              key={p.id}
              position={{ lat: p.latitude!, lng: p.longitude! }}
              onClick={() => {
                setTooltip(tooltip === p.id ? null : p.id);
                onMarkerClick?.(p.id);
              }}
              title={p.fullName ?? specialtyLabel(p.specialty)}
            >
              <Pin
                background={specialtyColor(p.specialty)}
                borderColor={specialtyColor(p.specialty)}
                glyphColor="#fff"
                scale={tooltip === p.id ? 1.3 : 1}
              />
              {tooltip === p.id && (
                <div
                  className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-card border border-border rounded-lg shadow-lg p-2 min-w-[160px] z-50 text-sm"
                  onClick={(e) => e.stopPropagation()}
                >
                  <p className="font-medium text-foreground truncate">{p.fullName ?? "Professional"}</p>
                  <p className="text-xs text-muted-foreground">{specialtyLabel(p.specialty)}</p>
                  {p.city && <p className="text-xs text-muted-foreground">{p.city}</p>}
                  {p.distanceKm != null && (
                    <p className="text-xs text-primary font-medium mt-0.5">{p.distanceKm} km away</p>
                  )}
                </div>
              )}
            </AdvancedMarker>
          ))}
      </Map>
      {!hasGeoResults && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-card/90 backdrop-blur-sm border border-border rounded-lg px-4 py-2 text-sm text-muted-foreground shadow text-center max-w-xs">
            Specialist locations are shared only after a booking is confirmed
          </div>
        </div>
      )}
    </APIProvider>
  );
}
