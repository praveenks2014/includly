import { useState } from "react";
import { useUser } from "@clerk/react";
import { Redirect, useLocation } from "wouter";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  useGetMyAssessments,
  useUpdateAssessmentStatus,
  useGetChildReports,
  useGetAssessmentMatches,
  useSubmitAssessmentReport,
  useUpdateAssessmentReport,
  getMyAssessmentsQueryKey,
  type AssessmentBookingType,
  type AssessmentReportType,
  type AssessmentMatchType,
} from "@workspace/api-client-react";
import { getSpecialtyLabel } from "@/lib/specialties";
import { useToast } from "@/hooks/use-toast";
import { fetchWithAuth, getApiBase } from "@/lib/api";
import {
  Loader2, ClipboardList, FileText, Lightbulb,
  CalendarCheck, Clock, IndianRupee, AlertCircle,
  Star, MapPin, ChevronRight,
} from "lucide-react";

type ChildType = { id: number; name: string; diagnosisTags: string | null };

const STATUS_COLORS: Record<string, string> = {
  pending_payment: "bg-yellow-100 text-yellow-800",
  confirmed: "bg-green-100 text-green-800",
  completed: "bg-blue-100 text-blue-800",
  cancelled_by_parent: "bg-red-100 text-red-800",
  cancelled_by_professional: "bg-red-100 text-red-800",
  no_show: "bg-gray-100 text-gray-700",
};

const STATUS_LABELS: Record<string, string> = {
  pending_payment: "Payment Pending",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled_by_parent: "Cancelled",
  cancelled_by_professional: "Cancelled",
  no_show: "No Show",
};

function formatDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });
}

// ── Report dialog (professional submits report) ──────────────────────────────

interface ReportDialogProps {
  booking: AssessmentBookingType;
  open: boolean;
  onClose: () => void;
}

