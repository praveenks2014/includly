import { useUser } from "@clerk/react";
import { Redirect, useSearch } from "wouter";
import { Badge } from "@/components/ui/badge";
import { useGetMySessions, useUpdateSessionStatus, type SessionBookingWithDetails } from "@workspace/api-client-react";
import { Loader2, CalendarCheck, Clock, IndianRupee, User, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { getSpecialtyLabel } from "@/lib/specialties";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ChatThread } from "@/components/ChatThread";

type SessionWithMessageCount = SessionBookingWithDetails & { messageCount?: number };

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
  cancelled_by_parent: "Cancelled by Parent",
  cancelled_by_professional: "Cancelled",
  no_show: "No Show",
};

function formatDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function getReadCount(bookingId: number): number {
  return parseInt(localStorage.getItem(`chat_read_count_${bookingId}`) ?? "0", 10);
}

export default function SessionsPage() {
  const { isSignedIn, isLoaded, user } = useUser();
  const { toast } = useToast();
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [chatSession, setChatSession] = useState<SessionWithMessageCount | null>(null);
  const [readCounts, setReadCounts] = useState<Record<number, number>>({});

  const search = useSearch();
  const chatParam = new URLSearchParams(search).get("chat");
  const chatParamId = chatParam ? parseInt(chatParam, 10) : null;

  const { data: sessions, isLoading, refetch } = useGetMySessions();

  const { mutateAsync: updateStatus } = useUpdateSessionStatus();

  useEffect(() => {
    if (!sessions) return;
    const counts: Record<number, number> = {};
    for (const s of sessions) {
      counts[s.id] = getReadCount(s.id);
    }
    setReadCounts(counts);
  }, [sessions]);

  useEffect(() => {
    if (!chatParamId || !sessions || chatSession) return;
    const target = (sessions as SessionWithMessageCount[]).find((s) => s.id === chatParamId);
    if (target) setChatSession(target);
  }, [chatParamId, sessions, chatSession]);

  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect to="/sign-in" />;

  const role = (user.publicMetadata?.role as string) ?? "parent";
  const isProfessional = role === "professional" || role === "admin";

  async function handleStatusUpdate(sessionId: number, status: string) {
    setUpdatingId(sessionId);
    try {
      await updateStatus({ id: sessionId, data: { status: status as "confirmed" | "cancelled_by_professional" | "completed" | "no_show" } });
      toast({ title: "Session updated" });
      refetch();
    } catch {
      toast({ title: "Update failed", variant: "destructive" });
    } finally {
      setUpdatingId(null);
    }
  }

  function handleOpenChat(session: SessionWithMessageCount) {
    setChatSession(session);
  }

  function handleMessagesRead(bookingId: number, count: number) {
    setReadCounts((prev) => ({ ...prev, [bookingId]: count }));
  }

  const typedSessions = (sessions ?? []) as SessionWithMessageCount[];
  const upcoming = typedSessions.filter((s) => s.status === "confirmed" && s.bookedDate >= new Date().toISOString().slice(0, 10));
  const other = typedSessions.filter((s) => !upcoming.includes(s));

  const chatOtherParty = chatSession
    ? isProfessional
      ? (chatSession.parentName ?? "Parent")
      : (chatSession.professionalName ?? "Specialist")
    : "";

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="flex items-center gap-3 mb-8">
          <CalendarCheck size={28} className="text-primary" />
          <div>
            <h1 className="text-2xl font-serif font-semibold text-foreground">My Sessions</h1>
            <p className="text-sm text-muted-foreground">
              {isProfessional ? "Sessions booked with you" : "Your booked sessions"}
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20"><Loader2 size={32} className="animate-spin text-muted-foreground" /></div>
        ) : sessions?.length === 0 ? (
          <div className="text-center py-20">
            <CalendarCheck size={48} className="text-muted-foreground/30 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">No sessions yet</h3>
            <p className="text-muted-foreground text-sm">
              {isProfessional
                ? "Set up your availability so parents can book sessions with you."
                : "Browse specialists and book your first session."}
            </p>
            {isProfessional && (
              <Button className="mt-4" onClick={() => window.location.href = "/availability"}>
                Set availability
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-8">
            {upcoming.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Upcoming</h2>
                <div className="space-y-3">
                  {upcoming.map((session) => (
                    <SessionCard
                      key={session.id}
                      session={session}
                      isProfessional={isProfessional}
                      onStatusUpdate={handleStatusUpdate}
                      isUpdating={updatingId === session.id}
                      unreadCount={Math.max(0, (session.messageCount ?? 0) - (readCounts[session.id] ?? 0))}
                      onOpenChat={handleOpenChat}
                    />
                  ))}
                </div>
              </div>
            )}
            {other.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Past & Other</h2>
                <div className="space-y-3">
                  {other.map((session) => (
                    <SessionCard
                      key={session.id}
                      session={session}
                      isProfessional={isProfessional}
                      onStatusUpdate={handleStatusUpdate}
                      isUpdating={updatingId === session.id}
                      unreadCount={Math.max(0, (session.messageCount ?? 0) - (readCounts[session.id] ?? 0))}
                      onOpenChat={handleOpenChat}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <Dialog open={!!chatSession} onOpenChange={(open) => { if (!open) setChatSession(null); }}>
        <DialogContent className="max-w-lg w-full flex flex-col" style={{ maxHeight: "90vh" }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-serif">
              <MessageCircle size={18} className="text-primary" />
              Chat with {chatOtherParty}
            </DialogTitle>
            {chatSession && (
              <DialogDescription>
                {formatDate(chatSession.bookedDate)} · {chatSession.startTime}–{chatSession.endTime}
              </DialogDescription>
            )}
          </DialogHeader>
          {chatSession && (
            <div className="flex-1 min-h-0">
              <ChatThread
                bookingId={chatSession.id}
                otherPartyName={chatOtherParty}
                onMessagesRead={(count) => handleMessagesRead(chatSession.id, count)}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SessionCard({
  session,
  isProfessional,
  onStatusUpdate,
  isUpdating,
  unreadCount,
  onOpenChat,
}: {
  session: SessionWithMessageCount;
  isProfessional: boolean;
  onStatusUpdate: (id: number, status: string) => void;
  isUpdating: boolean;
  unreadCount: number;
  onOpenChat: (session: SessionWithMessageCount) => void;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-4">
      <div className="flex-1 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[session.status] ?? "bg-gray-100 text-gray-700"}`}>
            {STATUS_LABELS[session.status] ?? session.status}
          </span>
          {session.professionalSpecialty && (
            <Badge variant="outline" className="text-xs">{getSpecialtyLabel(session.professionalSpecialty)}</Badge>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <User size={14} className="text-muted-foreground" />
          {isProfessional ? session.parentName ?? "Parent" : session.professionalName ?? "Professional"}
        </div>

        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <CalendarCheck size={13} />
            {formatDate(session.bookedDate)}
          </span>
          <span className="flex items-center gap-1">
            <Clock size={13} />
            {session.startTime} – {session.endTime} ({session.durationMinutes} min)
          </span>
          <span className="flex items-center gap-1">
            <IndianRupee size={13} />
            ₹{session.amountInr}
          </span>
        </div>

        {session.notes && (
          <p className="text-xs text-muted-foreground italic">"{session.notes}"</p>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 relative"
          onClick={() => onOpenChat(session)}
          data-testid={`chat-btn-${session.id}`}
        >
          <MessageCircle size={14} />
          Message
          {unreadCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 bg-primary text-primary-foreground text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1" data-testid={`unread-badge-${session.id}`}>
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>

        {isProfessional && session.status === "confirmed" && (
          isUpdating ? (
            <Loader2 size={18} className="animate-spin text-muted-foreground" />
          ) : (
            <Select onValueChange={(v) => onStatusUpdate(session.id, v)}>
              <SelectTrigger className="h-9 w-44 text-sm">
                <SelectValue placeholder="Mark as…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="completed">Mark Completed</SelectItem>
                <SelectItem value="no_show">Mark No-Show</SelectItem>
                <SelectItem value="cancelled_by_professional">Cancel Session</SelectItem>
              </SelectContent>
            </Select>
          )
        )}
      </div>
    </div>
  );
}
