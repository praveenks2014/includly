import { useState, useRef } from "react";
import {
  useSearchProfessionals,
  getSearchProfessionalsQueryKey,
  type SearchProfessionalsSpecialty,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ProfessionalCard } from "@/components/ProfessionalCard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2, Search, SlidersHorizontal, X, Map, List, Navigation2, MapPin } from "lucide-react";
import { SPECIALTY_OPTIONS, SPECIALTY_ICONS, SPECIALTY_ICON_COLORS, SPECIALTY_LABELS, isInPersonOnly } from "@/lib/specialties";
import { UnlockPaymentModal } from "@/components/UnlockPaymentModal";
import { PlacesAutocomplete, type PlaceResult } from "@/components/PlacesAutocomplete";
import { ProfessionalsMap } from "@/components/ProfessionalsMap";

const RADIUS_OPTIONS = [5, 10, 25];

const TAG_OPTIONS = [
  "ADHD",
  "Autism",
  "Dyslexia",
  "Cerebral Palsy",
  "Down Syndrome",
  "Speech Delay",
  "Learning Disabilities",
];

export default function SearchPage() {
  const queryClient = useQueryClient();
  const [unlockTarget, setUnlockTarget] = useState<{ id: number; name?: string } | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "map">("list");

  const params = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : ""
  );

  const [specialty, setSpecialty] = useState(params.get("specialty") ?? "");
  const resultsRef = useRef<HTMLDivElement>(null);
  const [city, setCity] = useState(params.get("city") ?? "");
  const [minExperience, setMinExperience] = useState("");
  const [willingToTravel, setWillingToTravel] = useState(false);
  const [budgetMaxINR, setBudgetMaxINR] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const [geoLocation, setGeoLocation] = useState<{ lat: number; lng: number; city: string } | null>(null);
  const [radiusKm, setRadiusKm] = useState(5);
  const [geoMode, setGeoMode] = useState(false);
  const [geoLocating, setGeoLocating] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [verifiedOnly, setVerifiedOnly] = useState(false);

  const searchParams = {
    ...(specialty ? { specialty: specialty as SearchProfessionalsSpecialty } : {}),
    ...(!geoMode && city ? { city } : {}),
    ...(minExperience ? { minExperience: Number(minExperience) } : {}),
    ...(willingToTravel ? { willingToTravel: true } : {}),
    ...(budgetMaxINR ? { budgetMaxINR: Number(budgetMaxINR) } : {}),
    ...(geoMode && geoLocation
      ? { lat: geoLocation.lat, lng: geoLocation.lng, radiusKm }
      : {}),
    ...(selectedTags.length > 0 ? { tags: selectedTags.join(",") } : {}),
    ...(verifiedOnly ? { verifiedOnly: true } : {}),
    limit: 40,
  };

  const { data, isLoading, isFetching } = useSearchProfessionals(searchParams);

  function handlePlaceSelect(place: PlaceResult) {
    setGeoLocation({ lat: place.lat, lng: place.lng, city: place.city });
    setCity(place.city);
    setGeoMode(true);
  }

  function handleUseCurrentLocation() {
    if (!navigator.geolocation) return;
    setGeoLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, city: "Your location" });
        setCity("Your location");
        setGeoMode(true);
        setGeoLocating(false);
      },
      () => setGeoLocating(false),
      { timeout: 8000 },
    );
  }

  function handleCityTextChange(value: string) {
    setCity(value);
    if (geoMode && value !== geoLocation?.city) {
      setGeoMode(false);
      setGeoLocation(null);
    }
  }

  function handleUnlock(professionalId: number, name?: string) {
    setUnlockTarget({ id: professionalId, name });
  }

  function handleUnlockSuccess() {
    queryClient.invalidateQueries({ queryKey: getSearchProfessionalsQueryKey(searchParams) });
    setUnlockTarget(null);
  }

  function clearFilters() {
    setSpecialty("");
    setCity("");
    setMinExperience("");
    setWillingToTravel(false);
    setBudgetMaxINR("");
    setGeoMode(false);
    setGeoLocation(null);
    setSelectedTags([]);
    setVerifiedOnly(false);
  }

  const hasFilters = specialty || city || minExperience || willingToTravel || budgetMaxINR || geoMode || selectedTags.length > 0 || verifiedOnly;
  const professionals = data?.professionals ?? [];

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-serif font-semibold text-foreground">Find a specialist</h1>
            <p className="text-muted-foreground mt-1">Search from our network of verified professionals across India.</p>
          </div>
          <div className="flex items-center bg-muted rounded-lg p-0.5 shrink-0">
            <button
              onClick={() => setViewMode("list")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${viewMode === "list" ? "bg-card shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              data-testid="view-list"
            >
              <List size={15} />
              List
            </button>
            <button
              onClick={() => setViewMode("map")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${viewMode === "map" ? "bg-card shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              data-testid="view-map"
            >
              <Map size={15} />
              Map
            </button>
          </div>
        </div>

        {/* Category icon grid */}
        <div className="mb-6 overflow-x-auto -mx-1 px-1">
          <div className="flex gap-3 min-w-max sm:min-w-0 sm:grid sm:grid-cols-4 lg:grid-cols-8">
            {SPECIALTY_OPTIONS.map((opt) => {
              const Icon = SPECIALTY_ICONS[opt.value];
              const colorClass = SPECIALTY_ICON_COLORS[opt.value] ?? "text-gray-600 bg-gray-50";
              const active = specialty === opt.value;
              const inPerson = isInPersonOnly(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  data-testid={`category-${opt.value}`}
                  onClick={() => {
                    setSpecialty(active ? "" : opt.value);
                    resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  className={`group flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all text-center w-24 sm:w-auto ${
                    active
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-border bg-card hover:border-primary/40 hover:shadow-sm"
                  }`}
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colorClass} ${active ? "ring-1 ring-primary/30" : ""}`}>
                    {Icon && <Icon size={20} />}
                  </div>
                  <span className={`text-xs font-medium leading-tight ${active ? "text-primary" : "text-foreground group-hover:text-primary"} transition-colors`}>
                    {SPECIALTY_LABELS[opt.value]}
                  </span>
                  {inPerson && (
                    <span className="flex items-center gap-0.5 text-[10px] text-rose-600 font-medium">
                      <MapPin size={9} />
                      In-Person Only
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Search + filter bar */}
        <div className="bg-card border border-border rounded-xl p-4 mb-6 shadow-sm">
          <div className="flex gap-3 flex-wrap">
            <div className="flex-1 min-w-[200px] flex gap-2">
              <div className="flex-1">
                <PlacesAutocomplete
                  value={city}
                  onChange={handleCityTextChange}
                  onPlaceSelect={handlePlaceSelect}
                  placeholder="Search by city or area..."
                  data-testid="city-input"
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                className="shrink-0 h-10 w-10"
                onClick={handleUseCurrentLocation}
                disabled={geoLocating}
                title="Use my current location"
                data-testid="use-location-btn"
              >
                {geoLocating ? <Loader2 size={16} className="animate-spin" /> : <Navigation2 size={16} />}
              </Button>
            </div>
            <Select value={specialty || "all"} onValueChange={(v) => setSpecialty(v === "all" ? "" : v)}>
              <SelectTrigger className="w-[220px]" data-testid="specialty-select">
                <SelectValue placeholder="All specialties" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All specialties</SelectItem>
                {SPECIALTY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => setShowFilters(!showFilters)}
              data-testid="toggle-filters"
            >
              <SlidersHorizontal size={16} />
              Filters
              {hasFilters && <span className="bg-primary text-primary-foreground text-xs rounded-full w-4 h-4 flex items-center justify-center">!</span>}
            </Button>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1 text-muted-foreground">
                <X size={14} />
                Clear
              </Button>
            )}
          </div>

          {showFilters && (
            <div className="mt-4 pt-4 border-t border-border flex flex-wrap gap-5 items-end">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="min-exp">Min. years experience</Label>
                <Input
                  id="min-exp"
                  type="number"
                  min={0}
                  max={40}
                  placeholder="e.g. 5"
                  value={minExperience}
                  onChange={(e) => setMinExperience(e.target.value)}
                  className="w-36"
                  data-testid="min-experience-input"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="budget-max">Max budget (₹/session)</Label>
                <Input
                  id="budget-max"
                  type="number"
                  min={0}
                  placeholder="e.g. 2000"
                  value={budgetMaxINR}
                  onChange={(e) => setBudgetMaxINR(e.target.value)}
                  className="w-40"
                  data-testid="budget-max-input"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Willing to travel</Label>
                <div className="flex items-center gap-2 h-9">
                  <Switch
                    checked={willingToTravel}
                    onCheckedChange={setWillingToTravel}
                    data-testid="travel-toggle"
                  />
                  <span className="text-sm text-muted-foreground">{willingToTravel ? "Yes" : "Any"}</span>
                </div>
              </div>

              {geoLocation && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="radius-select">Search radius</Label>
                  <div className="flex items-center gap-2">
                    <Navigation2 size={14} className="text-primary" />
                    <Select
                      value={radiusKm.toString()}
                      onValueChange={(v) => {
                        setRadiusKm(Number(v));
                        setGeoMode(true);
                      }}
                    >
                      <SelectTrigger className="w-28" data-testid="radius-select">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {RADIUS_OPTIONS.map((r) => (
                          <SelectItem key={r} value={r.toString()}>{r} km</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Switch
                      checked={geoMode}
                      onCheckedChange={(v) => setGeoMode(v && !!geoLocation)}
                      data-testid="geo-toggle"
                    />
                    <span className="text-sm text-muted-foreground">Geo search</span>
                  </div>
                </div>
              )}

              <div className="w-full flex flex-col gap-1.5">
                <Label>Verified only</Label>
                <div className="flex items-center gap-2 h-9">
                  <Switch
                    checked={verifiedOnly}
                    onCheckedChange={setVerifiedOnly}
                    data-testid="verified-only-toggle"
                  />
                  <span className="text-sm text-muted-foreground">{verifiedOnly ? "Verified only" : "All"}</span>
                </div>
              </div>

              <div className="w-full flex flex-col gap-1.5">
                <Label>Specialization <span className="text-muted-foreground text-xs">(filter by need)</span></Label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {TAG_OPTIONS.map((tag) => {
                    const active = selectedTags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() =>
                          setSelectedTags((prev) =>
                            prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
                          )
                        }
                        className={`px-3 py-1 rounded-full text-sm border transition-colors ${active ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-foreground hover:border-primary"}`}
                        data-testid={`tag-${tag.replace(/\s+/g, "-").toLowerCase()}`}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {geoMode && geoLocation && (
            <div className="mt-3 pt-3 border-t border-border flex items-center gap-2 text-sm text-primary">
              <Navigation2 size={14} />
              <span>Showing specialists within <strong>{radiusKm} km</strong> of <strong>{geoLocation.city || "selected location"}</strong></span>
            </div>
          )}
        </div>

        {/* Results anchor */}
        <div ref={resultsRef} />

        {/* View */}
        {viewMode === "map" ? (
          <div className="relative h-[60vh] min-h-[400px] rounded-xl overflow-hidden border border-border shadow-sm">
            {isLoading || isFetching ? (
              <div className="absolute inset-0 flex items-center justify-center bg-muted/60 z-10">
                <Loader2 size={24} className="animate-spin text-primary" />
              </div>
            ) : null}
            <ProfessionalsMap
              professionals={professionals}
              searchLat={geoMode && geoLocation ? geoLocation.lat : undefined}
              searchLng={geoMode && geoLocation ? geoLocation.lng : undefined}
              radiusKm={geoMode ? radiusKm : undefined}
              onMarkerClick={(id) => {
                const p = professionals.find((pr) => pr.id === id);
                if (p && !p.isUnlocked) handleUnlock(id, p.fullName ?? undefined);
              }}
            />
          </div>
        ) : isLoading || isFetching ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin text-primary mr-2" />
            <span className="text-muted-foreground">Searching...</span>
          </div>
        ) : professionals.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-muted-foreground text-lg">No specialists found.</p>
            <p className="text-sm text-muted-foreground/70 mt-1">Try adjusting your filters.</p>
            {hasFilters && (
              <Button variant="outline" className="mt-4" onClick={clearFilters}>Clear all filters</Button>
            )}
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground mb-4">
              {data?.total ?? professionals.length} specialist{(data?.total ?? professionals.length) !== 1 ? "s" : ""} found
              {geoMode && geoLocation && ` within ${radiusKm} km`}
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {professionals.map((p) => (
                <ProfessionalCard
                  key={p.id}
                  professional={p}
                  onUnlock={(id) => handleUnlock(id, p.fullName ?? undefined)}
                  unlocking={false}
                  distanceKm={p.distanceKm ?? undefined}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <UnlockPaymentModal
        open={unlockTarget !== null}
        onClose={() => setUnlockTarget(null)}
        professionalId={unlockTarget?.id ?? 0}
        professionalName={unlockTarget?.name}
        onUnlockSuccess={handleUnlockSuccess}
      />
    </div>
  );
}
