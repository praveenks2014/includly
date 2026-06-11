import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useGetMe,
  useGetParentDashboard,
  useGetMySessions,
  useSearchProfessionals,
  useCreateRating,
  useGetWalletBalance,
  getGetMeQueryKey,
} from "@workspace/api-client-react";
import type { ProfessionalSearchResult, SessionBookingWithDetails } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { StarRating } from "@/components/StarRating";
import { ShadowTeacherRequestWidget } from "@/components/ShadowTeacherRequestWidget";
import { fetchWithAuth } from "@/lib/api";
import { getSpecialtyLabel } from "@/lib/specialties";
import { useToast } from "@/hooks/use-toast";
import {
  Home, Search, CalendarCheck, Bell, BookOpen, Settings,
  Star, MapPin, Loader2, ChevronDown, CheckCircle2,
  Clock, Video, Navigation, ArrowRight, HelpCircle,
  Phone, Mail, MessageSquarePlus, Check, X, Wallet,
  TrendingUp, Gift, Copy, Sparkles, Menu, MessageCircle,
  User, IndianRupee,
} from "lucide-react";

type Tab = "home" | "find" | "bookings" | "messages" | "notifications" | "shadow-teacher";

interface ProgressNote {
  bookingId: number;
  parentSummary: string | null;
  progressMarkers: string | null;
  noteCreatedAt: string;
  bookedDate: string;
  professionalName: string | null;
}

interface ReferralStats {
  code: string;
  shareUrl: string;
  totalReferrals: number;
  convertedReferrals: number;
  totalEarnedInr: number;
}

interface Notification {
  id: number;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

interface ChatMsg {
  id: number;
  threadId: number;
  senderId: number;
  senderName: string | null;
  body: string;
  createdAt: string;
}

const NAV_ITEMS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "home",           label: "Home",               icon: <Home size={18} /> },
  { id: "find",           label: "Find Professionals", icon: <Search size={18} /> },
  { id: "bookings",       label: "My Bookings",        icon: <CalendarCheck size={18} /> },
  { id: "shadow-teacher", label: "Shadow Teacher",     icon: <User size={18} /> },
  { id: "messages",       label: "Messages",           icon: <MessageCircle size={18} /> },
  { id: "notifications",  label: "Notifications",      icon: <Bell size={18} /> },
];

const MOBILE_BOTTOM: Tab[] = ["home", "find", "bookings", "shadow-teacher", "messages"];

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