function ReportDialog({ booking, open, onClose }: ReportDialogProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [summary, setSummary] = useState("");
  const [observationNotes, setObservationNotes] = useState("");
  const [recommendations, setRecommendations] = useState("");
  const [diagnosisTags, setDiagnosisTags] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submitReport = useSubmitAssessmentReport();
  const updateReport = useUpdateAssessmentReport();

  async function handleSubmit(status: "draft" | "submitted") {
    setSubmitting(true);
    try {
      const tags = diagnosisTags.split(",").map((t) => t.trim()).filter(Boolean);
      await submitReport.mutateAsync({
        bookingId: booking.id,
        summary: summary.trim() || undefined,
        observationNotes: observationNotes.trim() || undefined,
        recommendations: recommendations.trim() || undefined,
        diagnosisTags: tags,
        status,
      });
      void qc.invalidateQueries({ queryKey: getMyAssessmentsQueryKey() });
      toast({ title: status === "submitted" ? "Report submitted to parent" : "Report saved as draft" });
      onClose();
    } catch {
      toast({ title: "Could not save report", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif text-[#1A2340]">Assessment Report</DialogTitle>
          <DialogDescription>
            {booking.parentName ? `For: ${booking.parentName}` : ""} — {formatDate(booking.bookedDate)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">Summary</label>
            <Textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Brief overview of the assessment findings…"
              rows={3}
              className="text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">Observation Notes</label>
            <Textarea
              value={observationNotes}
              onChange={(e) => setObservationNotes(e.target.value)}
              placeholder="Detailed observations during the session…"
              rows={4}
              className="text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">Recommendations</label>
            <Textarea
              value={recommendations}
              onChange={(e) => setRecommendations(e.target.value)}
              placeholder="Next steps, therapy recommendations, follow-up…"
              rows={3}
              className="text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">
              Diagnosis Tags <span className="font-normal text-gray-400">(comma-separated)</span>
            </label>
            <input
              type="text"
              value={diagnosisTags}
              onChange={(e) => setDiagnosisTags(e.target.value)}
              placeholder="e.g. ASD, Speech Delay, Sensory Processing"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2EC4A5]"
            />
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <Button variant="outline" className="flex-1" onClick={() => handleSubmit("draft")} disabled={submitting}>
            {submitting ? <Loader2 className="animate-spin" size={14} /> : "Save Draft"}
          </Button>
          <Button
            className="flex-1 bg-[#2EC4A5] hover:bg-[#25a98d] text-white"
            onClick={() => handleSubmit("submitted")}
            disabled={submitting}
          >
            {submitting ? <Loader2 className="animate-spin" size={14} /> : "Submit to Parent"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Parent tabs ───────────────────────────────────────────────────────────────

function BookingCard({ b, onCancel }: { b: AssessmentBookingType; onCancel: (id: number) => void }) {
  return (
    <div className="bg-white rounded-xl p-4 shadow-[0_2px_12px_rgba(26,35,64,0.06)] border border-gray-50">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="font-semibold text-[#1A2340] text-sm">
            {b.professionalName ?? "Specialist"}
          </p>
          <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
            <CalendarCheck size={11} /> {formatDate(b.bookedDate)} at {b.startTime}
          </p>
        </div>
        <Badge className={`text-xs shrink-0 ${STATUS_COLORS[b.status] ?? "bg-gray-100 text-gray-700"}`}>
          {STATUS_LABELS[b.status] ?? b.status}
        </Badge>
      </div>
      <div className="flex items-center gap-4 text-xs text-gray-400">
        <span className="flex items-center gap-1"><Clock size={11} /> {b.durationMinutes} min</span>
        <span className="flex items-center gap-1"><IndianRupee size={11} /> ₹{b.amountInr.toLocaleString("en-IN")}</span>
      </div>
      {b.status === "confirmed" && (
        <div className="mt-3 pt-3 border-t border-gray-50">
          <Button
            variant="outline"
            size="sm"
            className="text-xs text-red-500 border-red-100 hover:bg-red-50 hover:text-red-600"
            onClick={() => onCancel(b.id)}
          >
            Cancel Booking
          </Button>
        </div>
      )}
    </div>
  );
}

function ReportCard({ r }: { r: AssessmentReportType }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="bg-white rounded-xl p-4 shadow-[0_2px_12px_rgba(26,35,64,0.06)] border border-gray-50">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-[#1A2340] text-sm">
            Assessment Report{r.professionalName ? ` — ${r.professionalName}` : ""}
          </p>
          {r.submittedAt && (
            <p className="text-xs text-gray-400 mt-0.5">
              {new Date(r.submittedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
            </p>
          )}
        </div>
        {r.diagnosisTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {r.diagnosisTags.slice(0, 3).map((t) => (
              <span key={t} className="text-xs bg-[#2EC4A5]/10 text-[#2EC4A5] px-2 py-0.5 rounded-full">{t}</span>
            ))}
          </div>
        )}
      </div>
      {r.summary && <p className="text-sm text-gray-600 mt-2">{r.summary}</p>}
      {(r.observationNotes || r.recommendations) && (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-[#2EC4A5] mt-2 hover:underline"
          >
            {expanded ? "Show less" : "Show full report"}
          </button>
          {expanded && (
            <div className="mt-3 space-y-3 pt-3 border-t border-gray-50">
              {r.observationNotes && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1">Observation Notes</p>
                  <p className="text-sm text-gray-600 whitespace-pre-wrap">{r.observationNotes}</p>
                </div>
              )}
              {r.recommendations && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1">Recommendations</p>
                  <p className="text-sm text-gray-600 whitespace-pre-wrap">{r.recommendations}</p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MatchCard({ m }: { m: AssessmentMatchType }) {
  const [, setLocation] = useLocation();
  return (
    <div className="bg-white rounded-xl p-4 shadow-[0_2px_12px_rgba(26,35,64,0.06)] border border-gray-50">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-[#2EC4A5] flex items-center justify-center shrink-0">
          <span className="text-white text-sm font-bold font-serif">
            {m.fullName?.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() ?? "PR"}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[#1A2340] text-sm">{m.fullName ?? "Specialist"}</p>
          <p className="text-xs text-[#2EC4A5] font-medium">{getSpecialtyLabel(m.specialty)}</p>
          <div className="flex items-center gap-3 mt-1">
            {m.city && (
              <span className="text-xs text-gray-400 flex items-center gap-0.5">
                <MapPin size={10} /> {m.city}
              </span>
            )}
            {m.averageRating != null && (
              <span className="text-xs text-gray-400 flex items-center gap-0.5">
                <Star size={10} className="fill-[#FFB830] text-[#FFB830]" /> {m.averageRating.toFixed(1)}
              </span>
            )}
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 text-xs border-[#2EC4A5] text-[#2EC4A5] hover:bg-[#2EC4A5] hover:text-white"
          onClick={() => setLocation(`/professionals/${m.id}`)}
        >
          View <ChevronRight size={12} />
        </Button>
      </div>
      {m.assessments.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-50 space-y-1.5">
          {m.assessments.slice(0, 2).map((a) => (
            <div key={a.id} className="flex items-center justify-between text-xs">
              <span className="text-gray-600">{a.title}</span>
              <span className="text-[#1A2340] font-semibold">₹{a.priceInr.toLocaleString("en-IN")}</span>
            </div>
          ))}
          {m.assessments.length > 2 && (
            <p className="text-xs text-gray-400">+{m.assessments.length - 2} more</p>
          )}
        </div>
      )}
    </div>
  );
}

function ParentView() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"bookings" | "reports" | "suggestions">("bookings");
  const [selectedChildId, setSelectedChildId] = useState<number | null>(null);

  const { data: bookings = [], isLoading: bookingsLoading } = useGetMyAssessments();
  const updateStatus = useUpdateAssessmentStatus();

  const { data: children = [] } = useQuery<ChildType[]>({
    queryKey: ["/children"],
    queryFn: async () => {
      const res = await fetchWithAuth(`${getApiBase()}/children`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: reports = [], isLoading: reportsLoading } = useGetChildReports(selectedChildId ?? 0, {
    query: { enabled: !!selectedChildId },
  });

  const { data: matches = [], isLoading: matchesLoading } = useGetAssessmentMatches(selectedChildId ?? 0, {
    query: { enabled: !!selectedChildId },
  });

  async function handleCancel(bookingId: number) {
    try {
      await updateStatus.mutateAsync({ bookingId, status: "cancelled_by_parent" });
      void qc.invalidateQueries({ queryKey: getMyAssessmentsQueryKey() });
      toast({ title: "Booking cancelled. Refund added to wallet." });
    } catch {
      toast({ title: "Could not cancel booking", variant: "destructive" });
    }
  }

  const TABS = [
    { key: "bookings" as const, label: "Bookings", icon: ClipboardList },
    { key: "reports" as const, label: "Reports", icon: FileText },
    { key: "suggestions" as const, label: "Suggestions", icon: Lightbulb },
  ];

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold py-2 rounded-lg transition-all ${
              activeTab === key
                ? "bg-white text-[#1A2340] shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {/* Bookings tab */}
      {activeTab === "bookings" && (
        <div className="space-y-3">
          {bookingsLoading && (
            <div className="flex justify-center py-10"><Loader2 className="animate-spin text-[#2EC4A5]" size={28} /></div>
          )}
          {!bookingsLoading && bookings.length === 0 && (
            <div className="text-center py-12">
              <ClipboardList size={40} className="mx-auto text-gray-200 mb-3" />
              <p className="text-gray-500 font-medium">No assessments booked yet</p>
              <p className="text-sm text-gray-400 mt-1">
                Visit a specialist's profile to book an assessment.
              </p>
            </div>
          )}
          {bookings.map((b) => (
            <BookingCard key={b.id} b={b} onCancel={handleCancel} />
          ))}
        </div>
      )}

      {/* Reports tab */}
      {activeTab === "reports" && (
        <div className="space-y-4">
          {children.length > 0 ? (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-2">Select a child to view reports</p>
              <div className="flex flex-wrap gap-2">
                {children.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedChildId(c.id)}
                    className={`text-sm px-4 py-1.5 rounded-full border transition-all ${
                      selectedChildId === c.id
                        ? "border-[#2EC4A5] bg-[#2EC4A5] text-white font-semibold"
                        : "border-gray-200 text-gray-600 hover:border-[#2EC4A5]"
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-6">Add a child to your profile to see their reports.</p>
          )}

          {selectedChildId && (
            <>
              {reportsLoading && (
                <div className="flex justify-center py-8"><Loader2 className="animate-spin text-[#2EC4A5]" size={24} /></div>
              )}
              {!reportsLoading && reports.length === 0 && (
                <div className="text-center py-8">
                  <FileText size={36} className="mx-auto text-gray-200 mb-3" />
                  <p className="text-gray-500 text-sm">No reports on this child's profile yet</p>
                  <p className="text-xs text-gray-400 mt-1">Reports appear here after a specialist completes an assessment.</p>
                </div>
              )}
              {reports.map((r) => <ReportCard key={r.id} r={r} />)}
            </>
          )}
        </div>
      )}

      {/* Suggestions tab */}
      {activeTab === "suggestions" && (
        <div className="space-y-4">
          <div className="p-3 bg-[#FFB830]/5 border border-[#FFB830]/20 rounded-xl flex items-start gap-2">
            <AlertCircle size={14} className="text-[#FFB830] mt-0.5 shrink-0" />
            <p className="text-xs text-gray-600">
              Suggestions are matched from your child's diagnosis tags to specialists in our network who offer assessments.
            </p>
          </div>

          {children.length > 0 ? (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-2">Select a child</p>
              <div className="flex flex-wrap gap-2">
                {children.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedChildId(c.id)}
                    className={`text-sm px-4 py-1.5 rounded-full border transition-all ${
                      selectedChildId === c.id
                        ? "border-[#2EC4A5] bg-[#2EC4A5] text-white font-semibold"
                        : "border-gray-200 text-gray-600 hover:border-[#2EC4A5]"
                    }`}
                  >
                    {c.name}
                    {c.diagnosisTags && (
                      <span className="ml-1.5 text-xs opacity-70">· {c.diagnosisTags.split(",")[0]}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-6">
              Add a child with diagnosis tags in your profile to get specialist suggestions.
            </p>
          )}

          {selectedChildId && (
            <>
              {matchesLoading && (
                <div className="flex justify-center py-8"><Loader2 className="animate-spin text-[#2EC4A5]" size={24} /></div>
              )}
              {!matchesLoading && matches.length === 0 && (
                <div className="text-center py-8">
                  <Lightbulb size={36} className="mx-auto text-gray-200 mb-3" />
                  <p className="text-gray-500 text-sm">No matches found</p>
                  <p className="text-xs text-gray-400 mt-1">
                    Add diagnosis tags to your child's profile for personalised suggestions.
                  </p>
                </div>
              )}
              {matches.map((m) => <MatchCard key={m.id} m={m} />)}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Professional view ─────────────────────────────────────────────────────────

function ProfessionalView() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [reportBooking, setReportBooking] = useState<AssessmentBookingType | null>(null);
  const { data: bookings = [], isLoading } = useGetMyAssessments();
  const updateStatus = useUpdateAssessmentStatus();

  async function handleComplete(bookingId: number) {
    try {
      await updateStatus.mutateAsync({ bookingId, status: "completed" });
      void qc.invalidateQueries({ queryKey: getMyAssessmentsQueryKey() });
      toast({ title: "Marked as completed. Payment released." });
    } catch {
      toast({ title: "Could not update status", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-3">
      {isLoading && (
        <div className="flex justify-center py-10"><Loader2 className="animate-spin text-[#2EC4A5]" size={28} /></div>
      )}
      {!isLoading && bookings.length === 0 && (
        <div className="text-center py-12">
          <ClipboardList size={40} className="mx-auto text-gray-200 mb-3" />
          <p className="text-gray-500 font-medium">No assessment bookings yet</p>
          <p className="text-sm text-gray-400 mt-1">
            Parents will book when you add assessment offerings on your profile.
          </p>
        </div>
      )}
      {bookings.map((b) => (
        <div key={b.id} className="bg-white rounded-xl p-4 shadow-[0_2px_12px_rgba(26,35,64,0.06)] border border-gray-50">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <p className="font-semibold text-[#1A2340] text-sm">{b.parentName ?? "Parent"}</p>
              <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                <CalendarCheck size={11} /> {formatDate(b.bookedDate)} at {b.startTime}
              </p>
            </div>
            <Badge className={`text-xs shrink-0 ${STATUS_COLORS[b.status] ?? "bg-gray-100 text-gray-700"}`}>
              {STATUS_LABELS[b.status] ?? b.status}
            </Badge>
          </div>
          <div className="flex items-center gap-4 text-xs text-gray-400 mb-3">
            <span className="flex items-center gap-1"><Clock size={11} /> {b.durationMinutes} min</span>
            <span className="flex items-center gap-1"><IndianRupee size={11} /> ₹{b.amountInr.toLocaleString("en-IN")}</span>
          </div>
          {b.status === "confirmed" && (
            <div className="flex gap-2 pt-3 border-t border-gray-50">
              <Button
                size="sm"
                variant="outline"
                className="text-xs flex-1"
                onClick={() => setReportBooking(b)}
              >
                <FileText size={12} className="mr-1" /> Add Report
              </Button>
              <Button
                size="sm"
                className="text-xs flex-1 bg-[#2EC4A5] hover:bg-[#25a98d] text-white"
                onClick={() => handleComplete(b.id)}
              >
                Mark Complete
              </Button>
            </div>
          )}
        </div>
      ))}

      {reportBooking && (
        <ReportDialog
          booking={reportBooking}
          open={!!reportBooking}
          onClose={() => setReportBooking(null)}
        />
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AssessmentsPage() {
  const { isSignedIn, isLoaded, user } = useUser();

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-[#F5F7FA] flex items-center justify-center">
        <Loader2 className="animate-spin text-[#2EC4A5]" size={32} />
      </div>
    );
  }

  if (!isSignedIn) return <Redirect to="/sign-in" />;

  const role = (user.publicMetadata as { role?: string }).role ?? "parent";
  const isProfessional = role === "professional" || role === "admin";

  return (
    <div className="min-h-screen bg-[#F5F7FA]">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6">
          <h1 className="font-serif text-2xl sm:text-3xl font-bold text-[#1A2340]">Assessments</h1>
          <p className="text-sm text-gray-500 mt-1">
            {isProfessional
              ? "Manage incoming assessment bookings and submit reports."
              : "Your booked assessments, reports, and specialist suggestions."}
          </p>
        </div>

        {isProfessional ? <ProfessionalView /> : <ParentView />}
      </div>
    </div>
  );
}
