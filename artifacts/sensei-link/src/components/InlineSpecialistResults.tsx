import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useSearchProfessionals, type SearchProfessionalsSpecialty } from "@workspace/api-client-react";
import { ProfessionalCard } from "@/components/ProfessionalCard";
import { BookingWidgetV2 } from "@/components/BookingWidgetV2";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface BookingTarget {
  id: number;
  name: string | null;
  offersHomeVisits: boolean;
}

// Inline results for the 4 consultation/coach categories' mini-forms
// (ConsultationMiniForm, CoachActivityForm) — a lean, specialty-fixed
// alternative to /search's full page (category grid + filter panel),
// since the mini-form already narrowed the search. Shared between both
// mini-forms (unlike the forms themselves, which stay deliberately
// separate — see ConsultationMiniForm's own comment on why).
export function InlineSpecialistResults({ specialty, coachingSubType }: { specialty: string; coachingSubType?: string }) {
  const [bookingTarget, setBookingTarget] = useState<BookingTarget | null>(null);

  const { data, isLoading } = useSearchProfessionals({
    specialty: specialty as SearchProfessionalsSpecialty,
    ...(coachingSubType ? { coachingSubType } : {}),
    limit: 40,
  });
  const professionals = data?.professionals ?? [];

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 size={22} className="animate-spin text-[#2EC4A5]" />
      </div>
    );
  }

  if (professionals.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-10">No specialists found yet. Check back soon.</p>;
  }

  return (
    <>
      <div className="space-y-3">
        {professionals.map((p) => (
          <ProfessionalCard
            key={p.id}
            professional={p}
            onBook={() => setBookingTarget({ id: p.id, name: p.fullName ?? null, offersHomeVisits: !!p.offersHomeVisits })}
          />
        ))}
      </div>

      <Dialog open={!!bookingTarget} onOpenChange={(open) => !open && setBookingTarget(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-serif text-[#1A2340]">
              Book with {bookingTarget?.name ?? "specialist"}
            </DialogTitle>
          </DialogHeader>
          {bookingTarget && (
            <BookingWidgetV2
              professionalId={bookingTarget.id}
              professionalName={bookingTarget.name}
              offersHomeVisits={bookingTarget.offersHomeVisits}
              specialty={specialty}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
