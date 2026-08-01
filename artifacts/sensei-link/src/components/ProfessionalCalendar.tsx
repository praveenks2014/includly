import { useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import type { EventClickArg, EventInput, EventSourceFuncArg } from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import { format } from "date-fns";
import { fetchWithAuth } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Loader2, ShieldAlert } from "lucide-react";
import "./ProfessionalCalendar.css";

interface CommittedBlock {
  vertical: "shadow_teacher" | "tutor" | "therapist";
  engagementId: number;
  date: string;
  startTime: string;
  endTime: string;
}

interface OpenSlot {
  id: number;
  date: string;
  startTime: string;
  endTime: string;
  durationMins: number;
  priceInr: number;
  status: "open" | "blocked";
  generatedFromTemplateId: number | null;
}

interface BookedSession {
  id: number;
  date: string;
  startTime: string | null;
  endTime: string | null;
  status: string;
  parentName: string | null;
  childName: string | null;
  vertical: "session_booking" | "tutor" | "therapist";
  meetLink: string | null;
}

interface CalendarResponse {
  committed: CommittedBlock[];
  open: OpenSlot[];
  booked: BookedSession[];
}

const VERTICAL_LABEL: Record<CommittedBlock["vertical"], string> = {
  shadow_teacher: "Shadow Teacher commitment",
  tutor: "Tutoring commitment",
  therapist: "Therapy commitment",
};

// Three layers, three sources (matches GET /professionals/me/calendar's own
// doc comment): committed = recurring engagements the professional can't be
// double-booked into (not directly actionable here); open/blocked = the
// professional's own materialized slots, actionable via the B7 endpoints
// below; booked = live session_bookings, not slots.status, since the
// write-path migration that would keep the two in sync is deferred.
function toEvents(data: CalendarResponse): EventInput[] {
  const committed: EventInput[] = data.committed.map((b) => ({
    id: `committed-${b.vertical}-${b.engagementId}-${b.date}-${b.startTime}`,
    title: VERTICAL_LABEL[b.vertical],
    start: `${b.date}T${b.startTime}`,
    end: `${b.date}T${b.endTime}`,
    backgroundColor: "#94a3b8",
    borderColor: "#94a3b8",
    textColor: "#1a2340",
    editable: false,
    extendedProps: { kind: "committed" },
  }));

  const slots: EventInput[] = data.open.map((s) => ({
    id: `slot-${s.id}`,
    title: s.status === "blocked" ? "Blocked" : `Open · ₹${s.priceInr}`,
    start: `${s.date}T${s.startTime}`,
    end: `${s.date}T${s.endTime}`,
    backgroundColor: s.status === "blocked" ? "#fca5a5" : "#2ec4a5",
    borderColor: s.status === "blocked" ? "#ef4444" : "#26a88d",
    textColor: s.status === "blocked" ? "#7f1d1d" : "#ffffff",
    editable: false,
    extendedProps: {
      kind: "slot",
      slotId: s.id,
      status: s.status,
      priceInr: s.priceInr,
      generatedFromTemplateId: s.generatedFromTemplateId,
    },
  }));

  // Sessions scheduled without a specific time (tutor/therapist engagement
  // sessions allow startTime/endTime to be null) have nothing to place on
  // a time grid — excluded here rather than guessed at.
  const booked: EventInput[] = data.booked
    .filter((s): s is BookedSession & { startTime: string; endTime: string } => s.startTime != null && s.endTime != null)
    .map((s) => ({
      id: `booked-${s.vertical}-${s.id}`,
      title: [s.parentName, s.childName].filter(Boolean).join(" · ") || "Booked",
      start: `${s.date}T${s.startTime}`,
      end: `${s.date}T${s.endTime}`,
      backgroundColor: "#1a2340",
      borderColor: "#1a2340",
      textColor: "#ffffff",
      editable: false,
      extendedProps: {
        kind: "booked",
        bookingId: s.id,
        status: s.status,
        parentName: s.parentName,
        childName: s.childName,
        vertical: s.vertical,
        meetLink: s.meetLink,
      },
    }));

  return [...committed, ...slots, ...booked];
}

interface SelectedSlot {
  slotId: number;
  status: "open" | "blocked";
  generatedFromTemplateId: number | null;
  title: string;
}

interface SelectedBooked {
  title: string;
  start: Date | null;
  end: Date | null;
  status: string;
  parentName: string | null;
  childName: string | null;
  vertical: "session_booking" | "tutor" | "therapist";
  meetLink: string | null;
}

interface AddSlotDraft {
  date: string;
  startTime: string;
  endTime: string;
  priceInr: string;
}

