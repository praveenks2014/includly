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
  useGetMyChildren,
  getGetMeQueryKey,
} from "@workspace/api-client-react";
import type { ProfessionalSearchResult, SessionBookingWithDetails } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { StarRating } from "@/components/StarRating";
import { ShadowTeacherRequestWidget } from "@/components/ShadowTeacherRequestWidget";
import { ComingSoon } from "@/components/ComingSoon";
import { EngagementProgress } from "@/components/EngagementProgress";
import { useSelectedChild } from "@/contexts/SelectedChildContext";
import { fetchWithAuth } from "@/lib/api";
import { getSpecialtyLabel } from "@/lib/specialties";
import { useToast } from "@/hooks/use-toast";
import {
  Home, Search, CalendarCheck, Bell, BookOpen, Settings,
  Star, MapPin, Loader2, ChevronDown, CheckCircle2,
  Clock, Video, Navigation, ArrowRight, HelpCircle,
  Phone, Mail, MessageSquarePlus, Check, X, Wallet,
  TrendingUp, Gift, Copy, Sparkles, Menu, MessageCircle,
  User, IndianRupee, ArrowLeft, Building2,
} from "lucide-react";

type Tab = "home" | "find" | "services" | "progress" | "bookings" | "messages" | "notifications" | "shadow-teacher";

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


