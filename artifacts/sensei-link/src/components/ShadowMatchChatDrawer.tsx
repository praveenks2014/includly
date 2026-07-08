import { useState, useEffect, useRef } from "react";
import { fetchWithAuth } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, X, Send, Lock, ShieldCheck, MapPin, CheckCircle2, XCircle, CalendarClock, Video, Star } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ── Structured-message card renderer — Task 3g ──────────────────────────────
// Each msgType posted by the redesigned parent<->teacher journey endpoints
// (Task 2a) carries a JSON body specific to that action. Rendered as a
// non-bubble "system card" distinct from regular chat bubbles.
interface InterviewSlotPayload { date: string; time: string; label?: string; }

function StructuredMessageCard({ msgType, body }: { msgType: string; body: string }) {
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(body) as Record<string, unknown>; } catch { /* malformed — render with empty data */ }

  const base = "max-w-[85%] px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed border space-y-1.5";

  switch (msgType) {
    case "request_sent":
      return (
        <div className={`${base} bg-blue-50 border-blue-200 text-blue-800`}>
          <p className="font-semibold flex items-center gap-1.5"><Send size={12} /> Shadowing request sent</p>
        </div>
      );
    case "request_accepted":
      return (
        <div className={`${base} bg-green-50 border-green-200 text-green-800`}>
          <p className="font-semibold flex items-center gap-1.5"><CheckCircle2 size={12} /> Request accepted</p>
        </div>
      );
    case "request_rejected":
      return (
        <div className={`${base} bg-red-50 border-red-200 text-red-800`}>
          <p className="font-semibold flex items-center gap-1.5"><XCircle size={12} /> Request declined</p>
          {typeof data["note"] === "string" && data["note"] && <p className="italic">"{data["note"]}"</p>}
        </div>
      );
    case "interview_proposed": {
      const slots = Array.isArray(data["slots"]) ? (data["slots"] as InterviewSlotPayload[]) : [];
      return (
        <div className={`${base} bg-purple-50 border-purple-200 text-purple-800`}>
          <p className="font-semibold flex items-center gap-1.5"><CalendarClock size={12} /> Interview slots proposed</p>
          <ul className="space-y-0.5">
            {slots.map((s, i) => (
              <li key={i}>{s.label ? `${s.label} — ` : ""}{s.date} at {s.time}</li>
            ))}
          </ul>
        </div>
      );
    }
    case "interview_confirmed": {
      const confirmedSlot = typeof data["confirmedSlot"] === "string" ? data["confirmedSlot"] : null;
      const meetLink = typeof data["meetLink"] === "string" ? data["meetLink"] : null;
      return (
        <div className={`${base} bg-green-50 border-green-200 text-green-800`}>
          <p className="font-semibold flex items-center gap-1.5"><CheckCircle2 size={12} /> Interview confirmed</p>
          {confirmedSlot && <p>{confirmedSlot}</p>}
          {meetLink && (
            <a
              href={meetLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 w-full h-8 rounded-lg bg-[#2EC4A5] hover:bg-[#26a88d] text-white font-semibold no-underline"
            >
              <Video size={12} />
              Join Interview
            </a>
          )}
        </div>
      );
    }
    case "interview_done":
      return (
        <div className={`${base} bg-teal-50 border-teal-200 text-teal-800`}>
          <p className="font-semibold flex items-center gap-1.5"><CheckCircle2 size={12} /> Interview marked complete</p>
        </div>
      );
    case "trial_requested": {
      const trialDays = typeof data["trialDays"] === "number" ? data["trialDays"] : null;
      return (
        <div className={`${base} bg-orange-50 border-orange-200 text-orange-800`}>
          <p className="font-semibold flex items-center gap-1.5"><Star size={12} /> Trial requested{trialDays ? ` — ${trialDays} day${trialDays > 1 ? "s" : ""}` : ""}</p>
        </div>
      );
    }
    case "trial_accepted": {
      const trialDays = typeof data["trialDays"] === "number" ? data["trialDays"] : null;
      return (
        <div className={`${base} bg-orange-50 border-orange-200 text-orange-800`}>
          <p className="font-semibold flex items-center gap-1.5"><CheckCircle2 size={12} /> Trial accepted{trialDays ? ` — ${trialDays} day${trialDays > 1 ? "s" : ""}` : ""}</p>
        </div>
      );
    }
    default:
      return null;
  }
}

const STRUCTURED_MSG_TYPES = new Set([
  "request_sent", "request_accepted", "request_rejected",
  "interview_proposed", "interview_confirmed", "interview_done",
  "trial_requested", "trial_accepted",
]);

interface ChatMessage {
  id: number;
  senderId: number;
  body: string;
  msgType?: string;
  createdAt: string;
}

interface ShadowMatchChatDrawerProps {
  matchId: number;
  candidateId: number;
  candidateName: string;
  committed: boolean;
  myUserId: number;
  onClose: () => void;
}

const PHONE_RE = /(\+?91[\s-]?)?[6-9]\d{9}/;
function inputLooksLikePhone(s: string): boolean {
  return PHONE_RE.test(s.replace(/[\s().\-]/g, ""));
}

export function ShadowMatchChatDrawer({
  matchId,
  candidateId,
  candidateName,
  committed,
  myUserId,
  onClose,
}: ShadowMatchChatDrawerProps) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threadId, setThreadId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const [showLocationInput, setShowLocationInput] = useState(false);
  const [locationText, setLocationText] = useState("");
  const [locationMapsUrl, setLocationMapsUrl] = useState("");
  const [sendingLocation, setSendingLocation] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);

  async function loadThread() {
    try {
      const res = await fetchWithAuth(`/api/shadow-teacher/${matchId}/thread/${candidateId}`);
      if (!res.ok) return;
      const data = await res.json() as { threadId: number; messages: ChatMessage[] };
      setThreadId(data.threadId);
      setMessages(data.messages);
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadThread();
    const interval = setInterval(() => { void loadThread(); }, 10_000);
    return () => clearInterval(interval);
  }, [matchId, candidateId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      const res = await fetchWithAuth(`/api/shadow-teacher/${matchId}/thread/${candidateId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: trimmed }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        toast({ title: d.error ?? "Send failed", variant: "destructive" });
        return;
      }
      const msg = await res.json() as ChatMessage;
      setMessages((prev) => [...prev, msg]);
      setBody("");
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  async function handleSendLocation() {
    const text = locationText.trim();
    if (!text || sendingLocation) return;
    setSendingLocation(true);
    try {
      const res = await fetchWithAuth(`/api/shadow-teacher/${matchId}/thread/${candidateId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: text,
          type: "location",
          mapsUrl: locationMapsUrl.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        toast({ title: d.error ?? "Could not share location", variant: "destructive" });
        return;
      }
      const msg = await res.json() as ChatMessage;
      setMessages((prev) => [...prev, msg]);
      setLocationText("");
      setLocationMapsUrl("");
      setShowLocationInput(false);
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setSendingLocation(false);
    }
  }

  const phoneWarning = locationText.length > 0 && inputLooksLikePhone(locationText);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <p className="font-semibold text-[#1A2340] text-sm">Chat with {candidateName}</p>
            {!committed && (
              <div className="flex items-center gap-1 mt-0.5">
                <Lock size={10} className="text-amber-500" />
                <span className="text-[10px] text-amber-600">Contact details hidden until you choose this teacher</span>
              </div>
            )}
            {committed && (
              <div className="flex items-center gap-1 mt-0.5">
                <ShieldCheck size={10} className="text-green-500" />
                <span className="text-[10px] text-green-600">Committed — full contact revealed</span>
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={18} /></button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[200px]">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 size={20} className="animate-spin text-[#2EC4A5]" />
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-gray-400">No messages yet.</p>
              <p className="text-xs text-gray-300 mt-1">Start the conversation below.</p>
            </div>
          ) : (
            messages.map((m) => {
              const isMe = m.senderId === myUserId;
              if (m.msgType && STRUCTURED_MSG_TYPES.has(m.msgType)) {
                return (
                  <div key={m.id} className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                    <StructuredMessageCard msgType={m.msgType} body={m.body} />
                    <p className="text-[10px] text-gray-400 mt-0.5 px-1">
                      {new Date(m.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                );
              }
              if (m.msgType === "location") {
                let locText = m.body;
                let mapsHref: string | undefined;
                try {
                  const loc = JSON.parse(m.body) as { text?: string; mapsUrl?: string | null };
                  locText = loc.text ?? m.body;
                  mapsHref = loc.mapsUrl ?? undefined;
                } catch { /* malformed — render raw */ }
                const href = mapsHref || `https://maps.google.com/?q=${encodeURIComponent(locText)}`;
                return (
                  <div key={m.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`max-w-[80%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed flex items-start gap-2 no-underline ${
                        isMe
                          ? "bg-[#2EC4A5] text-white rounded-br-sm"
                          : "bg-gray-100 text-[#1A2340] rounded-bl-sm"
                      }`}
                    >
                      <MapPin size={14} className={`shrink-0 mt-0.5 ${isMe ? "text-white/80" : "text-[#2EC4A5]"}`} />
                      <div>
                        <p className={`text-[10px] font-semibold uppercase tracking-wide mb-0.5 ${isMe ? "text-white/70" : "text-gray-400"}`}>
                          Meeting location
                        </p>
                        <p className="text-sm">{locText}</p>
                        <p className={`text-[10px] mt-1 underline ${isMe ? "text-white/60" : "text-[#2EC4A5]"}`}>
                          Open in Maps ↗
                        </p>
                        <p className={`text-[10px] mt-0.5 ${isMe ? "text-white/50 text-right" : "text-gray-400"}`}>
                          {new Date(m.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                    </a>
                  </div>
                );
              }
              return (
                <div key={m.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[80%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
                      isMe
                        ? "bg-[#2EC4A5] text-white rounded-br-sm"
                        : "bg-gray-100 text-[#1A2340] rounded-bl-sm"
                    }`}
                  >
                    {m.body}
                    <p className={`text-[10px] mt-1 ${isMe ? "text-white/60 text-right" : "text-gray-400"}`}>
                      {new Date(m.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        {!committed && (
          <div className="px-4 py-2 bg-amber-50 border-t border-amber-100">
            <p className="text-[10px] text-amber-600">
              Contact info (phone, email, WhatsApp) is automatically hidden in this chat to protect both parties. It will be revealed after you select this teacher.
            </p>
          </div>
        )}

        {/* Location input panel */}
        {showLocationInput && (
          <div className="px-4 pt-3 pb-2 border-t border-gray-100 space-y-2 bg-gray-50">
            <p className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
              <MapPin size={12} className="text-[#2EC4A5]" />
              Share a meeting location
            </p>
            <input
              type="text"
              placeholder="e.g. Tata Memorial Hospital, Parel, Mumbai"
              value={locationText}
              onChange={(e) => setLocationText(e.target.value)}
              maxLength={300}
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-1.5 outline-none focus:ring-1 focus:ring-[#2EC4A5] bg-white"
            />
            <input
              type="url"
              placeholder="Google Maps link (optional)"
              value={locationMapsUrl}
              onChange={(e) => setLocationMapsUrl(e.target.value)}
              maxLength={500}
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-1.5 outline-none focus:ring-1 focus:ring-[#2EC4A5] bg-white"
            />
            {phoneWarning && (
              <p className="text-[10px] text-red-500">
                ⚠️ Location looks like a phone number — contact details are only shared after you commit to this teacher.
              </p>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="text-xs text-gray-400 hover:text-gray-600 px-2"
                onClick={() => { setShowLocationInput(false); setLocationText(""); setLocationMapsUrl(""); }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="flex-1 bg-[#2EC4A5] hover:bg-[#26a88d] text-white rounded-xl text-xs gap-1"
                onClick={() => void handleSendLocation()}
                disabled={!locationText.trim() || sendingLocation || phoneWarning}
              >
                {sendingLocation ? <Loader2 size={12} className="animate-spin" /> : <MapPin size={12} />}
                Share location
              </Button>
            </div>
          </div>
        )}

        {/* Input */}
        <div className="flex items-end gap-2 px-4 py-3 border-t border-gray-100">
          <Button
            size="sm"
            variant="outline"
            className={`rounded-xl h-10 w-10 p-0 border-gray-200 shrink-0 ${showLocationInput ? "bg-[#2EC4A5]/10 border-[#2EC4A5]" : ""}`}
            onClick={() => setShowLocationInput((v) => !v)}
            title="Share a meeting location"
          >
            <MapPin size={14} className={showLocationInput ? "text-[#2EC4A5]" : "text-gray-400"} />
          </Button>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Type a message…"
            rows={2}
            className="flex-1 resize-none text-sm focus-visible:ring-[#2EC4A5] rounded-xl"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
          />
          <Button
            size="sm"
            className="bg-[#2EC4A5] hover:bg-[#26a88d] text-white rounded-xl h-10 w-10 p-0 shrink-0"
            onClick={() => void handleSend()}
            disabled={!body.trim() || sending}
            aria-label="Send message"
          >
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </Button>
        </div>
      </div>
    </div>
  );
}
