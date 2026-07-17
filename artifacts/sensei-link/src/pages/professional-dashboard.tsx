import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useGetMe,
  useGetProfessionalDashboard,
  useGetMyProfessionalProfile,
  useUpdateProfessionalProfile,
  useGetMyIdentityVerification,
  useGetMyCertifications,
  useGetMyAvailability,
  useSetAvailability,
  useGetMySessions,
  useCreateUpiVerificationOrder,
  useConfirmUpiVerification,
  getGetProfessionalDashboardQueryKey,
  getGetMyProfessionalProfileQueryKey,
  type ProfessionalProfile,
  type AvailabilitySlot,
  type SessionBookingWithDetails,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { FileUploadField } from "@/components/FileUploadField";
import { StarRating } from "@/components/StarRating";
import { getSpecialtyLabel } from "@/lib/specialties";
import { fetchWithAuth, getApiBase } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { loadRazorpayScript } from "@/lib/razorpay";
import {
  Home, User, CalendarClock, CalendarCheck, IndianRupee, Award,
  ShieldCheck, Bell, Settings, Loader2, CheckCircle2, XCircle,
  Clock, AlertCircle, Eye, Phone, Mail, MapPin, Star, Unlock,
  Edit3, Save, HelpCircle, BadgeCheck, FileText, ChevronRight,
  Menu, X, Plus, Trash2, TrendingUp, Check, MessageSquare, Send, ChevronLeft,
  Users, Minus, Camera, Share2, RefreshCw, Video,
} from "lucide-react";
import { ShadowMatchChatDrawer } from "@/components/ShadowMatchChatDrawer";
import { TermsAcknowledgment } from "@/components/TermsAcknowledgment";
import { ComingSoon } from "@/components/ComingSoon";
import { CityAutocomplete, type CityResult } from "@/components/CityAutocomplete";
import { SHOW_TUTOR_SEARCH, SHOW_THERAPIST_SEARCH } from "@/features";
import type { Vertical } from "@/components/VerticalRequestWidget";
import { VerticalCandidacyCard, type VerticalCandidacy } from "@/components/VerticalCandidacyCard";
import { VerticalEngagementCard, type VerticalEngagement } from "@/components/VerticalEngagementCard";

// ─── Types ────────────────────────────────────────────────────────────────────
type ProTab = "home" | "profile" | "availability" | "bookings" | "earnings" | "certifications" | "verification" | "notifications" | "messages" | "engagement" | "enquiries" | "vertical-requests";

interface Notification { id: number; title: string; body: string; read: boolean; createdAt: string; }
interface CertDoc { id: number; documentType: string; fileKey: string; uploadedAt: string; }
type SlotDraft = { dayOfWeek: number; startTime: string; endTime: string; slotDurationMinutes: number; priceInr: number; };
type RecurringScheduleSlot = { dayOfWeek: number; startTime: string; endTime: string; };

// ─── Multi-vertical offerings ──────────────────────────────────────────────
type OfferingVertical = "shadow_teacher" | "home_tutor" | "therapist";
interface Offering {
  isPrimary: boolean;
  vertical: OfferingVertical;
  verificationStatus: string;
  isVerified: boolean;
  rejectionReason: string | null;
}
const ALL_VERTICALS: OfferingVertical[] = ["shadow_teacher", "home_tutor", "therapist"];
const VERTICAL_LABELS: Record<OfferingVertical, string> = {
  shadow_teacher: "Shadow Teacher",
  home_tutor: "Home Tutor",
  therapist: "Therapist / Special Educator",
};

