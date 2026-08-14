import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/api";
import { Loader2, Building2, MapPin, ChevronRight } from "lucide-react";

interface TherapyCentreSummary {
  id: number;
  name: string;
  description: string | null;
  city: string | null;
  state: string | null;
  photos: string | null;
  therapyTypesOffered: string | null;
  yearsInOperation: number | null;
}

export default function TherapyCentresPage() {
  const { data: centres, isLoading } = useQuery({
    queryKey: ["centres", "browse"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/centres");
      if (!res.ok) throw new Error("Failed to load centres");
      return (await res.json()) as TherapyCentreSummary[];
    },
  });

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="font-serif text-2xl text-[#1A2340] mb-1">Therapy Centres</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Browse verified therapy centres and book a session with one of their specialists.
      </p>

      {isLoading && (
        <div className="flex justify-center py-16">
          <Loader2 size={24} className="animate-spin text-[#2EC4A5]" />
        </div>
      )}

      {!isLoading && (centres?.length ?? 0) === 0 && (
        <p className="text-sm text-muted-foreground text-center py-16">
          No therapy centres are live yet. Check back soon.
        </p>
      )}

      {!isLoading && (centres?.length ?? 0) > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {centres!.map((c) => {
            const firstPhoto = c.photos?.split(",").map((p) => p.trim()).filter(Boolean)[0];
            const types = c.therapyTypesOffered?.split(",").map((t) => t.trim()).filter(Boolean) ?? [];
            return (
              <Link
                key={c.id}
                href={`/therapy-centres/${c.id}`}
                className="block bg-card border border-border rounded-xl p-4 hover:border-[#2EC4A5]/50 hover:shadow-sm transition-all"
              >
                <div className="flex items-start gap-3">
                  {firstPhoto ? (
                    <img src={firstPhoto} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0" />
                  ) : (
                    <div className="w-14 h-14 rounded-lg bg-[#2EC4A5]/10 flex items-center justify-center shrink-0">
                      <Building2 size={22} className="text-[#2EC4A5]" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-[#1A2340] truncate">{c.name}</h3>
                    {(c.city || c.state) && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <MapPin size={11} />
                        {[c.city, c.state].filter(Boolean).join(", ")}
                      </p>
                    )}
                    {types.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {types.slice(0, 3).map((t) => (
                          <span key={t} className="text-[10px] bg-muted/60 text-muted-foreground rounded-full px-2 py-0.5">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <ChevronRight size={16} className="text-muted-foreground shrink-0 mt-1" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