const SPECIALTIES = [
  { value: "", label: "All Specialties" },
  { value: "shadow_teacher", label: "Shadow Teacher" },
  { value: "speech_therapy", label: "Speech Therapy" },
  { value: "occupational_therapy", label: "Occupational Therapy" },
  { value: "aba_therapy", label: "ABA Therapy" },
  { value: "sensory_integration", label: "Sensory Integration" },
  { value: "special_educator", label: "Special Educator" },
  { value: "child_psychologist", label: "Child Psychologist" },
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
    <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm hover:shadow-md hover:border-teal-100 transition-all flex flex-col gap-3">
      <div className="flex items-start gap-2.5">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-teal-100 to-teal-50 flex items-center justify-center text-teal-700 font-bold text-sm shrink-0 border border-teal-100">
          {initials(p.fullName)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-[#1A2340] text-sm truncate leading-tight">{p.fullName ?? "Professional"}</p>
          <span className="inline-block text-[11px] px-2 py-0.5 bg-teal-50 text-teal-700 rounded-full border border-teal-100 mt-1">
            {getSpecialtyLabel(p.specialty)}
          </span>
        </div>
        {p.isVerified && (
          <div className="shrink-0 w-5 h-5 rounded-full bg-green-50 border border-green-200 flex items-center justify-center" title="Verified">
            <CheckCircle2 size={11} className="text-green-600" />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2.5 text-[11px] text-gray-400 flex-wrap">
        {p.city && <span className="flex items-center gap-1"><MapPin size={10} />{p.city}</span>}
        {p.averageRating != null && p.totalRatings > 0 && (
          <span className="flex items-center gap-1">
            <Star size={10} className="fill-amber-400 text-amber-400" />
            {p.averageRating.toFixed(1)}
          </span>
        )}
        {p.pricingMinINR != null && (
          <span className="ml-auto font-bold text-[#1A2340] text-xs">
            {p.pricingMinINR === 0 ? "Free intro" : `₹${p.pricingMinINR}`}
          </span>
        )}
      </div>

      {(p.phone || p.email) && (
        <div className="bg-gray-50 rounded-xl p-2.5 space-y-1 text-[11px] border border-gray-100">
          {p.phone && <p className="flex items-center gap-2 text-gray-600"><Phone size={11} className="text-teal-500" />{p.phone}</p>}
          {p.email && <p className="flex items-center gap-2 text-gray-600"><Mail size={11} className="text-teal-500" />{p.email}</p>}
        </div>
      )}

      <div className="flex gap-2 mt-auto">
        <Link href={`/professionals/${p.id}`} className="flex-1">
          <Button variant="outline" size="sm" className="w-full text-xs border-gray-200 rounded-xl font-semibold">
            View Profile
          </Button>
        </Link>
        {onChat && (
          <Button size="sm" variant="ghost" className="text-xs gap-1 text-teal-600 border border-teal-100 hover:bg-teal-50 rounded-xl" onClick={onChat}>
            <MessageCircle size={12} />
          </Button>
        )}
        {onReview && !hasReviewed && (
          <Button size="sm" variant="ghost" className="text-xs gap-1 text-amber-500 border border-amber-100 hover:bg-amber-50 rounded-xl" onClick={onReview}>
            <Star size={12} />
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
    confirmed: "bg-green-50 text-green-700 border-green-200",
    pending_payment: "bg-amber-50 text-amber-700 border-amber-200",
    completed: "bg-gray-100 text-gray-500 border-gray-200",
    cancelled_by_parent: "bg-red-50 text-red-600 border-red-200",
    cancelled_by_professional: "bg-red-50 text-red-600 border-red-200",
    no_show: "bg-red-50 text-red-600 border-red-200",
  };

  return (
    <div className={`bg-white border border-gray-100 rounded-2xl p-4 ${compact ? "" : "shadow-sm"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-violet-50 border border-violet-100 flex items-center justify-center shrink-0">
            <CalendarCheck size={15} className="text-violet-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-[#1A2340] text-sm truncate">{s.professionalName ?? "Professional"}</p>
            {s.professionalSpecialty && (
              <p className="text-[11px] text-gray-400 mt-0.5">{getSpecialtyLabel(s.professionalSpecialty)}</p>
            )}
            <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-400">
              <span className="flex items-center gap-1"><CalendarCheck size={10} />{fmtDate(s.bookedDate)}</span>
              <span className="flex items-center gap-1"><Clock size={10} />{fmtTime(s.startTime)}</span>
            </div>
          </div>
        </div>
        <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold shrink-0 border ${statusColor[s.status] ?? "bg-gray-100 text-gray-500 border-gray-200"}`}>
          {s.status.replace(/_/g, " ")}
        </span>
      </div>
      {!isPast && s.status === "confirmed" && (
        <div className="mt-3 space-y-3">
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="gap-1 text-xs border-gray-200 rounded-xl">
              <Video size={12} /> Join online
            </Button>
            {s.professionalCity && (
              <Button size="sm" variant="ghost" className="gap-1 text-xs text-gray-500 rounded-xl">
                <Navigation size={12} /> Directions
              </Button>
            )}
          </div>
          {((s as any).startOtp || (s as any).endOtp) && (
            <div className="bg-gradient-to-br from-teal-50 to-emerald-50 border border-teal-100 rounded-2xl p-4 space-y-2.5">
              <p className="text-[10px] font-bold text-teal-700 uppercase tracking-[0.12em]">Session Codes — show to your specialist</p>
              <div className="grid grid-cols-2 gap-2">
                {(s as any).startOtp && (
                  <div className="bg-white rounded-xl p-3 border border-teal-100 text-center shadow-sm">
                    <p className="text-[10px] text-teal-500 font-bold uppercase tracking-wide mb-1">Start</p>
                    <p className="text-2xl font-bold tracking-[0.2em] text-[#1A2340] font-mono">{(s as any).startOtp}</p>
                  </div>
                )}
                {(s as any).endOtp && (
                  <div className="bg-white rounded-xl p-3 border border-teal-100 text-center shadow-sm">
                    <p className="text-[10px] text-teal-500 font-bold uppercase tracking-wide mb-1">Finish</p>
                    <p className="text-2xl font-bold tracking-[0.2em] text-[#1A2340] font-mono">{(s as any).endOtp}</p>
                  </div>
                )}
              </div>
              <p className="text-[10px] text-teal-500/80">Start code at the beginning · Finish code at the end.</p>
            </div>
          )}
        </div>
      )}
      {s.notes && <p className="mt-2 text-[11px] text-gray-400 italic">{s.notes}</p>}
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
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold text-[#1A2340] text-sm">Progress Notes</h2>
        {notes && notes.length > 0 && (
          <span className="text-[11px] text-gray-400 font-medium">{notes.length} update{notes.length !== 1 ? "s" : ""}</span>
        )}
      </div>
      {!notes || notes.length === 0 ? (
        <div className="bg-white border border-dashed border-teal-200 rounded-2xl p-6 text-center">
          <div className="w-10 h-10 bg-teal-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Sparkles size={18} className="text-teal-400" />
          </div>
          <p className="text-sm font-semibold text-gray-700">Progress notes will appear here</p>
          <p className="text-xs text-gray-400 mt-1">After each session, your specialist leaves a note on your child's progress.</p>
        </div>
      ) : (
        <div className="relative">
          <div className="absolute left-[19px] top-2 bottom-2 w-0.5 bg-gradient-to-b from-teal-200 to-teal-50" aria-hidden />
          <div className="space-y-3">
            {notes.slice(0, 5).map((note) => (
              <div key={note.bookingId} className="flex gap-4">
                <div className="w-9 h-9 rounded-2xl bg-teal-100 flex items-center justify-center shrink-0 z-10 border-2 border-white shadow-sm mt-0.5">
                  <TrendingUp size={13} className="text-teal-600" />
                </div>
                <div className="flex-1 bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-xs font-bold text-teal-700">{note.professionalName ?? "Your specialist"}</p>
                    <time className="text-[11px] text-gray-400 shrink-0">
                      {new Date(note.noteCreatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                    </time>
                  </div>
                  {note.parentSummary && <p className="text-sm text-gray-700 leading-relaxed">{note.parentSummary}</p>}
                  {note.progressMarkers && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {note.progressMarkers.split(",").filter(Boolean).map((m) => (
                        <span key={m.trim()} className="text-[11px] bg-teal-50 text-teal-700 border border-teal-100 rounded-full px-2.5 py-0.5 font-medium">{m.trim()}</span>
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
  const { data: myChildren = [] } = useGetMyChildren();
  const primaryChild = (myChildren as Array<{ id: number; name: string }>)[0];

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
    <div className="space-y-5 pb-4">

      {/* ── Hero header + Wallet ─────────────────────────────────────── */}
      <div className="rounded-3xl bg-gradient-to-br from-[#1A2340] via-[#1e2d55] to-[#243070] p-6 shadow-[0_8px_32px_rgba(26,35,64,0.22)] overflow-hidden relative">
        <div className="absolute top-0 right-0 w-48 h-48 rounded-full bg-[#2EC4A5] opacity-[0.06] -translate-y-1/2 translate-x-1/4 pointer-events-none" />
        <div className="relative">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#2EC4A5] mb-2">Includly</p>
          <h1 className="text-[1.6rem] font-bold text-white leading-tight">{greeting()}, {parentName}!</h1>
          <p className="text-sm text-white/45 mt-1">Your family's support hub.</p>
          {walletData !== undefined && (
            <div className="mt-5 flex items-center justify-between bg-white/[0.08] rounded-2xl px-4 py-3.5 border border-white/[0.07]">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#2EC4A5]">Wallet Balance</p>
                <p className="text-2xl font-bold text-white mt-0.5">₹{walletData.balanceInr}</p>
              </div>
              <div className="w-10 h-10 rounded-2xl bg-[#2EC4A5]/20 flex items-center justify-center">
                <Wallet size={18} className="text-[#2EC4A5]" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Quick stats ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Sessions", value: (sessions ?? []).length, icon: <CalendarCheck size={14} className="text-violet-500" />, bg: "bg-violet-50", border: "border-violet-100" },
          { label: "Upcoming", value: upcoming.length, icon: <Clock size={14} className="text-amber-500" />, bg: "bg-amber-50", border: "border-amber-100" },
          { label: "Connected", value: dashData?.totalUnlocks ?? 0, icon: <User size={14} className="text-teal-600" />, bg: "bg-teal-50", border: "border-teal-100" },
        ].map((stat) => (
          <div key={stat.label} className="bg-white border border-gray-100 rounded-2xl p-3.5 shadow-sm text-center">
            <div className={`w-8 h-8 ${stat.bg} border ${stat.border} rounded-xl flex items-center justify-center mx-auto mb-2`}>{stat.icon}</div>
            <p className="text-[1.35rem] font-bold text-[#1A2340] leading-none">{stat.value}</p>
            <p className="text-[10px] text-gray-400 mt-1 font-medium">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* ── Child profile quick-edit ─────────────────────────────────── */}
      {primaryChild && (
        <Link href={`/children/${primaryChild.id}/edit`}>
          <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm flex items-center gap-3 hover:border-violet-200 hover:shadow-md transition-all cursor-pointer">
            <div className="w-10 h-10 bg-gradient-to-br from-violet-100 to-violet-50 border border-violet-100 rounded-xl flex items-center justify-center shrink-0">
              <User size={15} className="text-violet-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-[#1A2340]">{primaryChild.name}'s Profile</p>
              <p className="text-[11px] text-gray-400 mt-0.5">Update conditions, goals & availability</p>
            </div>
            <div className="w-7 h-7 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0">
              <ArrowRight size={13} className="text-gray-400" />
            </div>
          </div>
        </Link>
      )}

      {/* ── Shadow Teacher CTA ───────────────────────────────────────── */}
      <Link href="/services">
        <div className="bg-gradient-to-r from-[#2EC4A5] to-[#26a88d] rounded-2xl p-5 shadow-[0_4px_18px_rgba(46,196,165,0.28)] flex items-center gap-4 hover:shadow-[0_6px_24px_rgba(46,196,165,0.38)] transition-shadow cursor-pointer">
          <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center shrink-0">
            <Sparkles size={20} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-white text-sm">Request a Shadow Teacher</p>
            <p className="text-xs text-white/70 mt-0.5">Get matched with a verified teacher for your child.</p>
          </div>
          <div className="w-8 h-8 bg-white/15 rounded-xl flex items-center justify-center shrink-0">
            <ArrowRight size={14} className="text-white" />
          </div>
        </div>
      </Link>

      {/* ── Upcoming sessions ────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-[#1A2340] text-sm">Upcoming Sessions</h2>
          <button onClick={() => onTabChange("bookings")} className="text-xs text-teal-600 font-semibold hover:text-teal-700 flex items-center gap-0.5">
            View all <ArrowRight size={11} />
          </button>
        </div>
        {upcoming.length === 0 ? (
          <div className="bg-white border border-dashed border-gray-200 rounded-2xl p-6 text-center">
            <div className="w-10 h-10 bg-gray-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <CalendarCheck size={18} className="text-gray-300" />
            </div>
            <p className="text-sm font-semibold text-gray-600">No upcoming sessions</p>
            <button onClick={() => onTabChange("find")} className="text-xs text-teal-600 font-semibold underline mt-1">Find a professional</button>
          </div>
        ) : (
          <div className="space-y-3">{upcoming.map((s) => <SessionCard key={s.id} s={s} />)}</div>
        )}
      </div>

      {/* ── Recommendations ──────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-[#1A2340] text-sm">{city ? `Near ${city}` : "Recommended Professionals"}</h2>
          <button onClick={() => onTabChange("find")} className="text-xs text-teal-600 font-semibold hover:text-teal-700 flex items-center gap-0.5">
            See all <ArrowRight size={11} />
          </button>
        </div>
        {recommendations.length === 0 ? (
          <div className="bg-white border border-dashed border-gray-200 rounded-2xl p-6 text-center">
            <div className="w-10 h-10 bg-teal-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Search size={17} className="text-teal-300" />
            </div>
            <p className="text-sm font-semibold text-gray-600">{city ? "No professionals nearby yet" : "Browse professionals"}</p>
            <button onClick={() => onTabChange("find")} className="text-xs text-teal-600 font-semibold underline mt-1">Search all</button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {recommendations.map((p) => <ProfCard key={p.id} p={p} />)}
          </div>
        )}
      </div>

      {/* ── Progress notes ───────────────────────────────────────────── */}
      <ProgressTimeline />

      {/* ── Recent activity ──────────────────────────────────────────── */}
      {activity.length > 0 && (
        <div>
          <h2 className="font-bold text-[#1A2340] text-sm mb-3">Recent Activity</h2>
          <div className="bg-white border border-gray-100 rounded-2xl divide-y divide-gray-50 shadow-sm overflow-hidden">
            {activity.map((a) => (
              <div key={a.id} className="flex items-center gap-3 px-4 py-3.5">
                <div className="w-8 h-8 bg-gray-50 border border-gray-100 rounded-xl flex items-center justify-center shrink-0">{a.icon}</div>
                <p className="text-sm text-gray-700 flex-1 leading-snug">{a.text}</p>
                <span className="text-[11px] text-gray-400 shrink-0 tabular-nums">{timeAgo(a.time)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Referral ─────────────────────────────────────────────────── */}
      <ReferralCard />

      {/* ── Featured resource ────────────────────────────────────────── */}
      <div className="bg-gradient-to-br from-[#2EC4A5] to-[#1a9a82] rounded-2xl p-5 text-white flex items-center gap-5 shadow-[0_4px_16px_rgba(46,196,165,0.22)]">
        <div className="flex-1 min-w-0">
          <div className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest bg-white/15 rounded-full px-2.5 py-1 mb-2.5">
            <BookOpen size={10} /> Resource
          </div>
          <h3 className="font-bold text-[15px] leading-snug">How to choose the right shadow teacher</h3>
          <p className="text-xs text-white/65 mt-1.5 leading-relaxed">A parent's guide to qualifications, communication style, and approach.</p>
        </div>
        <Link href="/support" className="shrink-0">
          <Button size="sm" className="bg-white text-[#1a9a82] hover:bg-teal-50 gap-1 font-bold shadow-sm">
            Read <ArrowRight size={12} />
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
    <div className="space-y-5 pb-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[1.35rem] font-bold text-[#1A2340] leading-tight">Find Professionals</h1>
          <p className="text-xs text-gray-400 mt-0.5">Search verified specialists near you</p>
        </div>
        {isFetching && (
          <div className="flex items-center gap-1.5 text-xs text-teal-600 font-semibold bg-teal-50 border border-teal-100 rounded-full px-3 py-1.5">
            <Loader2 size={12} className="animate-spin" /> Searching…
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm space-y-3">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.14em]">Filter by</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="relative">
            <select
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
              className="w-full h-10 pl-3 pr-8 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-teal-400 appearance-none"
            >
              {SPECIALTIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
          <div className="relative">
            <MapPin size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-teal-400 pointer-events-none" />
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
            <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
          <div className="relative">
            <IndianRupee size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <Input
              type="number"
              min={0}
              max={10000}
              value={maxFee ?? ""}
              onChange={(e) => setMaxFee(e.target.value ? Number(e.target.value) : undefined)}
              placeholder="Max fee"
              className="pl-8 h-10 border-gray-200 bg-gray-50 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Results */}
      {isFetching && results.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="w-12 h-12 bg-teal-50 rounded-2xl flex items-center justify-center">
            <Loader2 size={22} className="animate-spin text-teal-500" />
          </div>
          <p className="text-sm text-gray-400 font-medium">Finding specialists…</p>
        </div>
      ) : (
        <>
          {!isFetching && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-teal-700 bg-teal-50 border border-teal-100 rounded-full px-3 py-1">
              <User size={11} />{results.length} professional{results.length !== 1 ? "s" : ""} found
            </span>
          )}
          {results.length === 0 ? (
            <div className="bg-white border border-dashed border-gray-200 rounded-2xl p-10 text-center">
              <div className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <Search size={20} className="text-gray-300" />
              </div>
              <p className="text-sm font-semibold text-gray-600">No professionals found</p>
              <p className="text-xs text-gray-400 mt-1">Try adjusting your filters or broadening the city.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
    <div className="space-y-5 pb-4">
      <div>
        <h1 className="text-[1.35rem] font-bold text-[#1A2340] leading-tight">My Bookings</h1>
        <p className="text-xs text-gray-400 mt-0.5">Session history with your specialists</p>
      </div>
      <div className="flex bg-gray-100 rounded-2xl p-1 gap-1">
        {(["upcoming", "past"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setBookingTab(t)}
            className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${
              bookingTab === t ? "bg-white shadow-sm text-[#1A2340]" : "text-gray-400 hover:text-gray-600"
            }`}
          >
            {t === "upcoming" ? "Upcoming" : "Past"}
            <span className={`ml-1.5 text-[11px] font-bold px-1.5 py-0.5 rounded-full ${bookingTab === t ? "bg-teal-100 text-teal-700" : "bg-gray-200 text-gray-500"}`}>
              {t === "upcoming" ? upcoming.length : past.length}
            </span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-200 rounded-2xl p-10 text-center">
          <div className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <CalendarCheck size={20} className="text-gray-300" />
          </div>
          <p className="text-sm font-semibold text-gray-600">No {bookingTab} bookings</p>
          <p className="text-xs text-gray-400 mt-1">{bookingTab === "upcoming" ? "Find a professional to book a session." : "Your completed sessions will appear here."}</p>
        </div>
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
    <div className="space-y-5 pb-4">
      <div>
        <h1 className="text-[1.35rem] font-bold text-[#1A2340] leading-tight">Messages</h1>
        <p className="text-xs text-gray-400 mt-0.5">Conversations with your professionals</p>
      </div>
      {threads.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-200 rounded-2xl p-12 text-center">
          <div className="w-12 h-12 bg-teal-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <MessageCircle size={20} className="text-teal-300" />
          </div>
          <p className="text-sm font-semibold text-gray-600">No conversations yet</p>
          <p className="text-xs text-gray-400 mt-1">Find a professional and send your first message.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-100 rounded-2xl divide-y divide-gray-50 shadow-sm overflow-hidden">
          {threads.map((t) => (
            <button
              key={t.threadId}
              onClick={() => setChatProfessional({ id: t.professionalId, name: t.professionalName ?? "Professional" })}
              className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50/80 transition-colors text-left"
            >
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-teal-100 to-teal-50 border border-teal-100 flex items-center justify-center text-teal-700 font-bold text-sm shrink-0">
                {initials(t.professionalName)}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm truncate ${t.unread > 0 ? "font-bold text-[#1A2340]" : "font-semibold text-gray-700"}`}>
                  {t.professionalName ?? "Professional"}
                </p>
                {t.lastMessage && (
                  <p className={`text-[11px] truncate mt-0.5 ${t.unread > 0 ? "text-gray-600 font-medium" : "text-gray-400"}`}>
                    {t.lastMessage}
                  </p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                {t.lastAt && <span className="text-[11px] text-gray-400 tabular-nums">{timeAgo(t.lastAt)}</span>}
                {t.unread > 0 && (
                  <span className="min-w-[20px] h-5 px-1.5 text-[10px] font-bold bg-teal-500 text-white rounded-full flex items-center justify-center">{t.unread}</span>
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

  const unreadCount = (notifications ?? []).filter((n) => !n.read).length;
  if (isLoading) return <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-teal-600" /></div>;

  return (
    <div className="space-y-5 pb-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[1.35rem] font-bold text-[#1A2340] leading-tight">Notifications</h1>
          {unreadCount > 0
            ? <p className="text-xs text-teal-600 font-semibold mt-0.5">{unreadCount} unread</p>
            : <p className="text-xs text-gray-400 mt-0.5">You're all caught up</p>
          }
        </div>
        {unreadCount > 0 && (
          <Button variant="ghost" size="sm" className="text-xs text-teal-600 gap-1.5 border border-teal-100 hover:bg-teal-50 rounded-xl" onClick={markAllRead}>
            <Check size={12} /> Mark all read
          </Button>
        )}
      </div>
      {(!notifications || notifications.length === 0) ? (
        <div className="bg-white border border-dashed border-gray-200 rounded-2xl p-12 text-center">
          <div className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Bell size={20} className="text-gray-300" />
          </div>
          <p className="text-sm font-semibold text-gray-600">No notifications yet</p>
          <p className="text-xs text-gray-400 mt-1">You'll see updates about your sessions here.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-100 rounded-2xl divide-y divide-gray-50 shadow-sm overflow-hidden">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`flex items-start gap-3 px-4 py-4 cursor-pointer transition-colors hover:bg-gray-50/50 ${!n.read ? "bg-teal-50/25" : ""}`}
              onClick={() => !n.read && markRead(n.id)}
            >
              <div className={`mt-1.5 shrink-0 rounded-full ${n.read ? "w-1.5 h-1.5 bg-gray-200" : "w-2.5 h-2.5 bg-teal-500 shadow-[0_0_0_3px_rgba(46,196,165,0.18)]"}`} />
              <div className="flex-1 min-w-0">
                <p className={`text-sm leading-snug ${n.read ? "font-medium text-gray-500" : "font-bold text-[#1A2340]"}`}>{n.title}</p>
                <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{n.body}</p>
              </div>
              <span className="text-[11px] text-gray-400 shrink-0 tabular-nums mt-0.5">{timeAgo(n.createdAt)}</span>
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
  const { selectedChildId } = useSelectedChild();
  const { data: me } = useGetMe();
  const myUserId = (me as unknown as { id?: number })?.id ?? 0;

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
    startOtp?: string | null;
    endDate?: string | null;
    endedReason?: string | null;
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
  interface SalaryPayment {
    id: number;
    month: string;
    grossInr: string;
    status: string;
    paidAt: string | null;
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

  const { data: engagements = [], isLoading } = useQuery<STEngagement[]>({
    queryKey: ["parent-engagements"],
    queryFn: () => fetchWithAuth("/api/engagements").then(r => r.json()),
  });

  const active = engagements.find(e =>
    (["active", "notice_period", "paused", "pending_start", "pending_teacher_acceptance", "ended"].includes(e.status)) &&
    e.childId === selectedChildId
  );

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

  const { data: lifecycleRequests = [] } = useQuery<LifecycleRequest[]>({
    queryKey: ["engagement-lifecycle", active?.id],
    queryFn: () => fetchWithAuth(`/api/engagements/${active!.id}/lifecycle`).then(r => r.json()),
    enabled: !!active,
  });

  const pendingPR = lifecycleRequests.find(r => ["pause", "resume"].includes(r.type) && r.status === "pending") ?? null;
  const iAmPRRequester = myUserId > 0 && pendingPR?.raisedByUserId === myUserId;

  const [lifecycleType, setLifecycleType] = useState<"stop" | "pause" | "buyout" | "full_buyout" | "">("");
  const [lifecycleNotes, setLifecycleNotes] = useState("");
  const [pauseReason, setPauseReason] = useState("");
  const [postingLifecycle, setPostingLifecycle] = useState(false);
  const [buyoutPaid, setBuyoutPaid] = useState(false);
  const [fullBuyoutPaid, setFullBuyoutPaid] = useState(false);
  const [fullBuyoutDate, setFullBuyoutDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payingMonth, setPayingMonth] = useState("");
  const [payingInProgress, setPayingInProgress] = useState(false);
  const [stTab, setStTab] = useState<"overview" | "logs" | "goals" | "trends" | "payments" | "lifecycle">("overview");
  const [editingStartDate, setEditingStartDate] = useState(false);
  const [newStartDate, setNewStartDate] = useState("");
  const [changingStartDate, setChangingStartDate] = useState(false);

  const pendingStartDisabledTabs = new Set(["logs", "goals", "trends", "payments"]);
  const visibleStTab: typeof stTab =
    ((active?.status === "pending_start" || active?.status === "pending_teacher_acceptance") && pendingStartDisabledTabs.has(stTab)) ||
    (active?.status === "ended" && stTab === "lifecycle")
      ? "overview" : stTab;

  async function handleChangeStartDate() {
    if (!active || !newStartDate) return;
    setChangingStartDate(true);
    try {
      const res = await fetchWithAuth(`/api/engagements/${active.id}/start-date`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: newStartDate }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        toast({ title: "Could not update date", description: err.error ?? "Unknown error", variant: "destructive" });
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["parent-engagements"] });
      setEditingStartDate(false);
      toast({ title: "Start date updated", description: "Your teacher has been notified." });
    } catch { toast({ title: "Network error", variant: "destructive" }); }
    finally { setChangingStartDate(false); }
  }

  async function handleRequestPause() {
    if (!active) return;
    setPostingLifecycle(true);
    try {
      const resp = await fetchWithAuth(`/api/engagements/${active.id}/lifecycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "pause", reason: pauseReason.trim() || undefined }),
      });
      if (!resp.ok) { const e = await resp.json() as { error?: string }; throw new Error(e.error ?? "Failed to submit"); }
      queryClient.invalidateQueries({ queryKey: ["engagement-lifecycle", active.id] });
      setPauseReason("");
      toast({ title: "Pause request sent — waiting for teacher to respond" });
    } catch (err) { toast({ title: err instanceof Error ? err.message : "Failed", variant: "destructive" }); }
    finally { setPostingLifecycle(false); }
  }

  async function handleRequestResume() {
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
      toast({ title: "Resume request sent — waiting for teacher to respond" });
    } catch (err) { toast({ title: err instanceof Error ? err.message : "Failed", variant: "destructive" }); }
    finally { setPostingLifecycle(false); }
  }

  async function handleConsentPR(status: "approved" | "rejected") {
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
      queryClient.invalidateQueries({ queryKey: ["parent-engagements"] });
      toast({ title: status === "approved" ? "Request accepted ✓" : "Request rejected" });
    } catch (err) { toast({ title: err instanceof Error ? err.message : "Failed", variant: "destructive" }); }
    finally { setPostingLifecycle(false); }
  }

  async function handleWithdrawPR() {
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
      const resp = await fetchWithAuth(`/api/engagements/${active.id}/lifecycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          lifecycleType === "buyout"
            ? { type: "stop", method: "buyout", reason: lifecycleNotes || undefined }
            : lifecycleType === "full_buyout"
              ? { type: "stop", method: "full_buyout", endDate: fullBuyoutDate, reason: lifecycleNotes || undefined }
              : lifecycleType === "pause"
                ? { type: "change", reason: lifecycleNotes || undefined }
                : { type: "stop", method: "notice", reason: lifecycleNotes || undefined }
        ),
      });
      if (!resp.ok) { const e = await resp.json() as { error?: string }; throw new Error(e.error ?? "Failed to submit"); }
      const data = await resp.json() as { id: number; buyoutOrderId?: string; buyoutFeeInr?: number; keyId?: string };

      if ((lifecycleType === "buyout" || lifecycleType === "full_buyout") && data.buyoutOrderId && data.buyoutFeeInr && data.keyId) {
        const script = document.createElement("script");
        script.src = "https://checkout.razorpay.com/v1/checkout.js";
        document.body.appendChild(script);
        await new Promise<void>(resolve => { script.onload = () => resolve(); });

        const capturedType = lifecycleType;
        await new Promise<void>((resolve, reject) => {
          const rzp = new (window as unknown as { Razorpay: new (opts: unknown) => { open: () => void } }).Razorpay({
            key: data.keyId,
            amount: data.buyoutFeeInr! * 100,
            currency: "INR",
            name: "Includly",
            description: capturedType === "full_buyout" ? "Full Buyout Fee" : "Early Exit Buyout Fee",
            order_id: data.buyoutOrderId,
            handler: async (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
              try {
                const vResp = await fetchWithAuth(`/api/engagements/${active.id}/lifecycle/${data.id}/verify-buyout-payment`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    razorpay_order_id: response.razorpay_order_id,
                    razorpay_payment_id: response.razorpay_payment_id,
                    razorpay_signature: response.razorpay_signature,
                  }),
                });
                if (!vResp.ok) { const e = await vResp.json() as { error?: string }; throw new Error(e.error ?? "Verification failed"); }
                if (capturedType === "full_buyout") {
                  setFullBuyoutPaid(true);
                  toast({ title: "Full buyout payment confirmed ✓" });
                } else {
                  setBuyoutPaid(true);
                  toast({ title: "Buyout payment confirmed ✓" });
                }
                resolve();
              } catch (e) { reject(e); }
            },
            modal: { ondismiss: () => reject(new Error("dismissed")) },
            theme: { color: "#2EC4A5" },
          });
          rzp.open();
        });
      }

      queryClient.invalidateQueries({ queryKey: ["parent-engagements"] });
      setLifecycleType(""); setLifecycleNotes("");
      if (lifecycleType !== "buyout" && lifecycleType !== "full_buyout") toast({ title: "Request submitted ✓" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      if (msg !== "dismissed") toast({ title: msg, variant: "destructive" });
    } finally { setPostingLifecycle(false); }
  }

  if (isLoading) {
    return <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-14 bg-white rounded-xl animate-pulse shadow-sm" />)}</div>;
  }

  if (!active) {
    return <ShadowTeacherRequestWidget key={selectedChildId ?? "no-child"} />;
  }

  return (
    <div className="space-y-5 pb-4">
      {/* Header card */}
      <div className={`rounded-2xl p-5 text-white shadow-[0_4px_20px_rgba(0,0,0,0.13)] ${active.status === "ended" ? "bg-gradient-to-br from-gray-500 to-gray-600" : active.status === "paused" ? "bg-gradient-to-br from-amber-500 to-amber-600" : "bg-gradient-to-br from-[#2EC4A5] to-[#1a9a82]"}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] opacity-65">
              {active.status === "ended" ? "Past Engagement" : active.status === "paused" ? "Engagement Paused" : "Active Engagement"}
            </p>
            <p className="text-[1.2rem] font-bold mt-1 leading-tight">{active.professionalName ?? `Teacher #${active.professionalId}`}</p>
            {active.childName && <p className="text-sm opacity-75 mt-0.5">Supporting {active.childName}</p>}
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <div className="w-10 h-10 rounded-2xl bg-white/20 border border-white/20 flex items-center justify-center text-white font-bold text-sm">
              {initials(active.professionalName)}
            </div>
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-white/20 border border-white/15 uppercase tracking-wide whitespace-nowrap">
              {active.status.replace(/_/g, " ")}
            </span>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-4">
          <div>
            <p className="text-[10px] opacity-60 uppercase tracking-wide mb-0.5">Monthly</p>
            <p className="font-bold text-base">₹{Number(active.monthlyFeeInr).toLocaleString("en-IN")}</p>
          </div>
          <div className="w-px h-8 bg-white/20" />
          <div>
            <p className="text-[10px] opacity-60 uppercase tracking-wide mb-0.5">Since</p>
            <p className="font-bold text-sm">{new Date(active.startDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p>
          </div>
          {active.tier && <>
            <div className="w-px h-8 bg-white/20" />
            <div>
              <p className="text-[10px] opacity-60 uppercase tracking-wide mb-0.5">Tier</p>
              <p className="font-bold text-sm">{active.tier}</p>
            </div>
          </>}
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-2xl p-1 overflow-x-auto">
        {(([["overview", "Overview"], ["logs", "Daily Logs"], ["goals", "Goals"], ["trends", "Trends"], ["payments", "Payments"], ["lifecycle", "Manage"]] as [string, string][])
          .filter(([id]) =>
            !(active.status === "ended" && id === "lifecycle") &&
            !(active.status === "pending_teacher_acceptance" && id === "lifecycle")
          )
        ).map(([id, label]) => {
          const isPendingDisabled = (active.status === "pending_start" || active.status === "pending_teacher_acceptance") && pendingStartDisabledTabs.has(id);
          const tipText = id === "payments"
            ? "Available once the engagement starts — salary payments begin on the confirmed start date"
            : "Available once the engagement starts";
          return isPendingDisabled ? (
            <button key={id} disabled title={tipText}
              className="px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap text-gray-300 cursor-not-allowed select-none">
              {label}
            </button>
          ) : (
            <button key={id} onClick={() => setStTab(id as typeof stTab)}
              className={`px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${stTab === id ? "bg-white text-[#1A2340] shadow-sm" : "text-gray-400 hover:text-gray-600"}`}>
              {label}
            </button>
          );
        })}
      </div>

      {stTab === "overview" && active.status === "ended" && (
        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gray-100 rounded-2xl flex items-center justify-center shrink-0">
              <CheckCircle2 size={18} className="text-gray-400" />
            </div>
            <div>
              <p className="text-sm font-bold text-[#1A2340]">This engagement has ended</p>
              <p className="text-xs text-gray-400 mt-0.5">Logs, goals and payments are preserved</p>
            </div>
          </div>
          <p className="text-xs text-gray-500 leading-relaxed pl-[52px]">
            {active.endDate
              ? <>Ended on <span className="font-semibold text-gray-700">{new Date(active.endDate + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span>
                {active.endedReason === "buyout" ? " via early exit." : active.endedReason === "full_buyout" ? " via full buyout." : active.endedReason === "stop" ? " after the notice period." : "."}</>
              : "This engagement is no longer active."}
            {" "}Switch to the Find tab to start a new engagement.
          </p>
        </div>
      )}

      {stTab === "overview" && active.status !== "ended" && (
        <div className="bg-white rounded-xl p-5 shadow-[0_2px_12px_rgba(26,35,64,0.06)] space-y-4">
          {active.status === "pending_teacher_acceptance" ? (
            <div className="space-y-3">
              <p className="text-sm font-bold text-[#1A2340]">Waiting for Teacher to Accept</p>
              <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 space-y-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 bg-blue-100 rounded-xl flex items-center justify-center shrink-0">
                    <Clock size={14} className="text-blue-600" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-blue-900">Awaiting teacher confirmation</p>
                    <p className="text-[11px] text-blue-600 mt-0.5">You'll be notified as soon as they confirm</p>
                  </div>
                </div>
                <p className="text-xs text-blue-700 leading-relaxed">
                  {active.professionalName ?? "Your teacher"} has been notified and needs to accept this engagement before it begins.
                </p>
                <div className="bg-white rounded-xl border border-blue-100 p-3 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] text-gray-500">Proposed start</span>
                    <span className="text-[11px] font-semibold text-gray-700">
                      {new Date(active.startDate + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] text-gray-500">Agreed fee</span>
                    <span className="text-[11px] font-semibold text-gray-700">
                      ₹{parseFloat(active.monthlyFeeInr).toLocaleString("en-IN")}/month
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : active.status === "pending_start" ? (
            <div className="space-y-3">
              <p className="text-sm font-bold text-[#1A2340]">Engagement Booked — Awaiting Start</p>
              <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 space-y-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 bg-amber-100 rounded-xl flex items-center justify-center shrink-0">
                    <Clock size={14} className="text-amber-600" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-amber-900">Waiting for teacher to confirm start</p>
                    <p className="text-[11px] text-amber-600 mt-0.5">
                      Share the code on{" "}
                      <span className="font-semibold">{new Date(active.startDate + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</span>
                    </p>
                  </div>
                </div>
                {!editingStartDate ? (
                  <button
                    onClick={() => { setEditingStartDate(true); setNewStartDate(active.startDate); }}
                    className="text-xs text-amber-700 underline font-semibold"
                  >
                    Change start date
                  </button>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap pt-0.5">
                    <input
                      type="date"
                      value={newStartDate}
                      onChange={e => setNewStartDate(e.target.value)}
                      min={new Date().toISOString().slice(0, 10)}
                      className="text-xs rounded-lg border border-amber-300 bg-white px-2 py-1 focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                    <button
                      onClick={() => void handleChangeStartDate()}
                      disabled={changingStartDate || !newStartDate}
                      className="text-xs bg-amber-700 text-white rounded-lg px-3 py-1 font-semibold disabled:opacity-50"
                    >
                      {changingStartDate ? "Saving…" : "Confirm"}
                    </button>
                    <button
                      onClick={() => setEditingStartDate(false)}
                      className="text-xs text-amber-700 underline"
                    >
                      Cancel
                    </button>
                  </div>
                )}
                {active.startOtp ? (
                  <div className="bg-white border border-amber-200 rounded-2xl p-5 text-center space-y-2 shadow-inner">
                    <p className="text-[10px] font-bold text-amber-500 uppercase tracking-[0.18em]">Start Code</p>
                    <p className="text-4xl font-mono font-bold tracking-[0.35em] text-[#1A2340] select-all py-1">{active.startOtp}</p>
                    <p className="text-[10px] text-amber-600 font-medium">Show this to your teacher — do not share publicly</p>
                  </div>
                ) : (
                  <div className="bg-white rounded-xl px-4 py-3 border border-amber-100">
                    <p className="text-xs text-amber-700">
                      Your start code will appear here on{" "}
                      <span className="font-semibold">{new Date(active.startDate + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</span>.
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm font-bold text-[#1A2340]">Engagement Summary</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-teal-50/60 border border-teal-100 rounded-2xl p-3.5">
                  <p className="text-[10px] font-bold text-teal-600 uppercase tracking-[0.1em]">Total Logs</p>
                  <p className="text-2xl font-bold text-[#1A2340] mt-1">{logs.length}</p>
                </div>
                <div className="bg-violet-50/60 border border-violet-100 rounded-2xl p-3.5">
                  <p className="text-[10px] font-bold text-violet-600 uppercase tracking-[0.1em]">Payments Made</p>
                  <p className="text-2xl font-bold text-[#1A2340] mt-1">{payments.filter(p => p.status === "paid").length}</p>
                </div>
              </div>
              {active.notes && <p className="text-xs text-gray-500 bg-gray-50 rounded-xl p-3">{active.notes}</p>}
            </>
          )}
        </div>
      )}

      {visibleStTab === "logs" && <EngagementProgress active={active} view="logs" />}

      {visibleStTab === "payments" && (
        <div className="space-y-4">
          {active.status === "ended" && (
            <div className="flex items-center gap-2.5 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
              <CheckCircle2 size={13} className="text-gray-400 shrink-0" />
              <p className="text-xs text-gray-500 font-medium">This engagement has ended — records are read-only.</p>
            </div>
          )}
          {active.status !== "ended" && (
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
          )}
          {payments.length === 0 ? (
            <div className="bg-white border border-dashed border-gray-200 rounded-2xl p-10 text-center">
              <div className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <IndianRupee size={20} className="text-gray-300" />
              </div>
              <p className="text-sm font-semibold text-gray-600">No salary payments yet</p>
              <p className="text-xs text-gray-400 mt-1">Payments will appear here once the engagement starts.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {payments.map(pmt => (
                <div key={pmt.id} className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${pmt.status === "paid" ? "bg-green-50" : "bg-amber-50"}`}>
                    <IndianRupee size={15} className={pmt.status === "paid" ? "text-green-600" : "text-amber-500"} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-[#1A2340]">{pmt.month}</p>
                    <p className="text-xs text-gray-400">₹{Number(pmt.grossInr).toLocaleString("en-IN")} gross{pmt.paidAt ? ` · ${new Date(pmt.paidAt).toLocaleDateString("en-IN")}` : ""}</p>
                  </div>
                  <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${pmt.status === "paid" ? "bg-green-50 text-green-700 border-green-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>{pmt.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {visibleStTab === "lifecycle" && (
        <div className="space-y-4">
          {/* Buyout / Full-buyout wind-down banner */}
          {active.status === "notice_period" && ["buyout", "full_buyout"].includes(active.endedReason ?? "") && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={15} className="text-amber-600 shrink-0" />
                <p className="text-sm font-bold text-amber-900">
                  {active.endedReason === "full_buyout" ? "Full buyout confirmed" : "Early exit confirmed"}
                </p>
              </div>
              <p className="text-xs text-amber-800 leading-relaxed">
                {active.professionalName ?? "Your teacher"} will continue working until{" "}
                <span className="font-semibold">
                  {active.endDate
                    ? new Date(active.endDate + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
                    : "the scheduled date"}
                </span>. The engagement ends automatically on that date — no further action needed.
              </p>
            </div>
          )}

          {/* Standard notice period banner */}
          {active.status === "notice_period" && !["buyout", "full_buyout"].includes(active.endedReason ?? "") && (
            <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Clock size={15} className="text-blue-500 shrink-0" />
                <p className="text-sm font-bold text-blue-900">Notice period active</p>
              </div>
              <p className="text-xs text-blue-800 leading-relaxed">
                This engagement ends on{" "}
                <span className="font-semibold">
                  {active.endDate
                    ? new Date(active.endDate + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
                    : "the scheduled date"}
                </span>. {active.professionalName ?? "Your teacher"} continues working until then.
              </p>
            </div>
          )}

          {/* Pending pause/resume consent banner */}
          {pendingPR && (
            <div className={`rounded-2xl p-4 border space-y-3 ${pendingPR.type === "pause" ? "bg-amber-50 border-amber-100" : "bg-blue-50 border-blue-100"}`}>
              <div className="flex items-center gap-2">
                <Clock size={15} className={`shrink-0 ${pendingPR.type === "pause" ? "text-amber-500" : "text-blue-500"}`} />
                <p className="text-sm font-bold text-[#1A2340]">
                  {pendingPR.type === "pause" ? "Pause Request Pending" : "Resume Request Pending"}
                </p>
              </div>
              {iAmPRRequester ? (
                <>
                  <p className="text-xs text-gray-600 leading-relaxed">
                    You requested to {pendingPR.type} this engagement. Waiting for the teacher to respond.
                  </p>
                  <Button size="sm" variant="outline" onClick={() => void handleWithdrawPR()} disabled={postingLifecycle}
                    className="border-red-200 text-red-600 hover:bg-red-50 text-xs rounded-xl">
                    {postingLifecycle ? <Loader2 size={12} className="animate-spin mr-1" /> : null}Withdraw Request
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-xs text-gray-600 leading-relaxed">
                    Your teacher has requested to {pendingPR.type} this engagement.
                    {pendingPR.reason ? ` Reason: "${pendingPR.reason}"` : ""}
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => void handleConsentPR("approved")} disabled={postingLifecycle}
                      className="bg-green-600 hover:bg-green-700 text-white text-xs rounded-xl">
                      {postingLifecycle ? <Loader2 size={12} className="animate-spin mr-1" /> : "Accept"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void handleConsentPR("rejected")} disabled={postingLifecycle}
                      className="border-red-200 text-red-600 hover:bg-red-50 text-xs rounded-xl">
                      Reject
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Pause section — only when active and no pending pause/resume */}
          {active.status === "active" && !pendingPR && (
            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm space-y-3">
              <div>
                <p className="text-sm font-bold text-[#1A2340]">Pause Engagement</p>
                <p className="text-xs text-gray-400 mt-0.5">Both parties must agree — billing stops during the pause</p>
              </div>
              <textarea value={pauseReason} onChange={(e) => setPauseReason(e.target.value)} rows={2}
                placeholder="Reason for pausing (optional)…"
                className="w-full rounded-xl border border-gray-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#2EC4A5] resize-none" />
              <Button size="sm" onClick={() => void handleRequestPause()} disabled={postingLifecycle}
                className="bg-amber-500 hover:bg-amber-600 text-white text-xs rounded-xl gap-1">
                {postingLifecycle ? <Loader2 size={12} className="animate-spin" /> : null}Request Pause
              </Button>
            </div>
          )}

          {/* Resume section — only when paused and no pending request */}
          {active.status === "paused" && !pendingPR && (
            <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5 space-y-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 bg-amber-100 rounded-xl flex items-center justify-center shrink-0">
                  <Clock size={14} className="text-amber-600" />
                </div>
                <div>
                  <p className="text-sm font-bold text-amber-900">Engagement is Paused</p>
                  <p className="text-[11px] text-amber-600 mt-0.5">Billing is on hold until both parties agree to resume</p>
                </div>
              </div>
              <p className="text-xs text-amber-700 leading-relaxed">Both you and {active.professionalName ?? "your teacher"} must consent to resume.</p>
              <Button size="sm" onClick={() => void handleRequestResume()} disabled={postingLifecycle}
                className="bg-[#2EC4A5] hover:bg-[#26a88d] text-white text-xs rounded-xl gap-1">
                {postingLifecycle ? <Loader2 size={12} className="animate-spin" /> : null}Request Resume
              </Button>
            </div>
          )}

          {/* End engagement — only when active or notice_period */}
          {(active.status === "active" || active.status === "notice_period") && (() => {
            const buyoutFee = Math.round(15 * parseFloat(active.monthlyFeeInr) / 30);
            const buyoutEndDate = new Date(); buyoutEndDate.setDate(buyoutEndDate.getDate() + 15);
            const buyoutEndStr = buyoutEndDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
            const teacherName = active.professionalName ?? "your teacher";
            return (
              <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm space-y-4">
                <div>
                  <p className="text-sm font-bold text-[#1A2340]">End Engagement</p>
                  <p className="text-xs text-gray-400 mt-0.5">Choose how you'd like to close this engagement</p>
                </div>
                <div className="space-y-2">
                  {/* Give Notice */}
                  <button onClick={() => setLifecycleType(lifecycleType === "stop" ? "" : "stop")}
                    className={`w-full py-2.5 px-3 rounded-xl border text-sm font-semibold transition-colors text-left ${lifecycleType === "stop" ? "border-[#FF6B6B] bg-[#FF6B6B]/10 text-[#FF6B6B]" : "border-gray-200 hover:border-gray-300 text-gray-600"}`}>
                    End (30-day notice) — no extra cost
                  </button>
                  {lifecycleType === "stop" && (
                    <p className="text-xs text-gray-500 px-1">
                      Ends this engagement after 30 days at no extra cost. {teacherName} continues for 30 days while you find alternative support. Either party can give notice.
                    </p>
                  )}

                  {/* Early Exit / 15-day Buyout */}
                  <button onClick={() => setLifecycleType(lifecycleType === "buyout" ? "" : "buyout")}
                    className={`w-full py-2.5 px-3 rounded-xl border text-sm font-semibold transition-colors text-left ${lifecycleType === "buyout" ? "border-[#FF6B6B] bg-[#FF6B6B]/10 text-[#FF6B6B]" : "border-gray-200 hover:border-gray-300 text-gray-600"}`}>
                    Early Exit (15 days) — one-time fee of ₹{buyoutFee.toLocaleString("en-IN")}
                  </button>
                  {lifecycleType === "buyout" && (
                    <p className="text-xs text-gray-500 px-1">
                      Ends this engagement in 15 days by paying a one-time fee of ₹{buyoutFee.toLocaleString("en-IN")}. {teacherName} continues working until {buyoutEndStr}. The engagement ends automatically on that date. The fee is non-refundable.
                    </p>
                  )}

                  {/* Full Buyout */}
                  <button onClick={() => setLifecycleType(lifecycleType === "full_buyout" ? "" : "full_buyout")}
                    className={`w-full py-2.5 px-3 rounded-xl border text-sm font-semibold transition-colors text-left ${lifecycleType === "full_buyout" ? "border-[#FF6B6B] bg-[#FF6B6B]/10 text-[#FF6B6B]" : "border-gray-200 hover:border-gray-300 text-gray-600"}`}>
                    Full Buyout — ₹{parseFloat(active.monthlyFeeInr).toLocaleString("en-IN")} — end on a date you choose
                  </button>
                  {lifecycleType === "full_buyout" && (
                    <div className="space-y-2 px-1">
                      <p className="text-xs text-gray-500">
                        Pay one full month's salary (₹{parseFloat(active.monthlyFeeInr).toLocaleString("en-IN")}) to end the engagement on any date — including today. {teacherName} is compensated for the full month regardless. No notice period required. The fee is non-refundable.
                      </p>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-gray-700">Engagement ends on:</label>
                        <input
                          type="date"
                          min={new Date().toISOString().slice(0, 10)}
                          value={fullBuyoutDate}
                          onChange={(e) => setFullBuyoutDate(e.target.value)}
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2EC4A5]"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {lifecycleType && (
                  <>
                    <textarea value={lifecycleNotes} onChange={(e) => setLifecycleNotes(e.target.value)} rows={3}
                      placeholder="Please explain why you are making this request…"
                      className="w-full rounded-lg border border-gray-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#2EC4A5] resize-none" />
                    <Button onClick={handleLifecycleRequest} disabled={postingLifecycle}
                      className="w-full bg-[#FF6B6B] hover:bg-[#e85a5a] text-white text-sm">
                      {postingLifecycle ? <Loader2 size={14} className="animate-spin mr-1" /> : null}Submit Request
                    </Button>
                  </>
                )}
                {buyoutPaid && (
                  <div className="flex items-center gap-2 p-3 bg-green-50 rounded-xl border border-green-200 text-sm text-green-700 font-medium">
                    <CheckCircle2 size={16} /> Early exit confirmed — {teacherName} continues until {buyoutEndStr}. The engagement ends automatically on that date.
                  </div>
                )}
                {fullBuyoutPaid && (
                  <div className="flex items-center gap-2 p-3 bg-green-50 rounded-xl border border-green-200 text-sm text-green-700 font-medium">
                    <CheckCircle2 size={16} />
                    {fullBuyoutDate === new Date().toISOString().slice(0, 10)
                      ? "Full buyout confirmed — this engagement has ended immediately."
                      : `Full buyout confirmed — engagement ends on ${new Date(fullBuyoutDate + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}.`
                    }
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Goals ── */}
      {visibleStTab === "goals" && <EngagementProgress active={active} view="goals" />}

      {/* ── Trends ── */}
      {visibleStTab === "trends" && <EngagementProgress active={active} view="trends" />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SERVICES (hub chooser)
// ═══════════════════════════════════════════════════════════════════════════════
function ServicesTab() {
  const [, setLocation] = useLocation();
  const [view, setView] = useState<"menu" | "find" | "centre" | "tutor">("menu");

  const backBtn = (
    <button
      onClick={() => setView("menu")}
      className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-teal-600 transition-colors"
    >
      <ArrowLeft size={14} /> All services
    </button>
  );

  if (view === "find") {
    return (
      <div className="space-y-4 pb-4">
        {backBtn}
        <FindTab />
      </div>
    );
  }
  if (view === "centre") {
    return (
      <div className="space-y-4 pb-4">
        {backBtn}
        <ComingSoon
          icon={Building2}
          accent="amber"
          title="Therapy Centres coming soon"
          description="Browse and book verified therapy centres near you — occupational, speech, behavioural and more. We're onboarding centres now."
        />
      </div>
    );
  }
  if (view === "tutor") {
    return (
      <div className="space-y-4 pb-4">
        {backBtn}
        <ComingSoon
          icon={BookOpen}
          accent="violet"
          title="Home Tutors coming soon"
          description="Find patient, special-needs-aware tutors for academic support at home. This service is on the way."
        />
      </div>
    );
  }

  const services: { icon: typeof Search; title: string; desc: string; accent: string; onClick: () => void }[] = [
    { icon: Sparkles, title: "Shadow Teacher", desc: "Get matched with a verified shadow teacher for your child", accent: "bg-teal-50 text-teal-600", onClick: () => setLocation("/shadow-teacher") },
    { icon: Search, title: "Therapists & Specialists", desc: "OT, speech, psychology, paediatrics & more", accent: "bg-blue-50 text-blue-600", onClick: () => setView("find") },
    { icon: HelpCircle, title: "Parent Coaching", desc: "1:1 guidance from experienced coaches", accent: "bg-violet-50 text-violet-600", onClick: () => setView("find") },
    { icon: Building2, title: "Therapy Centres", desc: "Centre-based programmes near you", accent: "bg-amber-50 text-amber-600", onClick: () => setView("centre") },
    { icon: BookOpen, title: "Home Tutors", desc: "Academic support tailored for your child", accent: "bg-rose-50 text-rose-600", onClick: () => setView("tutor") },
  ];

  return (
    <div className="space-y-5 pb-4">
      <div>
        <h1 className="text-[1.35rem] font-bold text-[#1A2340] leading-tight">Services</h1>
        <p className="text-xs text-gray-400 mt-0.5">Find the right support for your child</p>
      </div>
      <div className="space-y-3">
        {services.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.title}
              onClick={s.onClick}
              className="w-full bg-white border border-gray-100 rounded-2xl p-4 shadow-sm flex items-center gap-4 text-left hover:shadow-md transition-shadow"
            >
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${s.accent}`}>
                <Icon size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-[#1A2340] text-sm">{s.title}</p>
                <p className="text-xs text-gray-400 mt-0.5">{s.desc}</p>
              </div>
              <ArrowRight size={16} className="text-gray-300 shrink-0" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROGRESS (logs / goals / trends for the selected child's active engagement)
// ═══════════════════════════════════════════════════════════════════════════════
function ProgressTab() {
  const { selectedChildId } = useSelectedChild();
  const [, setLocation] = useLocation();
  const [pTab, setPTab] = useState<"logs" | "goals" | "trends">("logs");

  interface PEngagement {
    id: number;
    childId: number | null;
    childName: string | null;
    status: string;
  }
  const { data: engagements = [], isLoading } = useQuery<PEngagement[]>({
    queryKey: ["parent-engagements"],
    queryFn: () => fetchWithAuth("/api/engagements").then((r) => r.json()),
  });

  const active = engagements.find(e =>
    (["active", "notice_period", "paused", "pending_start", "pending_teacher_acceptance", "ended"].includes(e.status)) &&
    e.childId === selectedChildId
  );

  if (isLoading) {
    return (
      <div className="space-y-3 pb-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-14 bg-white rounded-xl animate-pulse shadow-sm" />
        ))}
      </div>
    );
  }

  if (!active) {
    return (
      <div className="space-y-5 pb-4">
        <div>
          <h1 className="text-[1.35rem] font-bold text-[#1A2340] leading-tight">Progress</h1>
          <p className="text-xs text-gray-400 mt-0.5">Daily logs, goals & trends for your child</p>
        </div>
        <div className="bg-white border border-dashed border-gray-200 rounded-2xl p-12 text-center">
          <div className="w-12 h-12 bg-teal-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <TrendingUp size={20} className="text-teal-300" />
          </div>
          <p className="text-sm font-semibold text-gray-600">No active engagement yet</p>
          <p className="text-xs text-gray-400 mt-1 max-w-xs mx-auto">
            Once you start working with a shadow teacher, daily logs, goals and progress trends for your child appear here.
          </p>
          <Button onClick={() => setLocation("/services")} className="mt-4 bg-[#2EC4A5] hover:bg-[#26a88d] text-white text-sm">
            Explore Services
          </Button>
        </div>
      </div>
    );
  }

  // Mirror ShadowTeacherTab: logs/goals/trends are gated until the engagement
  // actually starts (pending_start / pending_teacher_acceptance) — no pre-start writes.
  if (active.status === "pending_start" || active.status === "pending_teacher_acceptance") {
    return (
      <div className="space-y-5 pb-4">
        <div>
          <h1 className="text-[1.35rem] font-bold text-[#1A2340] leading-tight">Progress</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {active.childName ? `${active.childName}'s daily logs, goals & trends` : "Daily logs, goals & trends"}
          </p>
        </div>
        <div className="bg-white border border-dashed border-gray-200 rounded-2xl p-12 text-center">
          <div className="w-12 h-12 bg-teal-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Clock size={20} className="text-teal-300" />
          </div>
          <p className="text-sm font-semibold text-gray-600">Available once the engagement starts</p>
          <p className="text-xs text-gray-400 mt-1 max-w-xs mx-auto">
            Daily logs, goals and progress trends become available once your engagement begins on the confirmed start date.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-4">
      <div>
        <h1 className="text-[1.35rem] font-bold text-[#1A2340] leading-tight">Progress</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          {active.childName ? `${active.childName}'s daily logs, goals & trends` : "Daily logs, goals & trends"}
        </p>
      </div>
      <div className="flex gap-1 bg-gray-100 rounded-2xl p-1">
        {(([["logs", "Daily Logs"], ["goals", "Goals"], ["trends", "Trends"]] as ["logs" | "goals" | "trends", string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setPTab(id)}
            className={`flex-1 px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${pTab === id ? "bg-white text-[#1A2340] shadow-sm" : "text-gray-400 hover:text-gray-600"}`}
          >
            {label}
          </button>
        )))}
      </div>
      <EngagementProgress active={active} view={pTab} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PARENT DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════
export default function ParentDashboard() {
  const { user } = useUser();
  const [loc, setLocation] = useLocation();
  const { data: me } = useGetMe();

  const activeTab: Tab = (() => {
    if (loc.startsWith("/services"))       return "services";
    if (loc.startsWith("/progress"))       return "progress";
    if (loc.startsWith("/bookings"))       return "bookings";
    if (loc.startsWith("/inbox"))          return "messages";
    if (loc.startsWith("/shadow-teacher")) return "shadow-teacher";
    return "home";
  })();
  const [showNotifications, setShowNotifications] = useState(false);

  useEffect(() => { setShowNotifications(false); }, [loc]);
  const firstName = me?.fullName?.split(" ")[0] ?? user?.firstName ?? "there";
  const city = me?.location ?? null;

  const { data: notifData } = useQuery<{ notifications: Notification[]; unreadCount: number }>({
    queryKey: ["notifications"],
    queryFn: () => fetchWithAuth("/api/notifications").then((r) => r.json()),
  });
  const notifications = notifData?.notifications ?? [];
  const unreadCount = notifData?.unreadCount ?? 0;

  function handleTabChange(tab: Tab) {
    if (tab === "notifications") { setShowNotifications(true); return; }
    setShowNotifications(false);
    const routes: Partial<Record<Tab, string>> = {
      home: "/home",
      find: "/services",
      services: "/services",
      progress: "/progress",
      bookings: "/bookings",
      "shadow-teacher": "/shadow-teacher",
      messages: "/inbox",
    };
    const route = routes[tab];
    if (route) setLocation(route);
  }

  return (
    <div className="bg-[#F5F7FA]">
      <main className="px-4 sm:px-6 py-6 max-w-[900px] w-full mx-auto">
        {showNotifications ? (
          <NotificationsTab />
        ) : (
          <>
            {activeTab === "home"           && <HomeTab parentName={firstName} city={city} onTabChange={handleTabChange} />}
            {activeTab === "services"       && <ServicesTab />}
            {activeTab === "progress"       && <ProgressTab />}
            {activeTab === "bookings"       && <BookingsTab />}
            {activeTab === "shadow-teacher" && <ShadowTeacherTab />}
            {activeTab === "messages"       && <MessagesTab />}
          </>
        )}
      </main>
    </div>
  );
}
