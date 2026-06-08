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
import { FileUploadField } from "@/components/FileUploadField";
import { StarRating } from "@/components/StarRating";
import { getSpecialtyLabel } from "@/lib/specialties";
import { fetchWithAuth } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import {
  Home, User, CalendarClock, CalendarCheck, IndianRupee, Award,
  ShieldCheck, Bell, Settings, Loader2, CheckCircle2, XCircle,
  Clock, AlertCircle, Eye, Phone, Mail, MapPin, Star, Unlock,
  Edit3, Save, HelpCircle, BadgeCheck, FileText, ChevronRight,
  Menu, X, Plus, Trash2, TrendingUp, Check, MessageSquare, Send, ChevronLeft,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
type ProTab = "home" | "profile" | "availability" | "bookings" | "earnings" | "certifications" | "verification" | "notifications" | "messages";

interface Notification { id: number; title: string; body: string; read: boolean; createdAt: string; }
interface CertDoc { id: number; documentType: string; fileKey: string; uploadedAt: string; }
type SlotDraft = { dayOfWeek: number; startTime: string; endTime: string; slotDurationMinutes: number; priceInr: number; };

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

// ─── Nav ──────────────────────────────────────────────────────────────────────
const NAV_ITEMS: { id: ProTab; label: string; icon: React.ReactNode }[] = [
  { id: "home",         label: "Home",             icon: <Home size={18} /> },
  { id: "profile",      label: "My Profile",       icon: <User size={18} /> },
  { id: "availability", label: "Availability",     icon: <CalendarClock size={18} /> },
  { id: "bookings",     label: "Bookings",         icon: <CalendarCheck size={18} /> },
  { id: "earnings",     label: "My Earnings",      icon: <IndianRupee size={18} /> },
  { id: "certifications",label: "Certifications",  icon: <Award size={18} /> },
  { id: "verification", label: "ID Verification",  icon: <ShieldCheck size={18} /> },
  { id: "messages",     label: "Messages",         icon: <MessageSquare size={18} /> },
  { id: "notifications",label: "Notifications",    icon: <Bell size={18} /> },
];
const MOBILE_BOTTOM: ProTab[] = ["home", "profile", "bookings", "messages", "notifications"];

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
    { label: "Session Details", done: !!(profile?.pricingMinINR || profile?.pricingMaxINR), tab: "profile" as ProTab },
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
        <div>
          <Label className="text-sm font-medium text-gray-700 mb-2 block">Session Fee (₹)</Label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">₹</span>
              <Input
                type="number"
                min={0}
                placeholder="Min"
                value={feeMin}
                onChange={(e) => setFeeMin(e.target.value === "" ? "" : Number(e.target.value))}
                className="pl-7 rounded-lg focus-visible:ring-[#2EC4A5]"
                aria-label="Minimum session fee"
              />
            </div>
            <span className="text-gray-400 text-sm">–</span>
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">₹</span>
              <Input
                type="number"
                min={0}
                placeholder="Max"
                value={feeMax}
                onChange={(e) => setFeeMax(e.target.value === "" ? "" : Number(e.target.value))}
                className="pl-7 rounded-lg focus-visible:ring-[#2EC4A5]"
                aria-label="Maximum session fee"
              />
            </div>
            <Button
              size="sm"
              onClick={saveFee}
              disabled={feeSaving}
              className="bg-[#2EC4A5] hover:bg-[#26a88d] text-white shrink-0 focus-visible:ring-2 focus-visible:ring-[#2EC4A5]"
              aria-label="Save session fee"
            >
              {feeSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            </Button>
          </div>
        </div>

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
function ProfileTab({ profile }: { profile: ProfessionalProfile | undefined }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { mutateAsync: patchProfile, isPending } = useUpdateProfessionalProfile();
  const [editing, setEditing] = useState(false);

  const [form, setForm] = useState({
    fullName: profile?.fullName ?? "",
    bio: profile?.bio ?? "",
    qualifications: profile?.qualifications ?? "",
    yearsExperience: profile?.yearsExperience ?? 0,
    city: profile?.city ?? "",
    displayArea: profile?.displayArea ?? "",
    phone: profile?.phone ?? "",
    email: profile?.email ?? "",
    pricingMinINR: profile?.pricingMinINR ?? 0,
    pricingMaxINR: profile?.pricingMaxINR ?? 0,
    offersHomeVisits: profile?.offersHomeVisits ?? false,
    willingToTravel: profile?.willingToTravel ?? false,
    travelRadiusKm: profile?.travelRadiusKm ?? 0,
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
        phone: profile.phone ?? "",
        email: profile.email ?? "",
        pricingMinINR: profile.pricingMinINR ?? 0,
        pricingMaxINR: profile.pricingMaxINR ?? 0,
        offersHomeVisits: profile.offersHomeVisits ?? false,
        willingToTravel: profile.willingToTravel ?? false,
        travelRadiusKm: profile.travelRadiusKm ?? 0,
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
          phone: form.phone.trim() || undefined,
          email: form.email.trim() || undefined,
          pricingMinINR: Number(form.pricingMinINR) || undefined,
          pricingMaxINR: Number(form.pricingMaxINR) || undefined,
          offersHomeVisits: form.offersHomeVisits,
          willingToTravel: form.willingToTravel,
          travelRadiusKm: Number(form.travelRadiusKm) || undefined,
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
        <p className="text-sm text-gray-400 mb-5">Create your professional profile to appear in search results.</p>
        <Link href="/onboard"><Button className="bg-[#2EC4A5] hover:bg-[#26a88d]">Set up profile</Button></Link>
      </div>
    );
  }

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
            <span>₹{profile.pricingMinINR ?? "?"}–₹{profile.pricingMaxINR ?? "?"}/session</span>
          )}
        </div>
      </div>

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
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm">City</Label>
                <Input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} className="mt-1 rounded-lg focus-visible:ring-[#2EC4A5]" aria-label="City" />
              </div>
              <div>
                <Label className="text-sm">Display Area</Label>
                <Input value={form.displayArea} onChange={(e) => setForm((f) => ({ ...f, displayArea: e.target.value }))} className="mt-1 rounded-lg focus-visible:ring-[#2EC4A5]" placeholder="e.g. Bandra West, Mumbai" aria-label="Display area" />
              </div>
            </div>
          </div>

          {/* Session */}
          <div className="space-y-4 pt-4 border-t border-gray-50">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Session Details</p>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm">Min Fee (₹)</Label>
                <div className="relative mt-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">₹</span>
                  <Input type="number" min={0} value={form.pricingMinINR} onChange={(e) => setForm((f) => ({ ...f, pricingMinINR: Number(e.target.value) }))} className="pl-7 rounded-lg focus-visible:ring-[#2EC4A5]" aria-label="Minimum fee" />
                </div>
              </div>
              <div>
                <Label className="text-sm">Max Fee (₹)</Label>
                <div className="relative mt-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">₹</span>
                  <Input type="number" min={0} value={form.pricingMaxINR} onChange={(e) => setForm((f) => ({ ...f, pricingMaxINR: Number(e.target.value) }))} className="pl-7 rounded-lg focus-visible:ring-[#2EC4A5]" aria-label="Maximum fee" />
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
                  <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className="pl-9 rounded-lg focus-visible:ring-[#2EC4A5]" aria-label="Contact email" />
                </div>
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

