import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useGetMe,
  useGetParentDashboard,
  useGetMySessions,
  useGetMyUnlocks,
  useSearchProfessionals,
  useCreateRating,
  useGetWalletBalance,
  getGetMeQueryKey,
} from "@workspace/api-client-react";
import type { ProfessionalSearchResult, SessionBookingWithDetails, ContactUnlock } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { StarRating } from "@/components/StarRating";
import { fetchWithAuth } from "@/lib/api";
import { getSpecialtyLabel } from "@/lib/specialties";
import { useToast } from "@/hooks/use-toast";
import {
  Home, Search, CalendarCheck, Unlock, Bell, BookOpen, Settings,
  Star, MapPin, Loader2, ChevronDown, CheckCircle2,
  Clock, Video, Navigation, User, ArrowRight, HelpCircle,
  Phone, Mail, MessageSquarePlus, Check, X, Filter, Wallet,
} from "lucide-react";

type Tab = "home" | "find" | "bookings" | "unlocks" | "notifications";

interface Notification {
  id: number;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

const NAV_ITEMS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "home",          label: "Home",               icon: <Home size={18} /> },
  { id: "find",          label: "Find Professionals", icon: <Search size={18} /> },
  { id: "bookings",      label: "My Bookings",        icon: <CalendarCheck size={18} /> },
  { id: "unlocks",       label: "My Unlocks",         icon: <Unlock size={18} /> },
  { id: "notifications", label: "Notifications",      icon: <Bell size={18} /> },
];

