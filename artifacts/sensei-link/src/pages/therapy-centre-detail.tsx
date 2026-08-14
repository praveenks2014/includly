import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fetchWithAuth } from "@/lib/api";
import { ProfessionalCard } from "@/components/ProfessionalCard";
import { CentreBookingWidget } from "@/components/CentreBookingWidget";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Building2, MapPin, Phone, Globe, Clock } from "lucide-react";

interface TherapyCentreDetail {
  id: number;
  name: string;
  description: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  photos: string | null;
  languagesSpoken: string | null;
  therapyTypesOffered: string | null;
  yearsInOperation: number | null;
}

// Raw shape from GET /centres/:id/therapists — enriched with
// professionalProfilesTable/usersTable fields via LEFT JOIN. Not every
// roster row has a completed professional profile yet (an invited
// therapist who hasn't finished onboarding), so professionalProfileId can
// be null — those rows can't be rendered as a bookable ProfessionalCard.
interface CentreTherapistRow {
  id: number;
  name: string;
  photoUrl: string | null;
  specializations: string | null;
  qualifications: string | null;
  yearsExperience: number | null;
  isActive: boolean;
  professionalProfileId: number | null;
  profSpecialty: string | null;
  profBio: string | null;
  profIsVerified: boolean | null;
  profVerificationStatus: string | null;
  profAverageRating: number | null;
  profTotalRatings: number | null;
  profPaymentActivated: boolean | null;
  profAvatarUrl: string | null;
}

interface BookingTarget {
  id: number;
  name: string | null;
}

export default function TherapyCentreDetailPage() {
  const { id } = useParams<{ id: string }>();
  const centreId = Number(id);
  const [bookingTarget, setBookingTarget] = useState<BookingTarget | null>(null);

  const { data: centre, isLoading: centreLoading } = useQuery({
    queryKey: ["centres", centreId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/centres/${centreId}`);
      if (!res.ok) throw new Error("Failed to load centre");
      return (await res.json()) as TherapyCentreDetail;
    },
    enabled: !!centreId,
  });

  const { data: therapists, isLoading: therapistsLoading } = useQuery({
    queryKey: ["centres", centreId, "therapists"],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/centres/${centreId}/therapists`);
      if (!res.ok) throw new Error("Failed to load therapists");
      return (await res.json()) as CentreTherapistRow[];
    },
    enabled: !!centreId,
  });

  // Only roster entries with a completed, active professional profile are
  // bookable/viewable — mirrors InlineSpecialistResults' onBook pattern,
  // but against CentreBookingWidget (therapyBookingsTable-aware) instead
  // of BookingWidgetV2 (sessionsV2-aware), since this professional is
  // centre-employed and /sessions/book rejects them outright.
  const bookableTherapists = (therapists ?? []).filter((t) => t.isActive && t.professionalProfileId);

  if (centreLoading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 size={24} className="animate-spin text-[#2EC4A5]" />
      </div>
    );
  }

  if (!centre) {
    return <p className="text-sm text-muted-foreground text-center py-24">Centre not found.</p>;
  }

  const photoList = centre.photos?.split(",").map((p) => p.trim()).filter(Boolean) ?? [];
  const types = centre.therapyTypesOffered?.split(",").map((t) => t.trim()).filter(Boolean) ?? [];

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-start gap-4">
          {photoList[0] ? (
            <img src={photoList[0]} alt="" className="w-20 h-20 rounded-lg object-cover shrink-0" />
          ) : (
            <div className="w-20 h-20 rounded-lg bg-[#2EC4A5]/10 flex items-center justify-center shrink-0">
              <Building2 size={28} className="text-[#2EC4A5]" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="font-serif text-xl text-[#1A2340]">{centre.name}</h1>
            {(centre.city || centre.state) && (
              <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                <MapPin size={13} />
                {[centre.address, centre.city, centre.state].filter(Boolean).join(", ")}
              </p>
            )}
            <div className="flex flex-wrap gap-3 mt-2 text-xs text-muted-foreground">
              {centre.phone && <span className="flex items-center gap-1"><Phone size={11} />{centre.phone}</span>}
              {centre.website && <span className="flex items-center gap-1"><Globe size={11} />{centre.website}</span>}
              {centre.yearsInOperation != null && (
                <span className="flex items-center gap-1"><Clock size={11} />{centre.yearsInOperation} yrs in operation</span>
              )}
            </div>
            {types.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-3">
                {types.map((t) => (
                  <span key={t} className="text-[10px] bg-muted/60 text-muted-foreground rounded-full px-2 py-0.5">{t}</span>
                ))}
              </div>
            )}
          </div>
        </div>
        {centre.description && (
          <p className="text-sm text-muted-foreground mt-4 whitespace-pre-line">{centre.description}</p>
        )}
      </div>

      <div>
        <h2 className="font-semibold text-[#1A2340] mb-3">Our Specialists</h2>

        {therapistsLoading && (
          <div className="flex justify-center py-10">
            <Loader2 size={20} className="animate-spin text-[#2EC4A5]" />
          </div>
        )}

        {!therapistsLoading && bookableTherapists.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-10">
            No specialists available for booking yet. Check back soon.
          </p>
        )}

        {!therapistsLoading && bookableTherapists.length > 0 && (
          <div className="space-y-3">
            {bookableTherapists.map((t) => (
              <ProfessionalCard
                key={t.id}
                professional={{
                  id: t.professionalProfileId!,
                  fullName: t.name,
                  specialty: t.profSpecialty ?? "therapist",
                  bio: t.profBio,
                  yearsExperience: t.yearsExperience ?? 0,
                  city: centre.city,
                  isVerified: !!t.profIsVerified,
                  verificationStatus: t.profVerificationStatus ?? "unverified",
                  averageRating: t.profAverageRating,
                  totalRatings: t.profTotalRatings ?? 0,
                  paymentActivated: t.profPaymentActivated ?? undefined,
                  specializationTags: t.specializations ? t.specializations.split(",").map((s) => s.trim()).filter(Boolean) : null,
                  avatarUrl: t.profAvatarUrl ?? t.photoUrl,
                }}
                onBook={() => setBookingTarget({ id: t.professionalProfileId!, name: t.name })}
              />
            ))}
          </div>
        )}
      </div>

      <Dialog open={!!bookingTarget} onOpenChange={(open) => !open && setBookingTarget(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-serif text-[#1A2340]">
              Book with {bookingTarget?.name ?? "specialist"}
            </DialogTitle>
          </DialogHeader>
          {bookingTarget && (
            <CentreBookingWidget professionalId={bookingTarget.id} professionalName={bookingTarget.name} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