const emptyDraft: AddSlotDraft = { date: "", startTime: "", endTime: "", priceInr: "" };

export function ProfessionalCalendar() {
  const calendarRef = useRef<FullCalendar>(null);
  const { toast } = useToast();
  const [selected, setSelected] = useState<SelectedSlot | null>(null);
  const [selectedBooked, setSelectedBooked] = useState<SelectedBooked | null>(null);
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState<AddSlotDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [quickBlocking, setQuickBlocking] = useState(false);

  function refetch() {
    calendarRef.current?.getApi().refetchEvents();
  }

  async function fetchEvents(
    info: EventSourceFuncArg,
    successCallback: (events: EventInput[]) => void,
    failureCallback: (error: Error) => void,
  ) {
    try {
      const startDate = format(info.start, "yyyy-MM-dd");
      const endDate = format(info.end, "yyyy-MM-dd");
      const res = await fetchWithAuth(
        `/api/professionals/me/calendar?startDate=${startDate}&endDate=${endDate}`,
      );
      if (!res.ok) throw new Error("Failed to fetch calendar");
      const data = (await res.json()) as CalendarResponse;
      successCallback(toEvents(data));
    } catch (err) {
      failureCallback(err instanceof Error ? err : new Error("Failed to fetch calendar"));
    }
  }

  function handleEventClick(info: EventClickArg) {
    const props = info.event.extendedProps;
    if (props["kind"] === "slot") {
      setSelected({
        slotId: props["slotId"] as number,
        status: props["status"] as "open" | "blocked",
        generatedFromTemplateId: props["generatedFromTemplateId"] as number | null,
        title: info.event.title,
      });
      return;
    }
    if (props["kind"] === "booked") {
      setSelectedBooked({
        title: info.event.title,
        start: info.event.start,
        end: info.event.end,
        status: props["status"] as string,
        parentName: props["parentName"] as string | null,
        childName: props["childName"] as string | null,
        vertical: props["vertical"] as "session_booking" | "tutor" | "therapist",
        meetLink: props["meetLink"] as string | null,
      });
      return;
    }
    // "committed" — the recurring-pattern overview isn't individually
    // actionable here, nothing to show.
  }

  async function toggleBlock() {
    if (!selected) return;
    setBusy(true);
    try {
      const nextStatus = selected.status === "open" ? "blocked" : "open";
      const res = await fetchWithAuth(`/api/professionals/me/calendar/slots/${selected.slotId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) throw new Error();
      toast({ title: nextStatus === "blocked" ? "Slot blocked" : "Slot unblocked" });
      setSelected(null);
      refetch();
    } catch {
      toast({ title: "Could not update slot", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function deleteSlot() {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await fetchWithAuth(`/api/professionals/me/calendar/slots/${selected.slotId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not delete slot");
      toast({ title: "Slot deleted" });
      setSelected(null);
      refetch();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Could not delete slot", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function handleAddSlot() {
    const priceInr = Number(draft.priceInr);
    if (!draft.date || !draft.startTime || !draft.endTime || !Number.isFinite(priceInr) || priceInr <= 0) {
      toast({ title: "Fill in date, start/end time, and a valid price", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetchWithAuth("/api/professionals/me/calendar/slots", {
        method: "POST",
        body: JSON.stringify({ date: draft.date, startTime: draft.startTime, endTime: draft.endTime, priceInr }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not add slot");
      toast({ title: "One-off slot added" });
      setAddOpen(false);
      setDraft(emptyDraft);
      refetch();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Could not add slot", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  // Blocks every open slot in the CURRENTLY VISIBLE range that overlaps the
  // professional's own busy windows (recurring commitments + individually-
  // scheduled tutor/therapist sessions) — the same windows already drawn as
  // the committed/booked layers, so this is a bulk cleanup action over what
  // the professional can already see, not a hidden computation.
  async function handleQuickBlockBusy() {
    const view = calendarRef.current?.getApi().view;
    if (!view) return;
    setQuickBlocking(true);
    try {
      const startDate = format(view.activeStart, "yyyy-MM-dd");
      const endDate = format(view.activeEnd, "yyyy-MM-dd");
      const res = await fetchWithAuth("/api/professionals/me/calendar/quick-block-busy", {
        method: "POST",
        body: JSON.stringify({ startDate, endDate }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not block busy-hour conflicts");
      toast({ title: data.blockedCount > 0 ? `Blocked ${data.blockedCount} conflicting slot${data.blockedCount === 1 ? "" : "s"}` : "No open slots overlap your busy hours in this view" });
      refetch();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Could not block busy-hour conflicts", variant: "destructive" });
    } finally {
      setQuickBlocking(false);
    }
  }

  return (
    <div className="pro-calendar bg-white border border-gray-100 rounded-2xl shadow-[0_2px_12px_rgba(26,35,64,0.06)] p-4">
      <div className="flex justify-end gap-2 mb-2">
        <Button size="sm" variant="ghost" onClick={handleQuickBlockBusy} disabled={quickBlocking} className="gap-1 text-xs text-[#1A2340] hover:bg-gray-100" aria-label="Block busy-hour conflicts in this view">
          {quickBlocking ? <Loader2 size={13} className="animate-spin" /> : <ShieldAlert size={13} />} Block busy-hour conflicts
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setAddOpen(true)} className="gap-1 text-xs text-[#2EC4A5] hover:text-[#26a88d] hover:bg-[#2EC4A5]/10" aria-label="Add one-off slot">
          <Plus size={13} /> Add one-off slot
        </Button>
      </div>

      <FullCalendar
        ref={calendarRef}
        plugins={[timeGridPlugin, dayGridPlugin]}
        initialView="timeGridWeek"
        headerToolbar={{ left: "prev,next today", center: "title", right: "timeGridWeek,timeGridDay" }}
        firstDay={1}
        allDaySlot={false}
        nowIndicator
        slotMinTime="06:00:00"
        slotMaxTime="21:00:00"
        height="auto"
        events={fetchEvents}
        eventClick={handleEventClick}
      />

      <div className="flex flex-wrap items-center gap-4 pt-3 mt-3 border-t border-gray-50 text-xs text-gray-500">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#94a3b8]" />Committed</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#2EC4A5]" />Open</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#fca5a5]" />Blocked</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#1A2340]" />Booked</span>
      </div>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selected?.title}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-500">
            {selected?.status === "blocked"
              ? "This slot is blocked and not bookable by parents."
              : "This slot is open for parents to book."}
          </p>
          <DialogFooter className="gap-2">
            {selected?.generatedFromTemplateId === null && (
              <Button variant="outline" onClick={deleteSlot} disabled={busy} className="text-red-500 border-red-200 hover:bg-red-50">
                {busy ? <Loader2 size={14} className="animate-spin" /> : "Delete"}
              </Button>
            )}
            <Button onClick={toggleBlock} disabled={busy} className="bg-[#2EC4A5] hover:bg-[#26a88d] text-white">
              {busy ? <Loader2 size={14} className="animate-spin" /> : selected?.status === "blocked" ? "Unblock" : "Block this slot"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedBooked} onOpenChange={(open) => !open && setSelectedBooked(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedBooked?.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5 text-sm">
            {selectedBooked?.parentName && <p><span className="text-gray-400">Parent:</span> {selectedBooked.parentName}</p>}
            {selectedBooked?.childName && <p><span className="text-gray-400">Child:</span> {selectedBooked.childName}</p>}
            {selectedBooked?.start && selectedBooked?.end && (
              <p><span className="text-gray-400">Time:</span> {format(selectedBooked.start, "h:mm a")} – {format(selectedBooked.end, "h:mm a")}</p>
            )}
            <p><span className="text-gray-400">Status:</span> {selectedBooked?.status.replace(/_/g, " ")}</p>
          </div>
          {/* meetLink only exists on tutor/therapist engagement-session rows
              (stored, not regenerated here — see sessions.ts's calendar
              endpoint comment). session_bookings-sourced items never have
              one — no link shown for those, not a missing feature. */}
          {selectedBooked?.meetLink && (
            <a
              href={selectedBooked.meetLink}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-center bg-[#2EC4A5] hover:bg-[#26a88d] text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
            >
              Join video session
            </a>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) setDraft(emptyDraft); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add one-off slot</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="slot-date">Date</Label>
              <Input id="slot-date" type="date" value={draft.date} onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))} />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <Label htmlFor="slot-start">Start time</Label>
                <Input id="slot-start" type="time" value={draft.startTime} onChange={(e) => setDraft((d) => ({ ...d, startTime: e.target.value }))} />
              </div>
              <div className="flex-1">
                <Label htmlFor="slot-end">End time</Label>
                <Input id="slot-end" type="time" value={draft.endTime} onChange={(e) => setDraft((d) => ({ ...d, endTime: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label htmlFor="slot-price">Price (₹)</Label>
              <Input id="slot-price" type="number" value={draft.priceInr} onChange={(e) => setDraft((d) => ({ ...d, priceInr: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleAddSlot} disabled={saving} className="bg-[#2EC4A5] hover:bg-[#26a88d] text-white gap-2">
              {saving ? <Loader2 size={14} className="animate-spin" /> : "Add slot"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
