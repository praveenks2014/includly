import { useState, useEffect } from "react";
import { useUser } from "@clerk/react";
import { Redirect } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGetMyAvailability, useSetAvailability, type AvailabilitySlot } from "@workspace/api-client-react";
import { Loader2, Plus, Trash2, CalendarClock, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DURATION_OPTIONS = [30, 45, 60, 90, 120];

type SlotDraft = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  slotDurationMinutes: number;
  priceInr: number;
};

function calcEndTime(start: string, durationMinutes: number): string {
  const [h, m] = start.split(":").map(Number);
  const total = h * 60 + m + durationMinutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export default function AvailabilityPage() {
  const { isSignedIn, isLoaded } = useUser();
  const { toast } = useToast();
  const [slots, setSlots] = useState<SlotDraft[]>([]);
  const [loaded, setLoaded] = useState(false);

  const { data: existingAvailability, isLoading } = useGetMyAvailability();

  useEffect(() => {
    if (existingAvailability && !loaded) {
      setSlots(
        existingAvailability.map((s: AvailabilitySlot) => ({
          dayOfWeek: s.dayOfWeek,
          startTime: s.startTime,
          endTime: s.endTime,
          slotDurationMinutes: s.slotDurationMinutes,
          priceInr: s.priceInr,
        })),
      );
      setLoaded(true);
    }
  }, [existingAvailability, loaded]);

  const { mutateAsync: saveAvailability, isPending: saving } = useSetAvailability();

  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect to="/sign-in" />;

  function addSlot(day: number) {
    setSlots((prev) => [
      ...prev,
      { dayOfWeek: day, startTime: "09:00", endTime: "10:00", slotDurationMinutes: 60, priceInr: 500 },
    ]);
  }

  function removeSlot(idx: number) {
    setSlots((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateSlot(idx: number, field: keyof SlotDraft, value: string | number) {
    setSlots((prev) =>
      prev.map((s, i) => {
        if (i !== idx) return s;
        const updated = { ...s, [field]: value };
        if (field === "startTime" || field === "slotDurationMinutes") {
          updated.endTime = calcEndTime(
            field === "startTime" ? (value as string) : s.startTime,
            field === "slotDurationMinutes" ? (value as number) : s.slotDurationMinutes,
          );
        }
        return updated;
      }),
    );
  }

  async function handleSave() {
    try {
      await saveAvailability({ data: { slots } });
      toast({ title: "Availability saved", description: "Your weekly schedule is updated." });
    } catch {
      toast({ title: "Save failed", description: "Could not save availability.", variant: "destructive" });
    }
  }

  const slotsByDay = DAYS.map((_, day) => slots.filter((s) => s.dayOfWeek === day));

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <CalendarClock size={28} className="text-primary" />
            <div>
              <h1 className="text-2xl font-serif font-semibold text-foreground">Weekly Availability</h1>
              <p className="text-sm text-muted-foreground">Set the days and times when you accept session bookings</p>
            </div>
          </div>
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save schedule
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20"><Loader2 size={32} className="animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-6">
            {DAYS.map((dayName, day) => {
              const daySlots = slotsByDay[day];
              return (
                <div key={day} className="bg-card border border-border rounded-xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">{dayName}</span>
                      {daySlots.length > 0 && (
                        <Badge variant="secondary" className="text-xs">{daySlots.length} slot{daySlots.length > 1 ? "s" : ""}</Badge>
                      )}
                    </div>
                    <Button size="sm" variant="outline" onClick={() => addSlot(day)} className="gap-1 h-8 text-xs">
                      <Plus size={12} /> Add slot
                    </Button>
                  </div>

                  {daySlots.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No availability set — click "Add slot" to accept bookings on {dayName}s.</p>
                  ) : (
                    <div className="space-y-3">
                      {daySlots.map((slot) => {
                        const globalIdx = slots.findIndex(
                          (s, i) => s.dayOfWeek === day && slots.filter((ss, ii) => ii < i && ss.dayOfWeek === day).length === daySlots.indexOf(slot),
                        );
                        const realIdx = slots.indexOf(slot);
                        return (
                          <div key={realIdx} className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end p-3 bg-muted/30 rounded-lg">
                            <div>
                              <Label className="text-xs text-muted-foreground mb-1 block">Start time</Label>
                              <Input
                                type="time"
                                value={slot.startTime}
                                onChange={(e) => updateSlot(realIdx, "startTime", e.target.value)}
                                className="h-9 text-sm"
                              />
                            </div>
                            <div>
                              <Label className="text-xs text-muted-foreground mb-1 block">Duration</Label>
                              <Select
                                value={slot.slotDurationMinutes.toString()}
                                onValueChange={(v) => updateSlot(realIdx, "slotDurationMinutes", parseInt(v, 10))}
                              >
                                <SelectTrigger className="h-9 text-sm">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {DURATION_OPTIONS.map((d) => (
                                    <SelectItem key={d} value={d.toString()}>{d} min</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label className="text-xs text-muted-foreground mb-1 block">Price (₹)</Label>
                              <Input
                                type="number"
                                min={0}
                                value={slot.priceInr}
                                onChange={(e) => updateSlot(realIdx, "priceInr", parseInt(e.target.value, 10) || 0)}
                                className="h-9 text-sm"
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">ends {slot.endTime}</span>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-9 w-9 text-destructive hover:text-destructive"
                                onClick={() => removeSlot(realIdx)}
                              >
                                <Trash2 size={14} />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-6 p-4 bg-muted/40 rounded-xl border border-border">
          <p className="text-xs text-muted-foreground">
            <strong>How it works:</strong> Set your available time windows for each day. Each window is split into slots of the chosen duration. Parents can book any available slot and pay through the app. Session fees (minus platform commission) will be paid to your UPI ID — set it in your{" "}
            <a href="/onboard" className="text-primary hover:underline">profile settings</a>.
          </p>
        </div>

        <div className="flex justify-end mt-6">
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save schedule
          </Button>
        </div>
      </div>
    </div>
  );
}
