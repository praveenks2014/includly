import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import {
  useSearchProfessionals,
  getCreateUnlockMutationOptions,
  getSearchProfessionalsQueryKey,
  type SearchProfessionalsSpecialty,
} from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Loader2, Search, SlidersHorizontal, X } from "lucide-react";
import { SPECIALTY_OPTIONS } from "@/lib/specialties";
import { useToast } from "@/hooks/use-toast";

export default function SearchPage() {
  const [location] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [unlockingId, setUnlockingId] = useState<number | null>(null);

  const params = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : ""
  );

  const [specialty, setSpecialty] = useState(params.get("specialty") ?? "");
  const [city, setCity] = useState(params.get("city") ?? "");
  const [minExperience, setMinExperience] = useState("");
  const [willingToTravel, setWillingToTravel] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const searchParams = {
    ...(specialty ? { specialty: specialty as SearchProfessionalsSpecialty } : {}),
    ...(city ? { city } : {}),
    ...(minExperience ? { minExperience: Number(minExperience) } : {}),
    ...(willingToTravel ? { willingToTravel: true } : {}),
    limit: 20,
  };

  const { data, isLoading, isFetching } = useSearchProfessionals(searchParams);

  const unlockMutation = useMutation({
    ...getCreateUnlockMutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getSearchProfessionalsQueryKey(searchParams) });
      toast({ title: "Contact unlocked", description: "You can now view their contact details." });
      setUnlockingId(null);
    },
    onError: () => {
      toast({ title: "Could not unlock", description: "Please try again.", variant: "destructive" });
      setUnlockingId(null);
    },
  });

  function handleUnlock(professionalId: number) {
    setUnlockingId(professionalId);
    unlockMutation.mutate({ data: { professionalId } });
  }

  function clearFilters() {
    setSpecialty("");
    setCity("");
    setMinExperience("");
    setWillingToTravel(false);
  }

  const hasFilters = specialty || city || minExperience || willingToTravel;
  const professionals = data?.professionals ?? [];

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-serif font-semibold text-foreground">Find a specialist</h1>
          <p className="text-muted-foreground mt-1">Search from our network of verified professionals across India.</p>
        </div>

        {/* Search + filter bar */}
        <div className="bg-card border border-border rounded-xl p-4 mb-6 shadow-sm">
          <div className="flex gap-3 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by city..."
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="pl-9"
                  data-testid="city-input"
                />
              </div>
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
            <div className="mt-4 pt-4 border-t border-border flex flex-wrap gap-5">
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
            </div>
          )}
        </div>

        {/* Results */}
        {isLoading || isFetching ? (
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
            <p className="text-sm text-muted-foreground mb-4">{professionals.length} specialist{professionals.length !== 1 ? "s" : ""} found</p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {professionals.map((p) => (
                <ProfessionalCard
                  key={p.id}
                  professional={p}
                  onUnlock={handleUnlock}
                  unlocking={unlockingId === p.id}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
