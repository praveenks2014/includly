import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/api";
import { Loader2, Calendar, Clock, ChevronRight } from "lucide-react";

// Same labels/colors as centre-dashboard.tsx's BOOKING_STATUS_LABEL —
// duplicated, not imported, matching this codebase's own established
// convention for small per-file constants (see therapyBookings.ts's
// OTP_MAX_ATTEMPTS comment: route-file-to-route-file/page-to-page sharing
// isn't a boundary this project crosses for something this small).
const BOOKING_STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending_payment: { label: "Pending payment", color: "bg-gray-100 text-gray-600 border-gray-200" },
  confirmed: { label: "Confirmed", color: "bg-blue-50 text-blue-700 border-blue-200" },
  session_started: { label: "In session", color: "bg-teal-50 text-teal-700 border-teal-200" },
  session_completed: { label: "Completed", color: "bg-green-50 text-green-700 border-green-200" },
  cancelled_by_parent: { label: "Cancelled (you)", color: "bg-red-50 text-red-700 border-red-200" },
  cancelled_by_centre: { label: "Cancelled (centre)", color: "bg-red-50 text-red-700 border-red-200" },
  refunded: { label: "Refunded", color: "bg-red-50 text-red-700 border-red-200" },
  no_show_parent: { label: "Missed", color: "bg-amber-50 text-amber-700 border-amber-200" },
  no_show_centre: { label: "Centre no-show", color: "bg-amber-50 text-amber-700 border-amber-200" },
};

interface TherapyBookingSummary {
  id: number;
  centreId: number;
  centreName: string;
  therapistId: number | null;
  therapistName: string | null;
  serviceId: number;
  serviceName: string;
  bookedDate: string;
  startTime: string;
  endTime: string;
  status: string;
  amountInr: number;
  hasFeedback: boolean;
}

export default function TherapyBookingsPage() {
  const { data: bookings, isLoading } = useQuery({
    queryKey: ["therapy-bookings", "mine"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/therapy-bookings/mine");
      if (!res.ok) throw new Error("Failed to load bookings");
      return (await res.json()) as TherapyBookingSummary[];
    },
  });

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="font-serif text-2xl text-[#1A2340] mb-1">My Therapy Sessions</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Sessions booked with therapy centres. View status, feedback, and manage upcoming sessions.
      </p>

      {isLoading && (
        <div className="flex justify-center py-16">
          <Loader2 size={24} className="animate-spin text-[#2EC4A5]" />
        </div>
      )}

      {!isLoading && (bookings?.length ?? 0) === 0 && (
        <p className="text-sm text-muted-foreground text-center py-16">
          No therapy centre sessions booked yet.
        </p>
      )}

      {!isLoading && (bookings?.length ?? 0) > 0 && (
        <div className="space-y-2">
          {bookings!.map((b) => {
            const statusCfg = BOOKING_STATUS_LABEL[b.status] ?? { label: b.status, color: "bg-gray-100 text-gray-600 border-gray-200" };
            return (
              <Link
                key={b.id}
                href={`/therapy-bookings/${b.id}`}
                className="flex items-center gap-3 bg-card border border-border rounded-xl p-4 hover:border-[#2EC4A5]/50 hover:shadow-sm transition-all"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-[#1A2340] truncate">{b.serviceName}</h3>
                    <span className={`text-[10px] rounded-full px-2 py-0.5 border ${statusCfg.color}`}>{statusCfg.label}</span>
                    {b.hasFeedback && (
                      <span className="text-[10px] rounded-full px-2 py-0.5 border bg-purple-50 text-purple-700 border-purple-200">Feedback available</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {b.centreName}{b.therapistName ? ` · ${b.therapistName}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground flex items-center gap-3 mt-1">
                    <span className="flex items-center gap-1"><Calendar size={11} />{b.bookedDate}</span>
                    <span className="flex items-center gap-1"><Clock size={11} />{b.startTime}–{b.endTime}</span>
                  </p>
                </div>
                <ChevronRight size={16} className="text-muted-foreground shrink-0" />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
