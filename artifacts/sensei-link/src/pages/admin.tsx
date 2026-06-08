import { useState } from "react";
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
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

type SidebarTab = "overview" | "professionals" | "verifications" | "parents" | "payments" | "settings" | "commissions" | "moderation";

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
    { id: "payments", label: "Payments", icon: <CreditCard size={18} /> },
    { id: "moderation", label: "Moderation", icon: <Flag size={18} /> },
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
          {activeTab === "payments" && <PaymentsTab />}
          {activeTab === "moderation" && <ModerationTab />}
          {activeTab === "settings" && <SettingsTab />}
          {activeTab === "commissions" && <CommissionRatesTab />}
        </div>
      </div>
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

  const { data, isLoading } = useAdminListProfessionals(
    { status: statusFilter as "pending" | "verified" | "rejected" | "unsubmitted" | undefined, page, limit: 20 },
    { query: { queryKey: getAdminListProfessionalsQueryKey({ status: statusFilter as "pending" | "verified" | "rejected" | "unsubmitted" | undefined, page, limit: 20 }) } },
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
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell text-gray-500 text-xs">
                      {getSpecialtyLabel(prof.specialty as Parameters<typeof getSpecialtyLabel>[0])}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-gray-400 text-xs">
                      {[prof.city, prof.country].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[prof.verificationStatus] ?? STATUS_COLORS.unsubmitted}`}>
                        {prof.verificationStatus}
                      </span>
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
                          className="text-xs h-7 bg-[#1A2340] hover:bg-[#2a3660] focus-visible:ring-2 focus-visible:ring-[#2EC4A5]"
                          aria-label={`Review ${prof.fullName ?? prof.userName}`}
                        >
                          <Eye size={12} className="mr-1" />
                          Review
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
              </div>
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
                <Button
                  className="gap-1 bg-green-600 hover:bg-green-700 focus-visible:ring-2 focus-visible:ring-green-500"
                  onClick={() => handleApprove(reviewProf.id)}
                  disabled={isRejecting || isApproving}
                  aria-label="Approve application"
                >
                  {isApproving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} />}
                  Approve
                </Button>
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
  const [isSaving, setIsSaving] = useState(false);
  const [synced, setSynced] = useState(false);

  if (settings && !synced) {
    setContactLimit(settings.contactLimitPerParent ?? 5);
    setUnlockPrice(settings.contactUnlockPriceInr ?? 0);
    setCommissionPct(settings.platformCommissionPct ?? 0);
    setMonetisationEnabled(settings.monetisationEnabled ?? false);
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
        },
      });
      queryClient.invalidateQueries({ queryKey: getGetAdminSettingsQueryKey() });
      toast({ title: "Settings saved ✓" });
    } catch {
      toast({ title: "Failed to save settings", variant: "destructive" });
    } finally { setIsSaving(false); }
  }

  function handleToggleMonetisation() {
    if (!monetisationEnabled) {
      setShowMonetisationModal(true);
    } else {
      setMonetisationEnabled(false);
    }
  }

  function handleConfirmEnableMonetisation() {
    setMonetisationEnabled(true);
    setShowMonetisationModal(false);
  }

  if (isLoading) {
    return <div className="space-y-4">{[1,2,3].map(i => <div key={i} className="h-12 bg-white rounded-xl animate-pulse shadow-sm" />)}</div>;
  }

  return (
    <>
      <div className="max-w-lg space-y-6">
        {monetisationEnabled ? (
          <div className="flex items-start gap-3 p-4 bg-green-50 border border-green-200 rounded-xl">
            <IndianRupee size={18} className="text-green-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-green-800">Monetisation is active</p>
              <p className="text-xs text-green-600 mt-0.5">
                Parents are charged ₹{Number(unlockPrice) || 0} per contact unlock. Platform commission: {Number(commissionPct) || 0}%.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3 p-4 bg-[#FFB830]/10 border border-[#FFB830]/30 rounded-xl">
            <TrendingUp size={18} className="text-[#FFB830] mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-[#1A2340]">Platform is currently free</p>
              <p className="text-xs text-gray-500 mt-0.5">All contact unlocks are free. Enable monetisation below to charge parents per unlock via Razorpay.</p>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl p-6 shadow-[0_4px_24px_rgba(26,35,64,0.08)] space-y-5">
          <div>
            <Label htmlFor="contact-limit" className="text-sm font-semibold text-[#1A2340]">Contact Unlocks Per Parent</Label>
            <p className="text-xs text-gray-400 mb-2">Maximum number of professionals a parent can unlock contact details for.</p>
            <Input
              id="contact-limit"
              type="number"
              min={1}
              max={1000}
              value={contactLimit}
              onChange={(e) => setContactLimit(e.target.value === "" ? "" : Number(e.target.value))}
              className="rounded-lg focus-visible:ring-[#2EC4A5]"
              aria-label="Contact unlock limit per parent"
            />
          </div>

          <hr className="border-gray-100" />

          <div>
            <p className="text-sm font-semibold text-[#1A2340] mb-0.5">Monetisation</p>
            <p className="text-xs text-gray-400 mb-4">Control whether parents are charged for contact unlocks.</p>

            <div className="flex items-center justify-between p-3 rounded-xl border border-gray-100 bg-gray-50 mb-4">
              <div>
                <p className="text-sm font-medium text-[#1A2340]">Enable paid contact unlocks</p>
                <p className="text-xs text-gray-400">Charge parents each time they unlock a professional's contact details.</p>
              </div>
              <button
                type="button"
                onClick={handleToggleMonetisation}
                aria-label={monetisationEnabled ? "Disable monetisation" : "Enable monetisation"}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2EC4A5] focus-visible:ring-offset-2 ${monetisationEnabled ? "bg-[#2EC4A5]" : "bg-gray-200"}`}
              >
                <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition-transform ${monetisationEnabled ? "translate-x-5" : "translate-x-0"}`} />
              </button>
            </div>

            <div className={`space-y-4 transition-opacity duration-200 ${monetisationEnabled ? "opacity-100" : "opacity-40 pointer-events-none"}`}>
              <div>
                <Label htmlFor="unlock-price" className="text-sm font-semibold text-[#1A2340]">Contact Unlock Price (₹)</Label>
                <p className="text-xs text-gray-400 mb-2">Amount charged to parents per contact unlock.</p>
                <Input
                  id="unlock-price"
                  type="number"
                  min={0}
                  max={10000}
                  value={unlockPrice}
                  onChange={(e) => setUnlockPrice(e.target.value === "" ? "" : Number(e.target.value))}
                  className="rounded-lg focus-visible:ring-[#2EC4A5]"
                  aria-label="Contact unlock price in rupees"
                  disabled={!monetisationEnabled}
                />
              </div>
              <div>
                <Label htmlFor="commission-pct" className="text-sm font-semibold text-[#1A2340]">Platform Commission (%)</Label>
                <p className="text-xs text-gray-400 mb-2">Percentage of each unlock payment retained by Includly.</p>
                <Input
                  id="commission-pct"
                  type="number"
                  min={0}
                  max={100}
                  value={commissionPct}
                  onChange={(e) => setCommissionPct(e.target.value === "" ? "" : Number(e.target.value))}
                  className="rounded-lg focus-visible:ring-[#2EC4A5]"
                  aria-label="Platform commission percentage"
                  disabled={!monetisationEnabled}
                />
              </div>
            </div>
          </div>

          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="w-full bg-[#2EC4A5] hover:bg-[#26a88d] text-white focus-visible:ring-2 focus-visible:ring-[#2EC4A5]"
            aria-label="Save settings"
          >
            {isSaving ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
            Save Settings
          </Button>
        </div>
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
            <Button variant="ghost" onClick={() => setShowMonetisationModal(false)} aria-label="Cancel">Cancel</Button>
            <Button
              className="bg-[#2EC4A5] hover:bg-[#26a88d] focus-visible:ring-2 focus-visible:ring-[#2EC4A5]"
              onClick={handleConfirmEnableMonetisation}
              aria-label="Confirm enable monetisation"
            >
              Enable Monetisation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