// ─── Professional card ────────────────────────────────────────────────────────
function ProfCard({
  p,
  onReview,
  hasReviewed,
  onChat,
}: {
  p: ProfessionalSearchResult;
  onReview?: () => void;
  hasReviewed?: boolean;
  onChat?: () => void;
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

      <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
        {p.city && <span className="flex items-center gap-1"><MapPin size={11} />{p.city}</span>}
        {p.averageRating != null && p.totalRatings > 0 && (
          <span className="flex items-center gap-1">
            <Star size={11} className="fill-amber-400 text-amber-400" />
            {p.averageRating.toFixed(1)} ({p.totalRatings})
          </span>
        )}
        {p.pricingMinINR != null && (
          <span className="ml-auto font-semibold text-gray-800">
            {p.pricingMinINR === 0 ? "Free intro" : `₹${p.pricingMinINR}/session`}
          </span>
        )}
      </div>

      {(p.phone || p.email) && (
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
        {onChat && (
          <Button size="sm" variant="ghost" className="text-xs gap-1 text-teal-600 border border-teal-100 hover:bg-teal-50" onClick={onChat}>
            <MessageCircle size={13} /> Message
          </Button>
        )}
        {onReview && !hasReviewed && (
          <Button size="sm" variant="ghost" className="text-xs gap-1 text-teal-600" onClick={onReview}>
            <Star size={13} /> Review
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Session card ─────────────────────────────────────────────────────────────
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
        <div className="mt-3 space-y-3">
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="gap-1 text-xs border-gray-200">
              <Video size={12} /> Join online
            </Button>
            {s.professionalCity && (
              <Button size="sm" variant="ghost" className="gap-1 text-xs text-gray-600">
                <Navigation size={12} /> Get directions
              </Button>
            )}
          </div>
          {((s as any).startOtp || (s as any).endOtp) && (
            <div className="bg-teal-50 border border-teal-100 rounded-xl p-3 space-y-2">
              <p className="text-[11px] font-semibold text-teal-700 uppercase tracking-wide">Session Codes — show to your specialist</p>
              <div className="grid grid-cols-2 gap-2">
                {(s as any).startOtp && (
                  <div className="bg-white rounded-lg p-2.5 border border-teal-100 text-center">
                    <p className="text-[10px] text-teal-500 font-medium mb-0.5">START CODE</p>
                    <p className="text-xl font-bold tracking-widest text-[#1A2340] font-mono">{(s as any).startOtp}</p>
                  </div>
                )}
                {(s as any).endOtp && (
                  <div className="bg-white rounded-lg p-2.5 border border-teal-100 text-center">
                    <p className="text-[10px] text-teal-500 font-medium mb-0.5">FINISH CODE</p>
                    <p className="text-xl font-bold tracking-widest text-[#1A2340] font-mono">{(s as any).endOtp}</p>
                  </div>
                )}
              </div>
              <p className="text-[10px] text-teal-500">Give the start code when session begins. Give the finish code when it ends.</p>
            </div>
          )}
        </div>
      )}
      {s.notes && <p className="mt-2 text-xs text-gray-400 italic">{s.notes}</p>}
    </div>
  );
}

// ─── Review modal ─────────────────────────────────────────────────────────────
function ReviewModal({ professionalId, onClose }: { professionalId: number; onClose: () => void }) {
  const { toast } = useToast();
  const { mutateAsync: createRating, isPending } = useCreateRating();
  const [stars, setStars] = useState(5);
  const [review, setReview] = useState("");

  async function submit() {
    try {
      await createRating({ data: { professionalId, score: stars, comment: review.trim() || undefined } });
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

// ─── Chat modal ────────────────────────────────────────────────────────────────
function ChatModal({ professionalId, professionalName, onClose }: { professionalId: number; professionalName: string; onClose: () => void }) {
  const { toast } = useToast();
  const { data: me } = useGetMe();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [accessError, setAccessError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchWithAuth(`/api/connect/${professionalId}/thread`)
      .then(async (r) => {
        if (r.status === 403) {
          const d = await r.json() as { error?: string };
          setAccessError(d.error ?? "You need to connect with this specialist before messaging.");
          return;
        }
        if (!r.ok) { setAccessError("Could not load messages. Please try again."); return; }
        const data = await r.json() as { messages?: ChatMsg[] };
        if (Array.isArray(data.messages)) setMessages(data.messages);
      })
      .catch(() => setAccessError("Could not load messages. Please try again."))
      .finally(() => setLoading(false));
  }, [professionalId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  async function send() {
    const trimmed = body.trim();
    if (!trimmed || sending || accessError) return;
    setSending(true);
    try {
      const res = await fetchWithAuth(`/api/connect/${professionalId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: trimmed }),
      });
      const msg = await res.json() as ChatMsg & { error?: string };
      if (!res.ok) { toast({ title: msg.error ?? "Could not send", variant: "destructive" }); return; }
      setMessages((prev) => [...prev, msg]);
      setBody("");
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  const canSend = !sending && !loading && !accessError && body.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl shadow-2xl flex flex-col" style={{ height: "clamp(400px, 80vh, 600px)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div>
            <p className="font-semibold text-[#1A2340] text-sm">{professionalName}</p>
            <p className="text-xs text-gray-400">Message</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <X size={18} className="text-gray-500" />
          </button>
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
          {loading && <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-teal-500" /></div>}
          {!loading && accessError && (
            <div className="text-center py-8 text-gray-500">
              <MessageSquarePlus size={28} className="mx-auto mb-2 text-gray-300" />
              <p className="text-sm">{accessError}</p>
            </div>
          )}
          {!loading && !accessError && messages.length === 0 && (
            <div className="text-center py-8 text-gray-400">
              <MessageSquarePlus size={28} className="mx-auto mb-2 text-gray-300" />
              <p className="text-sm">Start the conversation!</p>
            </div>
          )}
          {messages.map((msg) => {
            const meId = (me as unknown as { id?: number })?.id;
            const isMe = meId != null && msg.senderId === meId;
            return (
              <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-sm ${isMe ? "bg-teal-500 text-white rounded-br-sm" : "bg-white border border-gray-100 text-gray-800 rounded-bl-sm shadow-sm"}`}>
                  {!isMe && <p className="text-[10px] font-semibold mb-0.5 opacity-60">{msg.senderName ?? professionalName}</p>}
                  <p>{msg.body}</p>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex gap-2 p-3 border-t border-gray-100">
          <input
            type="text"
            placeholder={accessError ? "Connect first to message" : "Type a message…"}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
            disabled={!!accessError || loading}
            className="flex-1 border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 disabled:bg-gray-50 disabled:text-gray-400"
          />
          <button
            onClick={() => void send()}
            disabled={!canSend}
            className="bg-teal-500 hover:bg-teal-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl px-3.5 flex items-center justify-center transition-colors"
          >
            {sending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Progress timeline ─────────────────────────────────────────────────────────
function ProgressTimeline() {
  const { data: notes, isLoading } = useQuery<ProgressNote[]>({
    queryKey: ["sessions-progress"],
    queryFn: () => fetchWithAuth("/api/sessions/progress").then((r) => r.json()),
  });

  if (isLoading) return <div className="flex items-center justify-center py-6"><Loader2 size={18} className="animate-spin text-teal-400" /></div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          <TrendingUp size={16} className="text-teal-600" />
          Your Child's Progress
        </h2>
        {notes && notes.length > 0 && (
          <span className="text-xs text-gray-400">{notes.length} update{notes.length !== 1 ? "s" : ""}</span>
        )}
      </div>
      {!notes || notes.length === 0 ? (
        <div className="bg-white border border-dashed border-teal-200 rounded-2xl p-6 text-center">
          <Sparkles size={28} className="mx-auto mb-2 text-teal-300" />
          <p className="text-sm font-medium text-gray-600">Progress notes will appear here</p>
          <p className="text-xs text-gray-400 mt-1">After each session, your specialist leaves a note on your child's progress.</p>
        </div>
      ) : (
        <div className="relative">
          <div className="absolute left-[19px] top-0 bottom-0 w-px bg-teal-100" aria-hidden />
          <div className="space-y-3">
            {notes.slice(0, 5).map((note) => (
              <div key={note.bookingId} className="flex gap-4">
                <div className="w-10 h-10 rounded-full bg-teal-100 flex items-center justify-center shrink-0 z-10 border-2 border-white shadow-sm">
                  <TrendingUp size={14} className="text-teal-600" />
                </div>
                <div className="flex-1 bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-xs font-medium text-teal-700">{note.professionalName ?? "Your specialist"}</p>
                    <time className="text-xs text-gray-400 shrink-0">
                      {new Date(note.noteCreatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                    </time>
                  </div>
                  {note.parentSummary && <p className="text-sm text-gray-700 leading-relaxed">{note.parentSummary}</p>}
                  {note.progressMarkers && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {note.progressMarkers.split(",").filter(Boolean).map((m) => (
                        <span key={m.trim()} className="text-[11px] bg-teal-50 text-teal-700 border border-teal-100 rounded-full px-2 py-0.5">{m.trim()}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Referral card ─────────────────────────────────────────────────────────────
function ReferralCard() {
  const { toast } = useToast();
  const [claimCode, setClaimCode] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data, refetch } = useQuery<ReferralStats>({
    queryKey: ["referral-my-code"],
    queryFn: () => fetchWithAuth("/api/referrals/my-code").then((r) => r.json()),
  });

  function copyCode() {
    if (!data?.code) return;
    navigator.clipboard.writeText(data.shareUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function claimReferral() {
    if (!claimCode.trim()) return;
    setClaiming(true);
    try {
      await fetchWithAuth("/api/referrals/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: claimCode.trim().toUpperCase() }),
      });
      toast({ title: "Code claimed! You'll earn ₹100 on your first session." });
      setClaimCode("");
      void refetch();
    } catch {
      toast({ title: "Could not claim code — check it and try again.", variant: "destructive" });
    } finally {
      setClaiming(false);
    }
  }

  return (
    <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-teal-200 rounded-2xl p-5">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-teal-100 flex items-center justify-center shrink-0">
          <Gift size={18} className="text-teal-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 text-sm">Refer a friend, earn ₹100</p>
          <p className="text-xs text-gray-500 mt-0.5">Both you and your friend get ₹100 wallet credit when they book their first session.</p>
        </div>
      </div>
      {data && (
        <>
          <div className="mt-4 flex items-center gap-2">
            <div className="flex-1 bg-white border border-teal-200 rounded-xl px-3 py-2 flex items-center justify-between">
              <span className="font-mono font-bold text-teal-700 tracking-widest text-sm">{data.code}</span>
              <button onClick={copyCode} className="text-teal-500 hover:text-teal-700 transition-colors" title="Copy share link">
                {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
              </button>
            </div>
          </div>
          {(data.convertedReferrals > 0 || data.totalEarnedInr > 0) && (
            <div className="mt-3 flex gap-4 text-center">
              <div className="flex-1 bg-white rounded-xl border border-teal-100 py-2">
                <p className="text-lg font-bold text-teal-700">{data.convertedReferrals}</p>
                <p className="text-[10px] text-gray-500">Friends joined</p>
              </div>
              <div className="flex-1 bg-white rounded-xl border border-teal-100 py-2">
                <p className="text-lg font-bold text-teal-700">₹{data.totalEarnedInr}</p>
                <p className="text-[10px] text-gray-500">Earned</p>
              </div>
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <Input
              value={claimCode}
              onChange={(e) => setClaimCode(e.target.value.toUpperCase())}
              placeholder="Have a friend's code? Enter it"
              className="h-9 text-sm border-teal-200 bg-white"
              maxLength={10}
            />
            <Button size="sm" className="h-9 bg-teal-600 hover:bg-teal-700 text-white shrink-0" onClick={claimReferral} disabled={claiming || !claimCode.trim()}>
              {claiming ? <Loader2 size={14} className="animate-spin" /> : "Claim"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB: HOME
// ═══════════════════════════════════════════════════════════════════════════════
function HomeTab({ parentName, city, onTabChange }: { parentName: string; city?: string | null; onTabChange: (t: Tab) => void }) {
  const { data: dashData } = useGetParentDashboard();
  const { data: sessions } = useGetMySessions();
  const { data: walletData } = useGetWalletBalance();

  const { data: recsData } = useSearchProfessionals(
    { city: city ?? undefined, limit: 4 },
    { query: { enabled: !!city } as any }
  );
  const recommendations = recsData?.professionals ?? [];

  const upcoming = (sessions ?? [])
    .filter((s) => ["confirmed", "pending_payment"].includes(s.status) && new Date(s.bookedDate) >= new Date())
    .sort((a, b) => new Date(a.bookedDate).getTime() - new Date(b.bookedDate).getTime())
    .slice(0, 2);

  const activity = [
    ...(dashData?.recentUnlocks ?? []).map((u) => ({
      id: `unlock-${u.id}`,
      text: `Connected with ${u.professional?.fullName ?? "a professional"}`,
      time: u.unlockedAt,
      icon: <User size={13} className="text-teal-600" />,
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
      <div>
        <h1 className="text-2xl font-serif font-semibold text-gray-900">{greeting()}, {parentName}!</h1>
        <p className="text-gray-500 text-sm mt-1">Here's what's happening on your Includly dashboard.</p>
      </div>

      {/* Wallet */}
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

      <ReferralCard />

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Sessions Booked", value: (sessions ?? []).length, icon: <CalendarCheck size={16} className="text-violet-600" />, bg: "bg-violet-50" },
          { label: "Upcoming", value: upcoming.length, icon: <Clock size={16} className="text-orange-500" />, bg: "bg-orange-50" },
          { label: "Professionals", value: dashData?.totalUnlocks ?? 0, icon: <User size={16} className="text-teal-600" />, bg: "bg-teal-50" },
        ].map((stat) => (
          <div key={stat.label} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
            <div className={`w-9 h-9 ${stat.bg} rounded-xl flex items-center justify-center mb-3`}>{stat.icon}</div>
            <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Recommendations */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900">{city ? `Professionals near ${city}` : "Recommended Professionals"}</h2>
          <button onClick={() => onTabChange("find")} className="text-xs text-teal-600 flex items-center gap-1 hover:underline">
            See all <ArrowRight size={13} />
          </button>
        </div>
        {recommendations.length === 0 ? (
          <div className="bg-white border border-gray-100 rounded-2xl p-6 text-center text-sm text-gray-400">
            {city ? "No professionals found nearby yet — " : "Browse all "}<button onClick={() => onTabChange("find")} className="text-teal-600 underline">search all</button>.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {recommendations.map((p) => <ProfCard key={p.id} p={p} />)}
          </div>
        )}
      </div>

      {/* Upcoming sessions */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900">Upcoming Sessions</h2>
          <button onClick={() => onTabChange("bookings")} className="text-xs text-teal-600 hover:underline">View all</button>
        </div>
        {upcoming.length === 0 ? (
          <div className="bg-white border border-gray-100 rounded-2xl p-6 text-center text-sm text-gray-400">
            No upcoming sessions. <button onClick={() => onTabChange("find")} className="text-teal-600 underline">Find a professional</button> to book.
          </div>
        ) : (
          <div className="space-y-3">{upcoming.map((s) => <SessionCard key={s.id} s={s} />)}</div>
        )}
      </div>

      <ProgressTimeline />

      {activity.length > 0 && (
        <div>
          <h2 className="font-semibold text-gray-900 mb-3">Recent Activity</h2>
          <div className="bg-white border border-gray-100 rounded-2xl divide-y divide-gray-50 shadow-sm">
            {activity.map((a) => (
              <div key={a.id} className="flex items-center gap-3 px-4 py-3">
                <div className="w-7 h-7 bg-gray-50 rounded-full flex items-center justify-center shrink-0">{a.icon}</div>
                <p className="text-sm text-gray-700 flex-1">{a.text}</p>
                <span className="text-xs text-gray-400 shrink-0">{timeAgo(a.time)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-gradient-to-r from-teal-600 to-teal-500 rounded-2xl p-5 text-white flex items-center justify-between gap-4">
        <div>
          <div className="text-xs font-medium opacity-80 mb-1">Featured Resource</div>
          <h3 className="font-semibold">How to choose the right shadow teacher for your child</h3>
          <p className="text-xs opacity-80 mt-1 max-w-xs">A parent's guide to evaluating qualifications, communication style, and approach.</p>
        </div>
        <Link href="/support">
          <Button size="sm" className="bg-white text-teal-700 hover:bg-gray-50 shrink-0 gap-1">Read <ArrowRight size={13} /></Button>
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
  const [chatProfessional, setChatProfessional] = useState<{ id: number; name: string } | null>(null);
  const [reviewingId, setReviewingId] = useState<number | null>(null);

  const modeParam = mode === "online" ? true : mode === "offline" ? false : undefined;
  const { data, isFetching } = useSearchProfessionals({
    specialty: (specialty as any) || undefined,
    city: city || undefined,
    willingToTravel: modeParam,
    budgetMaxINR: maxFee,
    limit: 40,
  });

  const results = data?.professionals ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-serif font-semibold text-gray-900">Find Professionals</h1>
        {isFetching && <Loader2 size={16} className="animate-spin text-teal-500" />}
      </div>

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
      </div>

      {/* Results */}
      {isFetching && results.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={28} className="animate-spin text-teal-500" />
        </div>
      ) : (
        <>
          <p className="text-sm text-gray-500">{results.length} professional{results.length !== 1 ? "s" : ""} found</p>
          {results.length === 0 ? (
            <div className="text-center py-10 text-gray-400">No professionals found — try different filters.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {results.map((p) => (
                <ProfCard
                  key={p.id}
                  p={p}
                  onChat={() => setChatProfessional({ id: p.id, name: p.fullName ?? "Professional" })}
                  onReview={() => setReviewingId(p.id)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {chatProfessional && (
        <ChatModal
          professionalId={chatProfessional.id}
          professionalName={chatProfessional.name}
          onClose={() => setChatProfessional(null)}
        />
      )}
      {reviewingId && <ReviewModal professionalId={reviewingId} onClose={() => setReviewingId(null)} />}
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
  const ACTIVE_STATUSES = ["confirmed", "pending_payment", "requested", "confirmed_by_pro", "paid_held", "session_started"];
  const upcoming = (sessions ?? [])
    .filter((s) => ACTIVE_STATUSES.includes(s.status) && new Date(s.bookedDate) >= now)
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
        <div className="text-center py-12 text-gray-400 text-sm">No {bookingTab} bookings.</div>
      ) : (
        <div className="space-y-3">{shown.map((s) => <SessionCard key={s.id} s={s} />)}</div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB: MESSAGES
// ═══════════════════════════════════════════════════════════════════════════════
interface ThreadSummary {
  threadId: number;
  professionalId: number;
  professionalName: string | null;
  lastMessage: string | null;
  lastAt: string | null;
  unread: number;
}

function MessagesTab() {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [chatProfessional, setChatProfessional] = useState<{ id: number; name: string } | null>(null);

  useEffect(() => {
    fetchWithAuth("/api/connect/inbox")
      .then((r) => r.json())
      .then((data) => setThreads(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-teal-600" /></div>;

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-serif font-semibold text-gray-900">Messages</h1>
      {threads.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <MessageCircle size={32} className="mx-auto mb-3 text-gray-300" />
          <p className="font-medium text-gray-600">No conversations yet</p>
          <p className="text-sm mt-1">Find a professional and start a conversation.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-100 rounded-2xl divide-y divide-gray-50 shadow-sm">
          {threads.map((t) => (
            <button
              key={t.threadId}
              onClick={() => setChatProfessional({ id: t.professionalId, name: t.professionalName ?? "Professional" })}
              className="w-full flex items-center gap-3 px-4 py-4 hover:bg-gray-50 transition-colors text-left"
            >
              <div className="w-10 h-10 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 font-bold text-sm shrink-0">
                {initials(t.professionalName)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-gray-900 truncate">{t.professionalName ?? "Professional"}</p>
                {t.lastMessage && <p className="text-xs text-gray-500 truncate mt-0.5">{t.lastMessage}</p>}
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                {t.lastAt && <span className="text-xs text-gray-400">{timeAgo(t.lastAt)}</span>}
                {t.unread > 0 && (
                  <span className="text-[10px] font-bold bg-teal-500 text-white rounded-full w-5 h-5 flex items-center justify-center">{t.unread}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
      {chatProfessional && (
        <ChatModal
          professionalId={chatProfessional.id}
          professionalName={chatProfessional.name}
          onClose={() => setChatProfessional(null)}
        />
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
              className={`flex items-start gap-3 px-4 py-4 cursor-pointer ${!n.read ? "bg-teal-50/40" : ""}`}
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
// TAB: SHADOW TEACHER
// ═══════════════════════════════════════════════════════════════════════════════
function ShadowTeacherTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  interface STEngagement {
    id: number;
    professionalId: number;
    childId: number | null;
    tier: string | null;
    startDate: string;
    monthlyFeeInr: string;
    status: string;
    notes: string | null;
    professionalName: string | null;
    childName: string | null;
  }
  interface DailyLog {
    id: number;
    logDate: string;
    template: string;
    responses: Record<string, string>;
    mood: string | null;
    notes: string | null;
    postedBy: string;
    createdAt: string;
  }
  interface SalaryPayment {
    id: number;
    month: string;
    grossInr: string;
    status: string;
    paidAt: string | null;
  }

  const { data: engagements = [], isLoading } = useQuery<STEngagement[]>({
    queryKey: ["parent-engagements"],
    queryFn: () => fetchWithAuth("/api/engagements").then(r => r.json()),
  });

  const active = engagements.find(e => e.status === "active" || e.status === "notice_period");

  const { data: logs = [] } = useQuery<DailyLog[]>({
    queryKey: ["engagement-logs", active?.id],
    queryFn: () => fetchWithAuth(`/api/engagements/${active!.id}/daily-logs`).then(r => r.json()),
    enabled: !!active,
  });

  const { data: payments = [] } = useQuery<SalaryPayment[]>({
    queryKey: ["engagement-payments", active?.id],
    queryFn: () => fetchWithAuth(`/api/engagements/${active!.id}/payments`).then(r => r.json()),
    enabled: !!active,
  });

  const [logNote, setLogNote] = useState("");
  const [logMood, setLogMood] = useState("");
  const [postingLog, setPostingLog] = useState(false);
  const [lifecycleType, setLifecycleType] = useState<"stop" | "pause" | "buyout" | "">("");
  const [lifecycleNotes, setLifecycleNotes] = useState("");
  const [postingLifecycle, setPostingLifecycle] = useState(false);
  const [payingMonth, setPayingMonth] = useState("");
  const [payingInProgress, setPayingInProgress] = useState(false);
  const [stTab, setStTab] = useState<"overview" | "logs" | "payments" | "lifecycle">("overview");

  async function handlePostLog() {
    if (!active || !logNote.trim()) return;
    setPostingLog(true);
    try {
      await fetchWithAuth(`/api/engagements/${active.id}/daily-logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template: "parent", responses: { general: logNote }, mood: logMood || null, notes: null }),
      });
      queryClient.invalidateQueries({ queryKey: ["engagement-logs", active.id] });
      setLogNote(""); setLogMood("");
      toast({ title: "Log posted ✓" });
    } catch { toast({ title: "Failed to post log", variant: "destructive" }); }
    finally { setPostingLog(false); }
  }

  async function handlePaySalary() {
    if (!active || !payingMonth.trim()) return;
    setPayingInProgress(true);
    try {
      const salaryResp = await fetchWithAuth(`/api/engagements/${active.id}/pay-salary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: payingMonth }),
      });
      if (salaryResp.status === 409) { toast({ title: "Already paid for this month" }); return; }
      if (!salaryResp.ok) { const e = await salaryResp.json(); throw new Error(e.error ?? "Failed to create order"); }
      const orderRes = await salaryResp.json();

      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      document.body.appendChild(script);
      await new Promise<void>(res => { script.onload = () => res(); });

      await new Promise<void>((resolve, reject) => {
        const rzp = new (window as unknown as { Razorpay: new (opts: unknown) => { open: () => void } }).Razorpay({
          key: orderRes.keyId,
          amount: orderRes.amountPaise,
          currency: "INR",
          name: "Includly",
          description: `Shadow Teacher Salary – ${payingMonth}`,
          order_id: orderRes.orderId,
          handler: async (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
            try {
              await fetchWithAuth(`/api/engagements/${active.id}/verify-salary-payment`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  paymentId: orderRes.paymentId,
                  razorpayPaymentId: response.razorpay_payment_id,
                  razorpayOrderId: response.razorpay_order_id,
                  razorpaySignature: response.razorpay_signature,
                }),
              });
              queryClient.invalidateQueries({ queryKey: ["engagement-payments", active.id] });
              toast({ title: "Salary paid ✓" }); resolve();
            } catch { reject(new Error("Verification failed")); }
          },
          modal: { ondismiss: () => reject(new Error("dismissed")) },
          theme: { color: "#2EC4A5" },
        });
        rzp.open();
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Payment failed";
      if (msg !== "dismissed") toast({ title: msg, variant: "destructive" });
    } finally { setPayingInProgress(false); }
  }

  async function handleLifecycleRequest() {
    if (!active || !lifecycleType) return;
    setPostingLifecycle(true);
    try {
      await fetchWithAuth(`/api/engagements/${active.id}/lifecycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestType: lifecycleType, notes: lifecycleNotes || null }),
      });
      queryClient.invalidateQueries({ queryKey: ["parent-engagements"] });
      setLifecycleType(""); setLifecycleNotes("");
      toast({ title: "Request submitted ✓" });
    } catch { toast({ title: "Failed to submit request", variant: "destructive" }); }
    finally { setPostingLifecycle(false); }
  }

  if (isLoading) {
    return <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-14 bg-white rounded-xl animate-pulse shadow-sm" />)}</div>;
  }

  if (!active) {
    return <ShadowTeacherRequestWidget />;
  }

  const MOODS = ["😊 Great", "🙂 Good", "😐 Okay", "😔 Difficult"];

  return (
    <div className="space-y-5">
      {/* Header card */}
      <div className="bg-gradient-to-br from-[#2EC4A5] to-[#26a88d] rounded-2xl p-5 text-white">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide opacity-75">Active Engagement</p>
            <p className="text-xl font-bold mt-1">{active.professionalName ?? `Teacher #${active.professionalId}`}</p>
            {active.childName && <p className="text-sm opacity-80 mt-0.5">For {active.childName}</p>}
          </div>
          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-white/20 uppercase tracking-wide">
            {active.status.replace("_", " ")}
          </span>
        </div>
        <div className="mt-4 flex items-center gap-4 text-sm">
          <div><span className="opacity-70">Monthly</span><br /><strong>₹{Number(active.monthlyFeeInr).toLocaleString("en-IN")}</strong></div>
          <div className="w-px h-8 bg-white/20" />
          <div><span className="opacity-70">Since</span><br /><strong>{new Date(active.startDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</strong></div>
          {active.tier && <>
            <div className="w-px h-8 bg-white/20" />
            <div><span className="opacity-70">Tier</span><br /><strong>{active.tier}</strong></div>
          </>}
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 overflow-x-auto">
        {([["overview", "Overview"], ["logs", "Daily Logs"], ["payments", "Payments"], ["lifecycle", "Manage"]] as [string, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setStTab(id as typeof stTab)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${stTab === id ? "bg-white text-[#1A2340] shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
            {label}
          </button>
        ))}
      </div>

      {stTab === "overview" && (
        <div className="bg-white rounded-xl p-5 shadow-[0_2px_12px_rgba(26,35,64,0.06)] space-y-4">
          <p className="text-sm font-bold text-[#1A2340]">Engagement Summary</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs text-gray-400">Total Logs</p>
              <p className="text-2xl font-bold text-[#1A2340] mt-0.5">{logs.length}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs text-gray-400">Payments Made</p>
              <p className="text-2xl font-bold text-[#1A2340] mt-0.5">{payments.filter(p => p.status === "paid").length}</p>
            </div>
          </div>
          {active.notes && <p className="text-xs text-gray-500 bg-gray-50 rounded-xl p-3">{active.notes}</p>}
        </div>
      )}

      {stTab === "logs" && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl p-5 shadow-[0_2px_12px_rgba(26,35,64,0.06)] space-y-3">
            <p className="text-sm font-bold text-[#1A2340]">Post Today's Observation</p>
            <div>
              <p className="text-xs text-gray-500 mb-2">How was today's session?</p>
              <div className="flex gap-2 flex-wrap">
                {MOODS.map(m => (
                  <button key={m} onClick={() => setLogMood(logMood === m ? "" : m)}
                    className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${logMood === m ? "border-[#2EC4A5] bg-[#2EC4A5]/10 text-[#2EC4A5]" : "border-gray-200 hover:border-gray-300"}`}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <textarea value={logNote} onChange={(e) => setLogNote(e.target.value)} rows={3}
              placeholder="Describe how the session went today…"
              className="w-full rounded-lg border border-gray-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#2EC4A5] resize-none" />
            <Button onClick={handlePostLog} disabled={postingLog || !logNote.trim()}
              className="w-full bg-[#2EC4A5] hover:bg-[#26a88d] text-white text-sm">
              {postingLog ? <Loader2 size={14} className="animate-spin mr-1" /> : null}Post Log
            </Button>
          </div>
          {logs.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-8">No logs yet. Post the first one above.</p>
          ) : (
            <div className="space-y-3">
              {[...logs].reverse().map(log => (
                <div key={log.id} className="bg-white rounded-xl p-4 shadow-[0_2px_12px_rgba(26,35,64,0.06)]">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold text-[#1A2340]">{new Date(log.logDate).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</span>
                    {log.mood && <span className="text-xs text-gray-500">{log.mood}</span>}
                    <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full border font-semibold ${log.template === "teacher" ? "bg-blue-50 text-blue-600 border-blue-200" : "bg-[#2EC4A5]/10 text-[#2EC4A5] border-[#2EC4A5]/20"}`}>
                      {log.template === "teacher" ? "Teacher" : "Parent"}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600">{(log.responses as Record<string, string>)["general"] ?? Object.values(log.responses as Record<string, string>)[0] ?? ""}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {stTab === "payments" && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl p-5 shadow-[0_2px_12px_rgba(26,35,64,0.06)] space-y-3">
            <p className="text-sm font-bold text-[#1A2340]">Pay Salary</p>
            <div>
              <p className="text-xs text-gray-500 mb-1">Month (YYYY-MM)</p>
              <input value={payingMonth} onChange={(e) => setPayingMonth(e.target.value)}
                placeholder="2026-06"
                className="w-full max-w-xs rounded-lg border border-gray-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2EC4A5]" />
            </div>
            <Button onClick={handlePaySalary} disabled={payingInProgress || !payingMonth.trim()}
              className="bg-[#2EC4A5] hover:bg-[#26a88d] text-white text-sm">
              {payingInProgress ? <Loader2 size={14} className="animate-spin mr-1" /> : <IndianRupee size={14} className="mr-1" />}
              Pay ₹{Number(active.monthlyFeeInr).toLocaleString("en-IN")} via Razorpay
            </Button>
          </div>
          {payments.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-8">No salary payments yet.</p>
          ) : (
            <div className="space-y-3">
              {payments.map(pmt => (
                <div key={pmt.id} className="bg-white rounded-xl p-4 shadow-[0_2px_12px_rgba(26,35,64,0.06)] flex items-center gap-4">
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-[#1A2340]">{pmt.month}</p>
                    <p className="text-xs text-gray-400">₹{Number(pmt.grossInr).toLocaleString("en-IN")} gross{pmt.paidAt ? ` · Paid ${new Date(pmt.paidAt).toLocaleDateString("en-IN")}` : ""}</p>
                  </div>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${pmt.status === "paid" ? "bg-green-50 text-green-700 border-green-200" : "bg-yellow-50 text-yellow-700 border-yellow-200"}`}>{pmt.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {stTab === "lifecycle" && (
        <div className="bg-white rounded-xl p-5 shadow-[0_2px_12px_rgba(26,35,64,0.06)] space-y-4">
          <p className="text-sm font-bold text-[#1A2340]">Request a Change</p>
          <div className="grid grid-cols-3 gap-2">
            {([["stop", "End Engagement"], ["pause", "Pause"], ["buyout", "Early Exit"]] as [string, string][]).map(([t, label]) => (
              <button key={t} onClick={() => setLifecycleType(lifecycleType === t ? "" : t as typeof lifecycleType)}
                className={`py-2 px-3 rounded-xl border text-xs font-semibold transition-colors ${lifecycleType === t ? "border-[#FF6B6B] bg-[#FF6B6B]/10 text-[#FF6B6B]" : "border-gray-200 hover:border-gray-300 text-gray-600"}`}>
                {label}
              </button>
            ))}
          </div>
          <textarea value={lifecycleNotes} onChange={(e) => setLifecycleNotes(e.target.value)} rows={3}
            placeholder="Please explain why you are making this request…"
            className="w-full rounded-lg border border-gray-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#2EC4A5] resize-none" />
          <Button onClick={handleLifecycleRequest} disabled={postingLifecycle || !lifecycleType}
            className="w-full bg-[#FF6B6B] hover:bg-[#e85a5a] text-white text-sm">
            {postingLifecycle ? <Loader2 size={14} className="animate-spin mr-1" /> : null}Submit Request
          </Button>
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
  const [, setLocation] = useLocation();
  const { data: me } = useGetMe();
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [drawerOpen, setDrawerOpen] = useState(false);

  const firstName = me?.fullName?.split(" ")[0] ?? user?.firstName ?? "there";
  const city = me?.location ?? null;

  const { data: notifications } = useQuery<Notification[]>({
    queryKey: ["notifications"],
    queryFn: () => fetchWithAuth("/api/notifications").then((r) => r.json()),
  });
  const unreadCount = (notifications ?? []).filter((n) => !n.read).length;

  function handleTabChange(tab: Tab) {
    setActiveTab(tab);
    setDrawerOpen(false);
    window.scrollTo(0, 0);
  }

  return (
    <div className="min-h-screen bg-[#F5F7FA] flex">
      {/* Mobile drawer overlay */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
      )}

      {/* ── SIDEBAR ────────────────────────────────────────────────────────── */}
      <aside
        className={`fixed top-0 bottom-0 left-0 z-50 w-[240px] bg-white border-r border-gray-100 flex flex-col transition-transform duration-200 md:top-16 md:translate-x-0 md:z-30 ${drawerOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}
        aria-label="Parent dashboard sidebar"
      >
        {/* Avatar + close (mobile) */}
        <div className="p-5 border-b border-gray-100 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#2EC4A5] flex items-center justify-center text-white font-bold text-sm shrink-0">
            {initials(me?.fullName ?? user?.fullName)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm text-[#1A2340] truncate">{me?.fullName ?? user?.fullName ?? "Parent"}</p>
            {city && <p className="text-xs text-gray-500 flex items-center gap-1 truncate"><MapPin size={10} />{city}</p>}
          </div>
          <button onClick={() => setDrawerOpen(false)} className="md:hidden p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-2 overflow-y-auto" aria-label="Dashboard navigation">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => handleTabChange(item.id)}
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
          <Link href="/support">
            <div className="w-full flex items-center gap-3 px-5 py-3 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors">
              <BookOpen size={18} />
              Resources
            </div>
          </Link>
          <button
            onClick={() => setLocation("/account")}
            className="w-full flex items-center gap-3 px-5 py-3 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors text-left"
          >
            <Settings size={18} />
            Account Settings
          </button>
        </nav>

        <div className="p-4 border-t border-gray-100 space-y-1">
          <a href="/support" className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-600 transition-colors px-1">
            <HelpCircle size={14} /> Need Help?
          </a>
          <p className="text-xs text-gray-300 px-1">Includly · Parent</p>
        </div>
      </aside>

      {/* ── MAIN CONTENT ───────────────────────────────────────────────────── */}
      <div className="flex-1 md:ml-[240px] flex flex-col min-w-0">
        {/* Mobile top bar */}
        <div className="md:hidden sticky top-16 z-30 bg-white border-b border-gray-100 px-4 h-12 flex items-center gap-3 shadow-sm">
          <button
            onClick={() => setDrawerOpen(true)}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600 focus-visible:ring-2 focus-visible:ring-[#2EC4A5]"
            aria-label="Open navigation"
          >
            <Menu size={20} />
          </button>
          <span className="font-semibold text-[#1A2340] text-sm">
            {NAV_ITEMS.find((n) => n.id === activeTab)?.label ?? "Dashboard"}
          </span>
          {unreadCount > 0 && (
            <button onClick={() => handleTabChange("notifications")} className="ml-auto relative">
              <Bell size={20} className="text-gray-600" />
              <span className="absolute -top-1 -right-1 text-[9px] font-bold bg-[#FF6B6B] text-white rounded-full w-4 h-4 flex items-center justify-center">{unreadCount}</span>
            </button>
          )}
        </div>

        <main className="flex-1 px-4 sm:px-6 py-6 pb-24 md:pb-6 max-w-[900px] w-full mx-auto">
          {activeTab === "home"           && <HomeTab parentName={firstName} city={city} onTabChange={handleTabChange} />}
          {activeTab === "find"           && <FindTab />}
          {activeTab === "bookings"       && <BookingsTab />}
          {activeTab === "shadow-teacher" && <ShadowTeacherTab />}
          {activeTab === "messages"       && <MessagesTab />}
          {activeTab === "notifications"  && <NotificationsTab />}
        </main>
      </div>

      {/* ── MOBILE BOTTOM TAB BAR ──────────────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-gray-100 z-40 flex">
        {MOBILE_BOTTOM.map((id) => {
          const item = NAV_ITEMS.find((n) => n.id === id)!;
          return (
            <button
              key={id}
              onClick={() => handleTabChange(id)}
              className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors relative ${
                activeTab === id ? "text-[#2EC4A5]" : "text-gray-400 hover:text-gray-600"
              }`}
            >
              {item.icon}
              <span className="text-[10px] leading-none">{item.label.split(" ")[0]}</span>
              {id === "notifications" && unreadCount > 0 && (
                <span className="absolute top-1 right-[calc(50%-14px)] text-[9px] font-bold bg-[#FF6B6B] text-white rounded-full w-4 h-4 flex items-center justify-center">{unreadCount}</span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
