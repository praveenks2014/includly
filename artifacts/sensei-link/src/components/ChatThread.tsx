import { useState, useEffect, useRef, useCallback } from "react";
import { Loader2, Send, MessageCircle, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@clerk/react";
import { useGetMe } from "@workspace/api-client-react";

interface ChatMessage {
  id: number;
  bookingId: number;
  senderId: number;
  senderName: string | null;
  body: string;
  createdAt: string;
}

interface MessagesResponse {
  messages: ChatMessage[];
  total: number;
  hasMore: boolean;
  nextBefore: number | null;
}

interface ChatThreadProps {
  bookingId: number;
  otherPartyName: string;
  onMessagesRead?: (count: number) => void;
}

const POLL_INTERVAL_MS = 10_000;
const PAGE_LIMIT = 100;

export function ChatThread({ bookingId, otherPartyName, onMessagesRead }: ChatThreadProps) {
  const { getToken } = useAuth();
  const { data: me } = useGetMe();
  const { toast } = useToast();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const totalReadRef = useRef(0);

  const localStorageKey = `chat_read_count_${bookingId}`;

  function scrollToBottom() {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }

  async function fetchPage(url: string): Promise<MessagesResponse | null> {
    const token = await getToken();
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    return res.json() as Promise<MessagesResponse>;
  }

  const fetchMessages = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const data = await fetchPage(`/api/sessions/${bookingId}/messages?limit=${PAGE_LIMIT}`);
      if (!data) {
        if (!silent) toast({ title: "Could not load messages", variant: "destructive" });
        return;
      }
      setMessages(data.messages);
      setHasMore(data.hasMore);
      setNextBefore(data.nextBefore);
      // Only increase the stored read count (never decrease).
      // handleOpenChat in sessions.tsx already sets it to session.messageCount
      // (total from the sessions list API) so the badge immediately clears.
      const stored = parseInt(localStorage.getItem(localStorageKey) ?? "0", 10);
      const newCount = Math.max(stored, data.messages.length);
      localStorage.setItem(localStorageKey, String(newCount));
      if (onMessagesRead) onMessagesRead(newCount);
    } catch {
      if (!silent) toast({ title: "Could not load messages", variant: "destructive" });
    } finally {
      if (!silent) setIsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId, localStorageKey, onMessagesRead, toast]);

  async function loadMore() {
    if (!nextBefore || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const data = await fetchPage(`/api/sessions/${bookingId}/messages?limit=${PAGE_LIMIT}&before=${nextBefore}`);
      if (!data) return;
      setMessages((prev) => [...data.messages, ...prev]);
      setHasMore(data.hasMore);
      setNextBefore(data.nextBefore);
    } catch {
      toast({ title: "Could not load earlier messages", variant: "destructive" });
    } finally {
      setIsLoadingMore(false);
    }
  }

  useEffect(() => {
    fetchMessages(false);
    pollRef.current = setInterval(() => fetchMessages(true), POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchMessages]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  async function handleSend() {
    const trimmed = draft.trim();
    if (!trimmed || isSending) return;

    setIsSending(true);
    try {
      const token = await getToken();
      const res = await fetch(`/api/sessions/${bookingId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ body: trimmed }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        toast({ title: err.error ?? "Could not send message", variant: "destructive" });
        return;
      }
      const newMsg = await res.json() as ChatMessage;
      setDraft("");
      setMessages((prev) => {
        const updated = [...prev, newMsg];
        totalReadRef.current = updated.length;
        localStorage.setItem(localStorageKey, String(updated.length));
        if (onMessagesRead) onMessagesRead(updated.length);
        return updated;
      });
    } catch {
      toast({ title: "Could not send message", variant: "destructive" });
    } finally {
      setIsSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function formatTime(iso: string) {
    return new Date(iso).toLocaleString("en-IN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-primary" size={24} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto py-3 px-1 space-y-3 min-h-0"
        style={{ maxHeight: "380px" }}
      >
        {hasMore && (
          <div className="flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs text-muted-foreground"
              onClick={loadMore}
              disabled={isLoadingMore}
              data-testid="load-more-messages"
            >
              {isLoadingMore ? <Loader2 size={12} className="animate-spin" /> : <ChevronUp size={12} />}
              Load earlier messages
            </Button>
          </div>
        )}

        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-center">
            <MessageCircle size={32} className="text-muted-foreground/30 mb-2" />
            <p className="text-sm text-muted-foreground">No messages yet. Say hi to {otherPartyName}!</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMine = me?.id === msg.senderId;
            return (
              <div
                key={msg.id}
                className={`flex flex-col gap-0.5 ${isMine ? "items-end" : "items-start"}`}
              >
                {!isMine && (
                  <span className="text-xs text-muted-foreground px-1">{msg.senderName ?? "Them"}</span>
                )}
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                    isMine
                      ? "bg-primary text-primary-foreground rounded-br-sm"
                      : "bg-muted text-foreground rounded-bl-sm"
                  }`}
                >
                  {msg.body}
                </div>
                <span className="text-[10px] text-muted-foreground px-1">{formatTime(msg.createdAt)}</span>
              </div>
            );
          })
        )}
      </div>

      <div className="border-t border-border pt-3 flex gap-2 items-end">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message… (Enter to send)"
          className="flex-1 resize-none min-h-[42px] max-h-[120px] text-sm"
          rows={1}
          disabled={isSending}
          data-testid="chat-message-input"
        />
        <Button
          size="icon"
          onClick={handleSend}
          disabled={!draft.trim() || isSending}
          className="shrink-0 h-10 w-10"
          data-testid="chat-send-btn"
        >
          {isSending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
        </Button>
      </div>
    </div>
  );
}