// ─── Booking card with OTP verification ────────────────────────────────────────
function BookingCard({ s, onRefresh }: { s: SessionBookingWithDetails; onRefresh: () => void }) {
  const { toast } = useToast();
  const [startOtpInput, setStartOtpInput] = useState("");
  const [endOtpInput, setEndOtpInput] = useState("");
  const [loading, setLoading] = useState<"start" | "end" | null>(null);
  const sa = s as any;

  const isPast = ["completed", "cancelled_by_parent", "cancelled_by_professional", "no_show"].includes(s.status);
  const isStarted = !!sa.startedAt;

  const STATUS_COLOR: Record<string, string> = {
    confirmed: "bg-green-100 text-green-700",
    pending_payment: "bg-yellow-100 text-yellow-700",
    completed: "bg-gray-100 text-gray-600",
    cancelled_by_parent: "bg-red-100 text-red-600",
    cancelled_by_professional: "bg-red-100 text-red-600",
    no_show: "bg-red-100 text-red-600",
  };

  async function verifyOtp(type: "start" | "end") {
    const otp = type === "start" ? startOtpInput.trim() : endOtpInput.trim();
    if (otp.length !== 6) { toast({ title: "Enter the 6-digit code", variant: "destructive" }); return; }
    setLoading(type);
    try {
      const res = await fetchWithAuth(`/api/sessions/${s.id}/verify-${type}-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otp }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ title: data.error ?? "Error", variant: "destructive" }); return; }
      toast({ title: type === "start" ? "Session started ✓" : "Session completed 🎉" });
      if (type === "start") setStartOtpInput(""); else setEndOtpInput("");
      onRefresh();
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setLoading(null);
    }
  }

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
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLOR[s.status] ?? "bg-gray-100 text-gray-600"}`}>
            {s.status.replace(/_/g, " ")}
          </span>
          {isStarted && s.status === "confirmed" && (
            <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium">In progress</span>
          )}
        </div>
      </div>
      {s.amountInr > 0 && <p className="text-xs text-green-700 mt-2 font-semibold">₹{s.amountInr}</p>}
      {s.notes && <p className="text-xs text-gray-400 mt-2 italic">{s.notes}</p>}

      {/* OTP verification — only shown for confirmed upcoming sessions */}
      {!isPast && s.status === "confirmed" && (
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
          {!isStarted ? (
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
          ) : (
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
          )}
          <p className="text-[10px] text-gray-400">Ask the parent for the 6-digit code shown in their app.</p>
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

  const STATUS_COLOR: Record<string, string> = {
    confirmed: "bg-green-100 text-green-700",
    pending_payment: "bg-yellow-100 text-yellow-700",
    completed: "bg-gray-100 text-gray-600",
    cancelled_by_parent: "bg-red-100 text-red-600",
    cancelled_by_professional: "bg-red-100 text-red-600",
    no_show: "bg-red-100 text-red-600",
  };

  const shown = typedSessions.filter((s) => {
    const isPast = ["completed", "cancelled_by_parent", "cancelled_by_professional", "no_show"].includes(s.status);
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
function EarningsTab() {
  const { data: sessions = [] } = useGetMySessions({ role: "professional" } as Parameters<typeof useGetMySessions>[0]);
  const typedSessions = sessions as SessionBookingWithDetails[];
  const completed = typedSessions.filter((s) => s.status === "completed");
  const totalEarnings = completed.reduce((sum, s) => sum + (s.amountInr ?? 0), 0);

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-serif font-semibold text-[#1A2340]">My Earnings</h1>

      <div className="grid sm:grid-cols-3 gap-4">
        {[
          { label: "Total Earned", value: `₹${totalEarnings.toLocaleString("en-IN")}`, icon: <IndianRupee size={16} className="text-green-600" />, bg: "bg-green-50" },
          { label: "Completed Sessions", value: completed.length, icon: <CalendarCheck size={16} className="text-[#2EC4A5]" />, bg: "bg-[#2EC4A5]/10" },
          { label: "This Month", value: `₹${completed.filter((s) => new Date(s.bookedDate).getMonth() === new Date().getMonth()).reduce((sum, s) => sum + (s.amountInr ?? 0), 0).toLocaleString("en-IN")}`, icon: <TrendingUp size={16} className="text-violet-600" />, bg: "bg-violet-50" },
        ].map((stat) => (
          <div key={stat.label} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-[0_4px_24px_rgba(26,35,64,0.08)]">
            <div className={`w-9 h-9 ${stat.bg} rounded-xl flex items-center justify-center mb-3`}>{stat.icon}</div>
            <p className="text-2xl font-bold font-serif text-[#1A2340]">{stat.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="bg-[#FFB830]/10 border border-[#FFB830]/30 rounded-xl p-4 flex items-start gap-3">
        <AlertCircle size={16} className="text-[#FFB830] mt-0.5 shrink-0" />
        <p className="text-sm text-[#1A2340]">
          <strong>Includly is currently free.</strong> Earnings tracking will activate once paid sessions are enabled. During the beta period, all session fees are ₹0 and earnings are ₹0.
        </p>
      </div>

      {completed.length > 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl shadow-[0_4px_24px_rgba(26,35,64,0.08)] overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-50">
            <h2 className="font-semibold text-[#1A2340]">Completed Sessions</h2>
          </div>
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
      ) : (
        <div className="bg-white border border-gray-100 rounded-2xl p-10 text-center shadow-sm">
          <IndianRupee size={36} className="mx-auto mb-3 text-gray-300" />
          <p className="font-semibold text-gray-500">No completed sessions yet</p>
          <p className="text-sm text-gray-400 mt-1">Earnings will appear here as you complete sessions with parents.</p>
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
  const { data: notifications, isLoading } = useQuery<Notification[]>({
    queryKey: ["notifications"],
    queryFn: () => fetchWithAuth("/api/notifications").then((r) => r.json()),
  });

  async function markRead(id: number) {
    await fetchWithAuth(`/api/notifications/${id}/read`, { method: "PATCH" });
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  }
  async function markAllRead() {
    await fetchWithAuth("/api/notifications/read-all", { method: "PATCH" });
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  }

  const unreadCount = (notifications ?? []).filter((n) => !n.read).length;

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
              className={`flex items-start gap-3 px-5 py-4 cursor-pointer transition-colors ${!n.read ? "bg-[#2EC4A5]/5 hover:bg-[#2EC4A5]/10" : "hover:bg-gray-50"}`}
              onClick={() => !n.read && markRead(n.id)}
            >
              <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${n.read ? "bg-transparent" : "bg-[#2EC4A5]"}`} />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${n.read ? "text-gray-600" : "text-[#1A2340]"}`}>{n.title}</p>
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
interface ConnectThread { id: number; parentId: number; parentName: string | null; createdAt: string; }
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
        <h2 className="font-serif font-semibold text-[#1A2340] text-lg">{selectedThread.parentName ?? "Parent"}</h2>

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
                <span className="text-sm font-bold text-[#2EC4A5]">{(thread.parentName ?? "P")[0]?.toUpperCase()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-[#1A2340] text-sm">{thread.parentName ?? "Parent"}</p>
                <p className="text-xs text-gray-400 mt-0.5">Tap to open conversation</p>
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
// MAIN: PROFESSIONAL DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════
export default function ProfessionalDashboard() {
  const { user } = useUser();
  const [, setLocation] = useLocation();
  const { data: me } = useGetMe();
  const { data: profile, isLoading: profileLoading } = useGetMyProfessionalProfile();
  const [activeTab, setActiveTab] = useState<ProTab>("home");
  const [drawerOpen, setDrawerOpen] = useState(false);

  const firstName = me?.fullName?.split(" ")[0] ?? user?.firstName ?? "there";
  const profileTyped = profile as ProfessionalProfile | undefined;

  // Unread notification count (badge on sidebar)
  const { data: notifications } = useQuery<Notification[]>({
    queryKey: ["notifications"],
    queryFn: () => fetchWithAuth("/api/notifications").then((r) => r.json()),
  });
  const unreadCount = (notifications ?? []).filter((n) => !n.read).length;

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
    setDrawerOpen(false);
  }

  function handleNavClick(id: ProTab) {
    if (id === "notifications" || true) {
      handleTabChange(id);
    }
  }

  return (
    <div className="min-h-screen bg-[#F5F7FA] flex">
      {/* Mobile drawer overlay */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
      )}

      {/* ── SIDEBAR ──────────────────────────────────────────────────────── */}
      <aside
        className={`fixed top-0 bottom-0 left-0 z-50 w-[240px] bg-white border-r border-gray-100 flex flex-col transition-transform duration-200 md:top-16 md:translate-x-0 md:z-30 ${drawerOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}
        aria-label="Professional dashboard sidebar"
      >
        {/* Avatar + close (mobile) */}
        <div className="p-5 border-b border-gray-100 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#2EC4A5] flex items-center justify-center text-white font-bold text-sm shrink-0">
            {initials(me?.fullName ?? user?.fullName)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm text-[#1A2340] truncate">{me?.fullName ?? user?.fullName ?? "Professional"}</p>
            {profileTyped && (
              <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${profileTyped.verificationStatus === "verified" ? "text-green-700 bg-green-50" : profileTyped.verificationStatus === "pending" ? "text-amber-700 bg-amber-50" : "text-gray-500 bg-gray-50"}`}>
                {profileTyped.verificationStatus === "verified" ? "✓ Verified" : profileTyped.verificationStatus === "pending" ? "⏳ Pending" : "Unverified"}
              </span>
            )}
          </div>
          <button onClick={() => setDrawerOpen(false)} className="md:hidden p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-2 overflow-y-auto" aria-label="Dashboard navigation">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => handleNavClick(item.id)}
              aria-label={item.label}
              aria-current={activeTab === item.id ? "page" : undefined}
              className={`w-full flex items-center gap-3 px-5 py-3 text-sm font-medium transition-colors text-left ${
                activeTab === item.id
                  ? "bg-[#2EC4A5]/10 text-[#2EC4A5] border-r-2 border-[#2EC4A5]"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
            >
              {item.icon}
              <span className="flex-1">{item.label}</span>
              {item.id === "notifications" && unreadCount > 0 && (
                <span className="text-[10px] font-bold bg-[#FF6B6B] text-white rounded-full w-5 h-5 flex items-center justify-center shrink-0">{unreadCount}</span>
              )}
            </button>
          ))}

          <div className="mx-3 my-2 border-t border-gray-100" />
          <button
            onClick={() => setLocation("/account")}
            className="w-full flex items-center gap-3 px-5 py-3 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors text-left"
            aria-label="Account Settings"
          >
            <Settings size={18} />
            Account Settings
          </button>
        </nav>

        <div className="p-4 border-t border-gray-100 space-y-1">
          <a href="/support" className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-600 transition-colors px-1">
            <HelpCircle size={14} /> Need Help?
          </a>
          <p className="text-xs text-gray-300 px-1">Includly · Professional</p>
        </div>
      </aside>

      {/* ── MAIN CONTENT ─────────────────────────────────────────────────── */}
      <div className="flex-1 md:ml-[240px] flex flex-col min-w-0">
        {/* Mobile top bar */}
        <div className="md:hidden sticky top-16 z-30 bg-white border-b border-gray-100 px-4 h-12 flex items-center gap-3 shadow-sm">
          <button
            onClick={() => setDrawerOpen(true)}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600 focus-visible:ring-2 focus-visible:ring-[#2EC4A5]"
            aria-label="Open navigation"
            data-testid="mobile-menu-btn"
          >
            <Menu size={20} />
          </button>
          <span className="font-semibold text-[#1A2340] text-sm">
            {NAV_ITEMS.find((n) => n.id === activeTab)?.label ?? "Dashboard"}
          </span>
        </div>

        <main className="flex-1 px-4 sm:px-6 py-6 pb-24 md:pb-6 max-w-[900px] w-full mx-auto">
          {activeTab === "home"          && <HomeTab profile={profileTyped} firstName={firstName} onTabChange={handleTabChange} />}
          {activeTab === "profile"       && <ProfileTab profile={profileTyped} />}
          {activeTab === "availability"  && <AvailabilityTab />}
          {activeTab === "bookings"      && <BookingsTab />}
          {activeTab === "earnings"      && <EarningsTab />}
          {activeTab === "certifications"&& <CertificationsTab />}
          {activeTab === "verification"  && <VerificationTab />}
          {activeTab === "messages"      && <MessagesTab />}
          {activeTab === "notifications" && <NotificationsTab />}
        </main>
      </div>

      {/* ── MOBILE BOTTOM TAB BAR ─────────────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-gray-100 z-40 flex" aria-label="Mobile bottom navigation">
        {MOBILE_BOTTOM.map((id) => {
          const item = NAV_ITEMS.find((n) => n.id === id)!;
          return (
            <button
              key={id}
              onClick={() => handleTabChange(id)}
              aria-label={item.label}
              aria-current={activeTab === id ? "page" : undefined}
              className={`flex-1 flex flex-col items-center justify-center py-2 gap-1 transition-colors relative ${activeTab === id ? "text-[#2EC4A5]" : "text-gray-400 hover:text-gray-600"}`}
            >
              {item.icon}
              <span className="text-[10px] leading-none">{item.label.split(" ")[0]}</span>
              {id === "notifications" && unreadCount > 0 && (
                <span className="absolute top-1.5 right-[calc(50%-10px)] w-3.5 h-3.5 text-[8px] font-bold bg-[#FF6B6B] text-white rounded-full flex items-center justify-center">{unreadCount}</span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
