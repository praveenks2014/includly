import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { fetchWithAuth } from "@/lib/api";
import {
  useGetMe,
  useAdminListProfessionals,
  useAdminGetStats,
  useGetAdminSettings,
  useAdminApproveProfessional,
  useUpdateAdminSettings,
  getAdminListProfessionalsQueryKey,
  getAdminGetStatsQueryKey,
  getGetAdminSettingsQueryKey,
  useGetCommissionRates,
  useUpdateCommissionRate,
  getCommissionRatesQueryKey,
  useGetCommunityAdminReports,
  useResolveReport,
  useSetPostVisibility,
  useSetAnswerVisibility,
  getCommunityAdminReportsQueryKey,
  type AdminProfessionalRow,
  type CommissionRateResponseType,
  type CommunityReportAdminItem,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { getSpecialtyLabel } from "@/lib/specialties";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  Loader2, Users, BarChart3, Settings, CheckCircle, XCircle, Clock,
  ShieldAlert, UserCheck, TrendingUp, FileText, Eye, ExternalLink, Bell,
  IndianRupee, CreditCard, Menu, X, UserX, Shield, ChevronRight, Flag,
  Building2, Plus, Check, Edit2, Trash2, Package, AlertTriangle,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

type SidebarTab = "overview" | "professionals" | "verifications" | "parents" | "users" | "payments" | "settings" | "commissions" | "moderation" | "bookings" | "shadow-teacher" | "engagements" | "centres" | "rci-queue";

// ── Booking row shape from /admin/bookings ────────────────────────────────────
interface AdminBookingRow {
  id: number;
  status: string;
  parentName: string | null;
  proName: string | null;
  proUpiVpa: string | null;
  bookedDate: string;
  startTime: string;
  amountInr: number;
  proAmountInr: number;
  markupInr: number;
  gstInr: number;
  disputeReason: string | null;
  releasedAt: string | null;
  createdAt: string;
}

// ── Shadow match row ───────────────────────────────────────────────────────────
interface AdminMatchCandidate {
  id: number;
  professionalId: number;
  proName: string | null;
  score: number | null;
  rank: number;
  addedBy: string;
  removedAt: string | null;
}

interface AdminMatchRow {
  id: number;
  status: string;
  parentName: string | null;
  parentEmail: string | null;
  matchedProName: string | null;
  matchingFeeInr: number;
  childDetails: string | null;
  requirements: string | null;
  childCity: string | null;
  childConditions: string[] | null;
  childBudgetMinInr: number | null;
  childBudgetMaxInr: number | null;
  extraNotes: string | null;
  adminNotes: string | null;
  matchedAt: string | null;
  createdAt: string;
  trialFeePaidInr: number | null;
  trialProviderPaymentId: string | null;
  trialCreditApplied: boolean | null;
  candidates: AdminMatchCandidate[];
}

interface ProfDocuments {
  identity: { id: number; documentType: string; fileKey: string; status: string; submittedAt: string } | null;
  certifications: { id: number; documentType: string; fileKey: string; uploadedAt: string }[];
}

function fileKeyToUrl(fileKey: string): string {
  return `/api/storage/objects/${fileKey.replace(/^\/objects\//, "")}`;
}

async function openDocWithAuth(fileKey: string): Promise<void> {
  try {
    const url = fileKeyToUrl(fileKey);
    const res = await fetchWithAuth(url);
    if (!res.ok) { alert("Could not load document — access denied or file not found."); return; }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    window.open(objectUrl, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch {
    alert("Failed to open document.");
  }
}

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_4px_24px_rgba(26,35,64,0.08)] border border-gray-100">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1">{label}</p>
      <p className={`text-3xl font-bold font-serif ${color ?? "text-[#1A2340]"}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-b border-gray-50">
      {[1,2,3,4,5].map(i => (
        <td key={i} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
      ))}
    </tr>
  );
}

function CommissionRatesTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: rates, isLoading } = useGetCommissionRates();
  const { mutateAsync: updateRate, isPending } = useUpdateCommissionRate({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getCommissionRatesQueryKey() });
      toast({ title: "Commission rate updated ✓" });
    },
    onError: () => toast({ title: "Failed to update rate", variant: "destructive" }),
  });
  const [editing, setEditing] = useState<{ bookingType: string; ratePct: number; notes: string } | null>(null);

  if (isLoading) {
    return <div className="space-y-3">{[1,2,3,4].map(i => <div key={i} className="h-14 bg-white rounded-xl animate-pulse" />)}</div>;
  }

  const typeLabel: Record<string, string> = {
    session: "Single Session",
    package: "Session Pass / Package",
    subscription: "Monthly Subscription",
    engagement: "Shadow Teacher Engagement",
  };

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h2 className="text-lg font-serif font-bold text-[#1A2340]">Commission Rates</h2>
        <p className="text-xs text-gray-400 mt-1">Percentage Includly retains from each payment type. Lower rates apply to longer-term commitments.</p>
      </div>
      <div className="space-y-3">
        {(rates ?? []).map((rate: CommissionRateResponseType) => (
          <div key={rate.bookingType} className="bg-white rounded-xl p-5 shadow-[0_4px_24px_rgba(26,35,64,0.08)] border border-gray-100">
            {editing?.bookingType === rate.bookingType ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm font-semibold text-[#1A2340] flex-1">{typeLabel[rate.bookingType] ?? rate.bookingType}</p>
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Commission %</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={editing!.ratePct}
                    onChange={(e) => setEditing({ ...editing!, ratePct: Number(e.target.value) })}
                    className="mt-1 rounded-lg focus-visible:ring-[#2EC4A5] w-28"
                  />
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Notes (optional)</Label>
                  <Input
                    value={editing!.notes}
                    onChange={(e) => setEditing({ ...editing!, notes: e.target.value })}
                    placeholder="Add a note..."
                    className="mt-1 rounded-lg focus-visible:ring-[#2EC4A5]"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={isPending}
                    className="bg-[#2EC4A5] hover:bg-[#26a88d] focus-visible:ring-2 focus-visible:ring-[#2EC4A5]"
                    onClick={async () => {
                      await updateRate({ bookingType: editing!.bookingType, ratePct: editing!.ratePct, notes: editing!.notes });
                      setEditing(null);
                    }}
                  >
                    {isPending ? <Loader2 size={13} className="animate-spin mr-1" /> : null} Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-[#1A2340]">{typeLabel[rate.bookingType] ?? rate.bookingType}</p>
                  {rate.notes && <p className="text-xs text-gray-400 mt-0.5">{rate.notes}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-2xl font-bold font-serif text-[#2EC4A5]">{rate.ratePct}%</span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs border-gray-200"
                    onClick={() => setEditing({ bookingType: rate.bookingType, ratePct: rate.ratePct, notes: rate.notes ?? "" })}
                  >
                    Edit
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ModerationTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<"pending" | "resolved" | "dismissed">("pending");

  const { data: reports = [], isLoading } = useGetCommunityAdminReports(statusFilter);
  const { mutateAsync: resolveReport, isPending: resolving } = useResolveReport();
  const { mutateAsync: setPostVis } = useSetPostVisibility();
  const { mutateAsync: setAnswerVis } = useSetAnswerVisibility();

  async function handleResolve(id: number, action: "resolve" | "dismiss") {
    try {
      await resolveReport({ id, action });
      queryClient.invalidateQueries({ queryKey: getCommunityAdminReportsQueryKey(statusFilter) });
      toast({ title: "Report updated ✓" });
    } catch {
      toast({ title: "Failed to update report", variant: "destructive" });
    }
  }

  async function handleHideContent(targetType: "post" | "answer", targetId: number) {
    try {
      if (targetType === "post") await setPostVis({ id: targetId, hidden: true });
      else await setAnswerVis({ id: targetId, hidden: true });
      toast({ title: "Content hidden ✓" });
    } catch {
      toast({ title: "Failed to hide content", variant: "destructive" });
    }
  }

  const FILTERS: { id: "pending" | "resolved" | "dismissed"; label: string }[] = [
    { id: "pending", label: "Pending" },
    { id: "resolved", label: "Resolved" },
    { id: "dismissed", label: "Dismissed" },
  ];

  const statusColor = {
    pending:   "bg-yellow-50 text-yellow-700 border-yellow-200",
    resolved:  "bg-green-50  text-green-700  border-green-200",
    dismissed: "bg-gray-50   text-gray-600   border-gray-200",
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h2 className="text-lg font-serif font-bold text-[#1A2340]">Community Moderation</h2>
        <p className="text-xs text-gray-400 mt-1">Review flagged posts and answers from the community Q&A.</p>
      </div>

      {/* Status filter */}
      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setStatusFilter(f.id)}
            className={`px-4 py-1.5 rounded-full text-xs font-medium border transition-all focus-visible:ring-2 focus-visible:ring-[#2EC4A5] ${
              statusFilter === f.id
                ? "bg-[#2EC4A5] text-white border-[#2EC4A5]"
                : "bg-white text-gray-600 border-gray-200 hover:border-[#2EC4A5]/40"
            }`}
            aria-label={`Show ${f.label} reports`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1,2,3].map((i) => (
            <div key={i} className="h-24 bg-white rounded-xl animate-pulse border border-gray-100" />
          ))}
        </div>
      ) : reports.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-10 text-center shadow-[0_4px_24px_rgba(26,35,64,0.08)]">
          <Flag size={28} className="text-gray-300 mx-auto mb-3" />
          <p className="font-semibold text-[#1A2340] text-sm">No {statusFilter} reports</p>
          <p className="text-xs text-gray-400 mt-1">Community is clear.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {(reports as CommunityReportAdminItem[]).map((report) => (
            <div
              key={report.id}
              className="bg-white rounded-xl border border-gray-100 p-5 shadow-[0_4px_24px_rgba(26,35,64,0.08)]"
            >
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full border ${statusColor[report.status]}`}>
                    {report.status}
                  </span>
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {report.targetType === "post" ? "Question" : "Answer"}
                  </span>
                  <span className="text-xs text-gray-400">
                    Reported by {report.reporter.fullName ?? "User #{report.reporter.id}"} ·{" "}
                    {new Date(report.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                  </span>
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg p-3 mb-3">
                <p className="text-xs text-gray-500 mb-1 font-medium uppercase tracking-wide">Content</p>
                <p className="text-sm text-[#1A2340] line-clamp-2">{report.targetPreview}</p>
              </div>

              <div className="bg-[#FF6B6B]/5 border border-[#FF6B6B]/20 rounded-lg p-3 mb-4">
                <p className="text-xs text-gray-500 mb-1 font-medium uppercase tracking-wide">Reason</p>
                <p className="text-sm text-gray-700">{report.reason}</p>
              </div>

              {report.status === "pending" && (
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    size="sm"
                    disabled={resolving}
                    className="bg-[#FF6B6B] hover:bg-[#ff5252] text-white border-0 text-xs gap-1"
                    onClick={() => handleResolve(report.id, "resolve")}
                    aria-label="Resolve report and hide content"
                  >
                    <CheckCircle size={12} />
                    Resolve &amp; Hide
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={resolving}
                    className="text-xs border-gray-200"
                    onClick={() => handleResolve(report.id, "dismiss")}
                    aria-label="Dismiss report"
                  >
                    Dismiss
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={resolving}
                    className="text-xs text-gray-500"
                    onClick={() => handleHideContent(report.targetType, report.targetId)}
                    aria-label="Hide content only"
                  >
                    Hide Content Only
                  </Button>
                </div>
              )}

              {report.status !== "pending" && report.reviewedAt && (
                <p className="text-xs text-gray-400 mt-1">
                  Reviewed {new Date(report.reviewedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminPage() {
  const [, setLocation] = useLocation();
  const { isLoaded } = useUser();
  const { data: me, isLoading: meLoading } = useGetMe();
  const [activeTab, setActiveTab] = useState<SidebarTab>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (!isLoaded || meLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F7FA]">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full bg-[#2EC4A5]/10 flex items-center justify-center mx-auto mb-3">
            <Loader2 className="animate-spin text-[#2EC4A5]" size={24} />
          </div>
          <p className="text-gray-500 text-sm">Loading admin panel…</p>
        </div>
      </div>
    );
  }

  if (me?.role !== "admin") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F7FA]">
        <div className="text-center max-w-sm bg-white rounded-2xl p-10 shadow-[0_8px_40px_rgba(26,35,64,0.12)]">
          <ShieldAlert className="mx-auto mb-4 text-[#FF6B6B]" size={48} />
          <h1 className="font-serif text-2xl font-bold text-[#1A2340] mb-2">Access Denied</h1>
          <p className="text-gray-500 mb-6">This page is restricted to administrators only.</p>
          <Button onClick={() => setLocation("/dashboard")} className="bg-[#2EC4A5] hover:bg-[#26a88d]">Go to Dashboard</Button>
        </div>
      </div>
    );
  }

  const NAV: { id: SidebarTab; label: string; icon: React.ReactNode }[] = [
    { id: "overview", label: "Overview", icon: <BarChart3 size={18} /> },
    { id: "professionals", label: "Professionals", icon: <UserCheck size={18} /> },
    { id: "verifications", label: "Verifications", icon: <Shield size={18} /> },
    { id: "parents", label: "Parents", icon: <Users size={18} /> },
    { id: "users", label: "User Management", icon: <UserX size={18} /> },
    { id: "payments", label: "Payments", icon: <CreditCard size={18} /> },
    { id: "bookings", label: "Bookings & Payouts", icon: <IndianRupee size={18} /> },
    { id: "shadow-teacher", label: "Shadow Teacher", icon: <UserCheck size={18} /> },
    { id: "engagements", label: "Engagements", icon: <IndianRupee size={18} /> },
    { id: "centres", label: "Therapy Centres", icon: <Building2 size={18} /> },
    { id: "moderation", label: "Moderation", icon: <Flag size={18} /> },
    { id: "rci-queue", label: "RCI Queue", icon: <Shield size={18} /> },
    { id: "settings", label: "Settings", icon: <Settings size={18} /> },
    { id: "commissions", label: "Commission Rates", icon: <IndianRupee size={18} /> },
  ];

  return (
    <div className="min-h-screen bg-[#F5F7FA] flex">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-60 bg-[#1A2340] text-white flex flex-col transition-transform duration-200 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
        aria-label="Admin sidebar"
      >
        <div className="px-5 py-6 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#2EC4A5] flex items-center justify-center">
              <Shield size={16} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-bold">Includly Admin</p>
              <p className="text-xs text-white/40">Control Panel</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => { setActiveTab(item.id); setSidebarOpen(false); }}
              aria-label={item.label}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all focus-visible:ring-2 focus-visible:ring-[#2EC4A5] ${
                activeTab === item.id
                  ? "bg-[#2EC4A5] text-white"
                  : "text-white/60 hover:text-white hover:bg-white/10"
              }`}
            >
              {item.icon}
              {item.label}
              {activeTab === item.id && <ChevronRight size={14} className="ml-auto" />}
            </button>
          ))}
        </nav>

        <div className="px-3 py-4 border-t border-white/10">
          <p className="text-xs text-white/30 px-3">Includly Admin v2</p>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Topbar */}
        <header className="bg-white border-b border-gray-100 px-4 sm:px-6 h-14 flex items-center gap-4 sticky top-0 z-30 shadow-sm">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 rounded-lg hover:bg-gray-100 text-gray-600 focus-visible:ring-2 focus-visible:ring-[#2EC4A5]"
            aria-label="Open sidebar"
          >
            <Menu size={20} />
          </button>
          <h1 className="font-serif text-lg font-bold text-[#1A2340]">
            {NAV.find((n) => n.id === activeTab)?.label}
          </h1>
        </header>

        <div className="flex-1 px-4 sm:px-6 py-6 overflow-auto">
          {activeTab === "overview" && <OverviewTab />}
          {activeTab === "professionals" && <ProfessionalsTab />}
          {activeTab === "verifications" && <VerificationsTab />}
          {activeTab === "parents" && <ParentsTab />}
          {activeTab === "users" && <UserManagementTab />}
          {activeTab === "payments" && <PaymentsTab />}
          {activeTab === "bookings" && <AdminBookingsTab />}
          {activeTab === "shadow-teacher" && <AdminShadowTeacherTab />}
          {activeTab === "engagements" && <AdminEngagementsTab />}
          {activeTab === "centres" && <AdminCentresTab />}
          {activeTab === "moderation" && <ModerationTab />}
          {activeTab === "settings" && <SettingsTab />}
          {activeTab === "commissions" && <CommissionRatesTab />}
          {activeTab === "rci-queue" && <RciQueueTab />}
        </div>
      </div>
    </div>
  );
}

function RciQueueTab() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState<number | null>(null);
  const [items, setItems] = useState<Array<{
    id: number;
    fullName: string | null;
    city: string | null;
    country: string | null;
    rciCrrNumber: string | null;
    userEmail: string | null;
    createdAt: string;
  }>>([]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/admin/professionals/pending-rci");
      const data = await res.json() as { professionals: typeof items };
      setItems(data.professionals ?? []);
    } catch {
      toast({ title: "Failed to load RCI queue", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function markVerified(id: number) {
    setVerifying(id);
    try {
      const res = await fetchWithAuth(`/api/admin/professionals/${id}/verify-rci`, { method: "PATCH" });
      if (!res.ok) throw new Error("Failed");
      toast({ title: "RCI verified ✓" });
      setItems((prev) => prev.filter((p) => p.id !== id));
    } catch {
      toast({ title: "Could not mark verified", variant: "destructive" });
    } finally {
      setVerifying(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-[#1A2340]">Therapist RCI Verification Queue</h2>
        <p className="text-sm text-gray-500 mt-1">
          Therapists who have submitted a CRR number and are awaiting manual verification.{" "}
          Before marking verified, look up the CRR number at{" "}
          <a
            href="https://www.rci.gov.in/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-teal-600 underline"
          >
            rci.gov.in
          </a>.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-gray-400" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-gray-400 border border-dashed rounded-xl">
          <CheckCircle size={32} className="mb-3 text-green-400" />
          <p className="font-medium text-gray-600">Queue is clear</p>
          <p className="text-sm mt-1">No therapists awaiting RCI verification right now.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="bg-white border rounded-xl p-4 flex items-start gap-4 shadow-sm">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-[#1A2340] truncate">{item.fullName ?? "—"}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {item.userEmail ?? "—"} · {[item.city, item.country].filter(Boolean).join(", ") || "—"}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-600 bg-gray-100 px-2 py-0.5 rounded">CRR #</span>
                  <span className="text-sm font-mono font-bold tracking-wide text-[#1A2340]">
                    {item.rciCrrNumber}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  Submitted {new Date(item.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                </p>
              </div>
              <button
                onClick={() => void markVerified(item.id)}
                disabled={verifying === item.id}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 text-white text-xs font-semibold rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
              >
                {verifying === item.id
                  ? <Loader2 size={12} className="animate-spin" />
                  : <Check size={12} />}
                Mark Verified
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OverviewTab() {
  const { data: stats, isLoading } = useAdminGetStats();

  const chartData = [
    { month: "Dec", parents: 12, professionals: 5 },
    { month: "Jan", parents: 18, professionals: 7 },
    { month: "Feb", parents: 24, professionals: 9 },
    { month: "Mar", parents: 31, professionals: 14 },
    { month: "Apr", parents: 42, professionals: 18 },
    { month: "May", parents: stats?.newUsersThisMonth ?? 0, professionals: 0 },
  ];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => (
            <div key={i} className="bg-white rounded-xl p-5 shadow-[0_4px_24px_rgba(26,35,64,0.08)] animate-pulse">
              <div className="h-3 w-20 bg-gray-200 rounded mb-3" />
              <div className="h-8 w-16 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const revenue = stats ? `₹${((stats.totalRevenueInPaise ?? 0) / 100).toLocaleString("en-IN")}` : "₹0";

  return (
    <div className="space-y-6 max-w-6xl">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Parents" value={stats?.totalParents ?? 0} sub="registered accounts" color="text-blue-600" />
        <StatCard label="Total Professionals" value={stats?.totalProfessionals ?? 0} sub={`${stats?.verifiedProfessionals ?? 0} approved`} color="text-[#2EC4A5]" />
        <StatCard label="Total Unlocks" value={stats?.totalUnlocksThisMonth ?? 0} sub="this month" color="text-violet-600" />
        <StatCard label="Total Revenue" value={revenue} sub="all time" color="text-[#FF6B6B]" />
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-4 shadow-[0_4px_24px_rgba(26,35,64,0.08)] border border-yellow-100">
          <div className="flex items-center gap-2 mb-2">
            <Clock size={16} className="text-[#FFB830]" />
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Pending Review</p>
          </div>
          <p className="text-2xl font-bold font-serif text-[#FFB830]">{stats?.pendingProfessionals ?? 0}</p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-[0_4px_24px_rgba(26,35,64,0.08)] border border-green-100">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle size={16} className="text-green-500" />
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Verified</p>
          </div>
          <p className="text-2xl font-bold font-serif text-green-600">{stats?.verifiedProfessionals ?? 0}</p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-[0_4px_24px_rgba(26,35,64,0.08)] border border-red-100">
          <div className="flex items-center gap-2 mb-2">
            <XCircle size={16} className="text-[#FF6B6B]" />
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Rejected</p>
          </div>
          <p className="text-2xl font-bold font-serif text-[#FF6B6B]">{stats?.rejectedProfessionals ?? 0}</p>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-white rounded-xl p-6 shadow-[0_4px_24px_rgba(26,35,64,0.08)]">
        <h2 className="font-serif text-lg font-bold text-[#1A2340] mb-1">Monthly New Signups</h2>
        <p className="text-sm text-gray-500 mb-6">Parents vs Professionals over the last 6 months</p>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#6b7280" }} />
            <YAxis tick={{ fontSize: 12, fill: "#6b7280" }} />
            <Tooltip
              contentStyle={{ borderRadius: "12px", border: "1px solid #e5e7eb", boxShadow: "0 4px 24px rgba(26,35,64,0.08)" }}
            />
            <Legend wrapperStyle={{ fontSize: "12px" }} />
            <Bar dataKey="parents" name="Parents" fill="#2EC4A5" radius={[4, 4, 0, 0]} />
            <Bar dataKey="professionals" name="Professionals" fill="#FF6B6B" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ProfessionalsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [page, setPage] = useState(1);
  const [reviewProf, setReviewProf] = useState<AdminProfessionalRow | null>(null);
  const [documents, setDocuments] = useState<ProfDocuments | null>(null);
  const [docsLoading, setDocsLoading] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [isRejecting, setIsRejecting] = useState(false);
  const [isApproving, setIsApproving] = useState(false);

  const resolvedStatus = (statusFilter || undefined) as "pending" | "verified" | "rejected" | "unsubmitted" | undefined;
  const { data, isLoading } = useAdminListProfessionals(
    { status: resolvedStatus, page, limit: 20 },
    { query: { queryKey: getAdminListProfessionalsQueryKey({ status: resolvedStatus, page, limit: 20 }) } },
  );

  const { mutateAsync: approve } = useAdminApproveProfessional();

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["adminListProfessionals"] });
    queryClient.invalidateQueries({ queryKey: getAdminGetStatsQueryKey() });
  }

  async function openReview(prof: AdminProfessionalRow) {
    setReviewProf(prof);
    setRejectReason("");
    setDocuments(null);
    setDocsLoading(true);
    try {
      const res = await fetchWithAuth(`/api/admin/professionals/${prof.id}/documents`);
      if (res.ok) setDocuments(await res.json() as ProfDocuments);
    } finally { setDocsLoading(false); }
  }

  async function handleApprove(id: number) {
    setIsApproving(true);
    try {
      await approve({ id });
      invalidate();
      toast({ title: "Approved ✓", description: "Professional is now visible in search results." });
      setReviewProf(null);
    } catch {
      toast({ title: "Error", description: "Failed to approve.", variant: "destructive" });
    } finally { setIsApproving(false); }
  }

  async function handleReject(id: number) {
    setIsRejecting(true);
    try {
      const res = await fetchWithAuth(`/api/admin/professionals/${id}/reject`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason.trim() || null }),
      });
      if (!res.ok) throw new Error("Failed");
      invalidate();
      toast({ title: "Rejected", description: "Professional application has been rejected." });
      setReviewProf(null);
    } catch {
      toast({ title: "Error", description: "Failed to reject.", variant: "destructive" });
    } finally { setIsRejecting(false); }
  }

  const STATUSES = [
    { value: "pending", label: "Pending" },
    { value: "verified", label: "Approved" },
    { value: "rejected", label: "Rejected" },
    { value: "unsubmitted", label: "Unsubmitted" },
    { value: "", label: "All" },
  ];

  const STATUS_COLORS: Record<string, string> = {
    pending: "bg-yellow-50 text-yellow-700 border-yellow-200",
    verified: "bg-green-50 text-green-700 border-green-200",
    rejected: "bg-red-50 text-red-700 border-red-200",
    unsubmitted: "bg-gray-50 text-gray-600 border-gray-200",
  };

  return (
    <>
      <div className="space-y-4 max-w-6xl">
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <button
              key={s.value}
              onClick={() => { setStatusFilter(s.value); setPage(1); }}
              aria-label={`Filter by ${s.label}`}
              className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-all focus-visible:ring-2 focus-visible:ring-[#2EC4A5] ${
                statusFilter === s.value
                  ? "bg-[#1A2340] text-white border-[#1A2340]"
                  : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-xl shadow-[0_4px_24px_rgba(26,35,64,0.08)] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Professional</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide hidden sm:table-cell">Specialty</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide hidden md:table-cell">Location</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Status</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
              ) : !data?.professionals?.length ? (
                <tr>
                  <td colSpan={5} className="py-16 text-center">
                    <svg width="60" height="60" viewBox="0 0 60 60" fill="none" className="mx-auto mb-3 opacity-40">
                      <circle cx="30" cy="30" r="30" fill="#2EC4A5" fillOpacity="0.15"/>
                      <circle cx="30" cy="24" r="8" fill="#2EC4A5" fillOpacity="0.6"/>
                      <ellipse cx="30" cy="42" rx="14" ry="7" fill="#2EC4A5" fillOpacity="0.4"/>
                    </svg>
                    <p className="font-semibold text-gray-600 mb-1">No professionals found</p>
                    <p className="text-sm text-gray-400">Try changing the status filter above.</p>
                  </td>
                </tr>
              ) : (
                data.professionals.map((prof: AdminProfessionalRow) => (
                  <tr key={prof.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-[#1A2340]">{prof.fullName ?? prof.userName ?? "—"}</p>
                      <p className="text-xs text-gray-400">{prof.userEmail ?? "—"}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        ID:{" "}
                        <button
                          type="button"
                          onClick={() => { void navigator.clipboard.writeText(String(prof.id)); }}
                          className="font-mono text-gray-500 hover:text-[#2EC4A5] hover:underline"
                          title="Click to copy — use this ID in Add/Assign dialogs"
                        >
                          {prof.id}
                        </button>
                      </p>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell text-gray-500 text-xs">
                      {getSpecialtyLabel(prof.specialty as Parameters<typeof getSpecialtyLabel>[0])}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-gray-400 text-xs">
                      {[prof.city, prof.country].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1 items-start">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[prof.verificationStatus] ?? STATUS_COLORS.unsubmitted}`}>
                          {prof.verificationStatus}
                        </span>
                        {prof.verificationStatus !== "verified" && !prof.requirementsMet && (
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border bg-red-50 text-red-600 border-red-200"
                            title={`Missing: ${prof.missingRequirements.join(", ")}`}
                          >
                            <AlertTriangle size={9} />
                            Not eligible
                          </span>
                        )}
                        {prof.requirementWarnings.length > 0 && (
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border bg-amber-50 text-amber-600 border-amber-200"
                            title={prof.requirementWarnings.join(", ")}
                          >
                            Low trust
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center gap-2 justify-end">
                        <a
                          href={`/professionals/${prof.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors focus-visible:ring-2 focus-visible:ring-[#2EC4A5]"
                          aria-label="View profile"
                        >
                          <ExternalLink size={14} />
                        </a>
                        <Button
                          size="sm"
                          onClick={() => openReview(prof)}
                          className={`text-xs h-7 focus-visible:ring-2 focus-visible:ring-[#2EC4A5] ${prof.verificationStatus === "verified" ? "bg-gray-100 hover:bg-gray-200 text-gray-600" : "bg-[#1A2340] hover:bg-[#2a3660]"}`}
                          aria-label={`${prof.verificationStatus === "verified" ? "View" : "Review"} ${prof.fullName ?? prof.userName}`}
                        >
                          <Eye size={12} className="mr-1" />
                          {prof.verificationStatus === "verified" ? "View" : "Review"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {data && data.total > data.limit && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-400">
              {((page - 1) * data.limit) + 1}–{Math.min(page * data.limit, data.total)} of {data.total}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">Previous</Button>
              <Button variant="outline" size="sm" disabled={page * data.limit >= data.total} onClick={() => setPage((p) => p + 1)} aria-label="Next page">Next</Button>
            </div>
          </div>
        )}
      </div>

      {/* Review modal */}
      <Dialog open={!!reviewProf} onOpenChange={(open) => { if (!open) setReviewProf(null); }}>
        <DialogContent className="max-w-lg shadow-[0_8px_40px_rgba(26,35,64,0.12)]">
          <DialogHeader>
            <DialogTitle className="font-serif text-[#1A2340]">Review Application</DialogTitle>
          </DialogHeader>
          {reviewProf && (
            <div className="space-y-4 py-1">
              <div className="bg-gray-50 rounded-xl p-4 space-y-1 text-sm">
                <p className="font-semibold text-[#1A2340]">{reviewProf.fullName ?? reviewProf.userName ?? "—"}</p>
                <p className="text-gray-500">{reviewProf.userEmail}</p>
                <p className="text-gray-600">{getSpecialtyLabel(reviewProf.specialty as Parameters<typeof getSpecialtyLabel>[0])}</p>
                <p className="text-gray-400">{[reviewProf.city, reviewProf.country].filter(Boolean).join(", ") || "—"}</p>
                <p className="text-xs text-gray-400 pt-1">
                  Professional ID: <span className="font-mono text-gray-600">{reviewProf.id}</span>
                </p>
              </div>
              {reviewProf.verificationStatus !== "verified" && !reviewProf.requirementsMet && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 space-y-1">
                  <div className="flex items-center gap-2 text-red-700 font-semibold text-sm">
                    <AlertTriangle size={14} />
                    Cannot approve yet
                  </div>
                  <p className="text-xs text-red-700 leading-relaxed">
                    Missing: {reviewProf.missingRequirements.map((r) => r.replace(/_/g, " ")).join(", ")}
                  </p>
                </div>
              )}
              {reviewProf.requirementWarnings.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 space-y-1">
                  <div className="flex items-center gap-2 text-amber-700 font-semibold text-sm">
                    <AlertTriangle size={14} />
                    Lower trust signal
                  </div>
                  <p className="text-xs text-amber-700 leading-relaxed">
                    {reviewProf.requirementWarnings.map((w) => w.replace(/_/g, " ")).join(", ")}
                  </p>
                </div>
              )}
              <div>
                <p className="text-sm font-semibold text-[#1A2340] mb-2">Uploaded Documents</p>
                {docsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
                    <Loader2 size={14} className="animate-spin" />
                    Loading documents…
                  </div>
                ) : documents ? (
                  <div className="space-y-2">
                    {documents.identity ? (
                      <button
                        onClick={() => openDocWithAuth(documents!.identity!.fileKey)}
                        className="w-full flex items-center gap-2 text-sm px-3 py-2 rounded-xl border border-gray-100 hover:bg-gray-50 transition-colors focus-visible:ring-2 focus-visible:ring-[#2EC4A5] text-left"
                        aria-label="View identity document"
                      >
                        <FileText size={14} className="text-[#2EC4A5] shrink-0" />
                        <span className="flex-1">Identity: <span className="capitalize">{documents.identity.documentType.replace(/_/g, " ")}</span></span>
                        <ExternalLink size={12} className="text-gray-400" />
                      </button>
                    ) : <p className="text-sm text-gray-400 italic">No identity document uploaded.</p>}
                    {documents.certifications.map((cert) => (
                      <button
                        key={cert.id}
                        onClick={() => openDocWithAuth(cert.fileKey)}
                        className="w-full flex items-center gap-2 text-sm px-3 py-2 rounded-xl border border-gray-100 hover:bg-gray-50 transition-colors focus-visible:ring-2 focus-visible:ring-[#2EC4A5] text-left"
                        aria-label="View certification"
                      >
                        <FileText size={14} className="text-blue-400 shrink-0" />
                        <span className="flex-1">Cert: <span className="capitalize">{cert.documentType.replace(/_/g, " ")}</span></span>
                        <ExternalLink size={12} className="text-gray-400" />
                      </button>
                    ))}
                    {documents.certifications.length === 0 && <p className="text-sm text-gray-400 italic">No certifications uploaded.</p>}
                  </div>
                ) : <p className="text-sm text-gray-400 italic">Could not load documents.</p>}
              </div>
              <div>
                <Label htmlFor="reject-reason" className="text-sm font-medium text-[#1A2340]">
                  Rejection reason <span className="text-gray-400 font-normal">(optional)</span>
                </Label>
                <Textarea
                  id="reject-reason"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="E.g. Documents unclear — please re-upload a higher quality scan."
                  className="mt-1 text-sm resize-none rounded-xl"
                  rows={3}
                  aria-label="Rejection reason"
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setReviewProf(null)} aria-label="Close dialog">Close</Button>
            {reviewProf && (
              <>
                <Button
                  variant="outline"
                  className="gap-1 text-[#FF6B6B] border-[#FF6B6B]/30 hover:bg-[#FF6B6B]/5 focus-visible:ring-2 focus-visible:ring-[#FF6B6B]"
                  onClick={() => handleReject(reviewProf.id)}
                  disabled={isRejecting || isApproving}
                  aria-label="Reject application"
                >
                  {isRejecting ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />}
                  Reject
                </Button>
                {reviewProf.verificationStatus !== "verified" && (
                  <Button
                    className="gap-1 bg-green-600 hover:bg-green-700 focus-visible:ring-2 focus-visible:ring-green-500 disabled:opacity-50"
                    onClick={() => handleApprove(reviewProf.id)}
                    disabled={isRejecting || isApproving || !reviewProf.requirementsMet}
                    aria-label="Approve application"
                    title={!reviewProf.requirementsMet ? `Missing: ${reviewProf.missingRequirements.join(", ")}` : undefined}
                  >
                    {isApproving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} />}
                    Approve
                  </Button>
                )}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function VerificationsTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["adminVerifications", "pending"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/verifications?status=pending");
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<{ verifications: any[]; total: number }>;
    },
  });

  const STATUS_COLORS: Record<string, string> = {
    pending: "bg-yellow-50 text-yellow-700 border-yellow-200",
    approved: "bg-green-50 text-green-700 border-green-200",
    rejected: "bg-red-50 text-red-700 border-red-200",
  };

  return (
    <div className="space-y-4 max-w-6xl">
      <p className="text-sm text-gray-500">Pending ID documents awaiting admin review.</p>

      <div className="bg-white rounded-xl shadow-[0_4px_24px_rgba(26,35,64,0.08)] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Professional</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide hidden sm:table-cell">Document</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Status</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide hidden md:table-cell">Submitted</th>
              <th className="text-right px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)
            ) : !data?.verifications?.length ? (
              <tr>
                <td colSpan={5} className="py-16 text-center">
                  <svg width="60" height="60" viewBox="0 0 60 60" fill="none" className="mx-auto mb-3 opacity-40">
                    <circle cx="30" cy="30" r="30" fill="#2EC4A5" fillOpacity="0.15"/>
                    <rect x="17" y="15" width="26" height="30" rx="4" fill="#2EC4A5" fillOpacity="0.4"/>
                    <path d="M23 27h14M23 33h8" stroke="#2EC4A5" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                  <p className="font-semibold text-gray-600 mb-1">No verifications found</p>
                  <p className="text-sm text-gray-400">No ID documents match this filter.</p>
                </td>
              </tr>
            ) : (
              data.verifications.map((v: any) => (
                <tr key={v.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-[#1A2340]">{v.fullName ?? "—"}</p>
                    <p className="text-xs text-gray-400">{v.email ?? "—"}</p>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell text-gray-500 text-xs capitalize">
                    {(v.documentType ?? "—").replace(/_/g, " ")}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[v.status] ?? "bg-gray-50 text-gray-600 border-gray-200"}`}>
                      {v.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell text-xs text-gray-400">
                    {v.submittedAt ? new Date(v.submittedAt).toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => openDocWithAuth(v.fileKey ?? "")}
                      className="inline-flex items-center gap-1 text-xs text-[#2EC4A5] hover:underline focus-visible:ring-2 focus-visible:ring-[#2EC4A5] rounded"
                      aria-label="View document"
                    >
                      <Eye size={13} />
                      View Doc
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ParentsTab() {
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["adminParents", page],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/parents?page=${page}&limit=20`);
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<{ parents: any[]; total: number; limit: number }>;
    },
  });

  return (
    <div className="space-y-4 max-w-6xl">
      <p className="text-sm text-gray-500">All parent accounts registered on Includly.</p>

      <div className="bg-white rounded-xl shadow-[0_4px_24px_rgba(26,35,64,0.08)] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Parent</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide hidden md:table-cell">Child Name</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide hidden sm:table-cell">City</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide hidden md:table-cell">Joined</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-50">
                  {[1,2,3,4].map(j => <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>)}
                </tr>
              ))
            ) : !data?.parents?.length ? (
              <tr>
                <td colSpan={4} className="py-16 text-center">
                  <svg width="60" height="60" viewBox="0 0 60 60" fill="none" className="mx-auto mb-3 opacity-40">
                    <circle cx="30" cy="30" r="30" fill="#2EC4A5" fillOpacity="0.15"/>
                    <circle cx="30" cy="24" r="8" fill="#2EC4A5" fillOpacity="0.6"/>
                    <ellipse cx="30" cy="42" rx="14" ry="7" fill="#2EC4A5" fillOpacity="0.4"/>
                  </svg>
                  <p className="font-semibold text-gray-600">No parents registered yet</p>
                </td>
              </tr>
            ) : (
              data.parents.map((p: any) => (
                <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-[#1A2340]">{p.fullName ?? p.name ?? "—"}</p>
                    <p className="text-xs text-gray-400">{p.email ?? "—"}</p>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell text-gray-500 text-xs">{p.childName ?? "—"}</td>
                  <td className="px-4 py-3 hidden sm:table-cell text-gray-400 text-xs">{p.city ?? "—"}</td>
                  <td className="px-4 py-3 hidden md:table-cell text-xs text-gray-400">
                    {p.createdAt ? new Date(p.createdAt).toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {data && data.total > data.limit && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-400">{((page - 1) * data.limit) + 1}–{Math.min(page * data.limit, data.total)} of {data.total}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">Previous</Button>
            <Button variant="outline" size="sm" disabled={page * data.limit >= data.total} onClick={() => setPage((p) => p + 1)} aria-label="Next page">Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── User Management Tab ─────────────────────────────────────────────────────
interface AdminUserRow {
  id: number;
  clerkId: string | null;
  email: string | null;
  fullName: string | null;
  role: string;
  city: string | null;
  createdAt: string | null;
}

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-red-100 text-red-700",
  professional: "bg-blue-100 text-blue-700",
  parent: "bg-green-100 text-green-700",
  centre_admin: "bg-purple-100 text-purple-700",
};

function UserManagementTab() {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [page, setPage] = useState(1);
  const [confirmDelete, setConfirmDelete] = useState<AdminUserRow | null>(null);
  const [roleChangeUser, setRoleChangeUser] = useState<AdminUserRow | null>(null);
  const [newRole, setNewRole] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["adminUsers", page, roleFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: "30" });
      if (roleFilter) params.set("role", roleFilter);
      const res = await fetchWithAuth(`/api/admin/users?${params}`);
      if (!res.ok) throw new Error("Failed to load users");
      return res.json() as Promise<{ users: AdminUserRow[]; page: number; limit: number }>;
    },
  });

  const filteredUsers = (data?.users ?? []).filter((u) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      u.email?.toLowerCase().includes(q) ||
      u.fullName?.toLowerCase().includes(q) ||
      String(u.id).includes(q)
    );
  });

  async function handleRoleChange() {
    if (!roleChangeUser || !newRole) return;
    setBusy(true);
    try {
      const res = await fetchWithAuth(`/api/admin/users/${roleChangeUser.id}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast({ title: "Role updated", description: `${roleChangeUser.email ?? roleChangeUser.id} → ${newRole}` });
      setRoleChangeUser(null);
      refetch();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    setBusy(true);
    try {
      const res = await fetchWithAuth(`/api/admin/users/${confirmDelete.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast({ title: "User removed", description: `${confirmDelete.email ?? confirmDelete.id} deleted from DB. Clerk account preserved — they can re-onboard on next sign-in.` });
      setConfirmDelete(null);
      refetch();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-6xl">
      <p className="text-sm text-gray-500">Find, change roles, or remove user accounts. Deleting a user removes their DB record — their Clerk account is preserved and they can re-onboard on next sign-in.</p>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          placeholder="Search by name, email, or ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:max-w-xs"
        />
        <select
          value={roleFilter}
          onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white focus:ring-2 focus:ring-[#2EC4A5] focus:outline-none"
        >
          <option value="">All roles</option>
          <option value="parent">Parents</option>
          <option value="professional">Professionals</option>
          <option value="admin">Admins</option>
          <option value="centre_admin">Centre Admins</option>
        </select>
      </div>

      <div className="bg-white rounded-xl shadow-[0_4px_24px_rgba(26,35,64,0.08)] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">User</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide hidden sm:table-cell">Role</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide hidden md:table-cell">Joined</th>
              <th className="text-right px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {[1,2,3,4].map(j => <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>)}
                </tr>
              ))
            ) : !filteredUsers.length ? (
              <tr>
                <td colSpan={4} className="py-12 text-center text-gray-400 text-sm">No users found</td>
              </tr>
            ) : (
              filteredUsers.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-[#1A2340]">{u.fullName ?? "—"}</p>
                    <p className="text-xs text-gray-400">{u.email ?? "—"} · #{u.id}</p>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[u.role] ?? "bg-gray-100 text-gray-600"}`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell text-xs text-gray-400">
                    {u.createdAt ? new Date(u.createdAt).toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        onClick={() => { setRoleChangeUser(u); setNewRole(u.role); }}
                      >
                        <Edit2 size={12} className="mr-1" />
                        Role
                      </Button>
                      {u.role !== "admin" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs text-red-600 border-red-200 hover:bg-red-50"
                          onClick={() => setConfirmDelete(u)}
                        >
                          <Trash2 size={12} className="mr-1" />
                          Remove
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {data && data.users.length === 30 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-400">Showing page {page}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      {/* Role-change dialog */}
      <Dialog open={!!roleChangeUser} onOpenChange={(open) => { if (!open) setRoleChangeUser(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Role</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-500 mb-3">
            Changing role for <span className="font-semibold">{roleChangeUser?.email ?? roleChangeUser?.fullName ?? `#${roleChangeUser?.id}`}</span>
          </p>
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white focus:ring-2 focus:ring-[#2EC4A5] focus:outline-none"
          >
            <option value="parent">parent</option>
            <option value="professional">professional</option>
            <option value="admin">admin</option>
            <option value="centre_admin">centre_admin</option>
          </select>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setRoleChangeUser(null)} disabled={busy}>Cancel</Button>
            <Button onClick={handleRoleChange} disabled={busy || newRole === roleChangeUser?.role} className="bg-[#2EC4A5] hover:bg-[#26a88d]">
              {busy ? <Loader2 size={14} className="animate-spin mr-1" /> : <Check size={14} className="mr-1" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete-confirm dialog */}
      <Dialog open={!!confirmDelete} onOpenChange={(open) => { if (!open) setConfirmDelete(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-600">Remove User</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-700">
            This removes <span className="font-semibold">{confirmDelete?.email ?? confirmDelete?.fullName ?? `#${confirmDelete?.id}`}</span> (role: <span className="font-semibold">{confirmDelete?.role}</span>) from the database.
          </p>
          <p className="text-xs text-gray-400 mt-1">Their Clerk account is NOT deleted — they can sign in again and re-onboard from scratch (starting as a parent).</p>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setConfirmDelete(null)} disabled={busy}>Cancel</Button>
            <Button onClick={handleDelete} disabled={busy} className="bg-red-500 hover:bg-red-600 text-white">
              {busy ? <Loader2 size={14} className="animate-spin mr-1" /> : <Trash2 size={14} className="mr-1" />}
              Remove User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PaymentsTab() {
  const { data: stats, isLoading } = useAdminGetStats();

  const revenue = stats ? (stats.totalRevenueInPaise ?? 0) / 100 : 0;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Total Payments" value={stats?.totalPaymentsCompleted ?? 0} sub="completed transactions" color="text-[#2EC4A5]" />
        <StatCard label="Total Revenue" value={`₹${revenue.toLocaleString("en-IN")}`} sub="all time" color="text-[#1A2340]" />
        <StatCard label="This Month" value={stats?.totalBookingsThisMonth ?? 0} sub="bookings" color="text-violet-600" />
      </div>

      <div className="bg-white rounded-xl p-8 shadow-[0_4px_24px_rgba(26,35,64,0.08)] text-center">
        <svg width="64" height="64" viewBox="0 0 64 64" fill="none" className="mx-auto mb-4 opacity-50">
          <rect width="64" height="64" rx="32" fill="#2EC4A5" fillOpacity="0.1"/>
          <rect x="14" y="22" width="36" height="24" rx="4" stroke="#2EC4A5" strokeWidth="2.5"/>
          <path d="M14 30h36" stroke="#2EC4A5" strokeWidth="2.5"/>
          <path d="M20 38h8" stroke="#2EC4A5" strokeWidth="2" strokeLinecap="round"/>
        </svg>
        <p className="font-serif text-lg font-bold text-[#1A2340] mb-2">Detailed payment history</p>
        <p className="text-sm text-gray-500 max-w-xs mx-auto">
          Granular payment transaction logs will be shown here. During the free period, all revenue values will be ₹0.
        </p>
      </div>
    </div>
  );
}

type TierDef = { name: string; minSalaryInr: number; maxSalaryInr: number; description: string; };
const DEFAULT_TIERS_FE: TierDef[] = [
  { name: "Foundation", minSalaryInr: 8000, maxSalaryInr: 12000, description: "Entry-level shadow teachers" },
  { name: "Certified",  minSalaryInr: 12001, maxSalaryInr: 20000, description: "Trained & certified teachers" },
  { name: "Expert",     minSalaryInr: 20001, maxSalaryInr: 35000, description: "Experienced specialists" },
];

function SettingsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useGetAdminSettings();
  const { mutateAsync: updateSettings } = useUpdateAdminSettings();

  const [contactLimit, setContactLimit] = useState<number | "">("");
  const [unlockPrice, setUnlockPrice] = useState<number | "">("");
  const [commissionPct, setCommissionPct] = useState<number | "">("");
  const [monetisationEnabled, setMonetisationEnabled] = useState(false);
  const [showMonetisationModal, setShowMonetisationModal] = useState(false);

  const [matchingFeeInr, setMatchingFeeInr] = useState<number | "">("");
  const [matchingFeeRefundable, setMatchingFeeRefundable] = useState(true);
  const [trialFeeInr, setTrialFeeInr] = useState<number | "">("");
  const [salaryPlatformCutPct, setSalaryPlatformCutPct] = useState<number | "">("");
  const [noticePeriodDays, setNoticePeriodDays] = useState<number | "">("");
  const [parentBuyoutDays, setParentBuyoutDays] = useState<number | "">("");
  const [markupPct, setMarkupPct] = useState<number | "">("");
  const [gstRatePct, setGstRatePct] = useState<number | "">("");
  const [tiers, setTiers] = useState<TierDef[]>(DEFAULT_TIERS_FE);

  const [placementFeeInr, setPlacementFeeInr] = useState<number | "">("");
  const [activationFeeInr, setActivationFeeInr] = useState<number | "">("");
  const [platformSalaryEnabled, setPlatformSalaryEnabled] = useState(false);
  const [trialDirectPayEnabled, setTrialDirectPayEnabled] = useState(true);

  const [isSaving, setIsSaving] = useState(false);
  const [synced, setSynced] = useState(false);

  if (settings && !synced) {
    setContactLimit(settings.contactLimitPerParent ?? 5);
    setUnlockPrice(settings.contactUnlockPriceInr ?? 0);
    setCommissionPct(settings.platformCommissionPct ?? 0);
    setMonetisationEnabled(settings.monetisationEnabled ?? false);
    const settingsRec = settings as unknown as Record<string, unknown>;
    setMatchingFeeInr(settingsRec["matchingFeeInr"] as number ?? 500);
    setMatchingFeeRefundable((settingsRec["matchingFeeRefundable"] as boolean) ?? true);
    setTrialFeeInr(settingsRec["trialFeeInr"] as number ?? 500);
    setSalaryPlatformCutPct(settingsRec["salaryPlatformCutPct"] as number ?? 10);
    setNoticePeriodDays(settingsRec["noticePeriodDays"] as number ?? 30);
    setParentBuyoutDays(settingsRec["parentBuyoutDays"] as number ?? 15);
    setMarkupPct(settingsRec["markupPct"] as number ?? 10);
    setGstRatePct(settingsRec["gstRatePct"] as number ?? 18);
    const tj = settingsRec["tiersJson"] as string | undefined;
    if (tj) { try { setTiers(JSON.parse(tj)); } catch { /* ignore */ } }
    setPlacementFeeInr(settingsRec["placementFeeInr"] as number ?? 2999);
    setActivationFeeInr(settingsRec["activationFeeInr"] as number ?? 999);
    setPlatformSalaryEnabled((settingsRec["platformSalaryEnabled"] as boolean) ?? false);
    setTrialDirectPayEnabled((settingsRec["trialDirectPayEnabled"] as boolean) ?? true);
    setSynced(true);
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      await updateSettings({
        data: {
          contactLimitPerParent: Number(contactLimit) || 5,
          contactUnlockPriceInr: Number(unlockPrice) || 0,
          platformCommissionPct: Number(commissionPct) || 0,
          monetisationEnabled,
          matchingFeeInr: Number(matchingFeeInr) || 500,
          matchingFeeRefundable,
          trialFeeInr: Number(trialFeeInr) || 500,
          salaryPlatformCutPct: Number(salaryPlatformCutPct) || 10,
          noticePeriodDays: Number(noticePeriodDays) || 30,
          parentBuyoutDays: Number(parentBuyoutDays) || 15,
          markupPct: Number(markupPct) || 10,
          gstRatePct: Number(gstRatePct) || 18,
          tiersJson: JSON.stringify(tiers),
          placementFeeInr: Number(placementFeeInr) || 2999,
          activationFeeInr: Number(activationFeeInr) || 999,
          platformSalaryEnabled,
          trialDirectPayEnabled,
        },
      });
      queryClient.invalidateQueries({ queryKey: getGetAdminSettingsQueryKey() });
      toast({ title: "Settings saved ✓" });
    } catch {
      toast({ title: "Failed to save settings", variant: "destructive" });
    } finally { setIsSaving(false); }
  }

  function updateTier(idx: number, field: string, value: unknown) {
    setTiers(prev => prev.map((t, i) => i === idx ? { ...t, [field]: value } : t));
  }

  if (isLoading) {
    return <div className="space-y-4">{[1,2,3].map(i => <div key={i} className="h-12 bg-white rounded-xl animate-pulse shadow-sm" />)}</div>;
  }

  return (
    <>
      <div className="max-w-2xl space-y-6">
        {monetisationEnabled ? (
          <div className="flex items-start gap-3 p-4 bg-green-50 border border-green-200 rounded-xl">
            <IndianRupee size={18} className="text-green-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-green-800">Monetisation is active</p>
              <p className="text-xs text-green-600 mt-0.5">Parents are charged ₹{Number(unlockPrice) || 0} per contact unlock. Platform commission: {Number(commissionPct) || 0}%.</p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3 p-4 bg-[#FFB830]/10 border border-[#FFB830]/30 rounded-xl">
            <TrendingUp size={18} className="text-[#FFB830] mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-[#1A2340]">Platform is currently free</p>
              <p className="text-xs text-gray-500 mt-0.5">Enable monetisation below to charge parents per unlock via Razorpay.</p>
            </div>
          </div>
        )}

        {/* ── Contact Unlocks ── */}
        <div className="bg-white rounded-xl p-6 shadow-[0_4px_24px_rgba(26,35,64,0.08)] space-y-5">
          <p className="text-base font-bold text-[#1A2340]">Contact Unlocks</p>
          <div>
            <Label htmlFor="contact-limit" className="text-sm font-semibold text-[#1A2340]">Unlocks Per Parent</Label>
            <p className="text-xs text-gray-400 mb-2">Maximum number of professionals a parent can unlock contact details for.</p>
            <Input id="contact-limit" type="number" min={1} max={1000} value={contactLimit}
              onChange={(e) => setContactLimit(e.target.value === "" ? "" : Number(e.target.value))}
              className="rounded-lg focus-visible:ring-[#2EC4A5] max-w-xs" />
          </div>
          <hr className="border-gray-100" />
          <div>
            <p className="text-sm font-semibold text-[#1A2340] mb-1">Monetisation</p>
            <p className="text-xs text-gray-400 mb-4">Control whether parents are charged for contact unlocks.</p>
            <div className="flex items-center justify-between p-3 rounded-xl border border-gray-100 bg-gray-50 mb-4">
              <div>
                <p className="text-sm font-medium text-[#1A2340]">Enable paid contact unlocks</p>
                <p className="text-xs text-gray-400">Charge parents each time they unlock a professional's contact details.</p>
              </div>
              <button type="button"
                onClick={() => !monetisationEnabled ? setShowMonetisationModal(true) : setMonetisationEnabled(false)}
                aria-label={monetisationEnabled ? "Disable monetisation" : "Enable monetisation"}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2EC4A5] focus-visible:ring-offset-2 ${monetisationEnabled ? "bg-[#2EC4A5]" : "bg-gray-200"}`}>
                <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition-transform ${monetisationEnabled ? "translate-x-5" : "translate-x-0"}`} />
              </button>
            </div>
            <div className={`grid grid-cols-2 gap-4 transition-opacity duration-200 ${monetisationEnabled ? "opacity-100" : "opacity-40 pointer-events-none"}`}>
              <div>
                <Label htmlFor="unlock-price" className="text-sm font-semibold text-[#1A2340]">Unlock Price (₹)</Label>
                <Input id="unlock-price" type="number" min={0} max={10000} value={unlockPrice}
                  onChange={(e) => setUnlockPrice(e.target.value === "" ? "" : Number(e.target.value))}
                  className="rounded-lg focus-visible:ring-[#2EC4A5] mt-1.5" disabled={!monetisationEnabled} />
              </div>
              <div>
                <Label htmlFor="commission-pct" className="text-sm font-semibold text-[#1A2340]">Platform Commission (%)</Label>
                <Input id="commission-pct" type="number" min={0} max={100} value={commissionPct}
                  onChange={(e) => setCommissionPct(e.target.value === "" ? "" : Number(e.target.value))}
                  className="rounded-lg focus-visible:ring-[#2EC4A5] mt-1.5" disabled={!monetisationEnabled} />
              </div>
            </div>
          </div>
        </div>

        {/* ── Shadow Teacher — Matching Fee ── */}
        <div className="bg-white rounded-xl p-6 shadow-[0_4px_24px_rgba(26,35,64,0.08)] space-y-5">
          <p className="text-base font-bold text-[#1A2340]">Shadow Teacher — Matching Fee</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-sm font-semibold text-[#1A2340]">Matching Fee (₹)</Label>
              <p className="text-xs text-gray-400 mb-1.5">Charged to parents when they submit a match request.</p>
              <Input type="number" min={0} value={matchingFeeInr}
                onChange={(e) => setMatchingFeeInr(e.target.value === "" ? "" : Number(e.target.value))}
                className="rounded-lg focus-visible:ring-[#2EC4A5]" />
            </div>
            <div className="flex flex-col gap-2">
              <Label className="text-sm font-semibold text-[#1A2340]">Matching Fee Refundable?</Label>
              <p className="text-xs text-gray-400">If yes, fee is refunded when no match is found.</p>
              <div className="flex items-center gap-3 mt-1">
                <button type="button" onClick={() => setMatchingFeeRefundable(v => !v)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2EC4A5] focus-visible:ring-offset-2 ${matchingFeeRefundable ? "bg-[#2EC4A5]" : "bg-gray-200"}`}>
                  <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition-transform ${matchingFeeRefundable ? "translate-x-5" : "translate-x-0"}`} />
                </button>
                <span className="text-sm text-gray-600">{matchingFeeRefundable ? "Yes, refundable" : "Non-refundable"}</span>
              </div>
            </div>
          </div>
          <hr className="border-gray-100" />
          <div>
            <Label className="text-sm font-semibold text-[#1A2340]">Trial Day Fee (₹)</Label>
            <p className="text-xs text-gray-400 mb-1.5">
              Optional trial: parent pays this fee to arrange a one-day trial with a shortlisted teacher.
              Non-refundable, but credited against the first month's salary if the parent commits.
            </p>
            <Input type="number" min={0} max={10000} value={trialFeeInr}
              onChange={(e) => setTrialFeeInr(e.target.value === "" ? "" : Number(e.target.value))}
              className="rounded-lg focus-visible:ring-[#2EC4A5] max-w-xs" />
          </div>
        </div>

        {/* ── Shadow Teacher — Engagement Terms ── */}
        <div className="bg-white rounded-xl p-6 shadow-[0_4px_24px_rgba(26,35,64,0.08)] space-y-5">
          <p className="text-base font-bold text-[#1A2340]">Shadow Teacher — Engagement Terms</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-sm font-semibold text-[#1A2340]">Platform Cut on Salary (%)</Label>
              <p className="text-xs text-gray-400 mb-1.5">% taken from each monthly salary payment.</p>
              <Input type="number" min={0} max={100} value={salaryPlatformCutPct}
                onChange={(e) => setSalaryPlatformCutPct(e.target.value === "" ? "" : Number(e.target.value))}
                className="rounded-lg focus-visible:ring-[#2EC4A5]" />
            </div>
            <div>
              <Label className="text-sm font-semibold text-[#1A2340]">Notice Period (days)</Label>
              <p className="text-xs text-gray-400 mb-1.5">Days either party must give before ending engagement.</p>
              <Input type="number" min={0} value={noticePeriodDays}
                onChange={(e) => setNoticePeriodDays(e.target.value === "" ? "" : Number(e.target.value))}
                className="rounded-lg focus-visible:ring-[#2EC4A5]" />
            </div>
            <div>
              <Label className="text-sm font-semibold text-[#1A2340]">Parent Buyout Period (days)</Label>
              <p className="text-xs text-gray-400 mb-1.5">Days parent pays to exit early without notice.</p>
              <Input type="number" min={0} value={parentBuyoutDays}
                onChange={(e) => setParentBuyoutDays(e.target.value === "" ? "" : Number(e.target.value))}
                className="rounded-lg focus-visible:ring-[#2EC4A5]" />
            </div>
          </div>
        </div>

        {/* ── Monetization Restructure — Placement & Activation Fees ── */}
        <div className="bg-white rounded-xl p-6 shadow-[0_4px_24px_rgba(26,35,64,0.08)] space-y-5">
          <div>
            <p className="text-base font-bold text-[#1A2340]">Placement & Activation Fees</p>
            <p className="text-xs text-gray-400 mt-1">
              These apply to NEW shadow-teacher engagements only. Changing them does not affect
              existing active engagements' salary or commission terms.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-sm font-semibold text-[#1A2340]">Placement Fee (₹)</Label>
              <p className="text-xs text-gray-400 mb-1.5">Charged to the parent when they commit to a shortlisted teacher.</p>
              <Input type="number" min={0} value={placementFeeInr}
                onChange={(e) => setPlacementFeeInr(e.target.value === "" ? "" : Number(e.target.value))}
                className="rounded-lg focus-visible:ring-[#2EC4A5]" />
            </div>
            <div>
              <Label className="text-sm font-semibold text-[#1A2340]">Activation Fee (₹)</Label>
              <p className="text-xs text-gray-400 mb-1.5">Charged to the teacher when they accept the engagement.</p>
              <Input type="number" min={0} value={activationFeeInr}
                onChange={(e) => setActivationFeeInr(e.target.value === "" ? "" : Number(e.target.value))}
                className="rounded-lg focus-visible:ring-[#2EC4A5]" />
            </div>
          </div>
          <hr className="border-gray-100" />
          <div className="flex items-center justify-between p-3 rounded-xl border border-gray-100 bg-gray-50">
            <div>
              <p className="text-sm font-medium text-[#1A2340]">Platform-run salary payments</p>
              <p className="text-xs text-gray-400">When on, new engagements route monthly salary through the platform instead of parent-to-teacher direct pay.</p>
            </div>
            <button type="button" onClick={() => setPlatformSalaryEnabled(v => !v)}
              aria-label={platformSalaryEnabled ? "Disable platform salary" : "Enable platform salary"}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2EC4A5] focus-visible:ring-offset-2 ${platformSalaryEnabled ? "bg-[#2EC4A5]" : "bg-gray-200"}`}>
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition-transform ${platformSalaryEnabled ? "translate-x-5" : "translate-x-0"}`} />
            </button>
          </div>
          <div className="flex items-center justify-between p-3 rounded-xl border border-gray-100 bg-gray-50">
            <div>
              <p className="text-sm font-medium text-[#1A2340]">Trial day direct pay</p>
              <p className="text-xs text-gray-400">When on, parents with a verified-UPI teacher can pay the trial fee directly instead of through the platform.</p>
            </div>
            <button type="button" onClick={() => setTrialDirectPayEnabled(v => !v)}
              aria-label={trialDirectPayEnabled ? "Disable trial direct pay" : "Enable trial direct pay"}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2EC4A5] focus-visible:ring-offset-2 ${trialDirectPayEnabled ? "bg-[#2EC4A5]" : "bg-gray-200"}`}>
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition-transform ${trialDirectPayEnabled ? "translate-x-5" : "translate-x-0"}`} />
            </button>
          </div>
        </div>

        {/* ── Session Pricing ── */}
        <div className="bg-white rounded-xl p-6 shadow-[0_4px_24px_rgba(26,35,64,0.08)] space-y-5">
          <p className="text-base font-bold text-[#1A2340]">Session Pricing</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-sm font-semibold text-[#1A2340]">Markup %</Label>
              <p className="text-xs text-gray-400 mb-1.5">Markup added on top of professional's base rate.</p>
              <Input type="number" min={0} max={100} value={markupPct}
                onChange={(e) => setMarkupPct(e.target.value === "" ? "" : Number(e.target.value))}
                className="rounded-lg focus-visible:ring-[#2EC4A5]" />
            </div>
            <div>
              <Label className="text-sm font-semibold text-[#1A2340]">GST Rate %</Label>
              <p className="text-xs text-gray-400 mb-1.5">GST applied on sessions (18% standard).</p>
              <Input type="number" min={0} max={100} value={gstRatePct}
                onChange={(e) => setGstRatePct(e.target.value === "" ? "" : Number(e.target.value))}
                className="rounded-lg focus-visible:ring-[#2EC4A5]" />
            </div>
          </div>
        </div>

        {/* ── Tiers Editor ── */}
        <div className="bg-white rounded-xl p-6 shadow-[0_4px_24px_rgba(26,35,64,0.08)] space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-base font-bold text-[#1A2340]">Shadow Teacher Tiers</p>
            <button type="button"
              onClick={() => setTiers(prev => [...prev, { name: "New Tier", minSalaryInr: 0, maxSalaryInr: 0, description: "" }])}
              className="text-xs text-[#2EC4A5] hover:underline font-semibold">+ Add Tier</button>
          </div>
          {tiers.map((tier, idx) => (
            <div key={idx} className="border border-gray-100 rounded-xl p-4 space-y-3 bg-gray-50/50">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-[#1A2340]">Tier {idx + 1}</p>
                <button type="button" onClick={() => setTiers(prev => prev.filter((_, i) => i !== idx))}
                  className="text-xs text-[#FF6B6B] hover:underline">Remove</button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-gray-500 mb-1">Tier Name</Label>
                  <Input value={tier.name} onChange={(e) => updateTier(idx, "name", e.target.value)}
                    className="rounded-lg focus-visible:ring-[#2EC4A5] h-8 text-sm" />
                </div>
                <div>
                  <Label className="text-xs text-gray-500 mb-1">Description</Label>
                  <Input value={tier.description} onChange={(e) => updateTier(idx, "description", e.target.value)}
                    className="rounded-lg focus-visible:ring-[#2EC4A5] h-8 text-sm" />
                </div>
                <div>
                  <Label className="text-xs text-gray-500 mb-1">Min Salary (₹/mo)</Label>
                  <Input type="number" value={tier.minSalaryInr}
                    onChange={(e) => updateTier(idx, "minSalaryInr", Number(e.target.value))}
                    className="rounded-lg focus-visible:ring-[#2EC4A5] h-8 text-sm" />
                </div>
                <div>
                  <Label className="text-xs text-gray-500 mb-1">Max Salary (₹/mo)</Label>
                  <Input type="number" value={tier.maxSalaryInr}
                    onChange={(e) => updateTier(idx, "maxSalaryInr", Number(e.target.value))}
                    className="rounded-lg focus-visible:ring-[#2EC4A5] h-8 text-sm" />
                </div>
              </div>
            </div>
          ))}
        </div>

        <Button onClick={handleSave} disabled={isSaving}
          className="w-full bg-[#2EC4A5] hover:bg-[#26a88d] text-white focus-visible:ring-2 focus-visible:ring-[#2EC4A5]">
          {isSaving ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
          Save All Settings
        </Button>
      </div>

      <Dialog open={showMonetisationModal} onOpenChange={setShowMonetisationModal}>
        <DialogContent className="max-w-sm shadow-[0_8px_40px_rgba(26,35,64,0.12)]">
          <DialogHeader>
            <DialogTitle className="font-serif text-[#1A2340]">Enable Monetisation?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="flex items-start gap-3 p-3 bg-[#FF6B6B]/5 border border-[#FF6B6B]/20 rounded-xl">
              <IndianRupee size={16} className="text-[#FF6B6B] mt-0.5 shrink-0" />
              <p className="text-sm text-gray-600">
                Parents will be charged <strong>₹{Number(unlockPrice) || 0}</strong> per contact unlock via Razorpay. This takes effect immediately on Save.
              </p>
            </div>
            <p className="text-xs text-gray-400">Make sure the unlock price and commission are configured correctly before enabling.</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setShowMonetisationModal(false)}>Cancel</Button>
            <Button className="bg-[#2EC4A5] hover:bg-[#26a88d] focus-visible:ring-2 focus-visible:ring-[#2EC4A5]"
              onClick={() => { setMonetisationEnabled(true); setShowMonetisationModal(false); }}>
              Enable Monetisation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB: ENGAGEMENTS (Admin)
// ═══════════════════════════════════════════════════════════════════════════════
interface AdminEngagement {
  id: number; parentId: number; professionalId: number; childId: number | null;
  matchRequestId: number | null; tier: string | null; startDate: string;
  monthlyFeeInr: string; status: string; endDate: string | null; notes: string | null;
  createdAt: string; parentName: string | null; professionalName: string | null; childName: string | null;
  platformSalaryEnabled: boolean | null; placementFeeInr: number | null; placementFeePaymentId: number | null;
  activationFeeInr: number | null; activationFeePaymentId: number | null;
}
interface LifecycleReq {
  id: number; engagementId: number; type: string; method: string | null;
  raisedByRole: string; raisedByName: string | null; status: string;
  reason: string | null; adminNotes: string | null; effectiveEndDate: string | null;
  raisedAt: string;
  buyoutOrderId: string | null; buyoutPaymentId: string | null; buyoutFeeInr: number | null;
}
interface AdminSalaryPayment {
  id: number; engagementId: number; month: string; grossInr: string;
  platformCutInr: string; netInr: string; status: string; paidAt: string | null; parentName: string | null;
}

function AdminEngagementsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: engagements = [], isLoading } = useQuery<AdminEngagement[]>({
    queryKey: ["admin-engagements"],
    queryFn: () => fetchWithAuth("/api/admin/engagements").then(r => r.json()),
  });

  const { data: salaryPayments = [] } = useQuery<AdminSalaryPayment[]>({
    queryKey: ["admin-salary-payments"],
    queryFn: () => fetchWithAuth("/api/admin/salary-payments").then(r => r.json()),
  });

  const [engAdminTab, setEngAdminTab] = useState<"engagements" | "salary">("engagements");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedEng, setSelectedEng] = useState<number | null>(null);
  const [lifecycle, setLifecycle] = useState<LifecycleReq[]>([]);
  const [loadingLifecycle, setLoadingLifecycle] = useState(false);
  const [form, setForm] = useState({ parentId: "", professionalId: "", childId: "", startDate: "", monthlyFeeInr: "", tier: "", notes: "" });
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    setCreating(true);
    try {
      await fetchWithAuth("/api/admin/engagements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentId: Number(form.parentId), professionalId: Number(form.professionalId),
          childId: form.childId ? Number(form.childId) : null, startDate: form.startDate,
          monthlyFeeInr: Number(form.monthlyFeeInr), tier: form.tier || null, notes: form.notes || null,
        }),
      });
      queryClient.invalidateQueries({ queryKey: ["admin-engagements"] });
      setShowCreate(false);
      setForm({ parentId: "", professionalId: "", childId: "", startDate: "", monthlyFeeInr: "", tier: "", notes: "" });
      toast({ title: "Engagement created ✓" });
    } catch { toast({ title: "Failed to create engagement", variant: "destructive" }); }
    finally { setCreating(false); }
  }

  async function loadLifecycle(id: number) {
    setSelectedEng(id); setLoadingLifecycle(true);
    try {
      const data = await fetchWithAuth(`/api/engagements/${id}/lifecycle`).then(r => r.json());
      setLifecycle(data);
    } catch { setLifecycle([]); }
    finally { setLoadingLifecycle(false); }
  }

  async function handleLifecycleAction(reqId: number, action: "approved" | "rejected") {
    try {
      await fetchWithAuth(`/api/admin/lifecycle/${reqId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: action }),
      });
      if (selectedEng) await loadLifecycle(selectedEng);
      queryClient.invalidateQueries({ queryKey: ["admin-engagements"] });
      toast({ title: `Request ${action} ✓` });
    } catch { toast({ title: "Action failed", variant: "destructive" }); }
  }

  const ENG_STATUS_COLORS: Record<string, string> = {
    pending_teacher_acceptance: "bg-purple-50 text-purple-700 border-purple-200",
    pending_activation_fee: "bg-orange-50 text-orange-700 border-orange-200",
    pending_start: "bg-amber-50 text-amber-700 border-amber-200",
    active: "bg-green-50 text-green-700 border-green-200",
    notice_period: "bg-yellow-50 text-yellow-700 border-yellow-200",
    ended: "bg-gray-50 text-gray-500 border-gray-200",
    paused: "bg-blue-50 text-blue-700 border-blue-200",
  };

  if (isLoading) return <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-14 bg-white rounded-xl animate-pulse shadow-sm" />)}</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-[#1A2340]">Engagements</h2>
          <p className="text-sm text-gray-400 mt-0.5">Manage shadow teacher engagements and lifecycle</p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="bg-[#2EC4A5] hover:bg-[#26a88d] text-white text-sm">
          + New Engagement
        </Button>
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {([["engagements", "Engagements"], ["salary", "Salary Payments"]] as [string, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setEngAdminTab(id as typeof engAdminTab)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${engAdminTab === id ? "bg-white text-[#1A2340] shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
            {label}
          </button>
        ))}
      </div>

      {engAdminTab === "engagements" && (
        <div className="space-y-3">
          {engagements.length === 0 && (
            <div className="text-center py-16 text-gray-400"><p className="text-sm">No engagements yet. Create one to get started.</p></div>
          )}
          {engagements.map(eng => (
            <div key={eng.id} className="bg-white rounded-xl p-4 shadow-[0_2px_12px_rgba(26,35,64,0.06)]">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-[#1A2340]">
                      {eng.parentName ?? `Parent #${eng.parentId}`} ↔ {eng.professionalName ?? `Pro #${eng.professionalId}`}
                    </p>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border uppercase tracking-wide ${ENG_STATUS_COLORS[eng.status] ?? "bg-gray-50 text-gray-500 border-gray-200"}`}>
                      {eng.status.replace("_", " ")}
                    </span>
                    {eng.tier && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#2EC4A5]/10 text-[#2EC4A5] border border-[#2EC4A5]/20">{eng.tier}</span>}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {eng.childName ? `Child: ${eng.childName} · ` : ""}₹{Number(eng.monthlyFeeInr).toLocaleString("en-IN")}/mo · From {new Date(eng.startDate).toLocaleDateString("en-IN")}
                  </p>
                  <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                    {eng.placementFeeInr != null && (
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${eng.placementFeePaymentId ? "bg-green-50 text-green-700 border-green-200" : "bg-yellow-50 text-yellow-700 border-yellow-200"}`}>
                        Placement fee ₹{eng.placementFeeInr.toLocaleString("en-IN")} {eng.placementFeePaymentId ? "· paid" : "· pending"}
                      </span>
                    )}
                    {eng.activationFeeInr != null && (
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${eng.activationFeePaymentId ? "bg-green-50 text-green-700 border-green-200" : "bg-yellow-50 text-yellow-700 border-yellow-200"}`}>
                        Activation fee ₹{eng.activationFeeInr.toLocaleString("en-IN")} {eng.activationFeePaymentId ? "· paid" : "· pending"}
                      </span>
                    )}
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${eng.platformSalaryEnabled ? "bg-indigo-50 text-indigo-700 border-indigo-200" : "bg-gray-50 text-gray-500 border-gray-200"}`}>
                      {eng.platformSalaryEnabled ? "Platform salary" : "Direct-pay salary"}
                    </span>
                  </div>
                </div>
                <button onClick={() => selectedEng === eng.id ? setSelectedEng(null) : loadLifecycle(eng.id)}
                  className="shrink-0 text-xs text-[#2EC4A5] hover:underline font-medium">
                  {selectedEng === eng.id ? "Hide" : "Lifecycle →"}
                </button>
              </div>
              {selectedEng === eng.id && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <p className="text-xs font-bold text-[#1A2340] mb-3">Lifecycle Requests</p>
                  {loadingLifecycle ? (
                    <div className="space-y-2">{[1,2].map(i => <div key={i} className="h-10 bg-gray-50 rounded-lg animate-pulse" />)}</div>
                  ) : lifecycle.length === 0 ? (
                    <p className="text-xs text-gray-400">No lifecycle requests.</p>
                  ) : (
                    <div className="space-y-2">
                      {lifecycle.map(lc => (
                        <div key={lc.id} className="flex items-center gap-3 p-2.5 bg-gray-50 rounded-lg flex-wrap">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-[#1A2340] capitalize">{lc.type}{lc.method ? ` (${lc.method})` : ""} · by {lc.raisedByName ?? lc.raisedByRole} · {new Date(lc.raisedAt).toLocaleDateString("en-IN")}</p>
                            <p className="text-xs text-gray-400 truncate">{lc.reason ?? (lc.effectiveEndDate ? `Ends: ${lc.effectiveEndDate}` : "No reason given")}</p>
                            {lc.method === "buyout" && lc.buyoutFeeInr != null && (
                              <p className="text-xs text-gray-400 mt-0.5">Buyout fee: ₹{lc.buyoutFeeInr.toLocaleString("en-IN")}</p>
                            )}
                          </div>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${lc.status === "pending" ? "bg-yellow-50 text-yellow-700 border-yellow-200" : lc.status === "approved" ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"}`}>
                            {lc.status}
                          </span>
                          {lc.method === "buyout" && (
                            lc.buyoutPaymentId
                              ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-green-50 text-green-700 border-green-200">payment confirmed ✓</span>
                              : <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-yellow-50 text-yellow-700 border-yellow-200">payment pending</span>
                          )}
                          {lc.status === "pending" && (
                            <div className="flex gap-1">
                              <button
                                onClick={() => handleLifecycleAction(lc.id, "approved")}
                                disabled={lc.method === "buyout" && !lc.buyoutPaymentId}
                                className="text-xs bg-green-50 hover:bg-green-100 text-green-700 px-2 py-1 rounded font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                                title={lc.method === "buyout" && !lc.buyoutPaymentId ? "Buyout payment not yet confirmed" : undefined}
                              >Approve</button>
                              <button onClick={() => handleLifecycleAction(lc.id, "rejected")} className="text-xs bg-red-50 hover:bg-red-100 text-red-700 px-2 py-1 rounded font-medium">Reject</button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {engAdminTab === "salary" && (
        <div className="space-y-3">
          {salaryPayments.length === 0 && (
            <div className="text-center py-16 text-gray-400"><p className="text-sm">No salary payments recorded yet.</p></div>
          )}
          {salaryPayments.map(pmt => (
            <div key={pmt.id} className="bg-white rounded-xl p-4 shadow-[0_2px_12px_rgba(26,35,64,0.06)] flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#1A2340]">Eng #{pmt.engagementId} · {pmt.month}</p>
                <p className="text-xs text-gray-400">
                  Gross ₹{Number(pmt.grossInr).toLocaleString("en-IN")} · Platform ₹{Number(pmt.platformCutInr).toLocaleString("en-IN")} · Net ₹{Number(pmt.netInr).toLocaleString("en-IN")}
                  {pmt.parentName ? ` · ${pmt.parentName}` : ""}
                </p>
              </div>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${pmt.status === "paid" ? "bg-green-50 text-green-700 border-green-200" : "bg-yellow-50 text-yellow-700 border-yellow-200"}`}>
                {pmt.status}
              </span>
            </div>
          ))}
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md shadow-[0_8px_40px_rgba(26,35,64,0.12)]">
          <DialogHeader>
            <DialogTitle className="font-serif text-[#1A2340]">Create Engagement</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            {([
              ["parentId", "Parent User ID"],
              ["professionalId", "Professional Profile ID"],
              ["childId", "Child ID (optional)"],
              ["startDate", "Start Date (YYYY-MM-DD)"],
              ["monthlyFeeInr", "Monthly Fee (₹)"],
              ["tier", "Tier (optional)"],
              ["notes", "Notes (optional)"],
            ] as [string, string][]).map(([field, label]) => (
              <div key={field}>
                <Label className="text-sm font-semibold text-[#1A2340]">{label}</Label>
                <Input value={form[field as keyof typeof form]}
                  onChange={(e) => setForm(f => ({ ...f, [field]: e.target.value }))}
                  className="rounded-lg focus-visible:ring-[#2EC4A5] mt-1" />
              </div>
            ))}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating}
              className="bg-[#2EC4A5] hover:bg-[#26a88d] focus-visible:ring-2 focus-visible:ring-[#2EC4A5]">
              {creating ? <Loader2 size={14} className="animate-spin mr-1" /> : null}Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB: BOOKINGS & PAYOUTS (Flow B state machine)
// ═══════════════════════════════════════════════════════════════════════════════
const BOOKING_STATUS_COLORS: Record<string, string> = {
  requested: "bg-yellow-50 text-yellow-700 border-yellow-200",
  confirmed_by_pro: "bg-blue-50 text-blue-700 border-blue-200",
  paid_held: "bg-indigo-50 text-indigo-700 border-indigo-200",
  session_started: "bg-teal-50 text-teal-700 border-teal-200",
  session_completed: "bg-gray-50 text-gray-600 border-gray-200",
  releasable: "bg-purple-50 text-purple-700 border-purple-200",
  released: "bg-green-50 text-green-700 border-green-200",
  cancelled: "bg-red-50 text-red-600 border-red-200",
  refunded: "bg-gray-50 text-gray-500 border-gray-200",
  disputed: "bg-red-50 text-red-700 border-red-300",
  confirmed: "bg-green-50 text-green-700 border-green-200",
  pending_payment: "bg-yellow-50 text-yellow-700 border-yellow-200",
  completed: "bg-gray-50 text-gray-600 border-gray-200",
};

function AdminBookingsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("releasable");
  const [releasing, setReleasing] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [batchReleasing, setBatchReleasing] = useState(false);
  const [disputeModal, setDisputeModal] = useState<AdminBookingRow | null>(null);
  const [resolution, setResolution] = useState<"release" | "refund">("release");
  const [resolvingDispute, setResolvingDispute] = useState(false);

  const { data, isLoading, refetch } = useQuery<{ bookings: AdminBookingRow[]; total: number }>({
    queryKey: ["admin-bookings", statusFilter],
    queryFn: async () => {
      const qs = statusFilter ? `?status=${statusFilter}` : "";
      const res = await fetchWithAuth(`/api/admin/bookings${qs}`);
      return res.json();
    },
    staleTime: 30_000,
  });

  const bookings = data?.bookings ?? [];

  const STATUS_FILTERS = [
    { value: "releasable", label: "Ready to release" },
    { value: "disputed", label: "Disputed" },
    { value: "paid_held", label: "Paid & held" },
    { value: "requested", label: "Requested" },
    { value: "confirmed_by_pro", label: "Confirmed" },
    { value: "released", label: "Released" },
    { value: "", label: "All" },
  ];

  async function handleRelease(id: number) {
    setReleasing(id);
    try {
      const res = await fetchWithAuth(`/api/admin/bookings/${id}/release`, { method: "PATCH" });
      const data = await res.json();
      if (!res.ok) { toast({ title: data.error ?? "Release failed", variant: "destructive" }); return; }
      toast({ title: "Payout marked as released ✓" });
      refetch();
    } catch { toast({ title: "Network error", variant: "destructive" }); }
    finally { setReleasing(null); }
  }

  async function handleBatchRelease() {
    if (selected.size === 0) return;
    setBatchReleasing(true);
    try {
      const res = await fetchWithAuth("/api/admin/bookings/batch-release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      const data = await res.json();
      toast({ title: `Released ${data.releasedCount ?? 0} of ${selected.size} bookings ✓` });
      setSelected(new Set());
      refetch();
    } catch { toast({ title: "Network error", variant: "destructive" }); }
    finally { setBatchReleasing(false); }
  }

  async function handleResolveDispute() {
    if (!disputeModal) return;
    setResolvingDispute(true);
    try {
      const res = await fetchWithAuth(`/api/admin/bookings/${disputeModal.id}/resolve-dispute`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ title: data.error ?? "Failed", variant: "destructive" }); return; }
      toast({ title: `Dispute resolved — booking moved to ${resolution === "release" ? "RELEASABLE" : "REFUNDED"} ✓` });
      setDisputeModal(null);
      refetch();
    } catch { toast({ title: "Network error", variant: "destructive" }); }
    finally { setResolvingDispute(false); }
  }

  const allReleasableSelected = bookings.filter((b) => b.status === "releasable");

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-serif font-bold text-[#1A2340] flex-1">Bookings & Payouts</h2>
        {selected.size > 0 && (
          <Button
            size="sm"
            className="bg-[#2EC4A5] hover:bg-[#26a88d] text-white"
            disabled={batchReleasing}
            onClick={handleBatchRelease}
          >
            {batchReleasing ? <Loader2 size={13} className="animate-spin mr-1" /> : null}
            Release selected ({selected.size})
          </Button>
        )}
        {statusFilter === "releasable" && allReleasableSelected.length > 0 && selected.size === 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSelected(new Set(allReleasableSelected.map((b) => b.id)))}
          >
            Select all releasable
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => { setStatusFilter(f.value); setSelected(new Set()); }}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
              statusFilter === f.value
                ? "bg-[#1A2340] text-white border-[#1A2340]"
                : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-16 bg-white rounded-xl animate-pulse" />)}</div>
      ) : bookings.length === 0 ? (
        <div className="bg-white rounded-xl p-10 text-center shadow-sm">
          <p className="text-gray-400 text-sm">No bookings found for this filter.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-[0_4px_24px_rgba(26,35,64,0.08)] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="w-8 px-3 py-3" />
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Booking</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden sm:table-cell">Parties</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Amount</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {bookings.map((b) => (
                <tr key={b.id} className="hover:bg-gray-50/50">
                  <td className="px-3 py-3">
                    {b.status === "releasable" && (
                      <input
                        type="checkbox"
                        checked={selected.has(b.id)}
                        onChange={(e) => {
                          const s = new Set(selected);
                          e.target.checked ? s.add(b.id) : s.delete(b.id);
                          setSelected(s);
                        }}
                        className="rounded"
                      />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-[#1A2340]">#{b.id}</p>
                    <p className="text-xs text-gray-400">{b.bookedDate} · {b.startTime}</p>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <p className="text-xs text-gray-600">Parent: {b.parentName ?? "—"}</p>
                    <p className="text-xs text-gray-600">Pro: {b.proName ?? "—"}</p>
                    {b.proUpiVpa && <p className="text-[10px] text-gray-400 mt-0.5">UPI: {b.proUpiVpa}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-[#1A2340]">₹{b.amountInr?.toLocaleString("en-IN")}</p>
                    <p className="text-[10px] text-gray-400">Pro: ₹{b.proAmountInr} · Fee: ₹{b.markupInr} · GST: ₹{b.gstInr}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full border font-medium ${BOOKING_STATUS_COLORS[b.status] ?? "bg-gray-50 text-gray-600 border-gray-200"}`}>
                      {b.status.replace(/_/g, " ")}
                    </span>
                    {b.disputeReason && (
                      <p className="text-[10px] text-red-500 mt-1 max-w-[120px] truncate" title={b.disputeReason}>{b.disputeReason}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1.5">
                      {b.status === "releasable" && (
                        <Button
                          size="sm"
                          className="bg-[#2EC4A5] hover:bg-[#26a88d] text-white text-xs h-7 px-2.5"
                          disabled={releasing === b.id}
                          onClick={() => handleRelease(b.id)}
                        >
                          {releasing === b.id ? <Loader2 size={11} className="animate-spin" /> : "Release"}
                        </Button>
                      )}
                      {b.status === "disputed" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs h-7 px-2.5 border-red-200 text-red-600 hover:bg-red-50"
                          onClick={() => setDisputeModal(b)}
                        >
                          Resolve
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!disputeModal} onOpenChange={() => setDisputeModal(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-serif text-[#1A2340]">Resolve Dispute #{disputeModal?.id}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            {disputeModal?.disputeReason && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
                <p className="font-semibold text-xs mb-1">Dispute reason:</p>
                {disputeModal.disputeReason}
              </div>
            )}
            <p className="text-sm text-gray-600">How would you like to resolve this dispute?</p>
            <div className="space-y-2">
              {(["release", "refund"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setResolution(r)}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border text-sm transition-all ${
                    resolution === r ? "border-[#2EC4A5] bg-[#2EC4A5]/5 text-[#1A2340]" : "border-gray-200 text-gray-600 hover:border-gray-300"
                  }`}
                >
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${resolution === r ? "border-[#2EC4A5]" : "border-gray-300"}`}>
                    {resolution === r && <div className="w-2 h-2 rounded-full bg-[#2EC4A5]" />}
                  </div>
                  {r === "release" ? "Release payment to professional" : "Refund payment to parent"}
                </button>
              ))}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setDisputeModal(null)}>Cancel</Button>
            <Button
              className="bg-[#2EC4A5] hover:bg-[#26a88d]"
              disabled={resolvingDispute}
              onClick={handleResolveDispute}
            >
              {resolvingDispute ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
              Confirm Resolution
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB: SHADOW TEACHER MATCHING (Flow A)
// ═══════════════════════════════════════════════════════════════════════════════
const MATCH_STATUS_COLORS: Record<string, string> = {
  pending_payment: "bg-yellow-50 text-yellow-700 border-yellow-200",
  pending: "bg-yellow-50 text-yellow-700 border-yellow-200",
  queued: "bg-blue-50 text-blue-700 border-blue-200",
  shortlisted: "bg-blue-50 text-blue-700 border-blue-200",
  pending_commitment: "bg-purple-50 text-purple-700 border-purple-200",
  committed: "bg-green-50 text-green-700 border-green-200",
  matched: "bg-green-50 text-green-700 border-green-200",
  cancelled: "bg-gray-50 text-gray-500 border-gray-200",
  refunded: "bg-gray-50 text-gray-500 border-gray-200",
  payment_failed: "bg-red-50 text-red-600 border-red-200",
  trial_pending: "bg-orange-50 text-orange-700 border-orange-200",
  trial_done: "bg-teal-50 text-teal-700 border-teal-200",
};

const MATCH_STATUS_LABELS: Record<string, string> = {
  pending_payment: "Pending Payment",
  pending: "Pending",
  queued: "Queued",
  shortlisted: "Shortlisted",
  pending_commitment: "Pending Commitment",
  committed: "Committed",
  matched: "Matched",
  cancelled: "Cancelled",
  refunded: "Refunded",
  payment_failed: "Payment Failed",
  trial_pending: "Trial Day Scheduled",
  trial_done: "Trial Day Completed",
};

function AdminShadowTeacherTab() {
  const { toast } = useToast();
  const [assignModal, setAssignModal] = useState<AdminMatchRow | null>(null);
  const [proId, setProId] = useState("");
  const [adminNotes, setAdminNotes] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [cancelling, setCancelling] = useState<number | null>(null);
  const [addingCandidateFor, setAddingCandidateFor] = useState<number | null>(null);
  const [addCandidateProId, setAddCandidateProId] = useState("");
  const [addingCandidate, setAddingCandidate] = useState(false);
  const [removingCandidate, setRemovingCandidate] = useState<number | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  const { data: rows, isLoading, refetch } = useQuery<AdminMatchRow[]>({
    queryKey: ["admin-shadow-teacher"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/shadow-teacher/requests");
      return res.json();
    },
    staleTime: 30_000,
  });

  async function handleAssign() {
    if (!assignModal || !proId.trim()) return;
    setAssigning(true);
    try {
      const res = await fetchWithAuth(`/api/shadow-teacher/${assignModal.id}/assign`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ professionalId: parseInt(proId, 10), adminNotes: adminNotes.trim() || undefined }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) { toast({ title: data.error ?? "Assignment failed", variant: "destructive" }); return; }
      toast({ title: "Shadow teacher assigned ✓" });
      setAssignModal(null);
      setProId("");
      setAdminNotes("");
      void refetch();
    } catch { toast({ title: "Network error", variant: "destructive" }); }
    finally { setAssigning(false); }
  }

  async function handleCancel(id: number) {
    setCancelling(id);
    try {
      const res = await fetchWithAuth(`/api/shadow-teacher/${id}/cancel`, { method: "PATCH" });
      const data = await res.json() as { error?: string; refundInitiated?: boolean };
      if (!res.ok) { toast({ title: data.error ?? "Cancel failed", variant: "destructive" }); return; }
      toast({ title: data.refundInitiated ? "Cancelled & refund initiated ✓" : "Cancelled ✓" });
      void refetch();
    } catch { toast({ title: "Network error", variant: "destructive" }); }
    finally { setCancelling(null); }
  }

  async function handleAddCandidate(matchId: number) {
    if (!addCandidateProId.trim()) return;
    setAddingCandidate(true);
    try {
      const res = await fetchWithAuth(`/api/shadow-teacher/${matchId}/candidates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ professionalId: parseInt(addCandidateProId, 10) }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) { toast({ title: data.error ?? "Could not add candidate", variant: "destructive" }); return; }
      toast({ title: "Candidate added ✓" });
      setAddingCandidateFor(null);
      setAddCandidateProId("");
      void refetch();
    } catch { toast({ title: "Network error", variant: "destructive" }); }
    finally { setAddingCandidate(false); }
  }

  async function handleRemoveCandidate(matchId: number, candidateId: number) {
    setRemovingCandidate(candidateId);
    try {
      const res = await fetchWithAuth(`/api/shadow-teacher/${matchId}/candidates/${candidateId}`, { method: "DELETE" });
      const data = await res.json() as { error?: string };
      if (!res.ok) { toast({ title: data.error ?? "Could not remove candidate", variant: "destructive" }); return; }
      toast({ title: "Candidate removed ✓" });
      void refetch();
    } catch { toast({ title: "Network error", variant: "destructive" }); }
    finally { setRemovingCandidate(null); }
  }

  const canAssign = (status: string) => !["cancelled", "refunded", "committed"].includes(status);
  const canCancel = (status: string) => !["cancelled", "refunded", "committed"].includes(status);

  return (
    <div className="space-y-5 max-w-6xl">
      <h2 className="text-lg font-serif font-bold text-[#1A2340]">Shadow Teacher Matching Requests</h2>

      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-16 bg-white rounded-xl animate-pulse" />)}</div>
      ) : !rows?.length ? (
        <div className="bg-white rounded-xl p-10 text-center shadow-sm">
          <p className="text-gray-400 text-sm">No shadow teacher match requests yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(rows ?? []).map((m) => {
            const activeCandidates = (m.candidates ?? []).filter((c) => !c.removedAt);
            const isExpanded = expandedRows.has(m.id);
            return (
              <div key={m.id} className="bg-white rounded-xl shadow-[0_2px_12px_rgba(26,35,64,0.07)] overflow-hidden">
                {/* Main row */}
                <div className="flex items-start gap-4 px-5 py-4">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-[#1A2340] text-sm">{m.parentName ?? "—"}</p>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${MATCH_STATUS_COLORS[m.status] ?? "bg-gray-50 text-gray-600 border-gray-200"}`}>
                        {MATCH_STATUS_LABELS[m.status] ?? m.status.replace(/_/g, " ")}
                      </span>
                      <span className="text-[10px] text-gray-400">#{m.id}</span>
                    </div>
                    <p className="text-xs text-gray-400">{m.parentEmail ?? ""}</p>
                    <div className="flex flex-wrap gap-3 text-[11px] text-gray-500 mt-1">
                      {m.childCity && <span>📍 {m.childCity}</span>}
                      {m.childConditions?.length ? <span>🏥 {m.childConditions.join(", ")}</span> : null}
                      {(m.childBudgetMinInr || m.childBudgetMaxInr) && (
                        <span>💰 ₹{m.childBudgetMinInr?.toLocaleString("en-IN") ?? "?"} – ₹{m.childBudgetMaxInr?.toLocaleString("en-IN") ?? "?"}/mo</span>
                      )}
                      {m.matchedProName && <span className="text-green-600 font-medium">✓ {m.matchedProName}</span>}
                    </div>
                    {m.extraNotes && <p className="text-[11px] text-gray-400 italic mt-1">"{m.extraNotes}"</p>}
                    {m.adminNotes && <p className="text-[11px] text-purple-600 mt-1">Admin: {m.adminNotes}</p>}
                  </div>

                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <p className="text-[10px] text-gray-400">{new Date(m.createdAt).toLocaleDateString("en-IN")}</p>
                    <div className="flex gap-1.5 flex-wrap justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-[10px] h-6 px-2 text-gray-500"
                        onClick={() => setExpandedRows((prev) => {
                          const next = new Set(prev);
                          if (next.has(m.id)) next.delete(m.id); else next.add(m.id);
                          return next;
                        })}
                      >
                        {isExpanded ? "Hide" : `Candidates (${activeCandidates.length})`}
                      </Button>
                      {canAssign(m.status) && (
                        <Button
                          size="sm"
                          className="bg-[#2EC4A5] hover:bg-[#26a88d] text-white text-[10px] h-6 px-2"
                          onClick={() => { setAssignModal(m); setProId(""); setAdminNotes(""); }}
                        >
                          Assign
                        </Button>
                      )}
                      {canCancel(m.status) && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-[10px] h-6 px-2 border-red-200 text-red-600 hover:bg-red-50"
                          disabled={cancelling === m.id}
                          onClick={() => void handleCancel(m.id)}
                        >
                          {cancelling === m.id ? <Loader2 size={10} className="animate-spin" /> : "Cancel"}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Expanded: Trial payment section */}
                {isExpanded && m.trialFeePaidInr != null && (
                  <div className="border-t border-orange-100 px-5 py-4 bg-orange-50/40 space-y-3">
                    <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide">Trial Day Payment</p>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[11px]">
                      <div>
                        <p className="text-gray-400 mb-0.5">Status</p>
                        <span className={`inline-block px-2 py-0.5 rounded-full border font-medium text-[10px] ${MATCH_STATUS_COLORS[m.status] ?? "bg-gray-50 text-gray-600 border-gray-200"}`}>
                          {MATCH_STATUS_LABELS[m.status] ?? m.status.replace(/_/g, " ")}
                        </span>
                      </div>
                      <div>
                        <p className="text-gray-400 mb-0.5">Trial Fee Paid</p>
                        <p className="font-semibold text-[#1A2340]">₹{m.trialFeePaidInr.toLocaleString("en-IN")}</p>
                      </div>
                      {m.trialProviderPaymentId && (
                        <div className="col-span-2">
                          <p className="text-gray-400 mb-0.5">Razorpay Payment ID</p>
                          <p className="font-mono text-[10px] text-gray-700 break-all">{m.trialProviderPaymentId}</p>
                        </div>
                      )}
                      <div>
                        <p className="text-gray-400 mb-0.5">Trial Credit Applied</p>
                        {m.trialCreditApplied == null ? (
                          <p className="text-gray-400 italic">No engagement yet</p>
                        ) : m.trialCreditApplied ? (
                          <p className="text-green-600 font-medium">✓ Applied to first month</p>
                        ) : (
                          <p className="text-orange-600">Pending application</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Expanded: Candidates section */}
                {isExpanded && (
                  <div className="border-t border-gray-100 px-5 py-4 bg-gray-50/50 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Shortlisted Candidates</p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-[10px] h-6 px-2 text-[#2EC4A5] border-[#2EC4A5]"
                        onClick={() => setAddingCandidateFor(m.id === addingCandidateFor ? null : m.id)}
                      >
                        + Add
                      </Button>
                    </div>

                    {addingCandidateFor === m.id && (
                      <div className="flex gap-2 items-end">
                        <div className="flex-1">
                          <Label className="text-[10px] text-gray-500 mb-1 block">Professional profile ID</Label>
                          <Input
                            type="number"
                            placeholder="e.g. 42"
                            value={addCandidateProId}
                            onChange={(e) => setAddCandidateProId(e.target.value)}
                            className="h-7 text-xs focus-visible:ring-[#2EC4A5]"
                          />
                        </div>
                        <Button
                          size="sm"
                          className="bg-[#2EC4A5] hover:bg-[#26a88d] text-white h-7 text-xs"
                          disabled={addingCandidate || !addCandidateProId.trim()}
                          onClick={() => void handleAddCandidate(m.id)}
                        >
                          {addingCandidate ? <Loader2 size={11} className="animate-spin" /> : "Add"}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-gray-400" onClick={() => setAddingCandidateFor(null)}>✕</Button>
                      </div>
                    )}

                    {activeCandidates.length === 0 ? (
                      <p className="text-xs text-gray-400">No candidates yet. Use "+ Add" to shortlist a teacher manually.</p>
                    ) : (
                      <div className="space-y-2">
                        {activeCandidates.map((c) => (
                          <div key={c.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-gray-100">
                            <div>
                              <p className="text-xs font-medium text-[#1A2340]">{c.proName ?? `Pro #${c.professionalId}`}</p>
                              <p className="text-[10px] text-gray-400">
                                Rank #{c.rank} · {c.score != null ? `${Math.round(c.score)}/100` : "no score"} · {c.addedBy === "admin" ? "Admin pick" : "Auto-matched"}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-[10px] h-6 px-2 text-red-500 hover:bg-red-50"
                              disabled={removingCandidate === c.id}
                              onClick={() => void handleRemoveCandidate(m.id, c.id)}
                            >
                              {removingCandidate === c.id ? <Loader2 size={10} className="animate-spin" /> : "Remove"}
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Assign modal */}
      <Dialog open={!!assignModal} onOpenChange={() => setAssignModal(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-serif text-[#1A2340]">Assign Shadow Teacher</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div>
              <p className="text-xs text-gray-500 mb-1">Parent</p>
              <p className="text-sm font-medium text-[#1A2340]">{assignModal?.parentName}</p>
            </div>
            {assignModal?.childCity && (
              <div>
                <p className="text-xs text-gray-500 mb-1">City · Budget</p>
                <p className="text-sm text-gray-600">
                  {assignModal.childCity}
                  {(assignModal.childBudgetMinInr || assignModal.childBudgetMaxInr) && ` · ₹${assignModal.childBudgetMinInr?.toLocaleString("en-IN")}–${assignModal.childBudgetMaxInr?.toLocaleString("en-IN")}/mo`}
                </p>
              </div>
            )}
            <div>
              <Label className="text-xs text-gray-600 mb-1 block">Professional ID</Label>
              <Input
                type="number"
                placeholder="Enter professional profile ID"
                value={proId}
                onChange={(e) => setProId(e.target.value)}
                className="focus-visible:ring-[#2EC4A5]"
              />
              <p className="text-[10px] text-gray-400 mt-1">Find the ID in the Professionals tab.</p>
            </div>
            <div>
              <Label className="text-xs text-gray-600 mb-1 block">Admin notes (optional)</Label>
              <Textarea
                placeholder="Why this match was made, any extra context…"
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                rows={2}
                className="resize-none text-sm focus-visible:ring-[#2EC4A5]"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setAssignModal(null)}>Cancel</Button>
            <Button
              className="bg-[#2EC4A5] hover:bg-[#26a88d]"
              disabled={assigning || !proId.trim()}
              onClick={() => void handleAssign()}
            >
              {assigning ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
              Assign Professional
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── AdminCentresTab ──────────────────────────────────────────────────────────

interface AdminCentreRow {
  id: number;
  name: string;
  city: string | null;
  state: string | null;
  status: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  description: string | null;
  therapyTypesOffered: string | null;
  registrationNumbers: string | null;
  yearsInOperation: number | null;
  verificationNotes: string | null;
  rejectedReason: string | null;
  createdAt: string;
}

interface AdminCentreService {
  id: number;
  name: string;
  serviceType: string;
  durationMinutes: number;
  mode: string;
  currentPriceInr: number | null;
}

type CentresSubTab = "queue" | "all" | "pricing";

function AdminCentresTab() {
  const { toast } = useToast();
  const [subTab, setSubTab] = useState<CentresSubTab>("queue");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedCentre, setSelectedCentre] = useState<AdminCentreRow | null>(null);
  const [verifyModal, setVerifyModal] = useState<{ centre: AdminCentreRow; action: "verify" | "reject" } | null>(null);
  const [pricingCentre, setPricingCentre] = useState<AdminCentreRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [verifyNotes, setVerifyNotes] = useState("");
  const [acting, setActing] = useState(false);

  const { data: centres = [], isLoading, refetch } = useQuery<AdminCentreRow[]>({
    queryKey: ["admin-centres", statusFilter],
    queryFn: async () => {
      const params = statusFilter !== "all" ? `?status=${statusFilter}` : "";
      const r = await fetchWithAuth(`/api/admin/centres${params}`);
      return r.ok ? r.json() : [];
    },
  });

  const filtered = centres.filter((c) =>
    !searchQuery || c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (c.city ?? "").toLowerCase().includes(searchQuery.toLowerCase())
  );

  const queue = centres.filter((c) => c.status === "submitted");

  async function handleVerify(centre: AdminCentreRow, action: "verify" | "reject") {
    setActing(true);
    try {
      const body: Record<string, string> = {};
      if (action === "verify") body.notes = verifyNotes;
      if (action === "reject") body.reason = rejectReason;
      const r = await fetchWithAuth(`/api/admin/centres/${centre.id}/verify`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body }),
      });
      if (!r.ok) throw new Error();
      toast({ title: action === "verify" ? "Centre verified ✓" : "Centre rejected" });
      setVerifyModal(null);
      setRejectReason(""); setVerifyNotes("");
      refetch();
    } catch {
      toast({ title: "Action failed", variant: "destructive" });
    } finally {
      setActing(false);
    }
  }

  const STATUS_COLORS: Record<string, string> = {
    draft: "bg-gray-100 text-gray-600",
    submitted: "bg-yellow-50 text-yellow-700",
    verified: "bg-blue-50 text-blue-700",
    live: "bg-teal-50 text-teal-700",
    rejected: "bg-red-50 text-red-700",
    suspended: "bg-orange-50 text-orange-700",
  };

  const SUB_TABS: { id: CentresSubTab; label: string }[] = [
    { id: "queue", label: `Verification Queue${queue.length > 0 ? ` (${queue.length})` : ""}` },
    { id: "all", label: "All Centres" },
    { id: "pricing", label: "Set Prices" },
  ];

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-serif font-bold text-[#1A2340]">Therapy Centres</h2>
          <p className="text-xs text-gray-400 mt-0.5">Verify centres and manage service prices.</p>
        </div>
      </div>

      {/* Sub-tab switcher */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {SUB_TABS.map((t) => (
          <button key={t.id} onClick={() => setSubTab(t.id)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${subTab === t.id ? "bg-white text-[#1A2340] shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Verification Queue */}
      {subTab === "queue" && (
        <div className="space-y-3">
          {queue.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-12 text-center text-gray-400">
              <CheckCircle size={36} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">No centres pending review.</p>
            </div>
          ) : (
            queue.map((centre) => (
              <CentreCard key={centre.id} centre={centre} statusColors={STATUS_COLORS}
                onVerify={() => { setVerifyModal({ centre, action: "verify" }); setVerifyNotes(""); }}
                onReject={() => { setVerifyModal({ centre, action: "reject" }); setRejectReason(""); }}
                onPricing={() => setPricingCentre(centre)}
              />
            ))
          )}
        </div>
      )}

      {/* All Centres */}
      {subTab === "all" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Search by name or city..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2EC4A5]"
            />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2EC4A5]">
              <option value="all">All statuses</option>
              <option value="draft">Draft</option>
              <option value="submitted">Submitted</option>
              <option value="verified">Verified</option>
              <option value="live">Live</option>
              <option value="rejected">Rejected</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="animate-spin text-teal-500" size={24} /></div>
          ) : filtered.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-12 text-center text-gray-400">
              <Building2 size={36} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">No centres found.</p>
            </div>
          ) : (
            filtered.map((centre) => (
              <CentreCard key={centre.id} centre={centre} statusColors={STATUS_COLORS}
                onVerify={() => { setVerifyModal({ centre, action: "verify" }); setVerifyNotes(""); }}
                onReject={() => { setVerifyModal({ centre, action: "reject" }); setRejectReason(""); }}
                onPricing={() => setPricingCentre(centre)}
              />
            ))
          )}
        </div>
      )}

      {/* Pricing tab — pick centre then set prices */}
      {subTab === "pricing" && (
        <div className="space-y-4">
          {!pricingCentre ? (
            <>
              <p className="text-sm text-gray-500">Select a verified centre to manage prices.</p>
              <div className="space-y-3">
                {centres.filter((c) => c.status === "verified" || c.status === "live").map((centre) => (
                  <button key={centre.id} onClick={() => setPricingCentre(centre)}
                    className="w-full text-left bg-white rounded-2xl border border-gray-100 p-4 shadow-sm hover:border-teal-300 transition-colors flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-[#1A2340]">{centre.name}</p>
                      {centre.city && <p className="text-xs text-gray-400">{centre.city}{centre.state ? `, ${centre.state}` : ""}</p>}
                    </div>
                    <ChevronRight size={16} className="text-gray-400" />
                  </button>
                ))}
                {centres.filter((c) => c.status === "verified" || c.status === "live").length === 0 && (
                  <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-12 text-center text-gray-400">
                    <Package size={36} className="mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No verified centres yet.</p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <CentrePricingPanel centre={pricingCentre} onBack={() => setPricingCentre(null)} />
          )}
        </div>
      )}

      {/* Verify / Reject modal */}
      <Dialog open={!!verifyModal} onOpenChange={(o) => { if (!o) setVerifyModal(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-serif">
              {verifyModal?.action === "verify" ? "Verify Centre" : "Reject Centre"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-sm text-gray-600">
              {verifyModal?.action === "verify"
                ? `Verify "${verifyModal.centre.name}"? This will notify the centre admin.`
                : `Reject "${verifyModal?.centre.name}"? Please provide a reason.`}
            </p>
            {verifyModal?.action === "verify" && (
              <div>
                <Label className="text-xs">Internal notes (optional)</Label>
                <Textarea value={verifyNotes} onChange={(e) => setVerifyNotes(e.target.value)} placeholder="e.g. Documents verified, MSME cert on file..." className="mt-1 min-h-[70px] text-sm" />
              </div>
            )}
            {verifyModal?.action === "reject" && (
              <div>
                <Label className="text-xs">Rejection reason <span className="text-red-500">*</span></Label>
                <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="e.g. Registration documents not uploaded..." className="mt-1 min-h-[70px] text-sm" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setVerifyModal(null)}>Cancel</Button>
            <Button
              onClick={() => verifyModal && handleVerify(verifyModal.centre, verifyModal.action)}
              disabled={acting || (verifyModal?.action === "reject" && !rejectReason.trim())}
              className={verifyModal?.action === "verify" ? "bg-teal-600 hover:bg-teal-700 text-white" : "bg-red-500 hover:bg-red-600 text-white"}
            >
              {acting ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
              {verifyModal?.action === "verify" ? "Verify" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CentreCard({ centre, statusColors, onVerify, onReject, onPricing }: {
  centre: AdminCentreRow;
  statusColors: Record<string, string>;
  onVerify: () => void;
  onReject: () => void;
  onPricing: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
      <div className="p-4 flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-teal-50 border border-teal-100 flex items-center justify-center shrink-0">
          <Building2 size={18} className="text-teal-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2 flex-wrap">
            <p className="font-semibold text-[#1A2340]">{centre.name}</p>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[centre.status] ?? "bg-gray-100 text-gray-500"}`}>
              {centre.status}
            </span>
          </div>
          {centre.city && <p className="text-xs text-gray-400 mt-0.5">{centre.city}{centre.state ? `, ${centre.state}` : ""}</p>}
          {centre.therapyTypesOffered && <p className="text-xs text-teal-600 mt-0.5 truncate">{centre.therapyTypesOffered}</p>}
          <p className="text-xs text-gray-400 mt-0.5">Submitted {new Date(centre.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          {centre.status === "submitted" && (
            <>
              <Button size="sm" onClick={onVerify} className="text-xs h-7 bg-teal-600 hover:bg-teal-700 text-white gap-1">
                <Check size={11} /> Verify
              </Button>
              <Button size="sm" variant="outline" onClick={onReject} className="text-xs h-7 text-red-500 border-red-200 hover:bg-red-50 gap-1">
                <XCircle size={11} /> Reject
              </Button>
            </>
          )}
          {(centre.status === "verified" || centre.status === "live") && (
            <Button size="sm" variant="outline" onClick={onPricing} className="text-xs h-7 gap-1 border-teal-200 text-teal-700 hover:bg-teal-50">
              <Edit2 size={11} /> Prices
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setExpanded(!expanded)} className="text-xs h-7 px-2">
            {expanded ? <XCircle size={13} className="text-gray-400" /> : <Eye size={13} className="text-gray-400" />}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-50 pt-3 space-y-2">
          {centre.description && <p className="text-sm text-gray-600 leading-relaxed">{centre.description}</p>}
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
            {centre.phone && <div className="text-gray-500"><span className="font-medium">Phone: </span>{centre.phone}</div>}
            {centre.email && <div className="text-gray-500"><span className="font-medium">Email: </span>{centre.email}</div>}
            {centre.website && <div className="text-gray-500"><span className="font-medium">Web: </span>{centre.website}</div>}
            {centre.registrationNumbers && <div className="text-gray-500"><span className="font-medium">Reg No: </span>{centre.registrationNumbers}</div>}
            {centre.yearsInOperation != null && <div className="text-gray-500"><span className="font-medium">Years: </span>{centre.yearsInOperation}</div>}
          </div>
          {centre.verificationNotes && (
            <div className="text-xs text-blue-700 bg-blue-50 rounded-lg px-3 py-2">
              <span className="font-medium">Notes: </span>{centre.verificationNotes}
            </div>
          )}
          {centre.rejectedReason && (
            <div className="text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2">
              <span className="font-medium">Rejection reason: </span>{centre.rejectedReason}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CentrePricingPanel({ centre, onBack }: { centre: AdminCentreRow; onBack: () => void }) {
  const { toast } = useToast();
  const [services, setServices] = useState<AdminCentreService[]>([]);
  const [loading, setLoading] = useState(true);
  const [prices, setPrices] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchWithAuth(`/api/admin/centres/${centre.id}/services`)
      .then(r => r.ok ? r.json() : [])
      .then((data: AdminCentreService[]) => {
        setServices(data);
        const init: Record<number, string> = {};
        data.forEach((s: AdminCentreService) => { init[s.id] = s.currentPriceInr?.toString() ?? ""; });
        setPrices(init);
      })
      .finally(() => setLoading(false));
  }, [centre.id]);

  async function handleSetPrice(serviceId: number) {
    const val = prices[serviceId];
    if (!val || isNaN(Number(val))) return;
    setSaving(serviceId);
    try {
      const r = await fetchWithAuth(`/api/admin/centres/${centre.id}/service-prices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId, priceInr: Number(val), effectiveFrom: new Date().toISOString() }),
      });
      if (!r.ok) throw new Error();
      toast({ title: "Price set ✓" });
      setServices(prev => prev.map(s => s.id === serviceId ? { ...s, currentPriceInr: Number(val) } : s));
    } catch {
      toast({ title: "Failed to set price", variant: "destructive" });
    } finally {
      setSaving(null);
    }
  }

  const MODE_LABELS: Record<string, string> = { in_centre: "In-Centre", home_visit: "Home Visit", online: "Online" };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1 text-gray-500 hover:text-gray-800">
          <ChevronRight size={14} className="rotate-180" /> Back
        </Button>
        <div>
          <h3 className="font-semibold text-[#1A2340]">{centre.name}</h3>
          <p className="text-xs text-gray-400">Set service prices</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="animate-spin text-teal-500" size={22} /></div>
      ) : services.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-10 text-center text-gray-400">
          <Package size={32} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">This centre has no services defined yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {services.map((s) => (
            <div key={s.id} className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-[#1A2340] text-sm">{s.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">{s.serviceType} · {s.durationMinutes} min · {MODE_LABELS[s.mode] ?? s.mode}</p>
                {s.currentPriceInr && (
                  <p className="text-xs text-teal-600 font-medium mt-0.5">Current: ₹{s.currentPriceInr.toLocaleString("en-IN")}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">₹</span>
                  <input
                    type="number"
                    min={0}
                    value={prices[s.id] ?? ""}
                    onChange={(e) => setPrices(p => ({ ...p, [s.id]: e.target.value }))}
                    placeholder="0"
                    className="w-28 pl-7 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-400"
                  />
                </div>
                <Button size="sm" onClick={() => handleSetPrice(s.id)}
                  disabled={saving === s.id || !prices[s.id] || isNaN(Number(prices[s.id]))}
                  className="bg-teal-600 hover:bg-teal-700 text-white text-xs h-8 gap-1">
                  {saving === s.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                  Set
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
