import { useState } from "react";
import { useLocation } from "wouter";
import { useUser } from "@clerk/react";
import {
  useGetMe,
  useAdminListProfessionals,
  useAdminGetStats,
  useGetAdminSettings,
  useAdminApproveProfessional,
  useAdminRejectProfessional,
  useUpdateAdminSettings,
  getAdminListProfessionalsQueryKey,
  getAdminGetStatsQueryKey,
  getGetAdminSettingsQueryKey,
  type AdminProfessionalRow,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { getSpecialtyLabel } from "@/lib/specialties";
import {
  Loader2,
  Users,
  BarChart3,
  Settings,
  CheckCircle,
  XCircle,
  Clock,
  ShieldAlert,
  UserCheck,
  UserX,
  TrendingUp,
  Phone,
} from "lucide-react";

type TabId = "professionals" | "stats" | "settings";

export default function AdminPage() {
  const [, setLocation] = useLocation();
  const { isLoaded: clerkLoaded } = useUser();
  const { data: me, isLoading: meLoading } = useGetMe();
  const [activeTab, setActiveTab] = useState<TabId>("professionals");

  if (!clerkLoaded || meLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-primary" size={28} />
      </div>
    );
  }

  if (me?.role !== "admin") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center max-w-sm">
          <ShieldAlert className="mx-auto mb-4 text-destructive" size={48} />
          <h1 className="text-2xl font-serif font-semibold mb-2">Access Denied</h1>
          <p className="text-muted-foreground mb-6">
            This page is restricted to administrators only.
          </p>
          <Button onClick={() => setLocation("/dashboard")}>Go to Dashboard</Button>
        </div>
      </div>
    );
  }

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: "professionals", label: "Professionals", icon: <Users size={16} /> },
    { id: "stats", label: "Platform Stats", icon: <BarChart3 size={16} /> },
    { id: "settings", label: "Settings", icon: <Settings size={16} /> },
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-serif font-semibold text-foreground flex items-center gap-2">
            <ShieldAlert size={24} className="text-primary" />
            Admin Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage onboarding approvals, view platform stats, and configure settings.
          </p>
        </div>

        <div className="flex gap-1 mb-6 border-b border-border">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                activeTab === tab.id
                  ? "bg-background border border-b-background border-border text-foreground -mb-px"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "professionals" && <ProfessionalsTab />}
        {activeTab === "stats" && <StatsTab />}
        {activeTab === "settings" && <SettingsTab />}
      </div>
    </div>
  );
}

function ProfessionalsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useAdminListProfessionals(
    { status: statusFilter as "pending" | "verified" | "rejected" | "unsubmitted" | undefined, page, limit: 20 },
    { query: { queryKey: getAdminListProfessionalsQueryKey({ status: statusFilter as "pending" | "verified" | "rejected" | "unsubmitted" | undefined, page, limit: 20 }) } },
  );

  const { mutateAsync: approve, isPending: approving } = useAdminApproveProfessional();
  const { mutateAsync: reject, isPending: rejecting } = useAdminRejectProfessional();

  async function handleApprove(id: number) {
    try {
      await approve({ id });
      queryClient.invalidateQueries({ queryKey: ["adminListProfessionals"] });
      queryClient.invalidateQueries({ queryKey: getAdminGetStatsQueryKey() });
      toast({ title: "Approved", description: "Professional has been approved and verified." });
    } catch {
      toast({ title: "Error", description: "Failed to approve professional.", variant: "destructive" });
    }
  }

  async function handleReject(id: number) {
    try {
      await reject({ id });
      queryClient.invalidateQueries({ queryKey: ["adminListProfessionals"] });
      queryClient.invalidateQueries({ queryKey: getAdminGetStatsQueryKey() });
      toast({ title: "Rejected", description: "Professional application has been rejected." });
    } catch {
      toast({ title: "Error", description: "Failed to reject professional.", variant: "destructive" });
    }
  }

  const statuses = [
    { value: "pending", label: "Pending" },
    { value: "verified", label: "Approved" },
    { value: "rejected", label: "Rejected" },
    { value: "unsubmitted", label: "Unsubmitted" },
    { value: "", label: "All" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {statuses.map((s) => (
          <Button
            key={s.value}
            variant={statusFilter === s.value ? "default" : "outline"}
            size="sm"
            onClick={() => { setStatusFilter(s.value); setPage(1); }}
          >
            {s.label}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-primary" size={28} />
        </div>
      ) : (
        <>
          <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Professional</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Specialty</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Location</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Joined</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(!data?.professionals || data.professionals.length === 0) ? (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-muted-foreground">
                      No professionals found.
                    </td>
                  </tr>
                ) : (
                  data.professionals.map((prof: AdminProfessionalRow) => (
                    <tr key={prof.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium">{prof.fullName ?? prof.userName ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">{prof.userEmail ?? "—"}</p>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <span className="text-muted-foreground">{getSpecialtyLabel(prof.specialty as Parameters<typeof getSpecialtyLabel>[0])}</span>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className="text-muted-foreground">{[prof.city, prof.country].filter(Boolean).join(", ") || "—"}</span>
                      </td>
                      <td className="px-4 py-3">
                        <VerificationBadge status={prof.verificationStatus} />
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className="text-muted-foreground text-xs">
                          {new Date(prof.createdAt).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" })}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {prof.verificationStatus !== "verified" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1 text-green-700 border-green-300 hover:bg-green-50 mr-1"
                            onClick={() => handleApprove(prof.id)}
                            disabled={approving || rejecting}
                            data-testid={`approve-btn-${prof.id}`}
                          >
                            <CheckCircle size={13} />
                            Approve
                          </Button>
                        )}
                        {prof.verificationStatus !== "rejected" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1 text-red-700 border-red-300 hover:bg-red-50"
                            onClick={() => handleReject(prof.id)}
                            disabled={approving || rejecting}
                            data-testid={`reject-btn-${prof.id}`}
                          >
                            <XCircle size={13} />
                            Reject
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {data && data.total > data.limit && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {((page - 1) * data.limit) + 1}–{Math.min(page * data.limit, data.total)} of {data.total}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page * data.limit >= data.total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function VerificationBadge({ status }: { status: string }) {
  if (status === "verified") {
    return (
      <Badge className="bg-green-100 text-green-700 border-green-300 gap-1">
        <UserCheck size={11} /> Approved
      </Badge>
    );
  }
  if (status === "pending") {
    return (
      <Badge variant="outline" className="gap-1 text-yellow-700 border-yellow-300 bg-yellow-50">
        <Clock size={11} /> Pending
      </Badge>
    );
  }
  if (status === "rejected") {
    return (
      <Badge variant="outline" className="gap-1 text-red-700 border-red-300 bg-red-50">
        <UserX size={11} /> Rejected
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1">
      <Clock size={11} /> Unsubmitted
    </Badge>
  );
}

function StatsTab() {
  const { data: stats, isLoading } = useAdminGetStats({
    query: { queryKey: getAdminGetStatsQueryKey() },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-primary" size={28} />
      </div>
    );
  }

  const cards = [
    { label: "Total Users", value: stats?.totalUsers ?? 0, icon: <Users size={20} className="text-primary" /> },
    { label: "Total Professionals", value: stats?.totalProfessionals ?? 0, icon: <UserCheck size={20} className="text-blue-600" /> },
    { label: "Total Parents", value: stats?.totalParents ?? 0, icon: <Users size={20} className="text-green-600" /> },
    { label: "Unlocks This Month", value: stats?.totalUnlocksThisMonth ?? 0, icon: <Phone size={20} className="text-accent" /> },
    { label: "Pending Review", value: stats?.pendingProfessionals ?? 0, icon: <Clock size={20} className="text-yellow-600" /> },
    { label: "Verified Professionals", value: stats?.verifiedProfessionals ?? 0, icon: <TrendingUp size={20} className="text-green-600" /> },
    { label: "Rejected Applications", value: stats?.rejectedProfessionals ?? 0, icon: <XCircle size={20} className="text-red-500" /> },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {cards.map((card) => (
        <div key={card.label} className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            {card.icon}
            <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{card.label}</span>
          </div>
          <div className="text-3xl font-bold text-foreground">{card.value.toLocaleString()}</div>
        </div>
      ))}
    </div>
  );
}

function SettingsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useGetAdminSettings({
    query: { queryKey: getGetAdminSettingsQueryKey() },
  });
  const { mutateAsync: updateSettings, isPending: saving } = useUpdateAdminSettings();

  const [contactLimit, setContactLimit] = useState<number | null>(null);

  const currentLimit = contactLimit ?? settings?.contactLimitPerParent ?? 5;

  async function handleSave() {
    try {
      await updateSettings({ data: { contactLimitPerParent: currentLimit } });
      queryClient.invalidateQueries({ queryKey: getGetAdminSettingsQueryKey() });
      toast({ title: "Settings saved", description: "Contact unlock limit has been updated." });
    } catch {
      toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" });
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-primary" size={28} />
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-6">
      <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
        <h2 className="font-semibold text-foreground mb-1">Contact Unlock Limit</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Maximum number of professional contacts a parent can unlock per month (free plan). Set to 0 for unlimited.
        </p>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={0}
            max={100}
            value={currentLimit}
            onChange={(e) => setContactLimit(Number(e.target.value))}
            className="w-24 px-3 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            data-testid="contact-limit-input"
          />
          <span className="text-sm text-muted-foreground">contacts / month</span>
        </div>
        <Button className="mt-4" onClick={handleSave} disabled={saving} data-testid="save-settings-btn">
          {saving ? <><Loader2 size={14} className="animate-spin mr-2" />Saving...</> : "Save settings"}
        </Button>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
        <h3 className="font-semibold text-amber-800 mb-2">How to grant admin access</h3>
        <p className="text-sm text-amber-700 mb-3">
          To elevate a user account to the <code className="bg-amber-100 px-1 rounded">admin</code> role, run the following SQL against the database:
        </p>
        <pre className="bg-amber-100 text-amber-900 text-xs rounded-lg p-3 overflow-x-auto font-mono">
          {`UPDATE users\n  SET role = 'admin'\n  WHERE email = 'your@email.com';`}
        </pre>
        <p className="text-xs text-amber-600 mt-2">
          Replace <code>your@email.com</code> with the target user's email address. The user must be signed in to see the admin dashboard.
        </p>
      </div>
    </div>
  );
}