const SPECIALTIES = [
  { value: "", label: "All Specialties" },
  { value: "shadow_teacher", label: "Shadow Teacher" },
  { value: "speech_therapy", label: "Speech Therapy" },
  { value: "occupational_therapy", label: "Occupational Therapy" },
  { value: "aba_therapy", label: "ABA Therapy" },
  { value: "sensory_integration", label: "Sensory Integration" },
  { value: "special_educator", label: "Special Educator" },
  { value: "child_psychologist", label: "Child Psychologist" },
  { value: "therapy_centre", label: "Therapy Centre" },
];

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Good night";
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { weekday: "short", month: "short", day: "numeric" });
}
function fmtTime(t: string) {
  const [h, m] = t.split(":");
  const hr = Number(h);
  return `${hr % 12 || 12}:${m} ${hr < 12 ? "AM" : "PM"}`;
}
function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const hr = Math.floor(m / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function initials(name?: string | null) {
  if (!name) return "?";
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

// ─── Professional card used in Find + Unlocks + Recommendations ───────────────
function ProfCard({
  p,
  showContact = false,
  onReview,
  hasReviewed,
}: {
  p: ProfessionalSearchResult;
  showContact?: boolean;
  onReview?: () => void;
  hasReviewed?: boolean;
}) {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-xl bg-teal-100 flex items-center justify-center text-teal-700 font-bold text-sm shrink-0">
          {initials(p.fullName)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 truncate">{p.fullName ?? "Professional"}</p>
          <div className="flex flex-wrap gap-1 mt-1">
            <span className="text-xs px-2 py-0.5 bg-teal-50 text-teal-700 rounded-full border border-teal-100">
              {getSpecialtyLabel(p.specialty)}
            </span>
          </div>
        </div>
        {p.isVerified && (
          <Badge className="shrink-0 text-xs bg-green-50 text-green-700 border-green-200 hover:bg-green-50">
            <CheckCircle2 size={10} className="mr-1" />Verified
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-3 text-xs text-gray-500">
        {p.city && <span className="flex items-center gap-1"><MapPin size={11} />{p.city}</span>}
        {p.averageRating != null && p.totalRatings > 0 && (
          <span className="flex items-center gap-1">
            <Star size={11} className="fill-amber-400 text-amber-400" />
            {p.averageRating.toFixed(1)} ({p.totalRatings})
          </span>
        )}
        {p.pricingMinINR != null && (
          <span className="ml-auto font-medium text-gray-800">
            {p.pricingMinINR === 0 ? "Free intro" : `₹${p.pricingMinINR}+`}
          </span>
        )}
      </div>

      {showContact && (p.phone || p.email) && (
        <div className="bg-teal-50 rounded-xl p-3 space-y-1 text-xs">
          {p.phone && <p className="flex items-center gap-2 text-teal-800"><Phone size={12} />{p.phone}</p>}
          {p.email && <p className="flex items-center gap-2 text-teal-800"><Mail size={12} />{p.email}</p>}
        </div>
      )}

      <div className="flex gap-2 mt-auto pt-1">
        <Link href={`/professionals/${p.id}`} className="flex-1">
          <Button variant="outline" size="sm" className="w-full text-xs border-gray-200">
            View Profile
          </Button>
        </Link>
        {showContact && onReview && !hasReviewed && (
          <Button size="sm" variant="ghost" className="text-xs gap-1 text-teal-600" onClick={onReview}>
            <MessageSquarePlus size={13} /> Review
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Session card ──────────────────────────────────────────────────────────────
function SessionCard({ s, compact = false }: { s: SessionBookingWithDetails; compact?: boolean }) {
  const isPast = ["completed", "cancelled_by_parent", "cancelled_by_professional", "no_show"].includes(s.status);
  const statusColor: Record<string, string> = {
    confirmed: "bg-green-100 text-green-700",
    pending_payment: "bg-yellow-100 text-yellow-700",
    completed: "bg-gray-100 text-gray-600",
    cancelled_by_parent: "bg-red-100 text-red-600",
    cancelled_by_professional: "bg-red-100 text-red-600",
    no_show: "bg-red-100 text-red-600",
  };

  return (
    <div className={`bg-white border border-gray-100 rounded-xl p-4 ${compact ? "" : "shadow-sm"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-gray-900 text-sm">{s.professionalName ?? "Professional"}</p>
          {s.professionalSpecialty && (
            <p className="text-xs text-gray-500 mt-0.5">{getSpecialtyLabel(s.professionalSpecialty)}</p>
          )}
          <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
            <span className="flex items-center gap-1"><CalendarCheck size={11} />{fmtDate(s.bookedDate)}</span>
            <span className="flex items-center gap-1"><Clock size={11} />{fmtTime(s.startTime)}</span>
          </div>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${statusColor[s.status] ?? "bg-gray-100 text-gray-600"}`}>
          {s.status.replace(/_/g, " ")}
        </span>
      </div>
      {!isPast && s.status === "confirmed" && (
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="outline" className="gap-1 text-xs border-gray-200">
            <Video size={12} /> Join online
          </Button>
          {s.professionalCity && (
            <Button size="sm" variant="ghost" className="gap-1 text-xs text-gray-600">
              <Navigation size={12} /> Get directions
            </Button>
          )}
        </div>
      )}
      {s.notes && <p className="mt-2 text-xs text-gray-400 italic">{s.notes}</p>}
    </div>
  );
}

// ─── Review modal ──────────────────────────────────────────────────────────────
function ReviewModal({ professionalId, onClose }: { professionalId: number; onClose: () => void }) {
  const { toast } = useToast();
  const { mutateAsync: createRating, isPending } = useCreateRating();
  const [stars, setStars] = useState(5);
  const [review, setReview] = useState("");

  async function submit() {
    try {
      await createRating({ data: { professionalId, stars, review: review.trim() || undefined } });
      toast({ title: "Review submitted!" });
      onClose();
    } catch {
      toast({ title: "Could not submit review", variant: "destructive" });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900">Leave a review</h3>
          <button onClick={onClose}><X size={18} className="text-gray-400" /></button>
        </div>
        <div className="mb-4">
          <StarRating value={stars} onChange={setStars} interactive />
        </div>
        <textarea
          className="w-full border border-gray-200 rounded-xl p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-teal-400"
          rows={3}
          placeholder="Share your experience…"
          value={review}
          onChange={(e) => setReview(e.target.value)}
        />
        <div className="flex gap-2 mt-4">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1 bg-teal-600 hover:bg-teal-700" onClick={submit} disabled={isPending}>
            {isPending ? <Loader2 size={14} className="animate-spin" /> : "Submit"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB: HOME
// ═══════════════════════════════════════════════════════════════════════════════
function HomeTab({ parentName, city }: { parentName: string; city?: string | null }) {
  const { data: dashData } = useGetParentDashboard();
  const { data: sessions } = useGetMySessions();
  const { data: walletData } = useGetWalletBalance();

  const { data: recsData } = useSearchProfessionals(
    { city: city ?? undefined, limit: 4 } as Parameters<typeof useSearchProfessionals>[0],
    { query: { enabled: !!city } }
  );
  const recommendations = recsData?.professionals ?? [];

  const upcoming = (sessions ?? [])
    .filter((s) => ["confirmed", "pending_payment"].includes(s.status) && new Date(s.bookedDate) >= new Date())
    .sort((a, b) => new Date(a.bookedDate).getTime() - new Date(b.bookedDate).getTime())
    .slice(0, 2);

  const activity = [
    ...(dashData?.recentUnlocks ?? []).map((u) => ({
      id: `unlock-${u.id}`,
      text: `Unlocked ${u.professional?.fullName ?? "a professional"}'s contact`,
      time: u.unlockedAt,
      icon: <Unlock size={13} className="text-teal-600" />,
    })),
    ...(sessions ?? []).slice(0, 3).map((s) => ({
      id: `session-${s.id}`,
      text: `Booked a session with ${s.professionalName ?? "a professional"}`,
      time: s.createdAt ?? s.bookedDate,
      icon: <CalendarCheck size={13} className="text-violet-600" />,
    })),
  ]
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-serif font-semibold text-gray-900">
          {greeting()}, {parentName}!
        </h1>
        <p className="text-gray-500 text-sm mt-1">Here's what's happening on your Includly dashboard.</p>
      </div>

      {/* Wallet widget */}
      {walletData !== undefined && (
        <div className="bg-gradient-to-r from-[#1A2340] to-[#2a3660] rounded-2xl p-5 text-white shadow-[0_4px_24px_rgba(26,35,64,0.2)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-white/60 font-medium uppercase tracking-widest mb-1">Includly Wallet</p>
              <p className="text-3xl font-bold font-serif">₹{walletData.balanceInr}</p>
              <p className="text-xs text-white/50 mt-1">Available balance</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center">
              <Wallet size={22} className="text-[#2EC4A5]" />
            </div>
          </div>
        </div>
      )}

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Professionals Connected", value: dashData?.totalUnlocks ?? 0, icon: <Unlock size={16} className="text-teal-600" />, bg: "bg-teal-50" },
          { label: "Sessions Booked", value: (sessions ?? []).length, icon: <CalendarCheck size={16} className="text-violet-600" />, bg: "bg-violet-50" },
          { label: "Upcoming Sessions", value: upcoming.length, icon: <Clock size={16} className="text-orange-500" />, bg: "bg-orange-50" },
        ].map((stat) => (
          <div key={stat.label} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
            <div className={`w-9 h-9 ${stat.bg} rounded-xl flex items-center justify-center mb-3`}>
              {stat.icon}
            </div>
            <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Recommendations */}
      {city && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900">Professionals near {city}</h2>
            <Link href="/search">
              <Button variant="ghost" size="sm" className="text-teal-600 text-xs gap-1">
                See all <ArrowRight size={13} />
              </Button>
            </Link>
          </div>
          {recommendations.length === 0 ? (
            <div className="bg-white border border-gray-100 rounded-2xl p-6 text-center text-sm text-gray-400">
              No professionals found nearby yet — <Link href="/search" className="text-teal-600 underline">search all</Link>.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {recommendations.map((p) => <ProfCard key={p.id} p={p} />)}
            </div>
          )}
        </div>
      )}

      {/* Upcoming sessions widget */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900">Upcoming Sessions</h2>
          <Link href="#" onClick={() => {}}><span /></Link>
        </div>
        {upcoming.length === 0 ? (
          <div className="bg-white border border-gray-100 rounded-2xl p-6 text-center text-sm text-gray-400">
            No upcoming sessions. <Link href="/search" className="text-teal-600 underline">Find a professional</Link> to book.
          </div>
        ) : (
          <div className="space-y-3">
            {upcoming.map((s) => <SessionCard key={s.id} s={s} />)}
          </div>
        )}
      </div>

      {/* Recent activity */}
      {activity.length > 0 && (
        <div>
          <h2 className="font-semibold text-gray-900 mb-3">Recent Activity</h2>
          <div className="bg-white border border-gray-100 rounded-2xl divide-y divide-gray-50 shadow-sm">
            {activity.map((a) => (
              <div key={a.id} className="flex items-center gap-3 px-4 py-3">
                <div className="w-7 h-7 bg-gray-50 rounded-full flex items-center justify-center shrink-0">
                  {a.icon}
                </div>
                <p className="text-sm text-gray-700 flex-1">{a.text}</p>
                <span className="text-xs text-gray-400 shrink-0">{timeAgo(a.time)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Resource highlight */}
      <div className="bg-gradient-to-r from-teal-600 to-teal-500 rounded-2xl p-5 text-white flex items-center justify-between gap-4">
        <div>
          <div className="text-xs font-medium opacity-80 mb-1">Featured Resource</div>
          <h3 className="font-semibold">How to choose the right shadow teacher for your child</h3>
          <p className="text-xs opacity-80 mt-1 max-w-xs">A parent's guide to evaluating qualifications, communication style, and approach.</p>
        </div>
        <Link href="/support">
          <Button size="sm" className="bg-white text-teal-700 hover:bg-gray-50 shrink-0 gap-1">
            Read <ArrowRight size={13} />
          </Button>
        </Link>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB: FIND PROFESSIONALS
// ═══════════════════════════════════════════════════════════════════════════════
function FindTab() {
  const [specialty, setSpecialty] = useState("");
  const [city, setCity] = useState("");
  const [mode, setMode] = useState("");
  const [maxFee, setMaxFee] = useState<number | undefined>();
  const [submitted, setSubmitted] = useState(false);

  const modeParam = mode === "online" ? true : mode === "offline" ? false : undefined;
  const { data, isFetching } = useSearchProfessionals(
    {
      specialty: (specialty as Parameters<typeof useSearchProfessionals>[0]["specialty"]) || undefined,
      city: city || undefined,
      willingToTravel: modeParam,
      budgetMaxINR: maxFee,
      limit: 20,
    },
    { query: { enabled: submitted } }
  );

  const results = data?.professionals ?? [];

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-serif font-semibold text-gray-900">Find Professionals</h1>

      {/* Filters */}
      <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="relative">
            <select
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
              className="w-full h-10 pl-3 pr-8 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-teal-400 appearance-none"
            >
              {SPECIALTIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>

          <div className="relative">
            <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <Input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="City"
              className="pl-8 h-10 border-gray-200 bg-gray-50 text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="relative">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              className="w-full h-10 pl-3 pr-8 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-teal-400 appearance-none"
            >
              <option value="">Online / Offline</option>
              <option value="online">Online only</option>
              <option value="offline">Offline only</option>
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>

          <div className="relative">
            <Input
              type="number"
              min={0}
              max={10000}
              value={maxFee ?? ""}
              onChange={(e) => setMaxFee(e.target.value ? Number(e.target.value) : undefined)}
              placeholder="Max fee (₹)"
              className="h-10 border-gray-200 bg-gray-50 text-sm"
            />
          </div>
        </div>

        <Button
          className="w-full bg-teal-600 hover:bg-teal-700 text-white gap-2"
          onClick={() => setSubmitted(true)}
          disabled={isFetching}
        >
          {isFetching ? <Loader2 size={15} className="animate-spin" /> : <Filter size={15} />}
          {isFetching ? "Searching…" : "Search"}
        </Button>
      </div>

      {/* Results */}
      {submitted && (
        <>
          <p className="text-sm text-gray-500">{results.length} professional{results.length !== 1 ? "s" : ""} found</p>
          {results.length === 0 ? (
            <div className="text-center py-10 text-gray-400">No results — try different filters.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {results.map((p) => <ProfCard key={p.id} p={p} showContact={p.isUnlocked} />)}
            </div>
          )}
        </>
      )}

      {!submitted && (
        <div className="text-center py-10 text-gray-400 text-sm">
          Use the filters above to find professionals.
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB: MY UNLOCKS
// ═══════════════════════════════════════════════════════════════════════════════
function UnlocksTab() {
  const { data: unlocks, isLoading } = useGetMyUnlocks();
  const [reviewingId, setReviewingId] = useState<number | null>(null);

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-teal-600" /></div>;

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-serif font-semibold text-gray-900">My Unlocks</h1>

      {(!unlocks || unlocks.length === 0) ? (
        <div className="text-center py-16 text-gray-400">
          <Unlock size={32} className="mx-auto mb-3 text-gray-300" />
          <p className="font-medium text-gray-600">No unlocks yet</p>
          <p className="text-sm mt-1">Find a professional and unlock their contact details.</p>
          <Link href="/search">
            <Button className="mt-4 bg-teal-600 hover:bg-teal-700 gap-2">
              <Search size={15} /> Browse professionals
            </Button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {unlocks.map((unlock: ContactUnlock) => unlock.professional ? (
            <ProfCard
              key={unlock.id}
              p={unlock.professional}
              showContact
              onReview={() => setReviewingId(unlock.professionalId)}
            />
          ) : null)}
        </div>
      )}

      {reviewingId && (
        <ReviewModal professionalId={reviewingId} onClose={() => setReviewingId(null)} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB: MY BOOKINGS
// ═══════════════════════════════════════════════════════════════════════════════
function BookingsTab() {
  const { data: sessions, isLoading } = useGetMySessions();
  const [bookingTab, setBookingTab] = useState<"upcoming" | "past">("upcoming");

  const now = new Date();
  const upcoming = (sessions ?? [])
    .filter((s) => ["confirmed", "pending_payment"].includes(s.status) && new Date(s.bookedDate) >= now)
    .sort((a, b) => new Date(a.bookedDate).getTime() - new Date(b.bookedDate).getTime());

  const past = (sessions ?? [])
    .filter((s) => !upcoming.find((u) => u.id === s.id))
    .sort((a, b) => new Date(b.bookedDate).getTime() - new Date(a.bookedDate).getTime());

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-teal-600" /></div>;

  const shown = bookingTab === "upcoming" ? upcoming : past;

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-serif font-semibold text-gray-900">My Bookings</h1>

      <div className="inline-flex bg-gray-100 rounded-xl p-1 gap-1">
        {(["upcoming", "past"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setBookingTab(t)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              bookingTab === t ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "upcoming" ? `Upcoming (${upcoming.length})` : `Past (${past.length})`}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          No {bookingTab} bookings.
        </div>
      ) : (
        <div className="space-y-3">
          {shown.map((s) => <SessionCard key={s.id} s={s} />)}
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

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-teal-600" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-serif font-semibold text-gray-900">
          Notifications {unreadCount > 0 && <span className="text-sm font-normal text-gray-400">({unreadCount} unread)</span>}
        </h1>
        {unreadCount > 0 && (
          <Button variant="ghost" size="sm" className="text-xs text-teal-600 gap-1" onClick={markAllRead}>
            <Check size={13} /> Mark all read
          </Button>
        )}
      </div>

      {(!notifications || notifications.length === 0) ? (
        <div className="text-center py-16 text-gray-400">
          <Bell size={32} className="mx-auto mb-3 text-gray-300" />
          <p className="font-medium text-gray-600">No notifications yet</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-100 rounded-2xl divide-y divide-gray-50 shadow-sm">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`flex items-start gap-3 px-4 py-4 ${!n.read ? "bg-teal-50/40" : ""}`}
              onClick={() => !n.read && markRead(n.id)}
            >
              <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${n.read ? "bg-transparent" : "bg-teal-500"}`} />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${n.read ? "text-gray-600" : "text-gray-900"}`}>{n.title}</p>
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
// MAIN PARENT DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════
export default function ParentDashboard() {
  const { user } = useUser();
  const { data: me } = useGetMe();
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<Tab>("home");

  const firstName = me?.fullName?.split(" ")[0] ?? user?.firstName ?? "there";
  const city = me?.location ?? null;

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* ── SIDEBAR (desktop) ────────────────────────────────────────────── */}
      <aside className="hidden md:flex flex-col w-[240px] shrink-0 bg-white border-r border-gray-100 fixed top-16 bottom-0 z-30">
        {/* Avatar + user info */}
        <div className="p-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-teal-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
              {initials(me?.fullName ?? user?.fullName)}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm text-gray-900 truncate">{me?.fullName ?? user?.fullName ?? "Parent"}</p>
              {city && <p className="text-xs text-gray-500 flex items-center gap-1 truncate"><MapPin size={10} />{city}</p>}
            </div>
          </div>
        </div>

        {/* Nav items */}
        <nav className="flex-1 py-3 overflow-y-auto">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-5 py-3 text-sm font-medium transition-colors text-left ${
                activeTab === item.id
                  ? "bg-teal-50 text-teal-700 border-r-2 border-teal-600"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}

          <div className="mx-3 my-2 border-t border-gray-100" />

          <Link href="/support">
            <div className="w-full flex items-center gap-3 px-5 py-3 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors">
              <BookOpen size={18} />
              Resources
            </div>
          </Link>
          <Link href="/account">
            <div className="w-full flex items-center gap-3 px-5 py-3 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors">
              <Settings size={18} />
              Account Settings
            </div>
          </Link>
        </nav>

        {/* Bottom */}
        <div className="p-4 border-t border-gray-100 space-y-1">
          <a href="/support" className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-600 transition-colors px-1">
            <HelpCircle size={14} />
            Need Help?
          </a>
          <p className="text-xs text-gray-300 px-1">Includly v1.0</p>
        </div>
      </aside>

      {/* ── MAIN CONTENT ─────────────────────────────────────────────────── */}
      <main className="flex-1 md:ml-[240px] pb-20 md:pb-0">
        <div className="max-w-[860px] mx-auto px-4 sm:px-6 py-6">
          {activeTab === "home"          && <HomeTab parentName={firstName} city={city} />}
          {activeTab === "find"          && <FindTab />}
          {activeTab === "bookings"      && <BookingsTab />}
          {activeTab === "unlocks"       && <UnlocksTab />}
          {activeTab === "notifications" && <NotificationsTab />}
        </div>
      </main>

      {/* ── BOTTOM TAB BAR (mobile) ──────────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-gray-100 z-40 flex">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`flex-1 flex flex-col items-center justify-center py-2 gap-1 transition-colors ${
              activeTab === item.id ? "text-teal-600" : "text-gray-400 hover:text-gray-600"
            }`}
          >
            {item.icon}
            <span className="text-[10px] leading-none">{item.label.split(" ")[0]}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