function useMyOfferings() {
  return useQuery<Offering[]>({
    queryKey: ["my-offerings"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/professionals/me/offerings");
      if (!res.ok) throw new Error("Failed to fetch offerings");
      const data = await res.json();
      return data.offerings as Offering[];
    },
    staleTime: 30_000,
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const DAYS_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Good night";
}
function timeAgo(iso: string | Date) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const hr = Math.floor(m / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
function initials(name?: string | null) {
  if (!name) return "P";
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { weekday: "short", month: "short", day: "numeric" });
}
function fmtTime(t: string) {
  const [h, m] = t.split(":");
  const hr = Number(h);
  return `${hr % 12 || 12}:${m} ${hr < 12 ? "AM" : "PM"}`;
}
function calcEndTime(start: string, mins: number) {
  const [h, m] = start.split(":").map(Number);
  const total = h * 60 + m + mins;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
function formatScheduleSummary(slots: RecurringScheduleSlot[]): string | null {
  if (slots.length === 0) return null;
  return [...slots]
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime))
    .map((s) => `${DAYS_SHORT[s.dayOfWeek]} ${fmtTime(s.startTime)}–${fmtTime(s.endTime)}`)
    .join(", ");
}


// ─── Go-Live Status Widget ────────────────────────────────────────────────────
function GoLiveStatusWidget({ profile, onTabChange }: {
  profile: ProfessionalProfile;
  onTabChange: (tab: ProTab) => void;
}) {
  const isTherapist = profile.vertical === "therapist";
  const { data: idVerificationRaw } = useGetMyIdentityVerification();
  const { data: certsRaw } = useGetMyCertifications();
  const hasIdentityDoc = !!idVerificationRaw;
  const certs = (certsRaw as CertDoc[] | undefined) ?? [];
  const hasRciCertificate = certs.some((c) => c.documentType === "rci_certificate");

  if (isTherapist) {
    if (!profile.rciCrrNumber) {
      return (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
          <AlertCircle size={18} className="text-red-500 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="font-semibold text-red-800 text-sm">RCI registration required</p>
            <p className="text-xs text-red-700 mt-0.5">
              Therapists must provide an RCI CRR number, a government ID and their RCI certificate to appear in parent search.
            </p>
          </div>
          <button onClick={() => onTabChange("profile")} className="text-xs text-red-600 underline shrink-0 mt-0.5">
            Add CRR →
          </button>
        </div>
      );
    }
    const missingDocs: string[] = [];
    if (!hasIdentityDoc) missingDocs.push("government ID");
    if (!hasRciCertificate) missingDocs.push("RCI certificate");
    if (missingDocs.length > 0 && profile.verificationStatus !== "verified") {
      return (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
          <AlertCircle size={18} className="text-red-500 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="font-semibold text-red-800 text-sm">Documents required</p>
            <p className="text-xs text-red-700 mt-0.5">
              Upload your {missingDocs.join(" and ")} to submit your profile for review — this is required before you can appear in parent search.
            </p>
          </div>
          <button onClick={() => onTabChange("verification")} className="text-xs text-red-600 underline shrink-0 mt-0.5">
            Upload →
          </button>
        </div>
      );
    }
    if (profile.verificationStatus === "verified") {
      return (
        <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl">
          <BadgeCheck size={18} className="text-green-600 shrink-0" />
          <div>
            <p className="font-semibold text-green-800 text-sm">✓ RCI Verified — Visible to parents</p>
            <p className="text-xs text-green-700 mt-0.5">Your RCI credentials and ID have been verified. Your profile is live in parent search.</p>
          </div>
        </div>
      );
    }
    if (profile.verificationStatus === "rejected") {
      return (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
          <XCircle size={18} className="text-red-500 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="font-semibold text-red-800 text-sm">Application not approved</p>
            <p className="text-xs text-red-700 mt-0.5">
              {(profile as ProfessionalProfile & { rejectionReason?: string | null }).rejectionReason
                ? <>Reason: <em>{(profile as ProfessionalProfile & { rejectionReason?: string | null }).rejectionReason}</em>. </>
                : ""}
              Please re-upload your documents.
            </p>
          </div>
          <button onClick={() => onTabChange("verification")} className="text-xs text-red-600 underline shrink-0 mt-0.5">
            Re-upload →
          </button>
        </div>
      );
    }
    return (
      <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
        <Clock size={18} className="text-amber-600 mt-0.5 shrink-0" />
        <div>
          <p className="font-semibold text-amber-800 text-sm">Pending RCI verification</p>
          <p className="text-xs text-amber-700 mt-0.5">
            Your CRR number, ID and RCI certificate have been submitted and are being reviewed by the Includly team. This usually takes 2–3 business days.
          </p>
        </div>
      </div>
    );
  }

  if (!profile.paymentActivated) {
    return (
      <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
        <Clock size={18} className="text-amber-600 mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="font-semibold text-amber-800 text-sm">Complete onboarding to go live</p>
          <p className="text-xs text-amber-700 mt-0.5">Finish your profile setup to become visible to parents searching on Includly.</p>
        </div>
        <a href="/onboarding/pro" className="text-xs text-amber-700 underline shrink-0 mt-0.5">Continue →</a>
      </div>
    );
  }
  if (profile.verificationStatus !== "verified") {
    return (
      <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
        <Clock size={18} className="text-amber-600 mt-0.5 shrink-0" />
        <div>
          <p className="font-semibold text-amber-800 text-sm">Profile under review</p>
          <p className="text-xs text-amber-700 mt-0.5">Our team is reviewing your profile. This usually takes 2–3 business days.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl">
      <CheckCircle2 size={18} className="text-green-600 shrink-0" />
      <div>
        <p className="font-semibold text-green-800 text-sm">✓ Visible to parents</p>
        <p className="text-xs text-green-700 mt-0.5">Parents can find and contact you in search results.</p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB: HOME
// ═══════════════════════════════════════════════════════════════════════════════
function HomeTab({ profile, firstName, onTabChange }: {
  profile: ProfessionalProfile | undefined;
  firstName: string;
  onTabChange: (tab: ProTab) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: dash } = useGetProfessionalDashboard();
  const { data: sessions = [] } = useGetMySessions({ role: "professional" } as Parameters<typeof useGetMySessions>[0]);
  const { data: certsRaw } = useGetMyCertifications();
  const certs = (certsRaw as CertDoc[] | undefined) ?? [];
  const { mutateAsync: patchProfile } = useUpdateProfessionalProfile();

  // Verification status banner with auto-dismiss
  const [bannerDismissed, setBannerDismissed] = useState(false);
  useEffect(() => {
    if (profile?.verificationStatus !== "verified") return undefined;
    const t = setTimeout(() => setBannerDismissed(true), 5000);
    return () => clearTimeout(t);
  }, [profile?.verificationStatus]);

  // Quick edit state
  const [feeMin, setFeeMin] = useState<number | "">(profile?.pricingMinINR ?? "");
  const [feeMax, setFeeMax] = useState<number | "">(profile?.pricingMaxINR ?? "");
  const [feeSaving, setFeeSaving] = useState(false);
  const [homeVisitSaving, setHomeVisitSaving] = useState(false);

  // Sync fee fields when profile loads
  useEffect(() => {
    if (profile?.pricingMinINR !== undefined) setFeeMin(profile.pricingMinINR ?? "");
    if (profile?.pricingMaxINR !== undefined) setFeeMax(profile.pricingMaxINR ?? "");
  }, [profile?.pricingMinINR, profile?.pricingMaxINR]);

  async function saveFee() {
    setFeeSaving(true);
    try {
      await patchProfile({ data: { pricingMinINR: Number(feeMin) || 0, pricingMaxINR: Number(feeMax) || 0 } });
      queryClient.invalidateQueries({ queryKey: getGetMyProfessionalProfileQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetProfessionalDashboardQueryKey() });
      toast({ title: "Session fee saved ✓" });
    } catch {
      toast({ title: "Could not save fee", variant: "destructive" });
    } finally { setFeeSaving(false); }
  }

  async function toggleHomeVisits(enabled: boolean) {
    setHomeVisitSaving(true);
    try {
      await patchProfile({ data: { offersHomeVisits: enabled } });
      queryClient.invalidateQueries({ queryKey: getGetMyProfessionalProfileQueryKey() });
      toast({ title: enabled ? "Home visits enabled" : "Home visits disabled" });
    } catch {
      toast({ title: "Could not update setting", variant: "destructive" });
    } finally { setHomeVisitSaving(false); }
  }

  // Profile completion checklist
  const steps = [
    { label: "Personal Details", done: !!(profile?.fullName && profile?.bio && profile?.city), tab: "profile" as ProTab },
    { label: "Specialties", done: !!profile?.specialty, tab: "profile" as ProTab },
    { label: profile?.specialty === "shadow_teacher" ? "Salary Details" : "Session Details", done: !!(profile?.pricingMinINR || profile?.pricingMaxINR), tab: "profile" as ProTab },
    { label: "Contact Info", done: !!(profile?.phone && profile?.email), tab: "profile" as ProTab },
    { label: "Upload Certifications", done: certs.length > 0, tab: "certifications" as ProTab },
    { label: "ID Verified", done: profile?.verificationStatus === "verified", tab: "verification" as ProTab },
  ];
  const completedCount = steps.filter((s) => s.done).length;
  const completionPct = Math.round((completedCount / steps.length) * 100);

  // Recent activity
  const recentRatings = (dash?.recentRatings ?? []).slice(0, 3).map((r) => ({
    id: `rating-${r.id}`,
    text: `New ${r.score}★ review received`,
    time: r.createdAt,
    icon: <Star size={13} className="text-[#FFB830] fill-[#FFB830]" />,
  }));
  const recentSessions = (sessions as SessionBookingWithDetails[]).slice(0, 3).map((s) => ({
    id: `session-${s.id}`,
    text: `Session booked with ${s.parentName ?? "a parent"}`,
    time: s.createdAt ?? s.bookedDate,
    icon: <CalendarCheck size={13} className="text-violet-600" />,
  }));
  const activity = [...recentRatings, ...recentSessions]
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, 5);

  const handsonSpecialties = ["shadow_teacher", "special_tutor", "occupational_therapy", "speech_therapy"];
  const showHomeVisits = profile ? handsonSpecialties.includes(profile.specialty) : false;

  return (
    <div className="space-y-6">
      {/* Vertical-aware go-live status widget */}
      {profile && <GoLiveStatusWidget profile={profile} onTabChange={onTabChange} />}
      {/* Verification status banner */}
      {profile && !bannerDismissed && (
        <>
          {profile.verificationStatus === "pending" && (
            <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl" data-testid="verification-banner-pending">
              <Clock size={18} className="text-amber-600 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="font-semibold text-amber-800 text-sm">Documents under review</p>
                <p className="text-xs text-amber-700 mt-0.5">Your profile and ID are being reviewed. This usually takes 2–3 business days. You'll receive a notification once approved.</p>
              </div>
            </div>
          )}
          {profile.verificationStatus === "rejected" && (
            <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl" data-testid="verification-banner-rejected">
              <XCircle size={18} className="text-red-500 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="font-semibold text-red-800 text-sm">Application not approved</p>
                <p className="text-xs text-red-700 mt-0.5">
                  {(profile as ProfessionalProfile & { rejectionReason?: string | null }).rejectionReason
                    ? <>Reason: <em>{(profile as ProfessionalProfile & { rejectionReason?: string | null }).rejectionReason}</em>. </>
                    : ""}
                  Please re-upload your documents or <a href="/support" className="underline font-medium">contact support</a>.
                </p>
              </div>
              <button onClick={() => onTabChange("verification")} className="text-xs text-red-600 underline shrink-0">Re-upload →</button>
            </div>
          )}
          {profile.verificationStatus === "verified" && (
            <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl" data-testid="verification-banner-verified">
              <BadgeCheck size={18} className="text-green-600 shrink-0" />
              <p className="text-sm font-semibold text-green-800 flex-1">Your profile is verified! You're now visible in search results.</p>
              <button onClick={() => setBannerDismissed(true)} className="text-green-500 hover:text-green-700"><X size={15} /></button>
            </div>
          )}
        </>
      )}

      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-serif font-semibold text-[#1A2340]">
          {greeting()}, {firstName}! <span className="text-[#2EC4A5]">You're making a difference.</span>
        </h1>
        <p className="text-gray-500 text-sm mt-1">Here's your activity on Includly.</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Profile Views", value: dash?.totalViews ?? 0, icon: <Eye size={16} className="text-blue-600" />, bg: "bg-blue-50" },
          { label: "Total Unlocks", value: dash?.totalUnlocks ?? 0, icon: <Unlock size={16} className="text-[#2EC4A5]" />, bg: "bg-[#2EC4A5]/10" },
          { label: "Total Sessions", value: (sessions as SessionBookingWithDetails[]).filter((s) => s.status === "completed").length, icon: <CalendarCheck size={16} className="text-violet-600" />, bg: "bg-violet-50" },
          { label: "Est. Earnings", value: "₹0", icon: <IndianRupee size={16} className="text-green-600" />, bg: "bg-green-50", sub: "Free period" },
        ].map((stat) => (
          <div key={stat.label} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-[0_4px_24px_rgba(26,35,64,0.08)]">
            <div className={`w-9 h-9 ${stat.bg} rounded-xl flex items-center justify-center mb-3`}>{stat.icon}</div>
            <p className="text-2xl font-bold font-serif text-[#1A2340]">{stat.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{stat.label}</p>
            {stat.sub && <p className="text-[10px] text-gray-400">{stat.sub}</p>}
          </div>
        ))}
      </div>

      {/* Profile completion */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-[0_4px_24px_rgba(26,35,64,0.08)]">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-[#1A2340]">Profile Completion</h2>
          <span className="text-sm font-bold text-[#2EC4A5]">{completionPct}%</span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-2 mb-4">
          <div
            className="h-2 rounded-full bg-[#2EC4A5] transition-all duration-500"
            style={{ width: `${completionPct}%` }}
          />
        </div>
        <div className="space-y-2">
          {steps.map((step) => (
            <button
              key={step.label}
              onClick={() => !step.done && onTabChange(step.tab)}
              className={`w-full flex items-center gap-3 text-sm text-left rounded-lg px-2 py-1.5 transition-colors ${step.done ? "cursor-default" : "hover:bg-gray-50 cursor-pointer"}`}
              disabled={step.done}
            >
              {step.done
                ? <CheckCircle2 size={16} className="text-[#2EC4A5] shrink-0" />
                : <div className="w-4 h-4 rounded-full border-2 border-gray-300 shrink-0" />}
              <span className={step.done ? "text-gray-400 line-through" : "text-gray-700 font-medium"}>{step.label}</span>
              {!step.done && <ChevronRight size={14} className="ml-auto text-gray-400" />}
            </button>
          ))}
        </div>
      </div>

      {/* Recent activity */}
      <div className="bg-white border border-gray-100 rounded-2xl shadow-[0_4px_24px_rgba(26,35,64,0.08)] overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between">
          <h2 className="font-semibold text-[#1A2340]">Recent Activity</h2>
        </div>
        <div className="divide-y divide-gray-50">
          {activity.length === 0 ? (
            <div className="py-10 text-center">
              <TrendingUp size={28} className="mx-auto mb-2 text-gray-300" />
              <p className="text-sm text-gray-400">No activity yet — your stats will appear here as parents interact with your profile.</p>
            </div>
          ) : (
            activity.map((item) => (
              <div key={item.id} className="flex items-center gap-3 px-5 py-3.5">
                <div className="w-7 h-7 rounded-full bg-gray-50 flex items-center justify-center shrink-0">{item.icon}</div>
                <p className="text-sm text-gray-700 flex-1">{item.text}</p>
                <span className="text-xs text-gray-400 shrink-0">{timeAgo(item.time)}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Quick edit panel */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-[0_4px_24px_rgba(26,35,64,0.08)] space-y-5">
        <h2 className="font-semibold text-[#1A2340]">Quick Edit</h2>

        {/* Session fee */}
        <ComingSoon icon={IndianRupee} title="Session fee editing coming soon" accent="teal" />

        {/* Home visits toggle */}
        {showHomeVisits && profile && (
          <div className="flex items-center justify-between py-3 border-t border-gray-50">
            <div>
              <p className="text-sm font-medium text-gray-700">Offer Home Visits</p>
              <p className="text-xs text-gray-400">Let parents book sessions at their location</p>
            </div>
            <Switch
              checked={!!profile.offersHomeVisits}
              onCheckedChange={toggleHomeVisits}
              disabled={homeVisitSaving}
              aria-label="Toggle home visits"
              data-testid="home-visits-toggle"
            />
          </div>
        )}

        <p className="text-xs text-gray-400">
          <button onClick={() => onTabChange("profile")} className="underline text-[#2EC4A5] hover:text-[#26a88d]">Edit full profile</button> for all settings
        </p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB: MY PROFILE
// ═══════════════════════════════════════════════════════════════════════════════
const VERIFICATION_BADGE: Record<string, { label: string; className: string }> = {
  unsubmitted: { label: "Not submitted", className: "bg-gray-100 text-gray-600 border-gray-200" },
  pending: { label: "Pending review", className: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  verified: { label: "Verified", className: "bg-green-50 text-green-700 border-green-200" },
  rejected: { label: "Rejected", className: "bg-red-50 text-red-700 border-red-200" },
};

// A professional's primary vertical is set at signup. This card lets them
// ADD further verticals (e.g. a therapist who also shadow-teaches) — each
// added offering goes through its own Stage-2 questions and must pass its
// OWN verification gate independently before it's listable.
function AdditionalOfferingsCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { data: offerings = [], isLoading } = useMyOfferings();
  const [adding, setAdding] = useState(false);
  const [picking, setPicking] = useState(false);

  if (isLoading) return null;

  const takenVerticals = new Set(offerings.map((o) => o.vertical));
  const availableVerticals = ALL_VERTICALS.filter((v) => !takenVerticals.has(v));
  const additionalOfferings = offerings.filter((o) => !o.isPrimary);

  async function handleAdd(vertical: OfferingVertical) {
    setAdding(true);
    try {
      const res = await fetchWithAuth("/api/professionals/me/offerings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vertical }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not add offering");
      }
      await queryClient.invalidateQueries({ queryKey: ["my-offerings"] });
      setLocation(`/onboarding/pro/stage2/${vertical}`);
    } catch (err: unknown) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Something went wrong", variant: "destructive" });
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-[0_4px_24px_rgba(26,35,64,0.08)] space-y-3">
      <p className="text-sm font-semibold text-[#1A2340]">Your Services</p>
      <p className="text-xs text-gray-400">
        Offer more than one service? Add another vertical — each is verified and listed independently.
      </p>

      {additionalOfferings.length > 0 && (
        <div className="space-y-2">
          {additionalOfferings.map((o) => {
            const badge = VERIFICATION_BADGE[o.verificationStatus] ?? VERIFICATION_BADGE.unsubmitted;
            return (
              <div key={o.vertical} className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-gray-100">
                <span className="text-sm text-[#1A2340]">{VERTICAL_LABELS[o.vertical]}</span>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${badge.className}`}>{badge.label}</span>
              </div>
            );
          })}
        </div>
      )}

      {availableVerticals.length > 0 && (
        picking ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {availableVerticals.map((v) => (
              <Button
                key={v}
                size="sm"
                variant="outline"
                disabled={adding}
                onClick={() => handleAdd(v)}
                className="rounded-xl border-[#2EC4A5] text-[#2EC4A5] hover:bg-[#2EC4A5]/10"
              >
                {adding ? <Loader2 size={13} className="animate-spin mr-1" /> : null}
                {VERTICAL_LABELS[v]}
              </Button>
            ))}
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPicking(true)}
            className="gap-1.5 rounded-xl border-gray-200 hover:border-[#2EC4A5] hover:text-[#2EC4A5]"
          >
            <Plus size={14} /> Add another service
          </Button>
        )
      )}
    </div>
  );
}

function ProfileTab({ profile }: { profile: ProfessionalProfile | undefined }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useUser();
  const { mutateAsync: patchProfile, isPending } = useUpdateProfessionalProfile();
  const [editing, setEditing] = useState(false);
  const [avatarFileKey, setAvatarFileKey] = useState("");
  const [savingAvatar, setSavingAvatar] = useState(false);
  const loginEmail = user?.primaryEmailAddress?.emailAddress ?? profile?.email ?? "";

  async function handleSaveAvatar() {
    if (!avatarFileKey) return;
    setSavingAvatar(true);
    try {
      await patchProfile({ data: { avatarUrl: avatarFileKey } });
      queryClient.invalidateQueries({ queryKey: getGetMyProfessionalProfileQueryKey() });
      toast({ title: "Photo updated ✓" });
      setAvatarFileKey("");
    } catch {
      toast({ title: "Could not save photo", variant: "destructive" });
    } finally { setSavingAvatar(false); }
  }

  const [form, setForm] = useState({
    fullName: profile?.fullName ?? "",
    bio: profile?.bio ?? "",
    qualifications: profile?.qualifications ?? "",
    yearsExperience: profile?.yearsExperience ?? 0,
    city: profile?.city ?? "",
    displayArea: profile?.displayArea ?? "",
    latitude: (profile as unknown as { latitude?: number | null })?.latitude ?? undefined as number | undefined,
    longitude: (profile as unknown as { longitude?: number | null })?.longitude ?? undefined as number | undefined,
    phone: profile?.phone ?? "",
    pricingMinINR: profile?.pricingMinINR ?? 0,
    pricingMaxINR: profile?.pricingMaxINR ?? 0,
    offersHomeVisits: profile?.offersHomeVisits ?? false,
    willingToTravel: profile?.willingToTravel ?? false,
    travelRadiusKm: profile?.travelRadiusKm ?? 0,
    languages: (profile as (typeof profile & { languages?: string[] | null }))?.languages ?? [] as string[],
  });

  useEffect(() => {
    if (profile && !editing) {
      setForm({
        fullName: profile.fullName ?? "",
        bio: profile.bio ?? "",
        qualifications: profile.qualifications ?? "",
        yearsExperience: profile.yearsExperience ?? 0,
        city: profile.city ?? "",
        displayArea: profile.displayArea ?? "",
        latitude: (profile as unknown as { latitude?: number | null })?.latitude ?? undefined,
        longitude: (profile as unknown as { longitude?: number | null })?.longitude ?? undefined,
        phone: profile.phone ?? "",
        pricingMinINR: profile.pricingMinINR ?? 0,
        pricingMaxINR: profile.pricingMaxINR ?? 0,
        offersHomeVisits: profile.offersHomeVisits ?? false,
        willingToTravel: profile.willingToTravel ?? false,
        travelRadiusKm: profile.travelRadiusKm ?? 0,
        languages: (profile as (typeof profile & { languages?: string[] | null }))?.languages ?? [],
      });
    }
  }, [profile, editing]);

  async function handleSave() {
    try {
      await patchProfile({
        data: {
          fullName: form.fullName.trim() || undefined,
          bio: form.bio.trim() || undefined,
          qualifications: form.qualifications.trim() || undefined,
          yearsExperience: Number(form.yearsExperience) || undefined,
          city: form.city.trim() || undefined,
          displayArea: form.displayArea.trim() || undefined,
          latitude: form.latitude,
          longitude: form.longitude,
          phone: form.phone.trim() || undefined,
          pricingMinINR: Number(form.pricingMinINR) || undefined,
          pricingMaxINR: Number(form.pricingMaxINR) || undefined,
          offersHomeVisits: form.offersHomeVisits,
          willingToTravel: form.willingToTravel,
          travelRadiusKm: Number(form.travelRadiusKm) || undefined,
          languages: form.languages.filter(Boolean),
        },
      });
      queryClient.invalidateQueries({ queryKey: getGetMyProfessionalProfileQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetProfessionalDashboardQueryKey() });
      toast({ title: "Profile updated ✓" });
      setEditing(false);
    } catch {
      toast({ title: "Could not save profile", variant: "destructive" });
    }
  }

  if (!profile) {
    return (
      <div className="bg-white border border-gray-100 rounded-2xl p-8 text-center shadow-sm">
        <User size={36} className="mx-auto mb-3 text-gray-300" />
        <p className="font-semibold text-gray-600 mb-1">No profile yet</p>
        <p className="text-sm text-gray-400 mb-5">Create your profile to appear in search results.</p>
        <Link href="/onboard"><Button className="bg-[#2EC4A5] hover:bg-[#26a88d]">Set up profile</Button></Link>
      </div>
    );
  }

  const isShadowTeacher = profile.specialty === "shadow_teacher";

  const statusColors: Record<string, string> = {
    verified: "bg-green-50 text-green-700 border-green-200",
    pending: "bg-amber-50 text-amber-700 border-amber-200",
    rejected: "bg-red-50 text-red-700 border-red-200",
    unsubmitted: "bg-gray-50 text-gray-600 border-gray-200",
  };

  return (
    <div className="space-y-5">
      {/* Public profile preview card */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-[0_4px_24px_rgba(26,35,64,0.08)]">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-full bg-[#2EC4A5] flex items-center justify-center text-white font-bold text-lg">
              {initials(profile.fullName)}
            </div>
            <div>
              <p className="font-semibold text-[#1A2340] text-lg">{profile.fullName ?? "Your name"}</p>
              <p className="text-sm text-[#2EC4A5] font-medium">{getSpecialtyLabel(profile.specialty)}</p>
              {profile.city && (
                <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5"><MapPin size={11} />{profile.city}</p>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${statusColors[profile.verificationStatus] ?? statusColors.unsubmitted}`}>
              {profile.verificationStatus === "verified" ? "✓ Verified" : profile.verificationStatus}
            </span>
            {profile.verificationStatus === "verified" ? (
              <a
                href={`/professionals/${profile.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[#2EC4A5] hover:underline flex items-center gap-1"
              >
                <Eye size={12} /> View public profile
              </a>
            ) : (
              <span
                className="text-xs text-gray-400 flex items-center gap-1 cursor-default select-none"
                title="Your profile will appear in search results once you are verified"
              >
                <Eye size={12} /> Visible after verification
              </span>
            )}
          </div>
        </div>
        {profile.bio && <p className="text-sm text-gray-600 line-clamp-2">{profile.bio}</p>}
        <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
          {profile.yearsExperience > 0 && <span>{profile.yearsExperience} yrs exp.</span>}
          {profile.averageRating && <span className="flex items-center gap-1"><Star size={11} className="fill-[#FFB830] text-[#FFB830]" />{profile.averageRating.toFixed(1)}</span>}
          {(profile.pricingMinINR || profile.pricingMaxINR) && (
            <span>₹{profile.pricingMinINR ?? "?"}–₹{profile.pricingMaxINR ?? "?"}{isShadowTeacher ? "/month" : "/hour"}</span>
          )}
        </div>
      </div>

      {/* Avatar photo upload — shadow teachers */}
      {profile.specialty === "shadow_teacher" && (
        <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-[0_4px_24px_rgba(26,35,64,0.08)] space-y-3">
          <p className="text-sm font-semibold text-[#1A2340]">Profile Photo</p>
          <p className="text-xs text-gray-400">Upload a photo so parents can recognise you.</p>
          <FileUploadField
            label="Choose photo"
            onUploaded={setAvatarFileKey}
            uploadedPath={avatarFileKey}
            accept="image/*"
          />
          <Button
            onClick={handleSaveAvatar}
            disabled={savingAvatar || !avatarFileKey}
            size="sm"
            className="bg-[#2EC4A5] hover:bg-[#26a88d] text-white gap-2 rounded-xl"
          >
            {savingAvatar ? <Loader2 size={13} className="animate-spin" /> : null}
            Save Photo
          </Button>
        </div>
      )}

      <AdditionalOfferingsCard />

      {/* Edit form */}
      {!editing ? (
        <Button
          onClick={() => setEditing(true)}
          variant="outline"
          className="w-full gap-2 rounded-xl border-gray-200 hover:border-[#2EC4A5] hover:text-[#2EC4A5]"
          aria-label="Edit profile"
          data-testid="edit-profile-btn"
        >
          <Edit3 size={15} /> Edit Profile
        </Button>
      ) : (
        <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-[0_4px_24px_rgba(26,35,64,0.08)] space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-gray-50">
            <h3 className="font-semibold text-[#1A2340]">Edit Profile</h3>
            <button onClick={() => setEditing(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>

          {/* Personal */}
          <div className="space-y-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Personal Details</p>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm">Full Name</Label>
                <Input value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} className="mt-1 rounded-lg focus-visible:ring-[#2EC4A5]" aria-label="Full name" />
              </div>
              <div>
                <Label className="text-sm">Years of Experience</Label>
                <Input type="number" min={0} value={form.yearsExperience} onChange={(e) => setForm((f) => ({ ...f, yearsExperience: Number(e.target.value) }))} className="mt-1 rounded-lg focus-visible:ring-[#2EC4A5]" aria-label="Years experience" />
              </div>
            </div>
            <div>
              <Label className="text-sm">Bio</Label>
              <Textarea value={form.bio} onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))} rows={4} className="mt-1 rounded-lg focus-visible:ring-[#2EC4A5] resize-none" aria-label="Bio" placeholder="Tell parents about your approach, experience, and what makes you unique..." />
            </div>
            <div>
              <Label className="text-sm">Qualifications</Label>
              <Input value={form.qualifications} onChange={(e) => setForm((f) => ({ ...f, qualifications: e.target.value }))} className="mt-1 rounded-lg focus-visible:ring-[#2EC4A5]" aria-label="Qualifications" placeholder="e.g. B.Ed Special Education, ASHA Certified SLP" />
            </div>
          </div>

          {/* Location */}
          <div className="space-y-4 pt-4 border-t border-gray-50">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Location</p>
            <CityAutocomplete
              city={form.city}
              area={form.displayArea}
              onSelect={(result: CityResult) =>
                setForm((f) => ({
                  ...f,
                  city: result.city,
                  displayArea: result.area || f.displayArea,
                  latitude: result.lat,
                  longitude: result.lng,
                }))
              }
              onManualChange={(city) => setForm((f) => ({ ...f, city }))}
            />
          </div>

          {/* Session */}
          <div className="space-y-4 pt-4 border-t border-gray-50">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
              {isShadowTeacher ? "Salary Details" : "Session Details"}
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm">{isShadowTeacher ? "Min Monthly Salary (₹)" : "Min Rate per Hour (₹)"}</Label>
                <div className="relative mt-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">₹</span>
                  <Input type="number" min={0} value={form.pricingMinINR} onChange={(e) => setForm((f) => ({ ...f, pricingMinINR: Number(e.target.value) }))} className="pl-7 rounded-lg focus-visible:ring-[#2EC4A5]" aria-label={isShadowTeacher ? "Minimum monthly salary" : "Minimum rate per hour"} />
                </div>
              </div>
              <div>
                <Label className="text-sm">{isShadowTeacher ? "Max Monthly Salary (₹)" : "Max Rate per Hour (₹)"}</Label>
                <div className="relative mt-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">₹</span>
                  <Input type="number" min={0} value={form.pricingMaxINR} onChange={(e) => setForm((f) => ({ ...f, pricingMaxINR: Number(e.target.value) }))} className="pl-7 rounded-lg focus-visible:ring-[#2EC4A5]" aria-label={isShadowTeacher ? "Maximum monthly salary" : "Maximum rate per hour"} />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.offersHomeVisits} onCheckedChange={(v) => setForm((f) => ({ ...f, offersHomeVisits: v }))} aria-label="Offers home visits" />
              <Label className="text-sm cursor-pointer">Offer home visits</Label>
            </div>
            {form.offersHomeVisits && (
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="flex items-center gap-3">
                  <Switch checked={form.willingToTravel} onCheckedChange={(v) => setForm((f) => ({ ...f, willingToTravel: v }))} aria-label="Willing to travel" />
                  <Label className="text-sm cursor-pointer">Willing to travel</Label>
                </div>
                <div>
                  <Label className="text-sm">Travel radius (km)</Label>
                  <Input type="number" min={0} value={form.travelRadiusKm} onChange={(e) => setForm((f) => ({ ...f, travelRadiusKm: Number(e.target.value) }))} className="mt-1 rounded-lg focus-visible:ring-[#2EC4A5]" aria-label="Travel radius" />
                </div>
              </div>
            )}
          </div>

          {/* Languages */}
          <div className="space-y-4 pt-4 border-t border-gray-50">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Languages</p>
            <p className="text-xs text-gray-400">Languages you can work in (used when matching you with families).</p>
            <div className="flex flex-wrap gap-2 min-h-[32px]">
              {form.languages.map((lang, i) => (
                <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#2EC4A5]/10 text-[#2EC4A5] rounded-full text-xs font-medium">
                  {lang}
                  <button type="button" onClick={() => setForm((f) => ({ ...f, languages: f.languages.filter((_, j) => j !== i) }))} className="hover:text-[#26a88d]" aria-label={`Remove ${lang}`}>×</button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                id="lang-input"
                placeholder="e.g. English, Hindi, Tamil…"
                className="rounded-lg focus-visible:ring-[#2EC4A5] text-sm"
                aria-label="Add language"
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    const val = (e.currentTarget.value ?? "").trim().replace(/,$/, "");
                    if (val && !form.languages.includes(val)) {
                      setForm((f) => ({ ...f, languages: [...f.languages, val] }));
                    }
                    e.currentTarget.value = "";
                  }
                }}
              />
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg bg-[#2EC4A5]/10 text-[#2EC4A5] text-xs font-medium hover:bg-[#2EC4A5]/20"
                onClick={() => {
                  const input = document.getElementById("lang-input") as HTMLInputElement | null;
                  const val = input?.value.trim() ?? "";
                  if (val && !form.languages.includes(val)) {
                    setForm((f) => ({ ...f, languages: [...f.languages, val] }));
                    if (input) input.value = "";
                  }
                }}
              >
                Add
              </button>
            </div>
          </div>

          {/* Contact */}
          <div className="space-y-4 pt-4 border-t border-gray-50">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Contact Info</p>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm">Phone</Label>
                <div className="relative mt-1">
                  <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className="pl-9 rounded-lg focus-visible:ring-[#2EC4A5]" placeholder="+91 98765 43210" aria-label="Phone number" />
                </div>
              </div>
              <div>
                <Label className="text-sm">Email</Label>
                <div className="relative mt-1">
                  <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <Input type="email" value={loginEmail} disabled readOnly className="pl-9 rounded-lg bg-gray-50 text-gray-500 cursor-not-allowed" aria-label="Contact email (synced with your login email)" />
                </div>
                <p className="text-xs text-gray-400 mt-1">Synced with your login email — can't be changed here.</p>
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={() => setEditing(false)} className="flex-1 rounded-xl" aria-label="Cancel editing">Cancel</Button>
            <Button onClick={handleSave} disabled={isPending} className="flex-1 rounded-xl bg-[#2EC4A5] hover:bg-[#26a88d] text-white" aria-label="Save profile changes" data-testid="save-profile-btn">
              {isPending ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
              Save Changes
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB: AVAILABILITY
// ═══════════════════════════════════════════════════════════════════════════════
function AvailabilityTab() {
  const { toast } = useToast();
  const [slots, setSlots] = useState<SlotDraft[]>([]);
  const [loaded, setLoaded] = useState(false);

  const { data: existing, isLoading } = useGetMyAvailability();
  const { mutateAsync: saveAvailability, isPending: saving } = useSetAvailability();

  useEffect(() => {
    if (existing && !loaded) {
      setSlots(
        existing.map((s: AvailabilitySlot) => ({
          dayOfWeek: s.dayOfWeek,
          startTime: s.startTime,
          endTime: s.endTime,
          slotDurationMinutes: s.slotDurationMinutes,
          priceInr: s.priceInr,
        }))
      );
      setLoaded(true);
    }
  }, [existing, loaded]);

  function addSlot(day: number) {
    setSlots((prev) => {
      const daySlots = prev.filter((s) => s.dayOfWeek === day);
      const lastEnd = daySlots.length > 0
        ? daySlots.reduce((max, s) => (s.endTime > max ? s.endTime : max), "00:00")
        : "09:00";
      return [...prev, { dayOfWeek: day, startTime: lastEnd, endTime: calcEndTime(lastEnd, 60), slotDurationMinutes: 60, priceInr: 500 }];
    });
  }
  function removeSlot(idx: number) {
    setSlots((prev) => prev.filter((_, i) => i !== idx));
  }
  function updateSlot(idx: number, field: keyof SlotDraft, value: string | number) {
    setSlots((prev) => prev.map((s, i) => {
      if (i !== idx) return s;
      const updated = { ...s, [field]: value };
      if (field === "startTime" || field === "slotDurationMinutes") {
        updated.endTime = calcEndTime(
          field === "startTime" ? (value as string) : s.startTime,
          field === "slotDurationMinutes" ? (value as number) : s.slotDurationMinutes,
        );
      }
      return updated;
    }));
  }

  async function handleSave() {
    try {
      await saveAvailability({ data: { slots } });
      toast({ title: "Availability saved ✓" });
    } catch {
      toast({ title: "Could not save availability", variant: "destructive" });
    }
  }

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-[#2EC4A5]" /></div>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-serif font-semibold text-[#1A2340]">Availability</h1>
          <p className="text-sm text-gray-500 mt-0.5">Set your weekly schedule. Parents can book within these slots.</p>
        </div>
        <Button onClick={handleSave} disabled={saving} className="bg-[#2EC4A5] hover:bg-[#26a88d] text-white gap-2 focus-visible:ring-2 focus-visible:ring-[#2EC4A5]" aria-label="Save availability">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save
        </Button>
      </div>

      <div className="space-y-4">
        {[1, 2, 3, 4, 5, 6, 0].map((day) => {
          const daySlots = slots.map((s, i) => ({ ...s, _idx: i })).filter((s) => s.dayOfWeek === day);
          return (
            <div key={day} className="bg-white border border-gray-100 rounded-2xl shadow-[0_2px_12px_rgba(26,35,64,0.06)] overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-50">
                <div className="flex items-center gap-3">
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${daySlots.length > 0 ? "bg-[#2EC4A5] text-white" : "bg-gray-100 text-gray-500"}`}>
                    {DAYS_SHORT[day]}
                  </span>
                  <p className="font-medium text-[#1A2340] text-sm">{DAYS_FULL[day]}</p>
                  {daySlots.length > 0 && (
                    <span className="text-xs text-[#2EC4A5] bg-[#2EC4A5]/10 px-2 py-0.5 rounded-full">{daySlots.length} slot{daySlots.length > 1 ? "s" : ""}</span>
                  )}
                </div>
                <Button size="sm" variant="ghost" onClick={() => addSlot(day)} className="gap-1 text-xs text-[#2EC4A5] hover:text-[#26a88d] hover:bg-[#2EC4A5]/10" aria-label={`Add slot for ${DAYS_FULL[day]}`}>
                  <Plus size={13} /> Add slot
                </Button>
              </div>

              {daySlots.length === 0 ? (
                <div className="px-5 py-3 text-xs text-gray-400">Not available on this day</div>
              ) : (
                <div className="px-5 py-3 space-y-2">
                  {daySlots.map(({ _idx: idx, ...slot }) => (
                    <div key={idx} className="flex flex-wrap items-center gap-2 py-2 border-b border-gray-50 last:border-0 last:pb-0">
                      <div className="flex items-center gap-2 flex-1">
                        <Input
                          type="time"
                          value={slot.startTime}
                          onChange={(e) => updateSlot(idx, "startTime", e.target.value)}
                          className="h-8 text-xs w-28 rounded-lg focus-visible:ring-[#2EC4A5]"
                          aria-label="Start time"
                        />
                        <span className="text-gray-400 text-xs">to {slot.endTime}</span>
                        <select
                          value={slot.slotDurationMinutes}
                          onChange={(e) => updateSlot(idx, "slotDurationMinutes", Number(e.target.value))}
                          className="h-8 text-xs border border-gray-200 rounded-lg px-2 bg-white focus:ring-[#2EC4A5] focus:ring-1"
                          aria-label="Session duration"
                        >
                          {[30, 45, 60, 90, 120].map((d) => <option key={d} value={d}>{d} min</option>)}
                        </select>
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">₹</span>
                          <Input
                            type="number"
                            value={slot.priceInr}
                            onChange={(e) => updateSlot(idx, "priceInr", Number(e.target.value))}
                            className="h-8 text-xs w-24 pl-5 rounded-lg focus-visible:ring-[#2EC4A5]"
                            aria-label="Slot price"
                          />
                        </div>
                      </div>
                      <button onClick={() => removeSlot(idx)} className="text-gray-300 hover:text-red-400 transition-colors p-1 rounded-lg focus-visible:ring-2 focus-visible:ring-red-300" aria-label="Remove slot">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-gray-400 text-center">Changes are only saved when you click "Save" above.</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Recurring weekly schedule editor — used at teacher-acceptance time to capture
// the block-only commitment (no price/duration; this isn't a bookable listing).
// ═══════════════════════════════════════════════════════════════════════════════
function TeacherScheduleEditor({ slots, onChange }: { slots: RecurringScheduleSlot[]; onChange: (slots: RecurringScheduleSlot[]) => void; }) {
  function addSlot(day: number) {
    const daySlots = slots.filter((s) => s.dayOfWeek === day);
    const lastEnd = daySlots.length > 0
      ? daySlots.reduce((max, s) => (s.endTime > max ? s.endTime : max), "00:00")
      : "09:00";
    onChange([...slots, { dayOfWeek: day, startTime: lastEnd, endTime: calcEndTime(lastEnd, 60) }]);
  }
  function removeSlot(idx: number) {
    onChange(slots.filter((_, i) => i !== idx));
  }
  function updateSlot(idx: number, field: "startTime" | "endTime", value: string) {
    onChange(slots.map((s, i) => (i === idx ? { ...s, [field]: value } : s)));
  }

  return (
    <div className="space-y-2.5">
      <p className="text-xs font-semibold text-[#1A2340]">Your weekly commitment</p>
      <p className="text-[11px] text-gray-500">
        Add the day(s) and time(s) you're committing to for this engagement. This blocks your calendar — required before you can accept.
      </p>
      <div className="space-y-2">
        {[1, 2, 3, 4, 5, 6, 0].map((day) => {
          const daySlots = slots.map((s, i) => ({ ...s, _idx: i })).filter((s) => s.dayOfWeek === day);
          return (
            <div key={day} className="border border-gray-100 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-gray-50/60">
                <div className="flex items-center gap-2">
                  <span className={`w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold ${daySlots.length > 0 ? "bg-[#2EC4A5] text-white" : "bg-gray-200 text-gray-500"}`}>
                    {DAYS_SHORT[day]}
                  </span>
                  <p className="text-xs font-medium text-[#1A2340]">{DAYS_FULL[day]}</p>
                </div>
                <button type="button" onClick={() => addSlot(day)} className="flex items-center gap-1 text-[11px] text-[#2EC4A5] hover:text-[#26a88d] font-medium" aria-label={`Add commitment for ${DAYS_FULL[day]}`}>
                  <Plus size={12} /> Add
                </button>
              </div>
              {daySlots.length > 0 && (
                <div className="px-3 py-2 space-y-1.5">
                  {daySlots.map(({ _idx: idx, ...slot }) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Input
                        type="time"
                        value={slot.startTime}
                        onChange={(e) => updateSlot(idx, "startTime", e.target.value)}
                        className="h-7 text-xs w-24 rounded-lg focus-visible:ring-[#2EC4A5]"
                        aria-label="Start time"
                      />
                      <span className="text-gray-400 text-[11px]">to</span>
                      <Input
                        type="time"
                        value={slot.endTime}
                        onChange={(e) => updateSlot(idx, "endTime", e.target.value)}
                        className="h-7 text-xs w-24 rounded-lg focus-visible:ring-[#2EC4A5]"
                        aria-label="End time"
                      />
                      <button type="button" onClick={() => removeSlot(idx)} className="ml-auto text-gray-300 hover:text-red-400 transition-colors p-1 rounded-lg" aria-label="Remove commitment">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Booking card with OTP verification ────────────────────────────────────────
const STATUS_COLOR_MAP: Record<string, string> = {
  // Legacy statuses
  confirmed: "bg-green-100 text-green-700",
  pending_payment: "bg-yellow-100 text-yellow-700",
  completed: "bg-gray-100 text-gray-600",
  cancelled_by_parent: "bg-red-100 text-red-600",
  cancelled_by_professional: "bg-red-100 text-red-600",
  no_show: "bg-red-100 text-red-600",
  // New Flow B statuses
  requested: "bg-yellow-100 text-yellow-700",
  confirmed_by_pro: "bg-blue-100 text-blue-700",
  paid_held: "bg-indigo-100 text-indigo-700",
  session_started: "bg-[#2EC4A5]/20 text-[#1a8a73]",
  session_completed: "bg-gray-100 text-gray-600",
  releasable: "bg-purple-100 text-purple-700",
  released: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-600",
  refunded: "bg-gray-100 text-gray-500",
  disputed: "bg-red-100 text-red-700",
};

const STATUS_LABEL_MAP: Record<string, string> = {
  requested: "Awaiting your confirmation",
  confirmed_by_pro: "Awaiting payment",
  paid_held: "Payment held — session upcoming",
  session_started: "In progress",
  session_completed: "Completed",
  releasable: "Awaiting payout release",
  released: "Payout released",
  cancelled: "Cancelled",
  refunded: "Refunded",
  disputed: "Under dispute",
  confirmed: "Confirmed",
  pending_payment: "Payment pending",
  completed: "Completed",
  cancelled_by_parent: "Cancelled by parent",
  cancelled_by_professional: "Cancelled",
  no_show: "No show",
};

function BookingCard({ s, onRefresh }: { s: SessionBookingWithDetails; onRefresh: () => void }) {
  const { toast } = useToast();
  const [startOtpInput, setStartOtpInput] = useState("");
  const [endOtpInput, setEndOtpInput] = useState("");
  const [loading, setLoading] = useState<"start" | "end" | "confirm" | "reject" | null>(null);
  const sa = s as any;

  const TERMINAL = ["completed", "cancelled_by_parent", "cancelled_by_professional", "no_show", "session_completed", "releasable", "released", "cancelled", "refunded"];
  const isPast = TERMINAL.includes(s.status);
  const isLegacyStarted = !!sa.startedAt && s.status === "confirmed";

  // V2 route helper
  async function v2Action(path: string, body?: Record<string, unknown>) {
    const res = await fetchWithAuth(`/api/sessions-v2/${s.id}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res;
  }

  async function handleConfirm() {
    setLoading("confirm");
    try {
      const res = await fetchWithAuth(`/api/sessions-v2/${s.id}/confirm`, { method: "PATCH" });
      const data = await res.json();
      if (!res.ok) { toast({ title: data.error ?? "Error", variant: "destructive" }); return; }
      toast({ title: "Session confirmed! The parent will now complete payment." });
      onRefresh();
    } catch { toast({ title: "Network error", variant: "destructive" }); }
    finally { setLoading(null); }
  }

  async function handleReject() {
    setLoading("reject");
    try {
      const res = await fetchWithAuth(`/api/sessions-v2/${s.id}/reject`, { method: "PATCH" });
      const data = await res.json();
      if (!res.ok) { toast({ title: data.error ?? "Error", variant: "destructive" }); return; }
      toast({ title: "Booking declined." });
      onRefresh();
    } catch { toast({ title: "Network error", variant: "destructive" }); }
    finally { setLoading(null); }
  }

  async function verifyOtp(type: "start" | "end") {
    const otp = (type === "start" ? startOtpInput : endOtpInput).trim();
    if (otp.length !== 6) { toast({ title: "Enter the 6-digit code", variant: "destructive" }); return; }
    setLoading(type);
    try {
      // V2 statuses use the new route; legacy uses old route
      const isV2 = ["paid_held", "session_started"].includes(s.status);
      let res: Response;
      if (isV2) {
        const endpoint = type === "start" ? "start-otp" : "end-otp";
        res = await v2Action(endpoint, { otp });
      } else {
        res = await fetchWithAuth(`/api/sessions/${s.id}/verify-${type}-otp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ otp }),
        });
      }
      const data = await res.json();
      if (!res.ok) {
        const attemptsLeft = data.attemptsRemaining != null ? ` (${data.attemptsRemaining} attempts left)` : "";
        toast({ title: data.error ?? "Error" + attemptsLeft, variant: "destructive" });
        return;
      }
      toast({ title: type === "start" ? "Session started ✓" : "Session completed 🎉" });
      if (type === "start") setStartOtpInput(""); else setEndOtpInput("");
      onRefresh();
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setLoading(null);
    }
  }

  const showOtpBlock =
    !isPast && (
      s.status === "confirmed" ||   // legacy
      s.status === "paid_held" ||   // V2: show start OTP input
      s.status === "session_started" // V2: show end OTP input
    );

  const isV2Started = s.status === "session_started";
  const needsStart = s.status === "paid_held" || (s.status === "confirmed" && !isLegacyStarted);
  const needsEnd = isV2Started || isLegacyStarted;

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-[0_2px_12px_rgba(26,35,64,0.06)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-[#1A2340]">{s.parentName ?? "Parent"}</p>
          <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
            <span className="flex items-center gap-1"><CalendarCheck size={11} />{fmtDate(s.bookedDate)}</span>
            <span className="flex items-center gap-1"><Clock size={11} />{fmtTime(s.startTime)}</span>
            <span>{s.durationMinutes} min</span>
          </div>
          {s.parentLocation && (
            <p className="text-xs text-gray-400 mt-1 flex items-center gap-1"><MapPin size={11} />{s.parentLocation}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLOR_MAP[s.status] ?? "bg-gray-100 text-gray-600"}`}>
            {STATUS_LABEL_MAP[s.status] ?? s.status.replace(/_/g, " ")}
          </span>
        </div>
      </div>

      {sa.proAmountInr > 0 && (
        <p className="text-xs text-green-700 mt-2 font-semibold">
          Your earnings: ₹{sa.proAmountInr.toLocaleString("en-IN")}
          {sa.markupInr > 0 && <span className="text-gray-400 font-normal"> (platform fee ₹{sa.markupInr} + GST ₹{sa.gstInr})</span>}
        </p>
      )}
      {!sa.proAmountInr && s.amountInr > 0 && (
        <p className="text-xs text-green-700 mt-2 font-semibold">₹{s.amountInr}</p>
      )}
      {s.notes && <p className="text-xs text-gray-400 mt-2 italic">{s.notes}</p>}

      {/* Action: confirm/reject for V2 requested bookings */}
      {s.status === "requested" && (
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
          <p className="text-xs text-gray-500">A parent has requested this slot. Confirm to allow them to pay.</p>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1 bg-[#2EC4A5] hover:bg-[#26a98d] text-white"
              disabled={loading === "confirm"}
              onClick={handleConfirm}
            >
              {loading === "confirm" ? <Loader2 size={14} className="animate-spin" /> : "Confirm"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1 border-red-200 text-red-600 hover:bg-red-50"
              disabled={loading === "reject"}
              onClick={handleReject}
            >
              {loading === "reject" ? <Loader2 size={14} className="animate-spin" /> : "Decline"}
            </Button>
          </div>
        </div>
      )}

      {/* Action: waiting for parent payment */}
      {s.status === "confirmed_by_pro" && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <p className="text-xs text-blue-700 bg-blue-50 rounded-lg px-3 py-2">
            Waiting for the parent to complete payment. The slot is reserved for them.
          </p>
        </div>
      )}

      {/* OTP verification */}
      {showOtpBlock && (
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
          {needsStart && !needsEnd ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="Start code (from parent)"
                value={startOtpInput}
                onChange={(e) => setStartOtpInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-[#2EC4A5] placeholder:text-gray-300"
              />
              <Button
                size="sm"
                className="bg-[#2EC4A5] hover:bg-[#26a98d] text-white shrink-0"
                disabled={loading === "start" || startOtpInput.length !== 6}
                onClick={() => verifyOtp("start")}
              >
                {loading === "start" ? <Loader2 size={14} className="animate-spin" /> : "Start"}
              </Button>
            </div>
          ) : needsEnd ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="Finish code (from parent)"
                value={endOtpInput}
                onChange={(e) => setEndOtpInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-[#FF6B6B] placeholder:text-gray-300"
              />
              <Button
                size="sm"
                className="bg-[#FF6B6B] hover:bg-[#e05a5a] text-white shrink-0"
                disabled={loading === "end" || endOtpInput.length !== 6}
                onClick={() => verifyOtp("end")}
              >
                {loading === "end" ? <Loader2 size={14} className="animate-spin" /> : "Complete"}
              </Button>
            </div>
          ) : null}
          <p className="text-[10px] text-gray-400">Ask the parent for the 6-digit code shown in their app.</p>
        </div>
      )}

      {/* Disputed notice */}
      {s.status === "disputed" && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <p className="text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2">
            This booking is under dispute and has been escalated to our team. We'll resolve it shortly.
          </p>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB: BOOKINGS
// ═══════════════════════════════════════════════════════════════════════════════
function BookingsTab() {
  const { data: sessions = [], isLoading } = useGetMySessions({ role: "professional" } as Parameters<typeof useGetMySessions>[0]);
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"upcoming" | "past" | "all">("upcoming");

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-[#2EC4A5]" /></div>;

  const typedSessions = sessions as SessionBookingWithDetails[];

  const PAST_STATUSES = [
    "completed", "cancelled_by_parent", "cancelled_by_professional", "no_show",
    "session_completed", "releasable", "released", "cancelled", "refunded",
  ];

  const shown = typedSessions.filter((s) => {
    const isPast = PAST_STATUSES.includes(s.status);
    if (filter === "upcoming") return !isPast;
    if (filter === "past") return isPast;
    return true;
  });

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-serif font-semibold text-[#1A2340]">Bookings</h1>

      <div className="flex gap-2">
        {(["upcoming", "past", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-all capitalize focus-visible:ring-2 focus-visible:ring-[#2EC4A5] ${filter === f ? "bg-[#1A2340] text-white border-[#1A2340]" : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"}`}
          >
            {f}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-10 text-center shadow-sm">
          <CalendarCheck size={36} className="mx-auto mb-3 text-gray-300" />
          <p className="font-semibold text-gray-600">No {filter} bookings</p>
          <p className="text-sm text-gray-400 mt-1">Sessions booked by parents will appear here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {shown.map((s) => (
            <BookingCard key={s.id} s={s} onRefresh={() => queryClient.invalidateQueries({ queryKey: ["sessions"] })} />
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB: EARNINGS
// ═══════════════════════════════════════════════════════════════════════════════
interface SalaryPaymentRow {
  id: number;
  engagementId: number;
  month: string;
  grossInr: number;
  platformCutInr: number;
  trialCreditInr: number;
  netInr: number;
  status: string;
  paidAt: string | null;
}

function useMySalaryPayments() {
  return useQuery<SalaryPaymentRow[]>({
    queryKey: ["my-salary-payments"],
    queryFn: async () => {
      const BASE = (window.location.origin) + (import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "");
      const res = await fetchWithAuth(`${BASE}/api/my-salary-payments`);
      if (!res.ok) throw new Error("Failed to fetch salary payments");
      return res.json();
    },
    staleTime: 60_000,
  });
}

function EarningsTab() {
  const { data: sessions = [] } = useGetMySessions({ role: "professional" } as Parameters<typeof useGetMySessions>[0]);
  const { data: salaryPayments = [], isLoading: salaryLoading } = useMySalaryPayments();
  const { data: profile } = useGetMyProfessionalProfile();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { mutateAsync: createUpiOrder } = useCreateUpiVerificationOrder();
  const { mutateAsync: confirmUpi } = useConfirmUpiVerification();
  const [verifyingUpi, setVerifyingUpi] = useState(false);
  const typedSessions = sessions as SessionBookingWithDetails[];
  const completed = typedSessions.filter((s) => s.status === "completed");
  const sessionTotal = completed.reduce((sum, s) => sum + (s.amountInr ?? 0), 0);

  const paidSalaries = salaryPayments.filter((p) => p.status === "paid");
  const salaryTotal = paidSalaries.reduce((sum, p) => sum + p.netInr, 0);
  const totalEarnings = sessionTotal + salaryTotal;

  const thisMonthStr = new Date().toISOString().slice(0, 7);
  const thisMonthSalary = paidSalaries
    .filter((p) => p.month === thisMonthStr)
    .reduce((sum, p) => sum + p.netInr, 0);
  const thisMonthSession = completed
    .filter((s) => new Date(s.bookedDate).toISOString().slice(0, 7) === thisMonthStr)
    .reduce((sum, s) => sum + (s.amountInr ?? 0), 0);

  async function handleVerifyUpi() {
    setVerifyingUpi(true);
    try {
      const order = await createUpiOrder();
      const loaded = await loadRazorpayScript();
      if (!loaded) {
        toast({ title: "Could not load payment gateway", description: "Please check your connection and try again.", variant: "destructive" });
        setVerifyingUpi(false);
        return;
      }
      const rzp = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: "Includly",
        description: "UPI verification (₹1, auto-refunded)",
        order_id: order.orderId,
        method: { upi: true, card: false, netbanking: false, wallet: false, emi: false, paylater: false },
        handler: async (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
          try {
            const result = await confirmUpi({
              data: {
                razorpayPaymentId: response.razorpay_payment_id,
                razorpayOrderId: response.razorpay_order_id,
                razorpaySignature: response.razorpay_signature,
              },
            });
            await queryClient.invalidateQueries({ queryKey: getGetMyProfessionalProfileQueryKey() });
            toast({ title: "UPI verified", description: result.message || "Your ₹1 will be refunded automatically." });
          } catch (err: unknown) {
            toast({ title: "Verification failed", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
          } finally {
            setVerifyingUpi(false);
          }
        },
        modal: { ondismiss: () => setVerifyingUpi(false) },
        theme: { color: "#2EC4A5" },
      });
      rzp.open();
    } catch (err: unknown) {
      toast({ title: "Could not start verification", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
      setVerifyingUpi(false);
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-serif font-semibold text-[#1A2340]">My Earnings</h1>

      <div className="grid sm:grid-cols-3 gap-4">
        {[
          { label: "Total Earned (Net)", value: `₹${totalEarnings.toLocaleString("en-IN")}`, icon: <IndianRupee size={16} className="text-green-600" />, bg: "bg-green-50" },
          { label: "Salary Payments", value: paidSalaries.length, icon: <CalendarCheck size={16} className="text-[#2EC4A5]" />, bg: "bg-[#2EC4A5]/10" },
          { label: "This Month (Net)", value: `₹${(thisMonthSalary + thisMonthSession).toLocaleString("en-IN")}`, icon: <TrendingUp size={16} className="text-violet-600" />, bg: "bg-violet-50" },
        ].map((stat) => (
          <div key={stat.label} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-[0_4px_24px_rgba(26,35,64,0.08)]">
            <div className={`w-9 h-9 ${stat.bg} rounded-xl flex items-center justify-center mb-3`}>{stat.icon}</div>
            <p className="text-2xl font-bold font-serif text-[#1A2340]">{stat.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Payout Settings — verified UPI */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-[0_4px_24px_rgba(26,35,64,0.08)] space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-[#1A2340] flex items-center gap-2">
            <IndianRupee size={16} className="text-[#2EC4A5]" /> Payout Settings
          </h2>
          {profile?.upiVerifiedAt && (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-[11px] font-semibold text-green-700">
              <ShieldCheck size={12} /> Verified
            </span>
          )}
        </div>

        {profile?.upiVpa && profile?.upiVerifiedAt ? (
          <>
            <div>
              <Label className="text-xs text-gray-500">Verified UPI ID</Label>
              <Input
                value={profile.upiVpa}
                readOnly
                disabled
                className="mt-1 bg-gray-50 font-medium"
                data-testid="input-verified-upi"
              />
              <p className="text-[11px] text-gray-400 mt-1">
                Verified on {new Date(profile.upiVerifiedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}. Payouts are sent to this UPI ID.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleVerifyUpi}
              disabled={verifyingUpi}
              data-testid="button-reverify-upi"
            >
              {verifyingUpi ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <RefreshCw size={14} className="mr-1.5" />}
              Re-verify to change UPI ID
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-500">
              Verify your UPI ID to receive payouts. We charge ₹1 to confirm ownership — it's automatically refunded within a few days.
            </p>
            <Button
              type="button"
              onClick={handleVerifyUpi}
              disabled={verifyingUpi}
              className="bg-[#2EC4A5] hover:bg-[#28B090]"
              data-testid="button-verify-upi"
            >
              {verifyingUpi ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <ShieldCheck size={14} className="mr-1.5" />}
              Verify your UPI ID
            </Button>
          </>
        )}
        <p className="text-[11px] text-gray-400 leading-relaxed">
          We confirm UPI ownership with a ₹1 payment via Razorpay, which is refunded automatically. Your UPI ID is never shown to parents.
        </p>
      </div>

      {/* Shadow teacher salary payments */}
      <div className="space-y-3">
        <h2 className="font-semibold text-[#1A2340]">Shadow Teacher Salary</h2>
        {salaryLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-gray-400">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : salaryPayments.length === 0 ? (
          <div className="bg-white border border-gray-100 rounded-2xl p-8 text-center shadow-sm">
            <IndianRupee size={32} className="mx-auto mb-2 text-gray-300" />
            <p className="font-semibold text-gray-500">No salary payments yet</p>
            <p className="text-xs text-gray-400 mt-1">Salary history will appear here once a parent pays your monthly fee.</p>
          </div>
        ) : (
          <div className="bg-white border border-gray-100 rounded-2xl shadow-[0_4px_24px_rgba(26,35,64,0.08)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/70">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Month</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Gross</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Platform cut</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Trial credit</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Net (you receive)</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {salaryPayments.map((p) => (
                    <tr key={p.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-3 font-medium text-[#1A2340]">{p.month}</td>
                      <td className="px-4 py-3 text-right text-gray-600">₹{p.grossInr.toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-right text-gray-400">−₹{p.platformCutInr.toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-right text-gray-400">
                        {p.trialCreditInr > 0 ? `−₹${p.trialCreditInr.toLocaleString("en-IN")}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-green-700">
                        ₹{p.netInr.toLocaleString("en-IN")}
                      </td>
                      <td className="px-4 py-3">
                        {p.status === "paid" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700">
                            <CheckCircle2 size={10} /> Paid
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-[11px] font-semibold text-yellow-700">
                            <Clock size={10} /> Pending
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-gray-100 bg-gray-50/50 px-4 py-2.5">
              <p className="text-[11px] text-gray-400">
                Disbursements are processed manually by Includly. Contact support if a payment is overdue.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Session earnings (legacy) */}
      {completed.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-semibold text-[#1A2340]">Session Earnings</h2>
          <div className="bg-white border border-gray-100 rounded-2xl shadow-[0_4px_24px_rgba(26,35,64,0.08)] overflow-hidden">
            <div className="divide-y divide-gray-50">
              {completed.map((s) => (
                <div key={s.id} className="flex items-center gap-4 px-5 py-3.5">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[#1A2340]">{s.parentName ?? "Parent"}</p>
                    <p className="text-xs text-gray-400">{fmtDate(s.bookedDate)} · {s.durationMinutes} min</p>
                  </div>
                  <p className="text-sm font-semibold text-green-700">₹{s.amountInr ?? 0}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB: CERTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════════
function CertificationsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: certsRaw, isLoading } = useGetMyCertifications();
  const certs = (certsRaw as CertDoc[] | undefined) ?? [];
  const [certFileKey, setCertFileKey] = useState("");
  const [certDocType, setCertDocType] = useState("");
  const [uploading, setUploading] = useState(false);

  async function handleUpload() {
    if (!certFileKey) { toast({ title: "Please upload a file first", variant: "destructive" }); return; }
    setUploading(true);
    try {
      const res = await fetchWithAuth("/api/verifications/certifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentType: certDocType.trim() || "certificate", fileKey: certFileKey }),
      });
      if (!res.ok) throw new Error("Failed");
      queryClient.invalidateQueries({ queryKey: ["/api/verifications/certifications"] });
      setCertFileKey("");
      setCertDocType("");
      toast({ title: "Certification uploaded ✓" });
    } catch {
      toast({ title: "Could not upload certification", variant: "destructive" });
    } finally { setUploading(false); }
  }

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-[#2EC4A5]" /></div>;

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-serif font-semibold text-[#1A2340]">Certifications</h1>

      {/* Uploaded list */}
      {certs.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-8 text-center shadow-sm">
          <Award size={36} className="mx-auto mb-3 text-gray-300" />
          <p className="font-semibold text-gray-500">No certifications uploaded yet</p>
          <p className="text-sm text-gray-400 mt-1">Upload your qualifications, degrees, or professional certificates below.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-100 rounded-2xl shadow-[0_4px_24px_rgba(26,35,64,0.08)] overflow-hidden">
          <div className="divide-y divide-gray-50">
            {certs.map((cert) => (
              <div key={cert.id} className="flex items-center gap-4 px-5 py-4">
                <div className="w-9 h-9 rounded-xl bg-[#2EC4A5]/10 flex items-center justify-center shrink-0">
                  <FileText size={16} className="text-[#2EC4A5]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#1A2340] capitalize">{cert.documentType.replace(/_/g, " ")}</p>
                  <p className="text-xs text-gray-400">
                    Uploaded {new Date(cert.uploadedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                </div>
                <button
                  onClick={async () => {
                    try {
                      const res = await fetchWithAuth(`/api/storage/objects/${cert.fileKey.replace(/^\/objects\//, "")}`);
                      if (!res.ok) { toast({ title: "Could not load document", variant: "destructive" }); return; }
                      const blob = await res.blob();
                      const url = URL.createObjectURL(blob);
                      window.open(url, "_blank", "noopener");
                      setTimeout(() => URL.revokeObjectURL(url), 60_000);
                    } catch { toast({ title: "Failed to open document", variant: "destructive" }); }
                  }}
                  className="text-xs text-[#2EC4A5] hover:underline flex items-center gap-1 shrink-0"
                  aria-label="View certification"
                >
                  <Eye size={13} /> View
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upload new */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-[0_4px_24px_rgba(26,35,64,0.08)] space-y-4">
        <h2 className="font-semibold text-[#1A2340]">Upload New Certification</h2>
        <div>
          <Label className="text-sm">Certificate Name / Type</Label>
          <Input
            value={certDocType}
            onChange={(e) => setCertDocType(e.target.value)}
            placeholder="e.g. B.Ed Special Education, ASHA SLP Certification"
            className="mt-1 rounded-lg focus-visible:ring-[#2EC4A5]"
            aria-label="Certificate type"
          />
        </div>
        <div>
          <Label className="text-sm">File</Label>
          <div className="mt-1">
            <FileUploadField
              label="Choose file"
              onUploaded={setCertFileKey}
              uploadedPath={certFileKey}
              accept=".pdf,.jpg,.jpeg,.png"
            />
          </div>
        </div>
        <Button
          onClick={handleUpload}
          disabled={uploading || !certFileKey}
          className="w-full bg-[#2EC4A5] hover:bg-[#26a88d] text-white rounded-xl gap-2 focus-visible:ring-2 focus-visible:ring-[#2EC4A5]"
          aria-label="Upload certification"
          data-testid="upload-cert-btn"
        >
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <Award size={14} />}
          {uploading ? "Uploading…" : "Upload Certification"}
        </Button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB: ID VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════════
function VerificationTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: idVerification, isLoading } = useGetMyIdentityVerification();
  const [idDocType, setIdDocType] = useState("aadhar");
  const [idFileKey, setIdFileKey] = useState("");
  const [dpdpConsent, setDpdpConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-[#2EC4A5]" /></div>;

  const verif = idVerification as (typeof idVerification & { status?: string; documentType?: string; submittedAt?: string }) | null | undefined;

  const STATUS_UI: Record<string, { color: string; icon: React.ReactNode; label: string; desc: string }> = {
    pending: {
      color: "bg-amber-50 border-amber-200",
      icon: <Clock size={20} className="text-amber-600" />,
      label: "Under Review",
      desc: "Your ID document has been received and is being reviewed by our team. This typically takes 2–3 business days.",
    },
    verified: {
      color: "bg-green-50 border-green-200",
      icon: <BadgeCheck size={20} className="text-green-600" />,
      label: "Identity Verified",
      desc: "Your identity has been verified. A Verified badge is now shown on your public profile.",
    },
    rejected: {
      color: "bg-red-50 border-red-200",
      icon: <XCircle size={20} className="text-red-500" />,
      label: "Not Approved",
      desc: "Your document could not be verified. Please re-upload a clearer copy of your ID.",
    },
  };

  const statusUI = verif?.status ? STATUS_UI[verif.status] : null;

  async function handleSubmit() {
    if (!idFileKey) { toast({ title: "Please upload your ID document first", variant: "destructive" }); return; }
    if (!dpdpConsent) { toast({ title: "Please accept the consent to continue", variant: "destructive" }); return; }
    setSubmitting(true);
    try {
      const res = await fetchWithAuth("/api/verifications/identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentType: idDocType, fileKey: idFileKey, dpdpConsent }),
      });
      if (!res.ok) throw new Error("Failed");
      queryClient.invalidateQueries({ queryKey: ["/api/verifications/identity"] });
      queryClient.invalidateQueries({ queryKey: getGetMyProfessionalProfileQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetProfessionalDashboardQueryKey() });
      toast({ title: "Document submitted ✓", description: "We'll review within 2–3 business days." });
      setIdFileKey("");
      setDpdpConsent(false);
    } catch {
      toast({ title: "Could not submit document", variant: "destructive" });
    } finally { setSubmitting(false); }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-serif font-semibold text-[#1A2340]">ID Verification</h1>
      <p className="text-sm text-gray-500">A verified badge builds parent trust and boosts your visibility in search results.</p>

      {/* Current status */}
      {statusUI && verif && (
        <div className={`flex items-start gap-4 p-5 border rounded-2xl ${statusUI.color}`}>
          <div className="shrink-0 mt-0.5">{statusUI.icon}</div>
          <div>
            <p className="font-semibold text-[#1A2340]">{statusUI.label}</p>
            <p className="text-sm text-gray-600 mt-0.5">{statusUI.desc}</p>
            {verif.documentType && (
              <p className="text-xs text-gray-400 mt-2 capitalize">
                Document: {verif.documentType.replace(/_/g, " ")}
                {verif.submittedAt ? ` · Submitted ${new Date(verif.submittedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : ""}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Show upload form if not submitted or rejected */}
      {(!verif || verif.status === "rejected") && (
        <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-[0_4px_24px_rgba(26,35,64,0.08)] space-y-5">
          <h2 className="font-semibold text-[#1A2340]">{verif?.status === "rejected" ? "Re-submit ID Document" : "Submit ID Document"}</h2>

          <div>
            <Label className="text-sm">Document Type</Label>
            <select
              value={idDocType}
              onChange={(e) => setIdDocType(e.target.value)}
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2EC4A5]"
              aria-label="ID document type"
              data-testid="id-doc-type-select"
            >
              <option value="aadhar">Aadhaar Card (India)</option>
              <option value="passport">Passport</option>
              <option value="driving_licence">Driving Licence</option>
              <option value="national_id">National ID</option>
            </select>
          </div>

          <div>
            <Label className="text-sm">Upload Document</Label>
            <div className="mt-1">
              <FileUploadField
                label="Choose ID document"
                onUploaded={setIdFileKey}
                uploadedPath={idFileKey}
                accept=".pdf,.jpg,.jpeg,.png"
              />
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-amber-900">Data Processing Consent — DPDP Act 2023</p>
            <p className="text-xs text-amber-800 leading-relaxed">
              Your ID document is collected solely for professional verification on Includly, stored securely, and will not be shared with third parties. You may request deletion at any time via Account Settings.
            </p>
            <div className="flex items-start gap-2">
              <Checkbox
                id="dpdp-consent"
                checked={dpdpConsent}
                onCheckedChange={(v) => setDpdpConsent(v === true)}
                data-testid="dpdp-consent-checkbox"
              />
              <label htmlFor="dpdp-consent" className="text-xs text-amber-900 leading-relaxed cursor-pointer">
                I consent to Includly processing my identity document for verification as described above.
              </label>
            </div>
          </div>

          <Button
            onClick={handleSubmit}
            disabled={submitting || !idFileKey || !dpdpConsent}
            className="w-full bg-[#2EC4A5] hover:bg-[#26a88d] text-white rounded-xl gap-2 focus-visible:ring-2 focus-visible:ring-[#2EC4A5]"
            aria-label="Submit identity verification"
            data-testid="submit-verification-btn"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
            {submitting ? "Submitting…" : "Submit for Verification"}
          </Button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB: NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════════
function NotificationsTab() {
  const queryClient = useQueryClient();
  const { data: notifications, isLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => fetchWithAuth("/api/notifications").then((r) => r.json()) as Promise<unknown>,
    select: (d: unknown): Notification[] => Array.isArray(d) ? d as Notification[] : ((d as { notifications?: Notification[] })?.notifications ?? []),
  });

  async function markRead(id: number) {
    await fetchWithAuth(`/api/notifications/${id}/read`, { method: "PATCH" });
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  }
  async function markAllRead() {
    await fetchWithAuth("/api/notifications/read-all", { method: "PATCH" });
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  }

  const unreadCount = (notifications ?? []).filter((n) => !n.isRead).length;

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-[#2EC4A5]" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-serif font-semibold text-[#1A2340]">
          Notifications {unreadCount > 0 && <span className="text-sm font-normal text-gray-400">({unreadCount} unread)</span>}
        </h1>
        {unreadCount > 0 && (
          <Button variant="ghost" size="sm" className="text-xs text-[#2EC4A5] gap-1" onClick={markAllRead} aria-label="Mark all notifications as read">
            <Check size={13} /> Mark all read
          </Button>
        )}
      </div>

      {(!notifications || notifications.length === 0) ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center shadow-sm">
          <Bell size={36} className="mx-auto mb-3 text-gray-300" />
          <p className="font-semibold text-gray-500">No notifications yet</p>
          <p className="text-sm text-gray-400 mt-1">You'll be notified here for new bookings, reviews, and verification updates.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-100 rounded-2xl divide-y divide-gray-50 shadow-[0_4px_24px_rgba(26,35,64,0.08)]">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`flex items-start gap-3 px-5 py-4 cursor-pointer transition-colors ${!n.isRead ? "bg-[#2EC4A5]/5 hover:bg-[#2EC4A5]/10" : "hover:bg-gray-50"}`}
              onClick={() => !n.isRead && markRead(n.id)}
            >
              <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${n.isRead ? "bg-transparent" : "bg-[#2EC4A5]"}`} />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${n.isRead ? "text-gray-600" : "text-[#1A2340]"}`}>{n.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">{n.body}</p>
              </div>
              <span className="text-xs text-gray-400 shrink-0">{timeAgo(n.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB: MESSAGES
// ═══════════════════════════════════════════════════════════════════════════════
interface ConnectThread { id: number; parentId: number; parentName: string | null; childId: number | null; childName: string | null; createdAt: string; }
interface ConnectMessage { id: number; threadId: number; senderId: number; senderName: string | null; body: string; createdAt: string; }

function MessagesTab() {
  const { data: me } = useGetMe();
  const { toast } = useToast();
  const [threads, setThreads] = useState<ConnectThread[]>([]);
  const [selectedThread, setSelectedThread] = useState<ConnectThread | null>(null);
  const [messages, setMessages] = useState<ConnectMessage[]>([]);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);

  useEffect(() => {
    fetchWithAuth("/api/connect/inbox")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setThreads(data); })
      .catch(() => {})
      .finally(() => setLoadingThreads(false));
  }, []);

  async function openThread(thread: ConnectThread) {
    setSelectedThread(thread);
    setMessages([]);
    setLoadingMessages(true);
    try {
      const res = await fetchWithAuth(`/api/connect/thread/${thread.id}/messages`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.messages)) setMessages(data.messages);
      }
    } catch { }
    finally { setLoadingMessages(false); }
  }

  async function send() {
    if (!body.trim() || !selectedThread) return;
    setSending(true);
    try {
      const res = await fetchWithAuth(`/api/connect/thread/${selectedThread.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: body.trim() }),
      });
      const msg = await res.json();
      if (!res.ok) { toast({ title: msg.error ?? "Could not send", variant: "destructive" }); return; }
      setMessages((prev) => [...prev, msg]);
      setBody("");
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  if (loadingThreads) return <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-[#2EC4A5]" /></div>;

  if (selectedThread) {
    return (
      <div className="flex flex-col gap-4" style={{ height: "calc(100vh - 160px)" }}>
        <button onClick={() => { setSelectedThread(null); setMessages([]); }} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#2EC4A5] transition-colors w-fit">
          <ChevronLeft size={16} /> Back to inbox
        </button>
        <div>
          <h2 className="font-serif font-semibold text-[#1A2340] text-lg">{selectedThread.childName ?? selectedThread.parentName ?? "Parent"}</h2>
          {selectedThread.childName && <p className="text-xs text-gray-400 mt-0.5">Parent: {selectedThread.parentName ?? "—"}</p>}
        </div>

        <div className="flex-1 overflow-y-auto bg-gray-50 rounded-2xl p-4 space-y-3 min-h-0">
          {loadingMessages && <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-[#2EC4A5]" /></div>}
          {!loadingMessages && messages.length === 0 && (
            <div className="text-center py-8 text-gray-400">
              <MessageSquare size={28} className="mx-auto mb-2 text-gray-300" />
              <p className="text-sm">No messages yet. Start the conversation!</p>
            </div>
          )}
          {messages.map((msg) => {
            const isMe = msg.senderId === (me as any)?.id;
            return (
              <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${isMe ? "bg-[#2EC4A5] text-white rounded-br-sm" : "bg-white border border-gray-100 text-gray-800 rounded-bl-sm shadow-sm"}`}>
                  {!isMe && <p className="text-[10px] font-semibold mb-0.5 opacity-60">{msg.senderName ?? "Parent"}</p>}
                  <p>{msg.body}</p>
                  <p className={`text-[10px] mt-1 ${isMe ? "opacity-70" : "text-gray-400"}`}>{timeAgo(msg.createdAt)}</p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex gap-2 pb-2">
          <input
            type="text"
            placeholder="Type a message…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2EC4A5]"
          />
          <Button onClick={send} disabled={sending || !body.trim()} className="bg-[#2EC4A5] hover:bg-[#26a98d] text-white px-4 shrink-0">
            {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-serif font-semibold text-[#1A2340]">Messages</h1>
      {threads.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-10 text-center shadow-sm">
          <MessageSquare size={36} className="mx-auto mb-3 text-gray-300" />
          <p className="font-semibold text-gray-600">No messages yet</p>
          <p className="text-sm text-gray-400 mt-1">Parents who have unlocked your contact will appear here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {threads.map((thread) => (
            <button
              key={thread.id}
              onClick={() => openThread(thread)}
              className="w-full bg-white border border-gray-100 rounded-2xl p-4 shadow-[0_2px_12px_rgba(26,35,64,0.06)] flex items-center gap-3 hover:border-[#2EC4A5]/40 transition-colors text-left"
            >
              <div className="w-10 h-10 rounded-full bg-[#2EC4A5]/10 flex items-center justify-center shrink-0">
                <span className="text-sm font-bold text-[#2EC4A5]">{(thread.childName ?? thread.parentName ?? "P")[0]?.toUpperCase()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-[#1A2340] text-sm">{thread.childName ?? thread.parentName ?? "Parent"}</p>
                <p className="text-xs text-gray-400 mt-0.5">{thread.childName ? `Parent: ${thread.parentName ?? "—"}` : "Tap to open conversation"}</p>
              </div>
              <ChevronRight size={16} className="text-gray-300 shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB: ENGAGEMENT (Shadow Teacher)
// ═══════════════════════════════════════════════════════════════════════════════
function EngagementTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: me } = useGetMe();
  const { data: profile } = useGetMyProfessionalProfile();
  const myUserId = (me as { id?: number } | undefined)?.id ?? 0;

  interface STEngagement {
    id: number;
    parentId: number;
    childId: number | null;
    tier: string | null;
    startDate: string;
    monthlyFeeInr: string;
    status: string;
    notes: string | null;
    parentName: string | null;
    childName: string | null;
    matchRequestId: number | null;
    candidateId: number | null;
    childConditions: string[] | null;
    childLanguages: string[] | null;
    childCity: string | null;
    childConsent: { media?: boolean } | null;
    endDate?: string | null;
    endedReason?: string | null;
    platformSalaryEnabled?: boolean;
    placementFeeInr?: number | null;
    activationFeeInr?: number | null;
  }

  interface DailyLog {
    id: number;
    logDate: string;
    authorRole: string;
    authorUserId: number;
    content: string;
    createdAt: string;
    updatedAt: string;
    authorName: string | null;
    signedPhotoUrl?: string | null;
  }

  interface ChildGoal {
    id: number;
    childId: number;
    engagementId: number | null;
    createdByUserId: number;
    label: string;
    category: string | null;
    isActive: boolean;
  }
  interface LifecycleRequest {
    id: number;
    type: string;
    status: string;
    raisedByUserId: number;
    raisedByRole: string;
    raisedAt: string;
    reason: string | null;
  }

  // ── Engagement selection ───────────────────────────────────────────────────
  const [selectedEngId, setSelectedEngId] = useState<number | null>(null);
  const [engTab, setEngTab] = useState<"overview" | "child" | "log" | "trends" | "lifecycle">("overview");
  const [chatOpen, setChatOpen] = useState(false);

  const { data: engagements = [], isLoading } = useQuery<STEngagement[]>({
    queryKey: ["pro-engagements"],
    queryFn: () => fetchWithAuth("/api/engagements").then(r => r.json()),
  });

  const activeList = engagements.filter(e => ["pending_teacher_acceptance", "pending_activation_fee", "pending_start", "active", "notice_period", "paused"].includes(e.status));
  const active = (selectedEngId ? engagements.find(e => e.id === selectedEngId) : null) ?? activeList[0] ?? null;

  const pendingStartDisabledEngTabs = new Set(["child", "log", "trends"]);
  const isPreStartStatus = active?.status === "pending_start" || active?.status === "pending_teacher_acceptance" || active?.status === "pending_activation_fee";
  const visibleEngTab: typeof engTab =
    (isPreStartStatus && pendingStartDisabledEngTabs.has(engTab)) ||
    (active?.status === "ended" && engTab === "lifecycle")
      ? "overview" : engTab;

  // ── Logs ───────────────────────────────────────────────────────────────────
  const { data: logs = [] } = useQuery<DailyLog[]>({
    queryKey: ["pro-engagement-logs", active?.id],
    queryFn: () => fetchWithAuth(`/api/engagements/${active!.id}/daily-logs`).then(r => { if (!r.ok) throw new Error(r.statusText); return r.json() as Promise<DailyLog[]>; }),
    enabled: !!active,
  });

  // ── Goals ─────────────────────────────────────────────────────────────────
  const { data: goals = [], refetch: refetchGoals } = useQuery<ChildGoal[]>({
    queryKey: ["child-goals", active?.childId],
    queryFn: () => fetchWithAuth(`/api/children/${active!.childId}/goals`).then(r => { if (!r.ok) throw new Error(r.statusText); return r.json() as Promise<ChildGoal[]>; }),
    enabled: !!active?.childId && (engTab === "child" || engTab === "log"),
  });

  // ── Lifecycle requests ─────────────────────────────────────────────────────
  const { data: lifecycleRequests = [] } = useQuery<LifecycleRequest[]>({
    queryKey: ["engagement-lifecycle", active?.id],
    queryFn: () => fetchWithAuth(`/api/engagements/${active!.id}/lifecycle`).then(r => { if (!r.ok) throw new Error(r.statusText); return r.json() as Promise<LifecycleRequest[]>; }),
    enabled: !!active,
  });

  const pendingPR = lifecycleRequests.find(r => ["pause", "resume"].includes(r.type) && r.status === "pending") ?? null;
  const iAmPRRequester = myUserId > 0 && pendingPR?.raisedByUserId === myUserId;

  // ── Teacher acceptance state ────────────────────────────────────────────────
  const [submittingAcceptance, setSubmittingAcceptance] = useState(false);
  const [acceptanceSchedule, setAcceptanceSchedule] = useState<RecurringScheduleSlot[]>([]);
  const [acceptanceTermsChecked, setAcceptanceTermsChecked] = useState(false);

  const { data: shadowTeacherPricing } = useQuery<{ noticePeriodDays: number }>({
    queryKey: ["shadow-teacher-pricing-notice"],
    queryFn: async () => {
      const res = await fetch(`${getApiBase()}/shadow-teacher/pricing`);
      return res.json() as Promise<{ noticePeriodDays: number }>;
    },
    staleTime: 5 * 60_000,
  });

  async function handleTeacherAcceptance(action: "accept" | "decline") {
    if (!active) return;
    if (action === "accept" && acceptanceSchedule.length === 0) {
      toast({ title: "Add your weekly commitment before accepting", variant: "destructive" });
      return;
    }
    if (action === "accept" && !acceptanceTermsChecked) {
      toast({ title: "Please agree to the terms of engagement before accepting", variant: "destructive" });
      return;
    }
    setSubmittingAcceptance(true);
    try {
      const res = await fetchWithAuth(`/api/engagements/${active.id}/teacher-acceptance`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "accept" ? { action, recurringSchedule: acceptanceSchedule, termsAcknowledged: acceptanceTermsChecked } : { action }),
      });
      if (!res.ok) { const e = await res.json() as { error?: string }; throw new Error(e.error ?? "Failed"); }
      queryClient.invalidateQueries({ queryKey: ["pro-engagements"] });
      toast({ title: action === "accept" ? "Engagement accepted ✓" : "Engagement declined" });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Failed", variant: "destructive" });
    } finally { setSubmittingAcceptance(false); }
  }

  // ── Activation fee payment (pending_activation_fee status) ─────────────────
  const [payingActivationFee, setPayingActivationFee] = useState(false);

  async function handlePayActivationFee() {
    if (!active) return;
    setPayingActivationFee(true);
    try {
      const orderRes = await fetchWithAuth(`/api/engagements/${active.id}/activation-fee/order`, { method: "POST" });
      const orderData = await orderRes.json() as { error?: string; orderId?: string; amount?: number; keyId?: string; resuming?: boolean };
      if (!orderRes.ok) { toast({ title: orderData.error ?? "Could not start payment", variant: "destructive" }); return; }
      if (!orderData.orderId || !orderData.amount || !orderData.keyId) { toast({ title: "Invalid payment response", variant: "destructive" }); return; }

      const loaded = await loadRazorpayScript();
      if (!loaded) { toast({ title: "Payment gateway unavailable", variant: "destructive" }); return; }

      await new Promise<void>((resolve, reject) => {
        const rzp = new window.Razorpay({
          key: orderData.keyId!,
          amount: orderData.amount!,
          currency: "INR",
          order_id: orderData.orderId!,
          name: "Includly",
          description: "One-time activation fee",
          handler: async (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
            try {
              const vRes = await fetchWithAuth(`/api/engagements/${active.id}/activation-fee/verify`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  razorpayOrderId: response.razorpay_order_id,
                  razorpayPaymentId: response.razorpay_payment_id,
                  razorpaySignature: response.razorpay_signature,
                }),
              });
              const vd = await vRes.json() as { error?: string; status?: string };
              if (!vRes.ok) { toast({ title: vd.error ?? "Payment verification failed", variant: "destructive" }); reject(new Error("verify")); return; }
              toast({ title: "Activation fee paid ✓", description: "You can now enter the parent's start code to activate the engagement." });
              queryClient.invalidateQueries({ queryKey: ["pro-engagements"] });
              resolve();
            } catch { reject(new Error("verify")); }
          },
          modal: { ondismiss: () => reject(new Error("dismissed")) },
          theme: { color: "#2EC4A5" },
        });
        rzp.open();
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (msg !== "dismissed") toast({ title: "Could not complete payment", description: msg, variant: "destructive" });
    } finally {
      setPayingActivationFee(false);
    }
  }

  // ── Direct-pay salary confirmations (platformSalaryEnabled === false) ──────
  interface SalaryConfirmation {
    id: number;
    engagementId: number;
    month: string;
    amountInr: number;
    markedPaidAt: string;
    confirmedAt: string | null;
  }
  const { data: salaryConfirmations = [] } = useQuery<SalaryConfirmation[]>({
    queryKey: ["salary-confirmations", active?.id],
    queryFn: () => fetchWithAuth(`/api/engagements/${active!.id}/salary-confirmations`).then(r => { if (!r.ok) throw new Error(r.statusText); return r.json() as Promise<SalaryConfirmation[]>; }),
    enabled: !!active && active.platformSalaryEnabled === false,
  });
  const [confirmingSalaryId, setConfirmingSalaryId] = useState<number | null>(null);

  async function handleConfirmSalaryReceipt(confId: number) {
    if (!active) return;
    setConfirmingSalaryId(confId);
    try {
      const res = await fetchWithAuth(`/api/engagements/${active.id}/salary-confirmations/${confId}/confirm`, { method: "POST" });
      if (!res.ok) { const e = await res.json() as { error?: string }; throw new Error(e.error ?? "Failed to confirm"); }
      queryClient.invalidateQueries({ queryKey: ["salary-confirmations", active.id] });
      toast({ title: "Receipt confirmed ✓" });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Failed", variant: "destructive" });
    } finally {
      setConfirmingSalaryId(null);
    }
  }

  // ── Goal management state ──────────────────────────────────────────────────
  const [newGoalLabel, setNewGoalLabel] = useState("");
  const [newGoalCategory, setNewGoalCategory] = useState("");
  const [addingGoal, setAddingGoal] = useState(false);
  const [savingGoal, setSavingGoal] = useState(false);

  async function handleAddGoal() {
    if (!active?.childId || !newGoalLabel.trim()) return;
    setSavingGoal(true);
    try {
      await fetchWithAuth(`/api/children/${active.childId}/goals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: newGoalLabel.trim(),
          category: newGoalCategory.trim() || undefined,
          engagementId: active.id,
        }),
      });
      void refetchGoals();
      setNewGoalLabel(""); setNewGoalCategory(""); setAddingGoal(false);
      toast({ title: "Goal added ✓" });
    } catch { toast({ title: "Failed to add goal", variant: "destructive" }); }
    finally { setSavingGoal(false); }
  }

  async function handleToggleGoal(goalId: number, isActive: boolean) {
    if (!active?.childId) return;
    await fetchWithAuth(`/api/children/${active.childId}/goals/${goalId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !isActive }),
    });
    void refetchGoals();
  }

  // ── Daily log form state ───────────────────────────────────────────────────
  const PROMPT_LEVELS = [
    { id: "independent",    label: "Independent",  color: "bg-green-100 text-green-700 border-green-300" },
    { id: "visual_prompt",  label: "Visual ✓",     color: "bg-yellow-100 text-yellow-700 border-yellow-300" },
    { id: "verbal_prompt",  label: "Verbal",        color: "bg-amber-100 text-amber-700 border-amber-300" },
    { id: "modeling",       label: "Modeling",      color: "bg-orange-100 text-orange-700 border-orange-300" },
    { id: "physical_assist", label: "Physical",     color: "bg-red-100 text-red-700 border-red-300" },
  ] as const;

  const DEFAULT_BEHAVIORS = ["Hand raising", "Peer interactions", "Sensory breaks"];

  const [tickedGoals, setTickedGoals] = useState<Set<number>>(new Set());
  const [goalLevels, setGoalLevels] = useState<Record<number, string>>({});
  const [logMoodNote, setLogMoodNote] = useState("");
  const [reteachNote, setReteachNote] = useState("");
  const [behaviorOpen, setBehaviorOpen] = useState(false);
  const [behaviorCounts, setBehaviorCounts] = useState<{ label: string; count: number }[]>(
    DEFAULT_BEHAVIORS.map(l => ({ label: l, count: 0 }))
  );
  const [durationOpen, setDurationOpen] = useState(false);
  const [focusMinutes, setFocusMinutes] = useState("");
  const [photoKey, setPhotoKey] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [postingLog, setPostingLog] = useState(false);
  const [logSubmitted, setLogSubmitted] = useState<{ matchId: number; candidateId: number; snippet: string } | null>(null);
  const [sharingToChat, setSharingToChat] = useState(false);

  // ── Lifecycle state ────────────────────────────────────────────────────────
  const [lifecycleType, setLifecycleType] = useState<"stop" | "pause" | "">("");
  const [lifecycleNotes, setLifecycleNotes] = useState("");
  const [postingLifecycle, setPostingLifecycle] = useState(false);

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    try {
      const res = await fetchWithAuth("/api/storage/uploads/request-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type || "image/jpeg" }),
      });
      const { uploadURL, objectPath } = await res.json() as { uploadURL: string; objectPath: string };
      await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      setPhotoKey(objectPath);
      toast({ title: "Photo uploaded ✓" });
    } catch { toast({ title: "Photo upload failed", variant: "destructive" }); }
    finally { setUploadingPhoto(false); }
  }

  function resetLogForm() {
    setTickedGoals(new Set()); setGoalLevels({}); setLogMoodNote(""); setReteachNote("");
    setBehaviorOpen(false); setBehaviorCounts(DEFAULT_BEHAVIORS.map(l => ({ label: l, count: 0 })));
    setDurationOpen(false); setFocusMinutes(""); setPhotoKey(null); setLogSubmitted(null);
  }

  async function handlePostLog() {
    if (!active) return;
    setPostingLog(true);
    try {
      const goalRatings = Array.from(tickedGoals).map(gid => {
        const goal = goals.find(g => g.id === gid);
        return { goalId: gid, label: goal?.label ?? "", level: goalLevels[gid] ?? "verbal_prompt" };
      });
      const usedCounts = behaviorCounts.filter(b => b.count > 0);
      const parsedMins = parseInt(focusMinutes, 10);
      const durations = focusMinutes && !isNaN(parsedMins) ? [{ label: "Sustained focus", minutes: parsedMins }] : [];

      const snippet = goalRatings.length > 0
        ? `Milestone update: ${goalRatings.map(gr => `${gr.label} (${gr.level.replace(/_/g, " ")})`).join(", ")}.`
        : logMoodNote.trim()
          ? `Session update: ${logMoodNote.trim().slice(0, 80)}`
          : "Session log posted.";

      const res = await fetchWithAuth(`/api/engagements/${active.id}/daily-logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          logDate: new Date().toISOString().slice(0, 10),
          content: {
            behaviorMood:   logMoodNote.trim()        || undefined,
            reteachAtHome:  reteachNote.trim()        || undefined,
            goalRatings:    goalRatings.length > 0    ? goalRatings  : undefined,
            behaviorCounts: usedCounts.length > 0     ? usedCounts   : undefined,
            durations:      durations.length > 0      ? durations    : undefined,
            photoKey:       photoKey                  ?? undefined,
          },
        }),
      });

      if (!res.ok) {
        const d = await res.json() as { error?: string };
        toast({ title: d.error ?? "Failed to submit log", variant: "destructive" });
        return;
      }

      queryClient.invalidateQueries({ queryKey: ["pro-engagement-logs", active.id] });
      toast({ title: "Daily log submitted ✓" });

      if (active.matchRequestId && active.candidateId) {
        setLogSubmitted({ matchId: active.matchRequestId, candidateId: active.candidateId, snippet });
      } else {
        resetLogForm();
      }
    } catch { toast({ title: "Failed to submit log", variant: "destructive" }); }
    finally { setPostingLog(false); }
  }

  async function handleShareToChat() {
    if (!logSubmitted) return;
    setSharingToChat(true);
    try {
      await fetchWithAuth(`/api/shadow-teacher/${logSubmitted.matchId}/thread/${logSubmitted.candidateId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: logSubmitted.snippet }),
      });
      toast({ title: "Shared to parent chat ✓" });
    } catch { toast({ title: "Share failed", variant: "destructive" }); }
    finally { setSharingToChat(false); resetLogForm(); }
  }

  async function handleProRequestPause() {
    if (!active) return;
    setPostingLifecycle(true);
    try {
      const resp = await fetchWithAuth(`/api/engagements/${active.id}/lifecycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "pause" }),
      });
      if (!resp.ok) { const e = await resp.json() as { error?: string }; throw new Error(e.error ?? "Failed to submit"); }
      queryClient.invalidateQueries({ queryKey: ["engagement-lifecycle", active.id] });
      toast({ title: "Pause request sent — waiting for parent to respond" });
    } catch (err) { toast({ title: err instanceof Error ? err.message : "Failed", variant: "destructive" }); }
    finally { setPostingLifecycle(false); }
  }

  async function handleProRequestResume() {
    if (!active) return;
    setPostingLifecycle(true);
    try {
      const resp = await fetchWithAuth(`/api/engagements/${active.id}/lifecycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "resume" }),
      });
      if (!resp.ok) { const e = await resp.json() as { error?: string }; throw new Error(e.error ?? "Failed to submit"); }
      queryClient.invalidateQueries({ queryKey: ["engagement-lifecycle", active.id] });
      toast({ title: "Resume request sent — waiting for parent to respond" });
    } catch (err) { toast({ title: err instanceof Error ? err.message : "Failed", variant: "destructive" }); }
    finally { setPostingLifecycle(false); }
  }

  async function handleProConsentPR(status: "approved" | "rejected") {
    if (!active || !pendingPR) return;
    setPostingLifecycle(true);
    try {
      const resp = await fetchWithAuth(`/api/engagements/${active.id}/lifecycle/${pendingPR.id}/consent`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!resp.ok) { const e = await resp.json() as { error?: string }; throw new Error(e.error ?? "Failed"); }
      queryClient.invalidateQueries({ queryKey: ["engagement-lifecycle", active.id] });
      queryClient.invalidateQueries({ queryKey: ["pro-engagements"] });
      toast({ title: status === "approved" ? "Request accepted ✓" : "Request rejected" });
    } catch (err) { toast({ title: err instanceof Error ? err.message : "Failed", variant: "destructive" }); }
    finally { setPostingLifecycle(false); }
  }

  async function handleProWithdrawPR() {
    if (!active || !pendingPR) return;
    setPostingLifecycle(true);
    try {
      const resp = await fetchWithAuth(`/api/engagements/${active.id}/lifecycle/${pendingPR.id}`, {
        method: "DELETE",
      });
      if (!resp.ok && resp.status !== 204) { const e = await resp.json() as { error?: string }; throw new Error(e.error ?? "Failed"); }
      queryClient.invalidateQueries({ queryKey: ["engagement-lifecycle", active.id] });
      toast({ title: "Request withdrawn" });
    } catch (err) { toast({ title: err instanceof Error ? err.message : "Failed", variant: "destructive" }); }
    finally { setPostingLifecycle(false); }
  }

  async function handleLifecycleRequest() {
    if (!active || !lifecycleType) return;
    setPostingLifecycle(true);
    try {
      await fetchWithAuth(`/api/engagements/${active.id}/lifecycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: lifecycleType,
          reason: lifecycleNotes || undefined,
        }),
      });
      queryClient.invalidateQueries({ queryKey: ["pro-engagements"] });
      setLifecycleType(""); setLifecycleNotes("");
      toast({ title: "Request submitted ✓" });
    } catch { toast({ title: "Failed to submit", variant: "destructive" }); }
    finally { setPostingLifecycle(false); }
  }

  if (isLoading) {
    return <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-14 bg-white rounded-xl animate-pulse shadow-sm" />)}</div>;
  }

  if (!active) {
    return (
      <div className="text-center py-20">
        <div className="w-16 h-16 bg-[#2EC4A5]/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <IndianRupee size={28} className="text-[#2EC4A5]" />
        </div>
        <h3 className="text-lg font-bold text-[#1A2340] mb-1">No Active Engagement</h3>
        <p className="text-sm text-gray-400 max-w-xs mx-auto">The admin will assign an engagement when a parent selects you as their shadow teacher.</p>
      </div>
    );
  }

  const TREND_RANK: Record<string, number> = { independent: 5, visual_prompt: 4, verbal_prompt: 3, modeling: 2, physical_assist: 1 };
  const TREND_BG: Record<string, string> = { independent: "bg-green-400", visual_prompt: "bg-yellow-400", verbal_prompt: "bg-amber-400", modeling: "bg-orange-400", physical_assist: "bg-red-400" };
  const _tLogs = [...logs].filter(l => l.authorRole === "teacher").sort((a, b) => a.logDate.localeCompare(b.logDate)).map(l => { let c: Record<string, unknown> = {}; try { c = JSON.parse(l.content) as Record<string, unknown>; } catch {} return { date: l.logDate.slice(5), c }; });
  const trendGoalMap: Record<string, { label: string; pts: { date: string; rank: number; level: string }[] }> = {};
  _tLogs.forEach(({ date, c }) => { ((c["goalRatings"] as { goalId: number; label: string; level: string }[] | undefined) ?? []).forEach(gr => { const k = String(gr.goalId); if (!trendGoalMap[k]) trendGoalMap[k] = { label: gr.label, pts: [] }; trendGoalMap[k].pts.push({ date, rank: TREND_RANK[gr.level] ?? 3, level: gr.level }); }); });
  const trendBehavMap: Record<string, { date: string; count: number }[]> = {};
  _tLogs.forEach(({ date, c }) => { ((c["behaviorCounts"] as { label: string; count: number }[] | undefined) ?? []).filter(b => b.count > 0).forEach(b => { if (!trendBehavMap[b.label]) trendBehavMap[b.label] = []; trendBehavMap[b.label].push({ date, count: b.count }); }); });
  const trendDurData = _tLogs.flatMap(({ date, c }) => { const tot = ((c["durations"] as { label: string; minutes: number }[] | undefined) ?? []).reduce((s, d) => s + d.minutes, 0); return tot > 0 ? [{ date, minutes: tot }] : []; });
  const trendGoalEntries = Object.entries(trendGoalMap);
  const trendBehavEntries = Object.entries(trendBehavMap);
  const hasTrendData = trendGoalEntries.length > 0 || trendBehavEntries.length > 0 || trendDurData.length > 0;
  const trendMaxMins = trendDurData.length > 0 ? Math.max(...trendDurData.map(d => d.minutes), 1) : 1;

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayLogged = logs.some(l => l.logDate === todayStr && l.authorRole === "teacher");
  const mediaConsent = active.childConsent?.media === true;
  const activeGoals = goals.filter(g => g.isActive);

  return (
    <div className="space-y-5">
      {/* Multi-engagement switcher */}
      {engagements.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {engagements.map(e => (
            <button key={e.id}
              onClick={() => { setSelectedEngId(e.id); setEngTab("overview"); resetLogForm(); }}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                active.id === e.id
                  ? "bg-[#1A2340] text-white border-[#1A2340]"
                  : "bg-white text-gray-500 border-gray-200 hover:border-gray-400"
              }`}>
              {e.childName ?? `Eng #${e.id}`}
              <span className="ml-1.5 opacity-60">{e.status.replace(/_/g, " ")}</span>
            </button>
          ))}
        </div>
      )}

      {/* Header card */}
      <div className="bg-gradient-to-br from-[#1A2340] to-[#2d3a5c] rounded-2xl p-5 text-white">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide opacity-60">Active Engagement</p>
            <p className="text-xl font-bold mt-1">{active.childName ?? `Child #${active.childId}`}</p>
            {active.parentName && <p className="text-sm opacity-70 mt-0.5">Parent: {active.parentName}</p>}
            {active.childCity && <p className="text-sm opacity-50 mt-0.5">{active.childCity}</p>}
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-white/15 uppercase tracking-wide">
              {active.status.replace(/_/g, " ")}
            </span>
            {active.matchRequestId && active.candidateId && (
              <button onClick={() => setChatOpen(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/20 text-xs font-medium transition-colors">
                <MessageSquare size={11} />Chat
              </button>
            )}
          </div>
        </div>
        <div className="mt-4 flex items-center gap-4 text-sm flex-wrap">
          <div><span className="opacity-60">My Salary</span><br /><strong>₹{Number(active.monthlyFeeInr).toLocaleString("en-IN")}/mo</strong></div>
          <div className="w-px h-8 bg-white/15" />
          <div><span className="opacity-60">Since</span><br /><strong>{new Date(active.startDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</strong></div>
          {active.tier && <><div className="w-px h-8 bg-white/15" /><div><span className="opacity-60">Tier</span><br /><strong>{active.tier}</strong></div></>}
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 overflow-x-auto">
        {([["overview", "Overview"], ["child", "Child & Goals"], ["log", "Daily Log"], ["trends", "Trends"], ["lifecycle", "Manage"]] as [string, string][])
          .filter(([id]) =>
            !(active.status === "ended" && id === "lifecycle") &&
            !((active.status === "pending_teacher_acceptance" || active.status === "pending_activation_fee") && id === "lifecycle")
          )
          .map(([id, label]) => {
            const isPendingDisabled = (active.status === "pending_start" || active.status === "pending_teacher_acceptance" || active.status === "pending_activation_fee") && pendingStartDisabledEngTabs.has(id);
            return isPendingDisabled ? (
              <button key={id} disabled title="Available once the engagement starts"
                className="px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap text-gray-300 cursor-not-allowed select-none">
                {label}
              </button>
            ) : (
              <button key={id} onClick={() => setEngTab(id as typeof engTab)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${engTab === id ? "bg-white text-[#1A2340] shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
                {label}
              </button>
            );
          })}
      </div>

      {/* ── Overview ── */}
      {visibleEngTab === "overview" && (
        <div className="space-y-4">
          {active.status === "pending_teacher_acceptance" && (() => {
            const isDirectPay = active.platformSalaryEnabled === false;
            const needsUpiVerification = isDirectPay && !profile?.upiVerifiedAt;
            return (
              <div className="bg-white rounded-xl p-5 shadow-[0_2px_12px_rgba(26,35,64,0.06)] space-y-4">
                <p className="text-sm font-bold text-[#1A2340]">New Engagement — Your Response Needed</p>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Parent</span>
                    <span className="font-semibold text-[#1A2340]">{active.parentName ?? "—"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Proposed start</span>
                    <span className="font-semibold text-[#1A2340]">
                      {new Date(active.startDate + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Agreed monthly fee</span>
                    <span className="font-semibold text-[#1A2340]">₹{parseFloat(active.monthlyFeeInr).toLocaleString("en-IN")}</span>
                  </div>
                </div>
                <p className="text-xs text-gray-500">
                  By accepting you commit to starting on the proposed date and entering the parent's start code to activate the engagement.
                </p>
                <TeacherScheduleEditor slots={acceptanceSchedule} onChange={setAcceptanceSchedule} />
                <TermsAcknowledgment
                  scheduleSummary={formatScheduleSummary(acceptanceSchedule)}
                  monthlyFeeLabel={`₹${parseFloat(active.monthlyFeeInr).toLocaleString("en-IN")}`}
                  startDate={active.startDate}
                  noticePeriodDays={shadowTeacherPricing?.noticePeriodDays}
                  checked={acceptanceTermsChecked}
                  onCheckedChange={setAcceptanceTermsChecked}
                />
                {needsUpiVerification && (
                  <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                    <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-xs font-semibold text-amber-900">Verify your UPI ID to accept</p>
                      <p className="text-[11px] text-amber-800 mt-0.5">
                        The parent will pay you directly each month. Verify your UPI (₹1, refunded instantly) in Earnings → Payout Settings before accepting.
                      </p>
                    </div>
                  </div>
                )}
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleTeacherAcceptance("decline")}
                    disabled={submittingAcceptance}
                    className="flex-1 border-red-200 text-red-600 hover:bg-red-50 text-xs font-semibold"
                  >
                    {submittingAcceptance && <Loader2 size={12} className="animate-spin mr-1" />}
                    Decline
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void handleTeacherAcceptance("accept")}
                    disabled={submittingAcceptance || needsUpiVerification || acceptanceSchedule.length === 0 || !acceptanceTermsChecked}
                    className="flex-1 bg-[#2EC4A5] hover:bg-[#26a88d] text-white text-xs font-semibold disabled:opacity-60"
                  >
                    {submittingAcceptance && <Loader2 size={12} className="animate-spin mr-1" />}
                    Accept Engagement
                  </Button>
                </div>
              </div>
            );
          })()}
          {active.status === "pending_activation_fee" && (
            <div className="bg-white rounded-xl p-5 shadow-[0_2px_12px_rgba(26,35,64,0.06)] space-y-4">
              <p className="text-sm font-bold text-[#1A2340]">One-Time Activation Fee</p>
              <p className="text-xs text-gray-500">
                Pay the one-time activation fee to unlock the start code entry for this engagement.
              </p>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">Activation fee</span>
                <span className="font-semibold text-[#1A2340]">₹{Number(active.activationFeeInr ?? 0).toLocaleString("en-IN")}</span>
              </div>
              <Button
                size="sm"
                onClick={() => void handlePayActivationFee()}
                disabled={payingActivationFee}
                className="w-full bg-[#2EC4A5] hover:bg-[#26a88d] text-white text-xs font-semibold"
              >
                {payingActivationFee && <Loader2 size={12} className="animate-spin mr-1" />}
                Pay ₹{Number(active.activationFeeInr ?? 0).toLocaleString("en-IN")} to Activate
              </Button>
            </div>
          )}
          {active.status === "pending_start" && (
            <EngagementStartOtpEntry engagementId={active.id} />
          )}
          {active.platformSalaryEnabled === false && salaryConfirmations.length > 0 && (
            <div className="bg-white rounded-xl p-5 shadow-[0_2px_12px_rgba(26,35,64,0.06)] space-y-3">
              <p className="text-sm font-bold text-[#1A2340]">Salary Confirmations</p>
              <p className="text-xs text-gray-500">
                Your salary for this engagement is paid directly to your UPI ID. Confirm receipt once the parent marks a month as paid.
              </p>
              <div className="space-y-2">
                {salaryConfirmations.map(sc => (
                  <div key={sc.id} className="flex items-center gap-3 p-2.5 bg-gray-50 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-[#1A2340]">{sc.month}</p>
                      <p className="text-xs text-gray-400">₹{sc.amountInr.toLocaleString("en-IN")} · marked paid {new Date(sc.markedPaidAt).toLocaleDateString("en-IN")}</p>
                    </div>
                    {sc.confirmedAt ? (
                      <span className="text-[10px] font-bold px-2.5 py-1 rounded-full border bg-green-50 text-green-700 border-green-200 shrink-0">confirmed</span>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => void handleConfirmSalaryReceipt(sc.id)}
                        disabled={confirmingSalaryId === sc.id}
                        className="bg-[#2EC4A5] hover:bg-[#26a88d] text-white text-xs font-semibold shrink-0"
                      >
                        {confirmingSalaryId === sc.id && <Loader2 size={12} className="animate-spin mr-1" />}
                        Confirm Receipt
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="bg-white rounded-xl p-5 shadow-[0_2px_12px_rgba(26,35,64,0.06)] space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-[#1A2340]">Recent Logs</p>
              <span className="text-xs text-gray-400">{logs.length} total</span>
            </div>
            {logs.length === 0 ? (
              <p className="text-xs text-gray-400">No logs yet. Use the Daily Log tab to submit today's update.</p>
            ) : (
              <div className="space-y-2">
                {logs.slice(0, 5).map(log => (
                  <div key={log.id} className="flex items-center gap-3 p-2.5 bg-gray-50 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-[#1A2340]">{new Date(log.logDate).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</p>
                      <p className="text-xs text-gray-400 truncate">
                        {(() => { try { const c = JSON.parse(log.content) as Record<string, unknown>; const _grs = c["goalRatings"] as { label: string }[] | undefined; return String(c["behaviorMood"] ?? c["taughtToday"] ?? c["eventsForTeacher"] ?? (_grs?.length ? `${_grs.length} goal${_grs.length > 1 ? "s" : ""} logged` : "")); } catch { return ""; } })()}
                      </p>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold shrink-0 ${log.authorRole === "teacher" ? "bg-blue-50 text-blue-600 border-blue-200" : "bg-[#2EC4A5]/10 text-[#2EC4A5] border-[#2EC4A5]/20"}`}>
                      {log.authorRole === "teacher" ? "You" : "Parent"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {todayLogged && (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-xl">
              <Check size={16} className="text-green-600 shrink-0" />
              <p className="text-sm text-green-700 font-medium">Today's log submitted ✓</p>
            </div>
          )}
        </div>
      )}

      {/* ── Child & Goals ── */}
      {visibleEngTab === "child" && (
        <div className="space-y-4">
          {active.status === "ended" && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs text-gray-500">📋 This engagement has ended — records are read-only.</p>
            </div>
          )}
          {(active.childConditions?.length || active.childLanguages?.length) ? (
            <div className="bg-white rounded-xl p-4 shadow-[0_2px_12px_rgba(26,35,64,0.06)] space-y-3">
              <p className="text-sm font-bold text-[#1A2340]">Child Profile</p>
              {active.childConditions && active.childConditions.length > 0 && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">Conditions</p>
                  <div className="flex flex-wrap gap-1">
                    {active.childConditions.map(c => <span key={c} className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">{c}</span>)}
                  </div>
                </div>
              )}
              {active.childLanguages && active.childLanguages.length > 0 && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">Languages</p>
                  <div className="flex flex-wrap gap-1">
                    {active.childLanguages.map(l => <span key={l} className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{l}</span>)}
                  </div>
                </div>
              )}
            </div>
          ) : null}

          <div className="bg-white rounded-xl p-5 shadow-[0_2px_12px_rgba(26,35,64,0.06)] space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-[#1A2340]">Goals</p>
              {active.status !== "ended" && (
                <button onClick={() => setAddingGoal(!addingGoal)}
                  className="flex items-center gap-1 text-xs text-[#2EC4A5] font-semibold hover:underline">
                  <Plus size={13} />{addingGoal ? "Cancel" : "Add Goal"}
                </button>
              )}
            </div>
            {addingGoal && active.status !== "ended" && (
              <div className="p-3 bg-gray-50 rounded-lg space-y-2">
                <input value={newGoalLabel} onChange={e => setNewGoalLabel(e.target.value)}
                  placeholder="Goal (e.g. Writes own name)"
                  className="w-full rounded-lg border border-gray-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2EC4A5]" />
                <input value={newGoalCategory} onChange={e => setNewGoalCategory(e.target.value)}
                  placeholder="Category (e.g. Writing, Math) — optional"
                  className="w-full rounded-lg border border-gray-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2EC4A5]" />
                <Button size="sm" onClick={() => void handleAddGoal()} disabled={savingGoal || !newGoalLabel.trim()}
                  className="bg-[#2EC4A5] hover:bg-[#26a88d] text-white text-xs">
                  {savingGoal ? <Loader2 size={12} className="animate-spin mr-1" /> : null}Save Goal
                </Button>
              </div>
            )}
            {goals.length === 0 ? (
              <p className="text-xs text-gray-400">No goals yet. Add IEP or learning goals above.</p>
            ) : (
              <div className="space-y-2">
                {goals.map(g => (
                  <div key={g.id} className="flex items-center gap-3 p-2.5 bg-gray-50 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${g.isActive ? "text-[#1A2340]" : "text-gray-400 line-through"}`}>{g.label}</p>
                      {g.category && <p className="text-xs text-gray-400">{g.category}</p>}
                    </div>
                    {active.status !== "ended" ? (
                      <button onClick={() => void handleToggleGoal(g.id, g.isActive)}
                        className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-semibold border transition-colors ${
                          g.isActive ? "bg-green-50 text-green-600 border-green-200 hover:bg-red-50 hover:text-red-500 hover:border-red-200"
                                     : "bg-gray-100 text-gray-400 border-gray-200 hover:bg-green-50 hover:text-green-600 hover:border-green-200"
                        }`}>
                        {g.isActive ? "Active" : "Inactive"}
                      </button>
                    ) : (
                      <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-semibold border ${g.isActive ? "bg-green-50 text-green-600 border-green-200" : "bg-gray-100 text-gray-400 border-gray-200"}`}>
                        {g.isActive ? "Active" : "Inactive"}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl p-5 shadow-[0_2px_12px_rgba(26,35,64,0.06)] space-y-3">
            <p className="text-sm font-bold text-[#1A2340]">Parent's Recent Updates</p>
            {logs.filter(l => l.authorRole === "parent").length === 0 ? (
              <p className="text-xs text-gray-400">Parent hasn't posted any home updates yet.</p>
            ) : (
              <div className="space-y-2">
                {logs.filter(l => l.authorRole === "parent").slice(0, 5).map(log => {
                  let c: Record<string, unknown> = {};
                  try { c = JSON.parse(log.content) as Record<string, unknown>; } catch {}
                  return (
                    <div key={log.id} className="p-3 bg-gray-50 rounded-lg">
                      <p className="text-xs font-semibold text-[#1A2340] mb-1">
                        {new Date(log.logDate).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}
                      </p>
                      {!!c["eventsForTeacher"] && <p className="text-xs text-gray-600">{String(c["eventsForTeacher"])}</p>}
                      {!!c["extraSupportAreas"] && <p className="text-xs text-gray-400 mt-1">Support needed: {String(c["extraSupportAreas"])}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Daily Log ── */}
      {visibleEngTab === "log" && (
        <div className="bg-white rounded-xl p-5 shadow-[0_2px_12px_rgba(26,35,64,0.06)] space-y-5">
          {active.status === "ended" && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs text-gray-500">📋 This engagement has ended — records are read-only.</p>
            </div>
          )}
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-[#1A2340]">Today's Log</p>
            {todayLogged && !logSubmitted && active.status !== "ended" && <span className="text-xs text-green-600 font-semibold">Already submitted today</span>}
          </div>

          {/* Post-submit share CTA */}
          {logSubmitted && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-xl space-y-3">
              <div className="flex items-center gap-2">
                <Check size={16} className="text-green-600 shrink-0" />
                <p className="text-sm font-semibold text-green-800">Log submitted!</p>
              </div>
              <p className="text-xs text-gray-600">Optionally share a milestone snippet to the parent chat:</p>
              <p className="text-xs italic text-gray-500 bg-white border border-gray-200 rounded-lg px-3 py-2">"{logSubmitted.snippet}"</p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void handleShareToChat()} disabled={sharingToChat}
                  className="bg-[#1A2340] hover:bg-[#2d3a5c] text-white text-xs">
                  {sharingToChat ? <Loader2 size={12} className="animate-spin mr-1" /> : <Share2 size={12} className="mr-1" />}
                  Share to chat
                </Button>
                <Button size="sm" variant="outline" onClick={resetLogForm} className="text-xs border-gray-200">
                  Done
                </Button>
              </div>
            </div>
          )}

          {!logSubmitted && active.status !== "ended" && (
            <>
              {/* Goals sampling */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-[#1A2340]">
                  Goals observed today
                  <span className="text-gray-400 font-normal ml-1">(tick each goal + pick level)</span>
                </p>
                {activeGoals.length === 0 ? (
                  <div className="p-3 bg-gray-50 rounded-lg text-xs text-gray-400">
                    No active goals. Add goals in the{" "}
                    <button onClick={() => setEngTab("child")} className="text-[#2EC4A5] underline font-medium">Child & Goals tab</button>.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {activeGoals.map(g => {
                      const ticked = tickedGoals.has(g.id);
                      return (
                        <div key={g.id} className={`rounded-xl border p-3 transition-colors ${ticked ? "border-[#2EC4A5] bg-[#2EC4A5]/5" : "border-gray-200"}`}>
                          <button className="flex items-center gap-2.5 w-full text-left"
                            onClick={() => setTickedGoals(prev => {
                              const next = new Set(prev);
                              if (next.has(g.id)) next.delete(g.id); else next.add(g.id);
                              return next;
                            })}>
                            <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${ticked ? "bg-[#2EC4A5] border-[#2EC4A5]" : "border-gray-300 bg-white"}`}>
                              {ticked && <Check size={10} className="text-white" />}
                            </span>
                            <span className="text-sm font-medium text-[#1A2340]">{g.label}</span>
                            {g.category && <span className="text-[10px] text-gray-400 ml-auto">{g.category}</span>}
                          </button>
                          {ticked && (
                            <div className="mt-2.5 flex flex-wrap gap-1.5 pl-6">
                              {PROMPT_LEVELS.map(pl => (
                                <button key={pl.id}
                                  onClick={() => setGoalLevels(prev => ({ ...prev, [g.id]: pl.id }))}
                                  className={`text-[10px] px-2.5 py-1 rounded-full border font-semibold transition-all ${
                                    goalLevels[g.id] === pl.id
                                      ? pl.color + " ring-1 ring-offset-1 ring-current shadow-sm"
                                      : "bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100"
                                  }`}>
                                  {pl.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Mood / session note */}
              <div>
                <p className="text-xs font-semibold text-[#1A2340] mb-1.5">Session note</p>
                <textarea value={logMoodNote} onChange={e => setLogMoodNote(e.target.value)} rows={3}
                  placeholder="Child's mood, energy, any wins or challenges today…"
                  className="w-full rounded-lg border border-gray-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#2EC4A5] resize-none" />
              </div>

              {/* Reteach at home */}
              <div>
                <p className="text-xs font-semibold text-[#1A2340] mb-1.5">
                  Reteach at home <span className="text-gray-400 font-normal">(optional)</span>
                </p>
                <textarea value={reteachNote} onChange={e => setReteachNote(e.target.value)} rows={2}
                  placeholder="e.g. Practice counting 1–10, read page 3 of worksheet…"
                  className="w-full rounded-lg border border-gray-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#2EC4A5] resize-none" />
              </div>

              {/* Behaviour counters — collapsed */}
              <div>
                <button onClick={() => setBehaviorOpen(!behaviorOpen)}
                  className="flex items-center gap-1.5 text-xs text-gray-500 font-semibold hover:text-gray-700 transition-colors">
                  <ChevronRight size={13} className={`transition-transform duration-150 ${behaviorOpen ? "rotate-90" : ""}`} />
                  Behaviours (optional)
                </button>
                {behaviorOpen && (
                  <div className="mt-3 space-y-2 pl-4">
                    {behaviorCounts.map((b, i) => (
                      <div key={b.label} className="flex items-center gap-3">
                        <span className="text-xs text-gray-600 flex-1">{b.label}</span>
                        <div className="flex items-center gap-2">
                          <button onClick={() => setBehaviorCounts(prev => prev.map((x, xi) => xi === i ? { ...x, count: Math.max(0, x.count - 1) } : x))}
                            className="w-7 h-7 rounded-full border border-gray-200 flex items-center justify-center text-gray-400 hover:bg-gray-100 transition-colors">
                            <Minus size={11} />
                          </button>
                          <span className="text-sm font-bold w-5 text-center text-[#1A2340]">{b.count}</span>
                          <button onClick={() => setBehaviorCounts(prev => prev.map((x, xi) => xi === i ? { ...x, count: x.count + 1 } : x))}
                            className="w-7 h-7 rounded-full border border-gray-200 flex items-center justify-center text-gray-400 hover:bg-gray-100 transition-colors">
                            <Plus size={11} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Duration — collapsed */}
              <div>
                <button onClick={() => setDurationOpen(!durationOpen)}
                  className="flex items-center gap-1.5 text-xs text-gray-500 font-semibold hover:text-gray-700 transition-colors">
                  <ChevronRight size={13} className={`transition-transform duration-150 ${durationOpen ? "rotate-90" : ""}`} />
                  Focus duration (optional)
                </button>
                {durationOpen && (
                  <div className="mt-3 pl-4 flex items-center gap-2">
                    <span className="text-xs text-gray-600">Sustained focus</span>
                    <input type="number" min="0" max="480" value={focusMinutes}
                      onChange={e => setFocusMinutes(e.target.value)} placeholder="0"
                      className="w-16 rounded-lg border border-gray-200 p-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-[#2EC4A5]" />
                    <span className="text-xs text-gray-400">min</span>
                  </div>
                )}
              </div>

              {/* Photo — consent gated */}
              {mediaConsent && (
                <div>
                  <p className="text-xs font-semibold text-[#1A2340] mb-1.5">
                    Attach photo <span className="text-gray-400 font-normal">(optional)</span>
                  </p>
                  {photoKey ? (
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-green-600 font-semibold">✓ Photo attached</span>
                      <button onClick={() => setPhotoKey(null)} className="text-xs text-red-400 hover:underline">Remove</button>
                    </div>
                  ) : (
                    <label className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-dashed border-gray-300 text-gray-500 cursor-pointer hover:border-[#2EC4A5] hover:text-[#2EC4A5] transition-colors ${uploadingPhoto ? "opacity-50 pointer-events-none" : ""}`}>
                      <Camera size={13} />{uploadingPhoto ? "Uploading…" : "Attach photo"}
                      <input type="file" accept="image/*" className="hidden" onChange={e => void handlePhotoUpload(e)} />
                    </label>
                  )}
                </div>
              )}

              <Button onClick={() => void handlePostLog()} disabled={postingLog}
                className="w-full bg-[#2EC4A5] hover:bg-[#26a88d] text-white text-sm">
                {postingLog ? <Loader2 size={14} className="animate-spin mr-1" /> : null}Submit Today's Log
              </Button>
            </>
          )}
        </div>
      )}

      {/* ── Manage / Lifecycle ── */}
      {visibleEngTab === "lifecycle" && (
        <div className="space-y-4">
          {/* Buyout / Full-buyout wind-down banner */}
          {active.status === "notice_period" && ["buyout", "full_buyout"].includes(active.endedReason ?? "") && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-1">
              <p className="text-sm font-bold text-amber-900">Engagement ending early</p>
              <p className="text-sm text-amber-800">
                This engagement is ending early. You are confirmed to continue working until{" "}
                <span className="font-semibold">
                  {active.endDate
                    ? new Date(active.endDate + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
                    : "the scheduled date"}
                </span>. The engagement ends automatically on that date — no action needed from you.
              </p>
            </div>
          )}

          {/* Standard notice period banner */}
          {active.status === "notice_period" && !["buyout", "full_buyout"].includes(active.endedReason ?? "") && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-1">
              <p className="text-sm font-bold text-blue-900">Notice period active</p>
              <p className="text-sm text-blue-800">
                This engagement ends on{" "}
                <span className="font-semibold">
                  {active.endDate
                    ? new Date(active.endDate + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
                    : "the scheduled date"}
                </span>. Continue working until that date.
              </p>
            </div>
          )}

          {/* Pending pause/resume consent banner */}
          {pendingPR && (
            <div className={`rounded-xl p-4 border space-y-3 ${pendingPR.type === "pause" ? "bg-amber-50 border-amber-200" : "bg-blue-50 border-blue-200"}`}>
              <p className="text-sm font-bold text-[#1A2340]">
                {pendingPR.type === "pause" ? "Pause Request Pending" : "Resume Request Pending"}
              </p>
              {iAmPRRequester ? (
                <>
                  <p className="text-xs text-gray-600">
                    You requested to {pendingPR.type} this engagement. Waiting for the parent to respond.
                  </p>
                  <Button size="sm" variant="outline" onClick={() => void handleProWithdrawPR()} disabled={postingLifecycle}
                    className="border-red-200 text-red-600 hover:bg-red-50 text-xs">
                    {postingLifecycle ? <Loader2 size={12} className="animate-spin mr-1" /> : null}Withdraw Request
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-xs text-gray-600">
                    The parent wants to {pendingPR.type} this engagement.
                    {pendingPR.reason ? ` Reason: "${pendingPR.reason}"` : ""}
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => void handleProConsentPR("approved")} disabled={postingLifecycle}
                      className="bg-green-600 hover:bg-green-700 text-white text-xs">
                      {postingLifecycle ? <Loader2 size={12} className="animate-spin mr-1" /> : "Accept"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void handleProConsentPR("rejected")} disabled={postingLifecycle}
                      className="border-red-200 text-red-600 hover:bg-red-50 text-xs">
                      Reject
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Pause section — only when active and no pending pause/resume */}
          {active.status === "active" && !pendingPR && (
            <div className="bg-white rounded-xl p-4 shadow-[0_2px_12px_rgba(26,35,64,0.06)] space-y-3">
              <p className="text-sm font-bold text-[#1A2340]">Pause Engagement</p>
              <p className="text-xs text-gray-500">
                Temporarily pauses this engagement with the parent's agreement. Both parties must consent. Billing stops during the pause. Either party can request to resume.
              </p>
              <Button size="sm" onClick={() => void handleProRequestPause()} disabled={postingLifecycle}
                className="bg-amber-500 hover:bg-amber-600 text-white text-xs">
                {postingLifecycle ? <Loader2 size={12} className="animate-spin mr-1" /> : null}Request Pause
              </Button>
            </div>
          )}

          {/* Resume section — only when paused and no pending request */}
          {active.status === "paused" && !pendingPR && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
              <p className="text-sm font-bold text-amber-800">Engagement is Paused</p>
              <p className="text-xs text-amber-700">Both you and the parent must agree to resume. Billing resumes once both parties consent.</p>
              <Button size="sm" onClick={() => void handleProRequestResume()} disabled={postingLifecycle}
                className="bg-[#2EC4A5] hover:bg-[#26a88d] text-white text-xs">
                {postingLifecycle ? <Loader2 size={12} className="animate-spin mr-1" /> : null}Request Resume
              </Button>
            </div>
          )}

          {/* End engagement — only when active or notice_period */}
          {(active.status === "active" || active.status === "notice_period") && (
            <div className="bg-white rounded-xl p-5 shadow-[0_2px_12px_rgba(26,35,64,0.06)] space-y-4">
              <p className="text-sm font-bold text-[#1A2340]">Give Notice</p>
              <button onClick={() => setLifecycleType(lifecycleType === "stop" ? "" : "stop")}
                className={`w-full py-2.5 px-3 rounded-xl border text-sm font-semibold transition-colors text-left ${lifecycleType === "stop" ? "border-[#FF6B6B] bg-[#FF6B6B]/10 text-[#FF6B6B]" : "border-gray-200 hover:border-gray-300 text-gray-600"}`}>
                End Engagement (30-day notice)
              </button>
              <p className="text-xs text-gray-500">
                Gives 30 days notice to end this engagement. The parent will be notified and the engagement ends after 30 days. Either party can give notice. No extra cost.
              </p>
              {lifecycleType === "stop" && (
                <>
                  <textarea value={lifecycleNotes} onChange={e => setLifecycleNotes(e.target.value)} rows={3}
                    placeholder="Please explain why you are making this request…"
                    className="w-full rounded-lg border border-gray-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#2EC4A5] resize-none" />
                  <Button onClick={() => void handleLifecycleRequest()} disabled={postingLifecycle}
                    className="w-full bg-[#FF6B6B] hover:bg-[#e85a5a] text-white text-sm">
                    {postingLifecycle ? <Loader2 size={14} className="animate-spin mr-1" /> : null}Submit End Request
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Teacher Log History ── */}
      {engTab === "log" && logs.filter(l => l.authorRole === "teacher").length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-bold text-[#1A2340] px-1">Past Submissions</p>
          {logs.filter(l => l.authorRole === "teacher").slice(0, 10).map(log => {
            let lc: Record<string, unknown> = {};
            try { lc = JSON.parse(log.content) as Record<string, unknown>; } catch {}
            const lgrs = lc["goalRatings"] as { goalId: number; label: string; level: string }[] | undefined;
            const lbcs = lc["behaviorCounts"] as { label: string; count: number }[] | undefined;
            const ldurs = lc["durations"] as { label: string; minutes: number }[] | undefined;
            const LC: Record<string, { label: string; cls: string }> = {
              independent:    { label: "Independent", cls: "bg-green-100 text-green-700" },
              visual_prompt:  { label: "Visual ✓",    cls: "bg-yellow-100 text-yellow-700" },
              verbal_prompt:  { label: "Verbal",      cls: "bg-amber-100 text-amber-700" },
              modeling:       { label: "Modeling",    cls: "bg-orange-100 text-orange-700" },
              physical_assist:{ label: "Physical",    cls: "bg-red-100 text-red-700" },
            };
            return (
              <div key={log.id} className="bg-white rounded-xl p-4 shadow-[0_2px_12px_rgba(26,35,64,0.06)] space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-[#1A2340]">{new Date(log.logDate).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</span>
                  <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full border font-semibold bg-blue-50 text-blue-600 border-blue-200">You</span>
                </div>
                {!!lc["behaviorMood"] && <p className="text-sm text-gray-700">{String(lc["behaviorMood"])}</p>}
                {!!lc["reteachAtHome"] && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-1.5">🏠 Reteach at home: {String(lc["reteachAtHome"])}</p>}
                {lgrs && lgrs.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {lgrs.map((gr, i) => { const chip = LC[gr.level] ?? { label: gr.level, cls: "bg-gray-100 text-gray-600" }; return <span key={i} className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${chip.cls}`}>{gr.label}: {chip.label}</span>; })}
                  </div>
                )}
                {lbcs && lbcs.filter(b => b.count > 0).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {lbcs.filter(b => b.count > 0).map((b, i) => <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-semibold">{b.label}: {b.count}×</span>)}
                  </div>
                )}
                {ldurs && ldurs.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {ldurs.map((d, i) => <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-teal-100 text-teal-700 font-semibold">⏱ {d.label}: {d.minutes}m</span>)}
                  </div>
                )}
                {!!log.signedPhotoUrl && (
                  <a
                    href={log.signedPhotoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-[#2EC4A5] hover:underline font-medium"
                  >
                    📷 View photo
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Trends ── */}
      {visibleEngTab === "trends" && (
        hasTrendData ? (
          <div className="space-y-4">
            {trendGoalEntries.map(([gid, { label, pts }]) => {
              const trend = pts.length > 1 ? pts[pts.length - 1].rank - pts[0].rank : 0;
              return (
                <div key={gid} className="bg-white rounded-xl p-4 shadow-[0_2px_12px_rgba(26,35,64,0.06)]">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-bold text-[#1A2340]">{label}</p>
                    {pts.length > 1 && <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${trend > 0 ? "bg-green-100 text-green-700" : trend < 0 ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-500"}`}>{trend > 0 ? "↑ Improving" : trend < 0 ? "↓ More support" : "Steady"}</span>}
                  </div>
                  <div className="flex items-end gap-1.5 overflow-x-auto pb-1" style={{ minHeight: 52 }}>
                    {pts.map((pt, i) => (
                      <div key={i} className="flex flex-col items-center gap-0.5 shrink-0">
                        <div className={`w-7 rounded-sm ${TREND_BG[pt.level] ?? "bg-gray-300"}`} style={{ height: `${(pt.rank / 5) * 40}px` }} />
                        <span className="text-[9px] text-gray-400">{pt.date}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-[9px] text-gray-300">← needs support</span>
                    <span className="text-[9px] text-gray-300">independent →</span>
                  </div>
                </div>
              );
            })}
            {trendBehavEntries.map(([bLabel, pts]) => {
              const maxC = Math.max(...pts.map(p => p.count), 1);
              return (
                <div key={bLabel} className="bg-white rounded-xl p-4 shadow-[0_2px_12px_rgba(26,35,64,0.06)]">
                  <p className="text-sm font-bold text-[#1A2340] mb-3">{bLabel} <span className="text-xs font-normal text-gray-400">incidents</span></p>
                  <div className="flex items-end gap-1.5 overflow-x-auto pb-1" style={{ minHeight: 52 }}>
                    {pts.map((pt, i) => (
                      <div key={i} className="flex flex-col items-center gap-0.5 shrink-0">
                        <span className="text-[9px] text-gray-500 font-medium">{pt.count}</span>
                        <div className="w-7 bg-amber-400 rounded-sm" style={{ height: `${Math.max((pt.count / maxC) * 40, 3)}px` }} />
                        <span className="text-[9px] text-gray-400">{pt.date}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {trendDurData.length > 0 && (
              <div className="bg-white rounded-xl p-4 shadow-[0_2px_12px_rgba(26,35,64,0.06)]">
                <p className="text-sm font-bold text-[#1A2340] mb-3">Focus duration <span className="text-xs font-normal text-gray-400">min</span></p>
                <div className="flex items-end gap-1.5 overflow-x-auto pb-1" style={{ minHeight: 52 }}>
                  {trendDurData.map((pt, i) => (
                    <div key={i} className="flex flex-col items-center gap-0.5 shrink-0">
                      <span className="text-[9px] text-gray-500 font-medium">{pt.minutes}</span>
                      <div className="w-7 bg-teal-400 rounded-sm" style={{ height: `${Math.max((pt.minutes / trendMaxMins) * 40, 3)}px` }} />
                      <span className="text-[9px] text-gray-400">{pt.date}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-xl p-8 text-center shadow-[0_2px_12px_rgba(26,35,64,0.06)]">
            <p className="text-sm text-gray-400">No trend data yet — submit daily logs with goal ratings to see progress charts here.</p>
          </div>
        )
      )}

      {/* Chat drawer */}
      {chatOpen && active.matchRequestId && active.candidateId && (
        <ShadowMatchChatDrawer
          matchId={active.matchRequestId}
          candidateId={active.candidateId}
          candidateName={active.parentName ?? "Parent"}
          committed={true}
          myUserId={myUserId}
          onClose={() => setChatOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Vertical Requests Tab (tutor/therapist — Part B) ────────────────────────
// Additive, separate from EnquiriesTab/EngagementTab above (shadow-teacher's
// own tabs are untouched). Gated on SHOW_TUTOR_SEARCH/SHOW_THERAPIST_SEARCH —
// renders nothing when both are false. Grouped by vertical using
// GET /professionals/me/offerings, so a professional only sees sections for
// verticals they actually hold (primary or additional offering).

function VerticalRequestsSection({ vertical, onUpdated }: { vertical: Vertical; onUpdated: () => void }) {
  const apiBase = vertical === "tutor" ? "/api/tutor" : "/api/therapist";
  const label = vertical === "tutor" ? "Tutor" : "Therapist";

  const { data: candidacies = [], refetch: refetchCandidacies } = useQuery<VerticalCandidacy[]>({
    queryKey: [`${vertical}-my-candidacies`],
    queryFn: () => fetchWithAuth(`${apiBase}/my-candidacies`).then(r => r.json()),
  });
  const { data: engagements = [], refetch: refetchEngagements } = useQuery<VerticalEngagement[]>({
    queryKey: [`${vertical}-my-engagements`],
    queryFn: () => fetchWithAuth(`${apiBase}/engagements`).then(r => r.json()),
  });

  function handleUpdated() {
    void refetchCandidacies();
    void refetchEngagements();
    onUpdated();
  }

  const activeEngagements = engagements.filter((e) => e.status !== "ended");

  return (
    <div className="space-y-4">
      <p className="text-base font-bold text-[#1A2340]">{label} Requests</p>
      {candidacies.length === 0 && activeEngagements.length === 0 ? (
        <p className="text-sm text-gray-400">No {label.toLowerCase()} requests yet.</p>
      ) : (
        <div className="space-y-3">
          {candidacies.map((c) => (
            <VerticalCandidacyCard key={`c-${c.candidateId}`} vertical={vertical} candidacy={c} onUpdated={handleUpdated} />
          ))}
          {activeEngagements.map((e) => (
            <VerticalEngagementCard key={`e-${e.id}`} vertical={vertical} engagement={e} onUpdated={handleUpdated} />
          ))}
        </div>
      )}
    </div>
  );
}

function VerticalRequestsTab() {
  const queryClient = useQueryClient();

  // Reuses the existing useMyOfferings() hook (already correctly unwraps
  // the endpoint's { offerings: [...] } response) instead of a second,
  // broken inline query that shared its cache key ("my-offerings") but
  // treated the raw wrapped response as a bare array — offerings.some(...)
  // then threw "offerings.some is not a function", crashing this whole tab.
  const { data: offerings = [] } = useMyOfferings();

  const verticals: Vertical[] = [];
  if (SHOW_TUTOR_SEARCH && offerings.some((o) => o.vertical === "home_tutor")) verticals.push("tutor");
  if (SHOW_THERAPIST_SEARCH && offerings.some((o) => o.vertical === "therapist")) verticals.push("therapist");

  if (verticals.length === 0) return null;

  return (
    <div className="space-y-8">
      {verticals.map((v) => (
        <VerticalRequestsSection key={v} vertical={v} onUpdated={() => queryClient.invalidateQueries()} />
      ))}
    </div>
  );
}

// ─── Enquiries Tab (shadow teachers) ─────────────────────────────────────────

interface Candidacy {
  candidateId:         number;
  matchId:             number;
  matchStatus:         string;
  isSelected:          boolean;
  selectedProfessionalId: number | null;
  childCity:           string | null;
  childConditions:     string[];
  childBudgetMinInr:   number | null;
  childBudgetMaxInr:   number | null;
  childPreferredModes: string[];
  childGoalsAreas:     string | null;
  preMeetingRequested: boolean;
  preMeetingNote:      string | null;
  trialLocation:       string | null;
  trialDirectPay:             boolean;
  trialDirectPayMarkedPaidAt: string | null;
  trialDirectPayConfirmedAt:  string | null;
  // Redesigned journey (Task 3B) — request → interview → trial state.
  requestStatus:          string;
  rejectionNote:          string | null;
  interviewSlotsJson:     string | null;
  interviewConfirmedSlot: string | null;
  meetLink:               string | null;
  interviewDoneAt:        string | null;
  trialDaysRequested:     number | null;
  trialDaysAccepted:      number | null;
  threadId:            number | null;
  messageCount:        number;
  lastMessageAt:       string | null;
  createdAt:           string;
}

interface CandidacyInterviewSlot {
  date: string;
  time: string;
  label?: string;
}

const MATCH_STATUS_LABEL: Record<string, string> = {
  shortlisted:     "Shortlisted",
  committed:       "Committed",
  cancelled:       "Cancelled",
  pending_payment: "Pending payment",
  completed:       "Completed",
  trial_pending:   "Trial day pending",
  trial_started:   "Trial day underway",
  trial_done:      "Trial complete",
};
const MATCH_STATUS_COLOR: Record<string, string> = {
  shortlisted:     "bg-teal-50 text-teal-700 border-teal-200",
  committed:       "bg-green-50 text-green-700 border-green-200",
  cancelled:       "bg-gray-50 text-gray-500 border-gray-200",
  pending_payment: "bg-yellow-50 text-yellow-700 border-yellow-200",
  completed:       "bg-blue-50 text-blue-700 border-blue-200",
  trial_pending:   "bg-orange-50 text-orange-700 border-orange-200",
  trial_started:   "bg-indigo-50 text-indigo-700 border-indigo-200",
  trial_done:      "bg-purple-50 text-purple-700 border-purple-200",
};

function CandidacyOfferSection({ matchId, candidateId, myUserId }: { matchId: number; candidateId: number; myUserId: number }) {
  const [offerInput, setOfferInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: offers = [] } = useQuery<{ id: number; raisedByUserId: number; raisedByRole: string; amountInr: number; status: string }[]>({
    queryKey: ["pro-offers", matchId, candidateId],
    queryFn: () => fetchWithAuth(`/api/shadow-teacher/${matchId}/candidates/${candidateId}/offers`).then(r => r.json()),
    enabled: myUserId > 0,
    refetchInterval: 15_000,
  });

  const acceptedOffer = offers.find(o => o.status === "accepted");
  const myPendingOffer = offers.find(o => o.status === "pending" && o.raisedByUserId === myUserId);
  const theirPendingOffer = offers.find(o => o.status === "pending" && o.raisedByUserId !== myUserId);

  async function submitOffer() {
    const amount = parseInt(offerInput.replace(/\D/g, ""), 10);
    if (!amount) { toast({ title: "Enter a valid amount", variant: "destructive" }); return; }
    setSubmitting(true);
    try {
      const res = await fetchWithAuth(`/api/shadow-teacher/${matchId}/candidates/${candidateId}/offers`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amountInr: amount }),
      });
      if (!res.ok) { const e = await res.json() as { error?: string }; toast({ title: e.error ?? "Failed", variant: "destructive" }); return; }
      setOfferInput("");
      queryClient.invalidateQueries({ queryKey: ["pro-offers", matchId, candidateId] });
    } finally { setSubmitting(false); }
  }

  async function acceptOffer(offerId: number) {
    setSubmitting(true);
    try {
      const res = await fetchWithAuth(`/api/shadow-teacher/${matchId}/candidates/${candidateId}/offers/${offerId}/accept`, { method: "PATCH" });
      if (!res.ok) { const e = await res.json() as { error?: string }; toast({ title: e.error ?? "Failed", variant: "destructive" }); return; }
      queryClient.invalidateQueries({ queryKey: ["pro-offers", matchId, candidateId] });
    } finally { setSubmitting(false); }
  }

  async function withdrawOffer(offerId: number) {
    setSubmitting(true);
    try {
      const res = await fetchWithAuth(`/api/shadow-teacher/${matchId}/candidates/${candidateId}/offers/${offerId}`, { method: "DELETE" });
      if (!res.ok) { const e = await res.json() as { error?: string }; toast({ title: e.error ?? "Failed", variant: "destructive" }); return; }
      queryClient.invalidateQueries({ queryKey: ["pro-offers", matchId, candidateId] });
    } finally { setSubmitting(false); }
  }

  return (
    <div className="mt-2 space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Price Negotiation</p>
      {offers.filter(o => o.status !== "withdrawn").slice(-4).map(o => (
        <div key={o.id} className={`flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg ${o.raisedByUserId === myUserId ? "bg-blue-50 text-blue-800" : "bg-gray-50 text-gray-600"}`}>
          <span>{o.raisedByUserId === myUserId ? "You" : "Parent"} offered ₹{o.amountInr.toLocaleString("en-IN")}/mo</span>
          <span className={`ml-2 text-[10px] font-semibold ${o.status === "accepted" ? "text-green-600" : o.status === "superseded" ? "text-gray-400" : "text-amber-600"}`}>
            {o.status === "accepted" ? "✓ Agreed" : o.status === "superseded" ? "replaced" : "pending"}
          </span>
        </div>
      ))}
      {acceptedOffer ? (
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          <span className="text-xs font-bold text-green-800">🔒 Agreed: ₹{acceptedOffer.amountInr.toLocaleString("en-IN")}/mo</span>
        </div>
      ) : myPendingOffer ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-amber-700">Waiting for parent's response…</span>
          <button onClick={() => void withdrawOffer(myPendingOffer.id)} disabled={submitting}
            className="text-[10px] text-red-500 hover:underline disabled:opacity-50">Withdraw</button>
        </div>
      ) : theirPendingOffer ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-gray-700">Parent offered ₹{theirPendingOffer.amountInr.toLocaleString("en-IN")}/mo</p>
          <div className="flex gap-2">
            <button onClick={() => void acceptOffer(theirPendingOffer.id)} disabled={submitting}
              className="flex-1 text-xs bg-green-600 text-white rounded-lg py-1.5 font-semibold hover:bg-green-700 disabled:opacity-50">Accept</button>
            <div className="flex flex-1 gap-1">
              <input type="number" min="1" placeholder="Counter ₹" value={offerInput} onChange={e => setOfferInput(e.target.value)}
                className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-[#2EC4A5] min-w-0" />
              <button onClick={() => void submitOffer()} disabled={submitting || !offerInput}
                className="text-xs bg-[#1A2340] text-white rounded-lg px-2 font-semibold disabled:opacity-50">Send</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <input type="number" min="1" placeholder="Propose a fee ₹/mo" value={offerInput} onChange={e => setOfferInput(e.target.value)}
            className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-[#2EC4A5] min-w-0" />
          <button onClick={() => void submitOffer()} disabled={submitting || !offerInput}
            className="text-xs bg-[#2EC4A5] text-white rounded-lg px-3 py-1.5 font-semibold hover:bg-[#26a88d] disabled:opacity-50">
            {submitting ? "…" : "Propose"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── RespondRequestBlock — Task 3e: teacher accepts/declines the shadowing request ──
function RespondRequestBlock({ candidacy: c, onUpdated }: { candidacy: Candidacy; onUpdated: () => void }) {
  const { toast } = useToast();
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineNote, setDeclineNote] = useState("");
  const [responding, setResponding] = useState(false);

  if (c.requestStatus !== "sent") return null;

  async function respond(action: "accept" | "reject") {
    setResponding(true);
    try {
      const res = await fetchWithAuth(`/api/shadow-teacher/${c.matchId}/candidates/${c.candidateId}/respond-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note: action === "reject" ? (declineNote.trim() || undefined) : undefined }),
      });
      if (!res.ok) { const e = await res.json() as { error?: string }; toast({ title: e.error ?? "Could not respond", variant: "destructive" }); return; }
      setDeclineOpen(false);
      onUpdated();
    } finally { setResponding(false); }
  }

  return (
    <div className="mb-3 p-4 bg-blue-50 border border-blue-200 rounded-xl space-y-3">
      <p className="text-sm font-bold text-blue-900">Shadowing Request</p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-blue-800">
        {c.childCity && <span>📍 {c.childCity}</span>}
        {(c.childBudgetMinInr || c.childBudgetMaxInr) && (
          <span>💰 ₹{c.childBudgetMinInr?.toLocaleString("en-IN") ?? "?"} – ₹{c.childBudgetMaxInr?.toLocaleString("en-IN") ?? "?"}/mo</span>
        )}
        {c.childPreferredModes.length > 0 && <span>🎓 {c.childPreferredModes.join(", ")}</span>}
        {c.childConditions.length > 0 && <span className="col-span-2">🏥 {c.childConditions.join(", ")}</span>}
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => void respond("accept")}
          disabled={responding}
          className="flex-1 bg-green-600 hover:bg-green-700 text-white text-xs h-8 rounded-xl"
        >
          {responding ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} className="mr-1" />}
          Accept
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setDeclineOpen(true)}
          disabled={responding}
          className="flex-1 border-red-200 text-red-600 hover:bg-red-50 text-xs h-8 rounded-xl"
        >
          <XCircle size={12} className="mr-1" />
          Decline
        </Button>
      </div>

      <Dialog open={declineOpen} onOpenChange={setDeclineOpen}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-[#1A2340]">Decline Request</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-2">
            <Label className="text-xs font-semibold text-gray-600">
              Reason <span className="font-normal text-gray-400">(optional, shown to the parent)</span>
            </Label>
            <Textarea
              rows={3}
              maxLength={500}
              value={declineNote}
              onChange={(e) => setDeclineNote(e.target.value)}
              placeholder="e.g. Not available for this location right now"
              className="text-sm rounded-xl resize-none"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-xl" onClick={() => setDeclineOpen(false)}>Cancel</Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white rounded-xl"
              disabled={responding}
              onClick={() => void respond("reject")}
            >
              {responding ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
              Confirm Decline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── TeacherInterviewSection — Task 3e: view proposed slots, confirm one, join ──
function TeacherInterviewSection({ candidacy: c, onUpdated }: { candidacy: Candidacy; onUpdated: () => void }) {
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  if (c.requestStatus !== "accepted") return null;

  let proposedSlots: CandidacyInterviewSlot[] = [];
  if (c.interviewSlotsJson) {
    try { proposedSlots = JSON.parse(c.interviewSlotsJson) as CandidacyInterviewSlot[]; } catch { /* ignore malformed */ }
  }

  async function confirmSlot() {
    if (!selectedSlot) return;
    setConfirming(true);
    try {
      const res = await fetchWithAuth(`/api/shadow-teacher/${c.matchId}/candidates/${c.candidateId}/confirm-interview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmedSlot: selectedSlot }),
      });
      if (!res.ok) { const e = await res.json() as { error?: string }; toast({ title: e.error ?? "Could not confirm interview", variant: "destructive" }); return; }
      onUpdated();
    } finally { setConfirming(false); }
  }

  if (c.interviewConfirmedSlot) {
    return (
      <div className="mb-3 p-4 bg-teal-50 border border-teal-200 rounded-xl space-y-2">
        <p className="text-sm font-bold text-teal-900">Interview scheduled for {c.interviewConfirmedSlot}</p>
        {c.meetLink && (
          <a
            href={c.meetLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 w-full h-9 rounded-lg bg-[#2EC4A5] hover:bg-[#26a88d] text-white font-semibold text-xs no-underline"
          >
            <Video size={13} />
            Join Interview
          </a>
        )}
      </div>
    );
  }

  if (proposedSlots.length === 0) {
    return (
      <div className="mb-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
        <p className="text-xs font-semibold text-amber-800">Waiting for parent to propose interview times</p>
      </div>
    );
  }

  return (
    <div className="mb-3 p-4 bg-purple-50 border border-purple-200 rounded-xl space-y-2">
      <p className="text-sm font-bold text-purple-900">Choose an interview slot</p>
      <div className="space-y-1.5">
        {proposedSlots.map((s, i) => {
          const key = `${s.date}T${s.time}`;
          const isChosen = selectedSlot === key;
          return (
            <button
              key={i}
              onClick={() => setSelectedSlot(key)}
              className={`w-full text-left text-xs px-3 py-2 rounded-lg border ${isChosen ? "bg-purple-600 text-white border-purple-600" : "bg-white text-purple-800 border-purple-200"}`}
            >
              {s.label ? `${s.label} — ` : ""}{s.date} at {s.time}
            </button>
          );
        })}
      </div>
      <Button
        size="sm"
        onClick={() => void confirmSlot()}
        disabled={!selectedSlot || confirming}
        className="w-full bg-purple-600 hover:bg-purple-700 text-white text-xs h-8 rounded-xl"
      >
        {confirming ? <Loader2 size={12} className="animate-spin mr-1" /> : null}
        Confirm Slot
      </Button>
    </div>
  );
}

// ── TeacherTrialAcceptSection — Task 3f: teacher offers up to trialDaysRequested ──
function TeacherTrialAcceptSection({ candidacy: c, onUpdated }: { candidacy: Candidacy; onUpdated: () => void }) {
  const { toast } = useToast();
  const [trialDays, setTrialDays] = useState(1);
  const [accepting, setAccepting] = useState(false);

  if (c.trialDaysRequested == null || c.trialDaysAccepted != null) return null;

  async function acceptTrial() {
    setAccepting(true);
    try {
      const res = await fetchWithAuth(`/api/shadow-teacher/${c.matchId}/candidates/${c.candidateId}/accept-trial`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trialDays }),
      });
      if (!res.ok) { const e = await res.json() as { error?: string }; toast({ title: e.error ?? "Could not accept trial", variant: "destructive" }); return; }
      onUpdated();
    } finally { setAccepting(false); }
  }

  return (
    <div className="mb-3 p-4 bg-orange-50 border border-orange-200 rounded-xl space-y-2">
      <p className="text-sm font-bold text-orange-900">
        Parent wants a {c.trialDaysRequested}-day trial. How many days can you offer?
      </p>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={1}
          max={c.trialDaysRequested}
          value={trialDays}
          onChange={(e) => setTrialDays(Math.max(1, Math.min(c.trialDaysRequested!, parseInt(e.target.value || "1", 10))))}
          className="w-20 text-sm border border-orange-200 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-orange-400 bg-white"
        />
        <Button
          size="sm"
          onClick={() => void acceptTrial()}
          disabled={accepting}
          className="flex-1 bg-orange-500 hover:bg-orange-600 text-white text-xs h-9 rounded-xl"
        >
          {accepting ? <Loader2 size={12} className="animate-spin mr-1" /> : null}
          Confirm Trial Days
        </Button>
      </div>
    </div>
  );
}

function CandidacyCard({ candidacy: c, onOpen, myUserId, onUpdated }: { candidacy: Candidacy; onOpen: () => void; myUserId: number; onUpdated: () => void }) {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-[0_4px_24px_rgba(26,35,64,0.06)]">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex flex-wrap gap-1.5 flex-1">
          {c.childConditions.length > 0
            ? c.childConditions.map((cond) => (
                <span key={cond} className="text-xs bg-[#2EC4A5]/10 text-[#2EC4A5] px-2 py-0.5 rounded-full font-medium">
                  {cond.replace(/_/g, " ")}
                </span>
              ))
            : <span className="text-xs text-gray-400 italic">No conditions listed</span>
          }
        </div>
        <span className={`shrink-0 text-[10px] font-semibold px-2.5 py-0.5 rounded-full border ${MATCH_STATUS_COLOR[c.matchStatus] ?? "bg-gray-50 text-gray-500 border-gray-200"}`}>
          {c.isSelected ? "✓ You were selected" : (MATCH_STATUS_LABEL[c.matchStatus] ?? c.matchStatus)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-gray-500 mb-4">
        {c.childCity && <span>📍 {c.childCity}</span>}
        {(c.childBudgetMinInr || c.childBudgetMaxInr) && (
          <span>
            💰 ₹{c.childBudgetMinInr?.toLocaleString("en-IN") ?? "?"} – ₹{c.childBudgetMaxInr?.toLocaleString("en-IN") ?? "?"}/mo
          </span>
        )}
        {c.childPreferredModes.length > 0 && (
          <span>🎓 {c.childPreferredModes.join(", ")}</span>
        )}
        {c.childGoalsAreas && (
          <span className="col-span-2 line-clamp-2">🎯 {c.childGoalsAreas}</span>
        )}
      </div>

      <RespondRequestBlock candidacy={c} onUpdated={onUpdated} />
      <TeacherInterviewSection candidacy={c} onUpdated={onUpdated} />
      <TeacherTrialAcceptSection candidacy={c} onUpdated={onUpdated} />

      {c.matchStatus === "trial_pending" && c.isSelected && c.trialLocation && (
        <div className="mb-2 p-3 bg-orange-50 border border-orange-200 rounded-xl space-y-1">
          <p className="text-xs font-semibold text-orange-800">📍 Trial location</p>
          <p className="text-xs text-orange-700">{c.trialLocation}</p>
        </div>
      )}
      {c.matchStatus === "trial_pending" && c.isSelected && c.preMeetingRequested && (
        <div className="mb-2 p-3 bg-blue-50 border border-blue-200 rounded-xl space-y-1">
          <p className="text-xs font-semibold text-blue-800">📅 Parent requested a pre-meeting</p>
          {c.preMeetingNote ? (
            <p className="text-xs text-blue-700 italic">"{c.preMeetingNote}"</p>
          ) : (
            <p className="text-xs text-blue-600">Please contact the parent to arrange a brief call before the trial day.</p>
          )}
        </div>
      )}
      {c.isSelected && c.trialDirectPay && c.trialDirectPayMarkedPaidAt && (
        <TrialDirectPayConfirm matchId={c.matchId} confirmedAt={c.trialDirectPayConfirmedAt} />
      )}
      {c.matchStatus === "trial_pending" && c.isSelected && (
        <TrialOtpEntry matchId={c.matchId} type="start" />
      )}
      {c.matchStatus === "trial_started" && c.isSelected && (
        <TrialOtpEntry matchId={c.matchId} type="end" />
      )}

      {/* Task 3B parity with 3c — negotiation only unlocks once the interview is
          marked done, matching the parent-side gate. */}
      {["shortlisted", "trial_done"].includes(c.matchStatus) && c.candidateId !== null && c.interviewDoneAt != null && (
        <CandidacyOfferSection matchId={c.matchId} candidateId={c.candidateId!} myUserId={myUserId} />
      )}

      <div className="flex items-center justify-between pt-3 border-t border-gray-50">
        {c.messageCount > 0 ? (
          <span className="flex items-center gap-1.5 text-xs text-[#2EC4A5] font-medium">
            <span className="w-2 h-2 rounded-full bg-[#2EC4A5] inline-block" />
            {c.messageCount} message{c.messageCount !== 1 ? "s" : ""}
          </span>
        ) : (
          <span className="text-xs text-gray-400">No messages yet</span>
        )}
        <Button
          size="sm"
          onClick={onOpen}
          className="bg-[#1A2340] hover:bg-[#2a3660] text-white text-xs h-8 px-4 rounded-xl"
        >
          <MessageSquare size={12} className="mr-1.5" />
          Open Chat
        </Button>
      </div>
    </div>
  );
}

function EngagementStartOtpEntry({ engagementId }: { engagementId: number }) {
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  async function handleSubmit() {
    const code = otp.trim();
    if (code.length === 0) { toast({ title: "Enter the start code", variant: "destructive" }); return; }
    setLoading(true);
    try {
      const res = await fetchWithAuth(`/api/engagements/${engagementId}/confirm-start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otp: code }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        toast({ title: d.error ?? "Incorrect code — try again", variant: "destructive" });
        setOtp("");
        return;
      }
      toast({ title: "Engagement started!", description: "Your engagement is now active." });
      queryClient.invalidateQueries({ queryKey: ["pro-engagements"] });
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
      <p className="text-sm font-semibold text-amber-800">📋 Enter the parent's start code to begin</p>
      <p className="text-xs text-amber-700">Ask the parent to open their app — the start code appears on the engagement start date.</p>
      <div className="flex gap-2">
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          placeholder="_ _ _ _ _ _"
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
          className="flex-1 h-9 text-center text-lg font-mono tracking-widest border border-amber-300 rounded-xl px-3 outline-none focus:ring-2 focus:ring-amber-400 bg-white"
          onKeyDown={(e) => { if (e.key === "Enter") void handleSubmit(); }}
        />
        <Button
          size="sm"
          className="h-9 px-4 rounded-xl text-xs text-white bg-amber-500 hover:bg-amber-600"
          onClick={() => void handleSubmit()}
          disabled={loading || otp.length === 0}
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : "Confirm Start"}
        </Button>
      </div>
    </div>
  );
}

function TrialOtpEntry({ matchId, type }: { matchId: number; type: "start" | "end" }) {
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const isStart = type === "start";
  const endpoint = isStart
    ? `/api/shadow-teacher/${matchId}/verify-trial-start-otp`
    : `/api/shadow-teacher/${matchId}/verify-trial-end-otp`;

  async function handleSubmit() {
    const code = otp.trim();
    if (code.length !== 6) {
      toast({ title: "Enter the 6-digit code", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const res = await fetchWithAuth(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otp: code }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        toast({ title: d.error ?? "Incorrect code — try again", variant: "destructive" });
        setOtp("");
        return;
      }
      toast({
        title: isStart ? "Trial day started!" : "Trial day complete!",
        description: isStart
          ? "The parent will now see the end code."
          : "The parent will now decide whether to commit.",
      });
      window.location.reload();
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`mt-3 p-3 rounded-xl space-y-2 ${isStart ? "bg-orange-50 border border-orange-200" : "bg-indigo-50 border border-indigo-200"}`}>
      <p className={`text-xs font-semibold ${isStart ? "text-orange-800" : "text-indigo-800"}`}>
        {isStart ? "Enter parent's start code to begin the trial" : "Enter parent's end code to complete the trial"}
      </p>
      <p className={`text-xs ${isStart ? "text-orange-600" : "text-indigo-600"}`}>
        Ask the parent to open their app and share the {isStart ? "start" : "end"} code with you.
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          placeholder="_ _ _ _ _ _"
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
          className={`flex-1 h-9 text-center text-lg font-mono tracking-widest border rounded-xl px-3 outline-none focus:ring-2 ${
            isStart
              ? "border-orange-300 focus:ring-orange-300 bg-white"
              : "border-indigo-300 focus:ring-indigo-300 bg-white"
          }`}
          onKeyDown={(e) => { if (e.key === "Enter") void handleSubmit(); }}
        />
        <Button
          size="sm"
          className={`h-9 px-4 rounded-xl text-xs text-white ${isStart ? "bg-orange-500 hover:bg-orange-600" : "bg-indigo-600 hover:bg-indigo-700"}`}
          onClick={handleSubmit}
          disabled={loading || otp.length !== 6}
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : (isStart ? "Start" : "End")}
        </Button>
      </div>
    </div>
  );
}

function TrialDirectPayConfirm({ matchId, confirmedAt }: { matchId: number; confirmedAt: string | null }) {
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(!!confirmedAt);
  const { toast } = useToast();

  async function handleConfirm() {
    setLoading(true);
    try {
      const res = await fetchWithAuth(`/api/shadow-teacher/${matchId}/confirm-trial-direct-pay`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        toast({ title: d.error ?? "Failed to confirm", variant: "destructive" });
        return;
      }
      setConfirmed(true);
      toast({ title: "Receipt confirmed ✓" });
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  if (confirmed) {
    return (
      <div className="mb-2 p-3 bg-green-50 border border-green-200 rounded-xl">
        <p className="text-xs font-semibold text-green-800">✓ You confirmed receiving the trial fee directly</p>
      </div>
    );
  }

  return (
    <div className="mb-2 p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
      <p className="text-xs font-semibold text-amber-800">💸 Parent says they've paid the trial fee to your UPI ID</p>
      <p className="text-xs text-amber-700">Check your UPI app, then confirm once you've received it.</p>
      <Button
        size="sm"
        onClick={() => void handleConfirm()}
        disabled={loading}
        className="h-8 px-4 rounded-xl text-xs text-white bg-amber-500 hover:bg-amber-600"
      >
        {loading ? <Loader2 size={12} className="animate-spin" /> : "Confirm I received it"}
      </Button>
    </div>
  );
}

function EnquiriesTab() {
  const { data: me } = useGetMe();
  const [candidacies, setCandidacies] = useState<Candidacy[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Candidacy | null>(null);

  // Task 3B — named so the redesigned-journey action components (respond-request,
  // confirm-interview, accept-trial) can refresh this plain-state list after a
  // mutation. This tab predates React Query adoption in this file; re-fetching
  // directly avoids a larger unrelated refactor to useQuery.
  function refetchCandidacies() {
    return fetchWithAuth("/api/shadow-teacher/my-candidacies")
      .then(r => r.json())
      .then((data: unknown) => { if (Array.isArray(data)) setCandidacies(data as Candidacy[]); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => { void refetchCandidacies(); }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 size={24} className="animate-spin text-[#2EC4A5]" />
      </div>
    );
  }

  const ACTIONABLE_STATUSES = new Set(["shortlisted", "pending_payment", "trial_pending", "trial_started", "trial_done"]);
  const actionable = candidacies.filter((c) => ACTIONABLE_STATUSES.has(c.matchStatus));

  if (candidacies.length === 0) {
    return (
      <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center shadow-sm">
        <Users size={36} className="mx-auto mb-3 text-gray-300" />
        <p className="font-semibold text-gray-600">No match requests yet</p>
        <p className="text-sm text-gray-400 mt-1 max-w-xs mx-auto">
          Once a parent shortlists you as a shadow teacher candidate, their request will appear here.
        </p>
      </div>
    );
  }

  if (actionable.length === 0) {
    return (
      <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center shadow-sm">
        <Users size={36} className="mx-auto mb-3 text-gray-300" />
        <p className="font-semibold text-gray-600">No active enquiries</p>
        <p className="text-sm text-gray-400 mt-1 max-w-xs mx-auto">
          All past match requests have been resolved. New shortlists will appear here.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        <div className="mb-2">
          <h2 className="text-lg font-serif font-semibold text-[#1A2340]">Match Requests</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Parents who have shortlisted you as a shadow teacher candidate.
          </p>
        </div>
        {actionable.map((c) => (
          <CandidacyCard key={c.candidateId} candidacy={c} onOpen={() => setSelected(c)} myUserId={(me as unknown as { id?: number })?.id ?? 0} onUpdated={refetchCandidacies} />
        ))}
      </div>
      {selected && (
        <ShadowMatchChatDrawer
          matchId={selected.matchId}
          candidateId={selected.candidateId}
          candidateName={selected.childCity ? `Parent — ${selected.childCity}` : "Parent"}
          committed={selected.isSelected}
          myUserId={(me as { id?: number } | undefined)?.id ?? 0}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN: PROFESSIONAL DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════
export default function ProfessionalDashboard() {
  const { user } = useUser();
  const [loc] = useLocation();
  const { data: me } = useGetMe();
  const { data: profile, isLoading: profileLoading } = useGetMyProfessionalProfile();

  const [activeTab, setActiveTab] = useState<ProTab>(() => {
    if (loc.startsWith("/pro/calendar"))    return "availability";
    if (loc.startsWith("/pro/inbox"))       return "messages";
    if (loc.startsWith("/pro/earnings"))    return "earnings";
    if (loc.startsWith("/pro/enquiries"))   return "enquiries";
    if (loc.startsWith("/pro/engagement"))  return "engagement";
    if (loc.startsWith("/pro/vertical-requests")) return "vertical-requests";
    return "home";
  });
  useEffect(() => {
    if (loc.startsWith("/pro/calendar"))             setActiveTab("availability");
    else if (loc.startsWith("/pro/inbox"))           setActiveTab("messages");
    else if (loc.startsWith("/pro/earnings"))        setActiveTab("earnings");
    else if (loc.startsWith("/pro/enquiries"))       setActiveTab("enquiries");
    else if (loc.startsWith("/pro/engagement"))      setActiveTab("engagement");
    else if (loc.startsWith("/pro/vertical-requests")) setActiveTab("vertical-requests");
    else if (loc.startsWith("/pro/today"))           setActiveTab("home");
  }, [loc]);
  const firstName = me?.fullName?.split(" ")[0] ?? user?.firstName ?? "there";
  const profileTyped = profile as ProfessionalProfile | undefined;

  // Unread notification count (badge on sidebar)
  const { data: notifications } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => fetchWithAuth("/api/notifications").then((r) => r.json()) as Promise<unknown>,
    select: (d: unknown): Notification[] => Array.isArray(d) ? d as Notification[] : ((d as { notifications?: Notification[] })?.notifications ?? []),
  });
  const unreadCount = (notifications ?? []).filter((n) => !n.isRead).length;

  if (profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F7FA]">
        <div className="text-center">
          <Loader2 size={28} className="animate-spin text-[#2EC4A5] mx-auto mb-2" />
          <p className="text-sm text-gray-500">Loading your dashboard…</p>
        </div>
      </div>
    );
  }

  function handleTabChange(tab: ProTab) {
    setActiveTab(tab);
  }

  return (
    <div className="bg-[#F5F7FA]">
      <main className="px-4 sm:px-6 py-6 max-w-[900px] w-full mx-auto">
        {activeTab === "home"          && <HomeTab profile={profileTyped} firstName={firstName} onTabChange={handleTabChange} />}
        {activeTab === "profile"       && <ProfileTab profile={profileTyped} />}
        {activeTab === "availability"  && <AvailabilityTab />}
        {activeTab === "bookings"      && <BookingsTab />}
        {activeTab === "earnings"      && <EarningsTab />}
        {activeTab === "certifications"&& <CertificationsTab />}
        {activeTab === "verification"  && <VerificationTab />}
        {activeTab === "engagement"    && <EngagementTab />}
        {activeTab === "messages"      && <MessagesTab />}
        {activeTab === "notifications" && <NotificationsTab />}
        {activeTab === "enquiries"     && <EnquiriesTab />}
        {activeTab === "vertical-requests" && <VerticalRequestsTab />}
      </main>
    </div>
  );
}
