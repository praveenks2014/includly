import { useState, useEffect, useRef } from "react";
import { fetchWithAuth } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, X, Send, Lock, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ChatMessage {
  id: number;
  senderId: number;
  body: string;
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

        {/* Input */}
        <div className="flex items-end gap-2 px-4 py-3 border-t border-gray-100">
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
            className="bg-[#2EC4A5] hover:bg-[#26a88d] text-white rounded-xl h-10 w-10 p-0"
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
