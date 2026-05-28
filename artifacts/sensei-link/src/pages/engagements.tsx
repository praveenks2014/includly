import { useState } from "react";
import { useLocation } from "wouter";
import { useUser } from "@clerk/react";
import {
  useGetEngagements,
  useUpdateEngagementStatus,
  useGetEngagementLogs,
  useLogEngagementWeek,
  useGetMe,
  getGetEngagementsQueryKey,
  getGetEngagementLogsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import type { EngagementResponseType } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { getSpecialtyLabel } from "@/lib/specialties";
import {
  Loader2, ArrowLeft, CalendarCheck, Clock, User,
  ChevronDown, ChevronRight, PauseCircle, PlayCircle,
  StopCircle, PlusCircle, BookOpen,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

const STATUS_COLOR: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  paused: "bg-yellow-100 text-yellow-700",
  ended: "bg-gray-100 text-gray-500",
};

function fmtDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" });
}

function EngagementLogsDialog({
  engagement,
  onClose,
  userRole,
}: {
  engagement: EngagementResponseType;
  onClose: () => void;
  userRole?: string;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: logs, isLoading } = useGetEngagementLogs(engagement.id);
  const { mutateAsync: logWeek, isPending } = useLogEngagementWeek({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetEngagementLogsQueryKey(engagement.id) });
      toast({ title: "Week logged ✓" });
      setForm({ weekStartDate: "", hoursLogged: 0, notes: "" });
      setShowForm(false);
    },
    onError: () => toast({ title: "Failed to log week", variant: "destructive" }),
  });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ weekStartDate: "", hoursLogged: 0, notes: "" });

  const canLog = userRole === "professional" || userRole === "admin";

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif text-[#1A2340]">
            Engagement Logs — {engagement.professionalName ?? "Professional"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 max-h-72 overflow-y-auto">
          {isLoading ? (
            <div className="flex justify-center py-6"><Loader2 size={20} className="animate-spin text-[#2EC4A5]" /></div>
          ) : (logs ?? []).length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No weeks logged yet.</p>
          ) : (
            (logs ?? []).map((log: any) => (
              <div key={log.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
                <div className="w-9 h-9 rounded-lg bg-[#2EC4A5]/10 flex items-center justify-center shrink-0">
                  <CalendarCheck size={15} className="text-[#2EC4A5]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#1A2340]">Week of {fmtDate(log.weekStartDate)}</p>
                  <p className="text-xs text-gray-500">{log.hoursLogged} hours · Logged by {log.loggedByName ?? "Unknown"}</p>
                  {log.notes && <p className="text-xs text-gray-400 mt-0.5 italic">{log.notes}</p>}
                </div>
              </div>
            ))
          )}
        </div>

        {canLog && (
          showForm ? (
            <div className="border-t border-gray-100 pt-4 space-y-3">
              <p className="text-sm font-semibold text-[#1A2340]">Log a Week</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-gray-500">Week Start Date</Label>
                  <Input
                    type="date"
                    value={form.weekStartDate}
                    onChange={(e) => setForm({ ...form, weekStartDate: e.target.value })}
                    className="mt-1 rounded-lg focus-visible:ring-[#2EC4A5]"
                  />
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Hours Logged</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={form.hoursLogged}
                    onChange={(e) => setForm({ ...form, hoursLogged: Number(e.target.value) })}
                    className="mt-1 rounded-lg focus-visible:ring-[#2EC4A5]"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs text-gray-500">Notes (optional)</Label>
                <Input
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="How did the week go?"
                  className="mt-1 rounded-lg focus-visible:ring-[#2EC4A5]"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={isPending || !form.weekStartDate}
                  className="bg-[#2EC4A5] hover:bg-[#26a88d] focus-visible:ring-2 focus-visible:ring-[#2EC4A5]"
                  onClick={() => logWeek({ id: engagement.id, ...form })}
                >
                  {isPending ? <Loader2 size={13} className="animate-spin mr-1" /> : null} Log Week
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-[#2EC4A5] text-[#2EC4A5] hover:bg-[#2EC4A5]/5"
              onClick={() => setShowForm(true)}
            >
              <PlusCircle size={14} /> Log a Week
            </Button>
          )
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EngagementCard({
  engagement,
  userRole,
}: {
  engagement: EngagementResponseType;
  userRole?: string;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showLogs, setShowLogs] = useState(false);
  const { mutateAsync: updateStatus, isPending } = useUpdateEngagementStatus({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetEngagementsQueryKey() });
      toast({ title: "Engagement status updated ✓" });
    },
    onError: () => toast({ title: "Failed to update status", variant: "destructive" }),
  });

  const isParent = userRole === "parent" || userRole === "admin";

  return (
    <>
      <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-[0_4px_24px_rgba(26,35,64,0.07)] space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-xl bg-[#2EC4A5]/10 flex items-center justify-center shrink-0">
              <User size={18} className="text-[#2EC4A5]" />
            </div>
            <div>
              <p className="font-semibold text-[#1A2340]">
                {isParent ? (engagement.professionalName ?? "Professional") : (engagement.parentName ?? "Parent")}
              </p>
              {engagement.childName && (
                <p className="text-xs text-gray-400 mt-0.5">Child: {engagement.childName}</p>
              )}
            </div>
          </div>
          <Badge className={`shrink-0 text-xs font-medium capitalize ${STATUS_COLOR[engagement.status] ?? "bg-gray-100 text-gray-600"}`}>
            {engagement.status}
          </Badge>
        </div>

        {/* Details */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex items-center gap-2 text-gray-600">
            <CalendarCheck size={13} className="text-[#2EC4A5]" />
            <span>Started {fmtDate(engagement.startDate)}</span>
          </div>
          <div className="flex items-center gap-2 text-gray-600">
            <Clock size={13} className="text-[#2EC4A5]" />
            <span>{engagement.hoursPerWeek} hrs / week</span>
          </div>
        </div>

        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100">
          <span className="text-xs text-gray-500">Monthly fee</span>
          <span className="text-base font-bold font-serif text-[#1A2340]">₹{engagement.monthlyFeeInr}</span>
        </div>

        {engagement.nextBillingDate && (
          <p className="text-xs text-gray-400">
            Next billing: {fmtDate(engagement.nextBillingDate)}
          </p>
        )}

        {engagement.notes && (
          <p className="text-xs text-gray-500 italic border-t border-gray-50 pt-3">{engagement.notes}</p>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2 pt-1 border-t border-gray-50">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs border-gray-200"
            onClick={() => setShowLogs(true)}
          >
            <BookOpen size={13} /> View Logs
          </Button>
          {engagement.status === "active" && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs border-yellow-200 text-yellow-700 hover:bg-yellow-50"
              disabled={isPending}
              onClick={() => updateStatus({ id: engagement.id, status: "paused" })}
            >
              <PauseCircle size={13} /> Pause
            </Button>
          )}
          {engagement.status === "paused" && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs border-green-200 text-green-700 hover:bg-green-50"
              disabled={isPending}
              onClick={() => updateStatus({ id: engagement.id, status: "active" })}
            >
              <PlayCircle size={13} /> Resume
            </Button>
          )}
          {engagement.status !== "ended" && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs border-red-200 text-red-600 hover:bg-red-50"
              disabled={isPending}
              onClick={() => updateStatus({ id: engagement.id, status: "ended" })}
            >
              <StopCircle size={13} /> End
            </Button>
          )}
        </div>
      </div>

      {showLogs && (
        <EngagementLogsDialog
          engagement={engagement}
          onClose={() => setShowLogs(false)}
          userRole={userRole}
        />
      )}
    </>
  );
}

export default function EngagementsPage() {
  const [, setLocation] = useLocation();
  const { isLoaded } = useUser();
  const { data: me } = useGetMe();
  const { data: engagements, isLoading } = useGetEngagements();

  const userRole = me?.role ?? "parent";

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F7FA]">
        <Loader2 size={28} className="animate-spin text-[#2EC4A5]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F7FA] pb-16">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-5">
        <div className="max-w-3xl mx-auto">
          <button
            onClick={() => setLocation("/dashboard")}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-[#2EC4A5] mb-3 transition-colors"
          >
            <ArrowLeft size={14} /> Back to Dashboard
          </button>
          <h1 className="text-2xl font-serif font-bold text-[#1A2340]">Shadow Teacher Engagements</h1>
          <p className="text-sm text-gray-400 mt-1">Track ongoing shadow teacher relationships, hours, and billing.</p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 pt-6">
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-2xl h-40 animate-pulse" />
            ))}
          </div>
        ) : (engagements ?? []).length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-gray-100">
            <div className="w-14 h-14 rounded-2xl bg-[#2EC4A5]/10 flex items-center justify-center mx-auto mb-4">
              <BookOpen size={24} className="text-[#2EC4A5]" />
            </div>
            <p className="text-lg font-serif font-semibold text-[#1A2340] mb-1">No engagements yet</p>
            <p className="text-sm text-gray-400 mb-6">Shadow teacher engagements will appear here once created.</p>
            <Button
              onClick={() => setLocation("/search?specialty=shadow_teacher")}
              className="bg-[#2EC4A5] hover:bg-[#26a88d] text-white"
            >
              Find a Shadow Teacher
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {(engagements ?? []).map((e) => (
              <EngagementCard key={e.id} engagement={e} userRole={userRole} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
