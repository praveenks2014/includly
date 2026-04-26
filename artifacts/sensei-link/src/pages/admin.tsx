import { useState } from "react";
import { useLocation } from "wouter";
import { useUser } from "@clerk/react";
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
  FileText,
  Eye,
  ExternalLink,
  Bell,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

type TabId = "pending-approvals" | "professionals" | "stats" | "settings";

export default function AdminPage() {
  const [, setLocation] = useLocation();
  const { isLoaded: clerkLoaded } = useUser();
  const { data: me, isLoading: meLoading } = useGetMe();
  const [activeTab, setActiveTab] = useState<TabId>("pending-approvals");

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
    { id: "pending-approvals", label: "Pending Approvals", icon: <Clock size={16} /> },
    { id: "professionals", label: "All Professionals", icon: <Users size={16} /> },
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

        {activeTab === "pending-approvals" && <PendingApprovalsTab />}
        {activeTab === "professionals" && <ProfessionalsTab />}
        {activeTab === "stats" && <StatsTab />}
        {activeTab === "settings" && <SettingsTab />}
      </div>
    </div>
  );
}

interface ProfDocuments {
  identity: {
    id: number;
    documentType: string;
    fileKey: string;
    status: string;
    submittedAt: string;
  } | null;
  certifications: {
    id: number;
    documentType: string;
    fileKey: string;
    uploadedAt: string;
  }[];
}

function fileKeyToUrl(fileKey: string): string {
  const withoutLeadingObjects = fileKey.replace(/^\/objects\//, "");
  return `/api/storage/objects/${withoutLeadingObjects}`;
}

function PendingApprovalsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [reviewProf, setReviewProf] = useState<AdminProfessionalRow | null>(null);
  const [documents, setDocuments] = useState<ProfDocuments | null>(null);
  const [docsLoading, setDocsLoading] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [isRejecting, setIsRejecting] = useState(false);
  const [isApproving, setIsApproving] = useState(false);

  const { data, isLoading } = useAdminListProfessionals(
    { status: "pending", page, limit: 20 },
    { query: { queryKey: getAdminListProfessionalsQueryKey({ status: "pending", page, limit: 20 }) } },
  );

  const { mutateAsync: approve } = useAdminApproveProfessional();

  function invalidateQueries() {
    queryClient.invalidateQueries({ queryKey: ["adminListProfessionals"] });
    queryClient.invalidateQueries({ queryKey: getAdminGetStatsQueryKey() });
  }

  async function openReview(prof: AdminProfessionalRow) {
    setReviewProf(prof);
    setRejectReason("");
    setDocuments(null);
    setDocsLoading(true);
    try {
      const res = await fetch(`/api/admin/professionals/${prof.id}/documents`);
      if (res.ok) {
        const docData = await res.json() as ProfDocuments;
        setDocuments(docData);
      }
    } finally {
      setDocsLoading(false);
    }
  }

  async function handleApprove(id: number) {
    setIsApproving(true);
    try {
      await approve({ id });
      invalidateQueries();
      toast({ title: "Approved", description: "Professional is now visible in search results." });
      setReviewProf(null);
    } catch {
      toast({ title: "Error", description: "Failed to approve professional.", variant: "destructive" });
    } finally {
      setIsApproving(false);
    }
  }

  async function handleReject(id: number) {
    setIsRejecting(true);
    try {
      const res = await fetch(`/api/admin/professionals/${id}/reject`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason.trim() || null }),
      });
      if (!res.ok) throw new Error("Failed");
      invalidateQueries();
      toast({ title: "Rejected", description: "Professional application has been rejected." });
      setReviewProf(null);
    } catch {
      toast({ title: "Error", description: "Failed to reject professional.", variant: "destructive" });
    } finally {
      setIsRejecting(false);
    }
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm text-muted-foreground">
            Review and approve professionals who have submitted their verification documents.
          </p>
          {data && (
            <span className="text-sm font-medium text-yellow-700 bg-yellow-50 border border-yellow-200 px-3 py-1 rounded-full">
              {data.total} awaiting review
            </span>
          )}
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
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Submitted</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Review</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(!data?.professionals || data.professionals.length === 0) ? (
                    <tr>
                      <td colSpan={5} className="text-center py-12 text-muted-foreground">
                        <CheckCircle size={32} className="mx-auto mb-2 text-green-400" />
                        No pending applications — all caught up!
                      </td>
                    </tr>
                  ) : (
                    data.professionals.map((prof: AdminProfessionalRow) => (
                      <tr key={prof.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          <p className="font-medium">{prof.fullName ?? prof.userName ?? "—"}</p>
                          <p className="text-xs text-muted-foreground">{prof.userEmail ?? "—"}</p>
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground">
                          {getSpecialtyLabel(prof.specialty as Parameters<typeof getSpecialtyLabel>[0])}
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell text-muted-foreground">
                          {[prof.city, prof.country].filter(Boolean).join(", ") || "—"}
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell text-xs text-muted-foreground">
                          {new Date(prof.createdAt).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" })}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            size="sm"
                            className="gap-1"
                            onClick={() => openReview(prof)}
                            data-testid={`pending-review-btn-${prof.id}`}
                          >
                            <Eye size={13} />
                            Review
                          </Button>
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
                  <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                  <Button variant="outline" size="sm" disabled={page * data.limit >= data.total} onClick={() => setPage((p) => p + 1)}>Next</Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <Dialog open={!!reviewProf} onOpenChange={(open) => { if (!open) setReviewProf(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText size={18} className="text-primary" />
              Review Application
            </DialogTitle>
          </DialogHeader>

          {reviewProf && (
            <div className="space-y-4 py-1">
              <div className="bg-muted/40 rounded-lg p-4 space-y-1 text-sm">
                <p className="font-semibold text-base">{reviewProf.fullName ?? reviewProf.userName ?? "—"}</p>
                <p className="text-muted-foreground">{reviewProf.userEmail}</p>
                <p>{getSpecialtyLabel(reviewProf.specialty as Parameters<typeof getSpecialtyLabel>[0])}</p>
                <p className="text-muted-foreground">{[reviewProf.city, reviewProf.country].filter(Boolean).join(", ") || "—"}</p>
              </div>

              <div>
                <p className="text-sm font-medium mb-2">Uploaded Documents</p>
                {docsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <Loader2 size={14} className="animate-spin" />
                    Loading documents…
                  </div>
                ) : documents ? (
                  <div className="space-y-2">
                    {documents.identity ? (
                      <a
                        href={fileKeyToUrl(documents.identity.fileKey)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-border hover:bg-muted/40 transition-colors"
                      >
                        <FileText size={14} className="text-primary shrink-0" />
                        <span className="flex-1">Identity: <span className="capitalize">{documents.identity.documentType.replace(/_/g, " ")}</span></span>
                        <ExternalLink size={12} className="text-muted-foreground" />
                      </a>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">No identity document uploaded.</p>
                    )}
                    {documents.certifications.length > 0 ? (
                      documents.certifications.map((cert) => (
                        <a
                          key={cert.id}
                          href={fileKeyToUrl(cert.fileKey)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-border hover:bg-muted/40 transition-colors"
                        >
                          <FileText size={14} className="text-blue-500 shrink-0" />
                          <span className="flex-1">Certification: <span className="capitalize">{cert.documentType.replace(/_/g, " ")}</span></span>
                          <ExternalLink size={12} className="text-muted-foreground" />
                        </a>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground italic">No certification documents uploaded.</p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">Could not load documents.</p>
                )}
              </div>

              <div>
                <Label htmlFor="pending-reject-reason" className="text-sm font-medium">
                  Rejection reason <span className="text-muted-foreground font-normal">(optional — shown to professional)</span>
                </Label>
                <Textarea
                  id="pending-reject-reason"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="E.g. Documents unclear, please re-upload a higher quality scan…"
                  className="mt-1 text-sm resize-none"
                  rows={3}
                  data-testid="pending-reject-reason-input"
                />
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setReviewProf(null)}>Close</Button>
            {reviewProf && (
              <Button
                variant="outline"
                className="gap-1 text-red-700 border-red-300 hover:bg-red-50"
                onClick={() => handleReject(reviewProf.id)}
                disabled={isRejecting || isApproving}
                data-testid={`pending-reject-btn-${reviewProf?.id}`}
              >
                {isRejecting ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />}
                Reject
              </Button>
            )}
            {reviewProf && (
              <Button
                className="gap-1 bg-green-600 hover:bg-green-700 text-white"
                onClick={() => handleApprove(reviewProf.id)}
                disabled={isRejecting || isApproving}
                data-testid={`pending-approve-btn-${reviewProf?.id}`}
              >
                {isApproving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} />}
                Approve
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ProfessionalsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("pending");
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

  function invalidateQueries() {
    queryClient.invalidateQueries({ queryKey: ["adminListProfessionals"] });
    queryClient.invalidateQueries({ queryKey: getAdminGetStatsQueryKey() });
  }

  async function openReview(prof: AdminProfessionalRow) {
    setReviewProf(prof);
    setRejectReason("");
    setDocuments(null);
    setDocsLoading(true);
    try {
      const res = await fetch(`/api/admin/professionals/${prof.id}/documents`);
      if (res.ok) {
        const docData = await res.json() as ProfDocuments;
        setDocuments(docData);
      }
    } finally {
      setDocsLoading(false);
    }
  }

  async function handleApprove(id: number) {
    setIsApproving(true);
    try {
      await approve({ id });
      invalidateQueries();
      toast({ title: "Approved", description: "Professional is now visible in search results." });
      setReviewProf(null);
    } catch {
      toast({ title: "Error", description: "Failed to approve professional.", variant: "destructive" });
    } finally {
      setIsApproving(false);
    }
  }

  async function handleReject(id: number) {
    setIsRejecting(true);
    try {
      const res = await fetch(`/api/admin/professionals/${id}/reject`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason.trim() || null }),
      });
      if (!res.ok) throw new Error("Failed");
      invalidateQueries();
      toast({ title: "Rejected", description: "Professional application has been rejected." });
      setReviewProf(null);
    } catch {
      toast({ title: "Error", description: "Failed to reject professional.", variant: "destructive" });
    } finally {
      setIsRejecting(false);
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
    <>
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
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1"
                            onClick={() => openReview(prof)}
                            data-testid={`review-btn-${prof.id}`}
                          >
                            <Eye size={13} />
                            Review
                          </Button>
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

      <Dialog open={!!reviewProf} onOpenChange={(open) => { if (!open) setReviewProf(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText size={18} className="text-primary" />
              Review Application
            </DialogTitle>
          </DialogHeader>

          {reviewProf && (
            <div className="space-y-4 py-1">
              <div className="bg-muted/40 rounded-lg p-4 space-y-1 text-sm">
                <p className="font-semibold text-base">{reviewProf.fullName ?? reviewProf.userName ?? "—"}</p>
                <p className="text-muted-foreground">{reviewProf.userEmail}</p>
                <p>{getSpecialtyLabel(reviewProf.specialty as Parameters<typeof getSpecialtyLabel>[0])}</p>
                <p className="text-muted-foreground">{[reviewProf.city, reviewProf.country].filter(Boolean).join(", ") || "—"}</p>
                <div className="pt-1">
                  <VerificationBadge status={reviewProf.verificationStatus} />
                </div>
              </div>

              <div>
                <p className="text-sm font-medium mb-2">Uploaded Documents</p>
                {docsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <Loader2 size={14} className="animate-spin" />
                    Loading documents…
                  </div>
                ) : documents ? (
                  <div className="space-y-2">
                    {documents.identity ? (
                      <a
                        href={fileKeyToUrl(documents.identity.fileKey)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-border hover:bg-muted/40 transition-colors"
                        data-testid="identity-doc-link"
                      >
                        <FileText size={14} className="text-primary shrink-0" />
                        <span className="flex-1">
                          Identity: <span className="capitalize">{documents.identity.documentType.replace(/_/g, " ")}</span>
                        </span>
                        <ExternalLink size={12} className="text-muted-foreground" />
                      </a>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">No identity document uploaded.</p>
                    )}
                    {documents.certifications.length > 0 ? (
                      documents.certifications.map((cert) => (
                        <a
                          key={cert.id}
                          href={fileKeyToUrl(cert.fileKey)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-border hover:bg-muted/40 transition-colors"
                        >
                          <FileText size={14} className="text-blue-500 shrink-0" />
                          <span className="flex-1">
                            Certification: <span className="capitalize">{cert.documentType.replace(/_/g, " ")}</span>
                          </span>
                          <ExternalLink size={12} className="text-muted-foreground" />
                        </a>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground italic">No certification documents uploaded.</p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">Could not load documents.</p>
                )}
              </div>

              {reviewProf.verificationStatus !== "verified" && (
                <div>
                  <Label htmlFor="reject-reason" className="text-sm font-medium">
                    Rejection reason <span className="text-muted-foreground font-normal">(optional — shown to the professional)</span>
                  </Label>
                  <Textarea
                    id="reject-reason"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="E.g. Documents unclear, please re-upload a higher quality scan…"
                    className="mt-1 text-sm resize-none"
                    rows={3}
                    data-testid="reject-reason-input"
                  />
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setReviewProf(null)}>
              Close
            </Button>
            {reviewProf && reviewProf.verificationStatus !== "rejected" && (
              <Button
                variant="outline"
                className="gap-1 text-red-700 border-red-300 hover:bg-red-50"
                onClick={() => handleReject(reviewProf.id)}
                disabled={isRejecting || isApproving}
                data-testid={`reject-btn-${reviewProf?.id}`}
              >
                {isRejecting ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />}
                Reject
              </Button>
            )}
            {reviewProf && reviewProf.verificationStatus !== "verified" && (
              <Button
                className="gap-1 bg-green-600 hover:bg-green-700 text-white"
                onClick={() => handleApprove(reviewProf.id)}
                disabled={isRejecting || isApproving}
                data-testid={`approve-btn-${reviewProf?.id}`}
              >
                {isApproving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} />}
                Approve
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
  const [testPushLoading, setTestPushLoading] = useState(false);

  async function handleTestPush() {
    setTestPushLoading(true);
    try {
      const res = await fetch("/api/admin/notifications/test", { method: "POST" });
      const data = await res.json() as { sent?: number; total?: number; error?: string };
      if (!res.ok) {
        toast({
          title: "Test failed",
          description: data.error ?? "Could not send test notification.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Test notification sent",
          description: `Delivered to ${data.sent} of ${data.total} subscription(s). Check your device.`,
        });
      }
    } catch {
      toast({ title: "Error", description: "Request failed. Check the server is running.", variant: "destructive" });
    } finally {
      setTestPushLoading(false);
    }
  }

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

      <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <Bell size={16} className="text-primary" />
          <h2 className="font-semibold text-foreground">Push Notification Health</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Send a test push notification to your own device to confirm the pipeline is working after deployments or config changes.
        </p>
        <Button
          variant="outline"
          onClick={handleTestPush}
          disabled={testPushLoading}
          data-testid="test-push-btn"
        >
          {testPushLoading ? (
            <><Loader2 size={14} className="animate-spin mr-2" />Sending…</>
          ) : (
            <><Bell size={14} className="mr-2" />Send test push</>
          )}
        </Button>
        <p className="text-xs text-muted-foreground mt-3">
          You must have push notifications enabled in your browser for this to work.
        </p>
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
