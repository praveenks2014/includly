import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useGetMe } from "@workspace/api-client-react";
import { fetchWithAuth } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Building2, Users, Package, Settings, ChevronRight, ChevronLeft,
  Check, Plus, Trash2, Menu, X, Clock, MapPin, Phone, Mail, Globe,
  Shield, CheckCircle2, AlertCircle, Edit2, Star,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useQuery } from "@tanstack/react-query";
import { FileUploadField } from "@/components/FileUploadField";

type CentreStatus = "draft" | "submitted" | "verified" | "live" | "rejected" | "suspended";

interface TherapyCentre {
  id: number;
  name: string;
  description: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  photoUrl: string | null;
  therapyTypesOffered: string | null;
  languagesSpoken: string | null;
  registrationNumbers: string | null;
  yearsInOperation: number | null;
  operatingHoursJson: string | null;
  status: CentreStatus;
  verificationNotes: string | null;
  rejectedReason: string | null;
}

interface Therapist {
  id: number;
  name: string;
  photoUrl: string | null;
  specializations: string | null;
  qualifications: string | null;
  yearsExperience: number;
  isActive: boolean;
}

interface Service {
  id: number;
  name: string;
  serviceType: string;
  durationMinutes: number;
  mode: string;
  description: string | null;
  assessmentRequired: boolean;
  isActive: boolean;
  currentPriceInr: number | null;
}

interface CancellationPolicy {
  window1Hours: number;
  window1RefundPct: number;
  window2Hours: number;
  window2RefundPct: number;
  insideWindow2RefundPct: number;
  noShowRefundPct: number;
  centreNoShowRefundPct: number;
  offerCompensationSlot: boolean;
}

type SidebarTab = "overview" | "therapists" | "services" | "cancellation" | "settings";

const THERAPY_TYPES = [
  "Occupational Therapy", "Speech Therapy", "Behavioral / ABA",
  "Physiotherapy", "Special Education", "Child Psychology", "Sensory Integration",
];

const SERVICE_TYPES = [
  "Initial Assessment", "OT Session", "Speech Session",
  "ABA Session", "Group Session", "Home Visit", "Online Session", "Other",
];

const STATUS_CONFIG: Record<CentreStatus, { label: string; color: string; icon: React.ReactNode }> = {
  draft: { label: "Draft", color: "bg-gray-100 text-gray-600 border-gray-200", icon: <Edit2 size={12} /> },
  submitted: { label: "Under Review", color: "bg-yellow-50 text-yellow-700 border-yellow-200", icon: <Clock size={12} /> },
  verified: { label: "Verified", color: "bg-blue-50 text-blue-700 border-blue-200", icon: <CheckCircle2 size={12} /> },
  live: { label: "Live", color: "bg-teal-50 text-teal-700 border-teal-200", icon: <CheckCircle2 size={12} /> },
  rejected: { label: "Rejected", color: "bg-red-50 text-red-700 border-red-200", icon: <AlertCircle size={12} /> },
  suspended: { label: "Suspended", color: "bg-orange-50 text-orange-700 border-orange-200", icon: <AlertCircle size={12} /> },
};

export default function CentreDashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: me, isLoading: meLoading } = useGetMe();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<SidebarTab>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const { data: centre, isLoading: centreLoading, refetch: refetchCentre } = useQuery<TherapyCentre | null>({
    queryKey: ["my-centre"],
    queryFn: async () => {
      const r = await fetchWithAuth("/api/centres/mine");
      if (r.status === 404) return null;
      if (!r.ok) throw new Error("Failed to load centre");
      return r.json();
    },
    enabled: (me?.role as string) === "centre_admin",
  });

  const { data: therapists = [], refetch: refetchTherapists } = useQuery<Therapist[]>({
    queryKey: ["centre-therapists", centre?.id],
    queryFn: async () => {
      const r = await fetchWithAuth(`/api/centres/${centre!.id}/therapists`);
      return r.ok ? r.json() : [];
    },
    enabled: !!centre?.id,
  });

  const { data: services = [], refetch: refetchServices } = useQuery<Service[]>({
    queryKey: ["centre-services", centre?.id],
    queryFn: async () => {
      const r = await fetchWithAuth(`/api/centres/${centre!.id}/services`);
      return r.ok ? r.json() : [];
    },
    enabled: !!centre?.id,
  });

  const { data: policy, refetch: refetchPolicy } = useQuery<CancellationPolicy | null>({
    queryKey: ["centre-policy", centre?.id],
    queryFn: async () => {
      const r = await fetchWithAuth(`/api/centres/${centre!.id}/cancellation-policy`);
      return r.ok ? r.json() : null;
    },
    enabled: !!centre?.id,
  });

  // Wizard / profile form state
  const [form, setForm] = useState<ProfileForm>({
    name: "", description: "", address: "", city: "", state: "", pincode: "",
    phone: "", email: "", website: "", registrationNumbers: "", yearsInOperation: "",
    therapyTypesOffered: [], languagesSpoken: "", photoUrl: "",
  });

  useEffect(() => {
    if (centre) {
      setForm({
        name: centre.name ?? "",
        description: centre.description ?? "",
        address: centre.address ?? "",
        city: centre.city ?? "",
        state: centre.state ?? "",
        pincode: centre.pincode ?? "",
        phone: centre.phone ?? "",
        email: centre.email ?? "",
        website: centre.website ?? "",
        registrationNumbers: centre.registrationNumbers ?? "",
        yearsInOperation: centre.yearsInOperation?.toString() ?? "",
        therapyTypesOffered: centre.therapyTypesOffered ? centre.therapyTypesOffered.split(",").map(s => s.trim()) : [],
        languagesSpoken: centre.languagesSpoken ?? "",
        photoUrl: centre.photoUrl ?? "",
      });
    }
  }, [centre]);

  async function handleSaveProfile() {
    setSaving(true);
    try {
      const payload = {
        ...form,
        yearsInOperation: form.yearsInOperation ? Number(form.yearsInOperation) : undefined,
        therapyTypesOffered: form.therapyTypesOffered.join(", "),
      };
      if (centre) {
        await fetchWithAuth(`/api/centres/${centre.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        await fetchWithAuth("/api/centres", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      await refetchCentre();
      toast({ title: "Profile saved ✓" });
      setShowWizard(false);
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmitForReview() {
    if (!centre) return;
    setSubmitting(true);
    try {
      await fetchWithAuth(`/api/centres/${centre.id}/submit`, { method: "POST" });
      await refetchCentre();
      toast({ title: "Submitted for review ✓", description: "We'll notify you once verified." });
    } catch {
      toast({ title: "Failed to submit", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  if (meLoading || centreLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F7FA]">
        <Loader2 className="animate-spin text-teal-500" size={28} />
      </div>
    );
  }

  if ((me?.role as string) !== "centre_admin") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F7FA]">
        <div className="text-center max-w-sm bg-white rounded-2xl p-10 shadow">
          <Shield className="mx-auto mb-4 text-red-400" size={48} />
          <h1 className="font-serif text-2xl font-bold text-[#1A2340] mb-2">Access Denied</h1>
          <p className="text-gray-500 mb-6">This page is for therapy centre admins only.</p>
          <Button onClick={() => setLocation("/dashboard")} className="bg-teal-600 hover:bg-teal-700">Go to Dashboard</Button>
        </div>
      </div>
    );
  }

  if (!centre && !showWizard) {
    return <SetupWizard onComplete={async () => { await refetchCentre(); }} />;
  }

  const NAV: { id: SidebarTab; label: string; icon: React.ReactNode }[] = [
    { id: "overview", label: "Overview", icon: <Building2 size={18} /> },
    { id: "therapists", label: "Therapists", icon: <Users size={18} /> },
    { id: "services", label: "Services", icon: <Package size={18} /> },
    { id: "cancellation", label: "Cancellation Policy", icon: <Shield size={18} /> },
    { id: "settings", label: "Centre Profile", icon: <Settings size={18} /> },
  ];

  const statusCfg = centre ? STATUS_CONFIG[centre.status] : null;

  return (
    <div className="min-h-screen bg-[#F5F7FA] flex">
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={`fixed lg:static inset-y-0 left-0 z-50 w-60 bg-[#1A2340] text-white flex flex-col transition-transform duration-200 ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}>
        <div className="px-5 py-6 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-teal-500 flex items-center justify-center">
              <Building2 size={16} className="text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold truncate">{centre?.name ?? "My Centre"}</p>
              <p className="text-xs text-white/40">Centre Dashboard</p>
            </div>
          </div>
          {statusCfg && (
            <div className={`mt-3 inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium ${statusCfg.color}`}>
              {statusCfg.icon}
              {statusCfg.label}
            </div>
          )}
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => { setActiveTab(item.id); setSidebarOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all focus-visible:ring-2 focus-visible:ring-teal-400 ${
                activeTab === item.id ? "bg-teal-500 text-white" : "text-white/60 hover:text-white hover:bg-white/10"
              }`}
            >
              {item.icon}
              {item.label}
              {activeTab === item.id && <ChevronRight size={14} className="ml-auto" />}
            </button>
          ))}
        </nav>

        <div className="px-3 py-4 border-t border-white/10">
          <button onClick={() => setLocation("/dashboard")} className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-white/40 hover:text-white/70 transition-colors">
            <ChevronLeft size={14} /> Back to Dashboard
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="bg-white border-b border-gray-100 px-4 sm:px-6 h-14 flex items-center gap-4 sticky top-0 z-30 shadow-sm">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 rounded-lg hover:bg-gray-100">
            <Menu size={20} />
          </button>
          <h1 className="font-serif text-lg font-bold text-[#1A2340]">
            {NAV.find((n) => n.id === activeTab)?.label}
          </h1>
          <div className="ml-auto flex items-center gap-2">
            {centre && (centre.status === "draft" || centre.status === "rejected") && (
              <Button
                size="sm"
                onClick={handleSubmitForReview}
                disabled={submitting}
                className="bg-teal-600 hover:bg-teal-700 text-white text-xs gap-1.5"
              >
                {submitting ? <Loader2 size={12} className="animate-spin" /> : <ChevronRight size={12} />}
                Submit for Review
              </Button>
            )}
          </div>
        </header>

        <div className="flex-1 px-4 sm:px-6 py-6 overflow-auto">
          {activeTab === "overview" && centre && (
            <OverviewTab centre={centre} therapists={therapists} services={services} onSubmit={handleSubmitForReview} submitting={submitting} />
          )}
          {activeTab === "therapists" && centre && (
            <TherapistsTab centreId={centre.id} therapists={therapists} onRefresh={refetchTherapists} />
          )}
          {activeTab === "services" && centre && (
            <ServicesTab centreId={centre.id} services={services} onRefresh={refetchServices} />
          )}
          {activeTab === "cancellation" && centre && (
            <CancellationPolicyTab centreId={centre.id} policy={policy ?? null} onRefresh={refetchPolicy} />
          )}
          {activeTab === "settings" && centre && (
            <ProfileSettingsTab centre={centre} form={form} setForm={setForm} onSave={handleSaveProfile} saving={saving} />
          )}
        </div>
      </div>
    </div>
  );
}

function SetupWizard({ onComplete }: { onComplete: () => Promise<void> }) {
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "", description: "", address: "", city: "", state: "", pincode: "",
    phone: "", email: "", website: "", registrationNumbers: "", yearsInOperation: "",
    therapyTypesOffered: [] as string[], languagesSpoken: "",
  });

  const STEPS = ["Basic Info", "Therapy Types", "Contact & Registration", "Review"];

  function set(field: string, value: string | string[]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function toggleTherapyType(t: string) {
    setForm((prev) => ({
      ...prev,
      therapyTypesOffered: prev.therapyTypesOffered.includes(t)
        ? prev.therapyTypesOffered.filter((x) => x !== t)
        : [...prev.therapyTypesOffered, t],
    }));
  }

  function canNext() {
    if (step === 0) return form.name.trim().length >= 2 && form.description.trim().length >= 10;
    if (step === 1) return form.therapyTypesOffered.length > 0;
    return true;
  }

  async function handleCreate() {
    setSaving(true);
    try {
      const payload = {
        ...form,
        yearsInOperation: form.yearsInOperation ? Number(form.yearsInOperation) : undefined,
        therapyTypesOffered: form.therapyTypesOffered.join(", "),
      };
      const r = await fetchWithAuth("/api/centres", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error("Failed to create centre");
      await onComplete();
      toast({ title: "Centre profile created ✓" });
    } catch {
      toast({ title: "Failed to create centre", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#dff2ec] via-[#f7fbf9] to-[#f0f4ff] flex flex-col">
      <div className="flex justify-center pt-8 pb-2">
        <a href="/" className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-teal-600 flex items-center justify-center shadow-sm">
            <span className="text-white font-bold text-base">In</span>
          </div>
          <span className="font-serif font-semibold text-xl text-gray-900">Includly<span className="text-teal-500">·</span></span>
        </a>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-lg">
          <div className="text-center mb-8">
            <h1 className="text-2xl sm:text-3xl font-serif font-semibold text-gray-900 mb-2">Set up your Therapy Centre</h1>
            <p className="text-gray-500 text-sm">Step {step + 1} of {STEPS.length}: {STEPS[step]}</p>
          </div>

          <div className="flex gap-2 mb-6">
            {STEPS.map((_, i) => (
              <div key={i} className={`flex-1 h-1.5 rounded-full transition-colors ${i <= step ? "bg-teal-500" : "bg-gray-200"}`} />
            ))}
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm space-y-5">
            {step === 0 && (
              <>
                <div>
                  <h2 className="text-lg font-serif font-semibold text-gray-900 mb-1">Centre name & description</h2>
                  <p className="text-xs text-gray-500">This will appear on your public profile.</p>
                </div>
                <div>
                  <Label>Centre Name <span className="text-red-500">*</span></Label>
                  <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Bloom Therapy Centre" className="mt-1" />
                </div>
                <div>
                  <Label>About your centre <span className="text-red-500">*</span></Label>
                  <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Describe your mission, approach, and what makes your centre unique..." className="mt-1 min-h-[100px]" />
                </div>
                <div>
                  <Label>Years in operation</Label>
                  <Input type="number" min={0} value={form.yearsInOperation} onChange={(e) => set("yearsInOperation", e.target.value)} placeholder="e.g. 5" className="mt-1 w-32" />
                </div>
              </>
            )}

            {step === 1 && (
              <>
                <div>
                  <h2 className="text-lg font-serif font-semibold text-gray-900 mb-1">What therapies do you offer?</h2>
                  <p className="text-xs text-gray-500">Select all that apply.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {THERAPY_TYPES.map((t) => {
                    const selected = form.therapyTypesOffered.includes(t);
                    return (
                      <button key={t} type="button" onClick={() => toggleTherapyType(t)}
                        className={`px-3 py-1.5 rounded-full border text-sm font-medium transition-all flex items-center gap-1.5 ${selected ? "bg-teal-600 text-white border-teal-600" : "bg-white border-gray-200 text-gray-700 hover:border-teal-400"}`}>
                        {selected && <Check size={12} />} {t}
                      </button>
                    );
                  })}
                </div>
                <div>
                  <Label>Languages spoken at centre</Label>
                  <Input value={form.languagesSpoken} onChange={(e) => set("languagesSpoken", e.target.value)} placeholder="e.g. English, Hindi, Kannada" className="mt-1" />
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <div>
                  <h2 className="text-lg font-serif font-semibold text-gray-900 mb-1">Contact & Location</h2>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>City</Label>
                    <Input value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="Bengaluru" className="mt-1" />
                  </div>
                  <div>
                    <Label>State</Label>
                    <Input value={form.state} onChange={(e) => set("state", e.target.value)} placeholder="Karnataka" className="mt-1" />
                  </div>
                </div>
                <div>
                  <Label>Full Address</Label>
                  <Textarea value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="123, 2nd Floor, MG Road..." className="mt-1 min-h-[60px]" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Phone</Label>
                    <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+91 98765 43210" className="mt-1" />
                  </div>
                  <div>
                    <Label>Email</Label>
                    <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="hello@yourcentre.in" className="mt-1" />
                  </div>
                </div>
                <div>
                  <Label>Registration / License No. <span className="text-gray-400 text-xs">(optional)</span></Label>
                  <Input value={form.registrationNumbers} onChange={(e) => set("registrationNumbers", e.target.value)} placeholder="e.g. MH/TC/2020/1234" className="mt-1" />
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <div>
                  <h2 className="text-lg font-serif font-semibold text-gray-900 mb-1">Review your details</h2>
                  <p className="text-xs text-gray-500">You can edit everything later from your dashboard.</p>
                </div>
                <div className="space-y-2 text-sm">
                  <ReviewRow icon={<Building2 size={14} />} label="Centre" value={form.name} />
                  <ReviewRow icon={<MapPin size={14} />} label="Location" value={[form.city, form.state].filter(Boolean).join(", ") || "—"} />
                  <ReviewRow icon={<Phone size={14} />} label="Phone" value={form.phone || "—"} />
                  <ReviewRow icon={<Mail size={14} />} label="Email" value={form.email || "—"} />
                  <ReviewRow icon={<Star size={14} />} label="Therapy types" value={form.therapyTypesOffered.join(", ") || "—"} />
                </div>
                <div className="bg-teal-50 border border-teal-100 rounded-xl p-3 text-xs text-teal-700">
                  After creating your profile, you'll need to add therapists and services. Then submit for admin review to go live.
                </div>
              </>
            )}
          </div>

          <div className="flex justify-between mt-5">
            <Button variant="outline" onClick={() => step > 0 ? setStep(s => s - 1) : undefined} disabled={step === 0} className="gap-1 border-gray-200">
              <ChevronLeft size={15} /> Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button onClick={() => setStep(s => s + 1)} disabled={!canNext()} className="bg-teal-600 hover:bg-teal-700 text-white gap-1">
                Continue <ChevronRight size={15} />
              </Button>
            ) : (
              <Button onClick={handleCreate} disabled={saving} className="bg-teal-600 hover:bg-teal-700 text-white gap-1">
                {saving && <Loader2 size={13} className="animate-spin" />}
                Create Centre Profile
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReviewRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-gray-400 mt-0.5">{icon}</span>
      <span className="text-gray-500 w-24 shrink-0">{label}</span>
      <span className="text-gray-800 font-medium">{value}</span>
    </div>
  );
}

function OverviewTab({ centre, therapists, services, onSubmit, submitting }: {
  centre: TherapyCentre;
  therapists: Therapist[];
  services: Service[];
  onSubmit: () => void;
  submitting: boolean;
}) {
  const statusCfg = STATUS_CONFIG[centre.status];
  const priceSet = services.some(s => s.currentPriceInr !== null);
  const canSubmit = centre.status === "draft" || centre.status === "rejected";
  const readyToSubmit = therapists.length > 0 && services.length > 0;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-serif font-bold text-[#1A2340]">{centre.name}</h2>
            {centre.city && <p className="text-sm text-gray-500 mt-0.5 flex items-center gap-1"><MapPin size={12} />{centre.city}{centre.state ? `, ${centre.state}` : ""}</p>}
          </div>
          <div className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-medium ${statusCfg.color}`}>
            {statusCfg.icon} {statusCfg.label}
          </div>
        </div>
        {centre.description && <p className="text-sm text-gray-600 mt-3 leading-relaxed">{centre.description}</p>}

        {centre.status === "rejected" && centre.rejectedReason && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
            <p className="font-semibold mb-1">Rejection reason:</p>
            <p>{centre.rejectedReason}</p>
          </div>
        )}
        {centre.status === "verified" && (
          <div className="mt-4 bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-700">
            Your centre is verified! The admin will set prices for your services before going live.
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Therapists", value: therapists.length, icon: <Users size={20} /> },
          { label: "Services", value: services.length, icon: <Package size={20} /> },
          { label: "Prices Set", value: services.filter(s => s.currentPriceInr !== null).length + "/" + services.length, icon: <Shield size={20} /> },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm text-center">
            <div className="text-teal-500 flex justify-center mb-1">{stat.icon}</div>
            <p className="text-2xl font-bold text-[#1A2340]">{stat.value}</p>
            <p className="text-xs text-gray-500">{stat.label}</p>
          </div>
        ))}
      </div>

      {canSubmit && (
        <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
          <h3 className="font-semibold text-[#1A2340] mb-3">Submit for Review</h3>
          <div className="space-y-2 mb-4">
            <ChecklistItem done={!!centre.name && !!centre.description} label="Centre profile filled" />
            <ChecklistItem done={therapists.length > 0} label="At least 1 therapist added" />
            <ChecklistItem done={services.length > 0} label="At least 1 service added" />
          </div>
          <Button
            onClick={onSubmit}
            disabled={submitting || !readyToSubmit}
            className="bg-teal-600 hover:bg-teal-700 text-white gap-2"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <ChevronRight size={14} />}
            Submit for Review
          </Button>
          {!readyToSubmit && <p className="text-xs text-gray-400 mt-2">Add at least 1 therapist and 1 service before submitting.</p>}
        </div>
      )}
    </div>
  );
}

function ChecklistItem({ done, label }: { done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {done ? <CheckCircle2 size={15} className="text-teal-500" /> : <div className="w-[15px] h-[15px] rounded-full border-2 border-gray-300" />}
      <span className={done ? "text-gray-700" : "text-gray-400"}>{label}</span>
    </div>
  );
}

function TherapistsTab({ centreId, therapists, onRefresh }: { centreId: number; therapists: Therapist[]; onRefresh: () => void }) {
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState<Therapist | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", specializations: "", qualifications: "", yearsExperience: "0" });

  function resetForm(t?: Therapist) {
    setForm({
      name: t?.name ?? "",
      specializations: t?.specializations ?? "",
      qualifications: t?.qualifications ?? "",
      yearsExperience: t?.yearsExperience?.toString() ?? "0",
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload = { ...form, yearsExperience: Number(form.yearsExperience) };
      if (editItem) {
        await fetchWithAuth(`/api/centres/${centreId}/therapists/${editItem.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      } else {
        await fetchWithAuth(`/api/centres/${centreId}/therapists`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      }
      onRefresh();
      toast({ title: editItem ? "Therapist updated ✓" : "Therapist added ✓" });
      setShowAdd(false); setEditItem(null); resetForm();
    } catch { toast({ title: "Failed to save", variant: "destructive" }); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: number) {
    try {
      await fetchWithAuth(`/api/centres/${centreId}/therapists/${id}`, { method: "DELETE" });
      onRefresh();
      toast({ title: "Therapist removed" });
    } catch { toast({ title: "Failed to remove", variant: "destructive" }); }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-serif font-bold text-[#1A2340]">Therapists</h2>
          <p className="text-xs text-gray-400">Add the therapists working at your centre.</p>
        </div>
        <Button size="sm" onClick={() => { resetForm(); setShowAdd(true); }} className="bg-teal-600 hover:bg-teal-700 text-white gap-1.5">
          <Plus size={14} /> Add Therapist
        </Button>
      </div>

      {therapists.length === 0 && (
        <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-10 text-center text-gray-400">
          <Users size={32} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">No therapists added yet.</p>
        </div>
      )}

      <div className="space-y-3">
        {therapists.map((t) => (
          <div key={t.id} className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-semibold text-[#1A2340]">{t.name}</p>
              {t.specializations && <p className="text-xs text-teal-600 mt-0.5">{t.specializations}</p>}
              {t.qualifications && <p className="text-xs text-gray-500 mt-0.5">{t.qualifications}</p>}
              <p className="text-xs text-gray-400 mt-0.5">{t.yearsExperience} yrs experience</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button size="sm" variant="outline" className="text-xs h-7 px-2" onClick={() => { resetForm(t); setEditItem(t); setShowAdd(true); }}>
                <Edit2 size={12} />
              </Button>
              <Button size="sm" variant="outline" className="text-xs h-7 px-2 text-red-500 border-red-200 hover:bg-red-50" onClick={() => handleDelete(t.id)}>
                <Trash2 size={12} />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={showAdd} onOpenChange={(o) => { setShowAdd(o); if (!o) { setEditItem(null); resetForm(); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-serif">{editItem ? "Edit Therapist" : "Add Therapist"}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-1">
            <div><Label>Name <span className="text-red-500">*</span></Label><Input value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Dr. Priya Sharma" className="mt-1" /></div>
            <div><Label>Specializations</Label><Input value={form.specializations} onChange={(e) => setForm(p => ({ ...p, specializations: e.target.value }))} placeholder="OT, Speech Therapy" className="mt-1" /></div>
            <div><Label>Qualifications</Label><Input value={form.qualifications} onChange={(e) => setForm(p => ({ ...p, qualifications: e.target.value }))} placeholder="B.Sc OT, ASHA Certified" className="mt-1" /></div>
            <div><Label>Years of experience</Label><Input type="number" min={0} value={form.yearsExperience} onChange={(e) => setForm(p => ({ ...p, yearsExperience: e.target.value }))} className="mt-1 w-24" /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setShowAdd(false); setEditItem(null); resetForm(); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.name.trim()} className="bg-teal-600 hover:bg-teal-700 text-white">
              {saving ? <Loader2 size={14} className="animate-spin mr-1" /> : null} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ServicesTab({ centreId, services, onRefresh }: { centreId: number; services: Service[]; onRefresh: () => void }) {
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState<Service | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", serviceType: "Initial Assessment", durationMinutes: "60", mode: "in_centre" as "in_centre" | "home_visit" | "online", description: "", assessmentRequired: false, priceInr: "" });

  function resetForm(s?: Service) {
    setForm({
      name: s?.name ?? "",
      serviceType: s?.serviceType ?? "Initial Assessment",
      durationMinutes: s?.durationMinutes?.toString() ?? "60",
      mode: (s?.mode ?? "in_centre") as "in_centre" | "home_visit" | "online",
      description: s?.description ?? "",
      assessmentRequired: s?.assessmentRequired ?? false,
      priceInr: s?.currentPriceInr?.toString() ?? "",
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload = { ...form, durationMinutes: Number(form.durationMinutes), priceInr: form.priceInr ? Number(form.priceInr) : undefined };
      if (editItem) {
        await fetchWithAuth(`/api/centres/${centreId}/services/${editItem.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      } else {
        await fetchWithAuth(`/api/centres/${centreId}/services`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      }
      onRefresh();
      toast({ title: editItem ? "Service updated ✓" : "Service added ✓" });
      setShowAdd(false); setEditItem(null); resetForm();
    } catch { toast({ title: "Failed to save", variant: "destructive" }); }
    finally { setSaving(false); }
  }

  const MODE_LABELS: Record<string, string> = { in_centre: "In-Centre", home_visit: "Home Visit", online: "Online" };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-serif font-bold text-[#1A2340]">Services</h2>
          <p className="text-xs text-gray-400">List the services your centre offers. Set your own price per session.</p>
        </div>
        <Button size="sm" onClick={() => { resetForm(); setShowAdd(true); }} className="bg-teal-600 hover:bg-teal-700 text-white gap-1.5">
          <Plus size={14} /> Add Service
        </Button>
      </div>

      {services.length === 0 && (
        <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-10 text-center text-gray-400">
          <Package size={32} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">No services added yet.</p>
        </div>
      )}

      <div className="space-y-3">
        {services.map((s) => (
          <div key={s.id} className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-[#1A2340]">{s.name}</p>
                {s.assessmentRequired && <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-orange-200 text-orange-600">Assessment first</Badge>}
              </div>
              <p className="text-xs text-gray-500 mt-0.5">{s.serviceType} · {s.durationMinutes} min · {MODE_LABELS[s.mode] ?? s.mode}</p>
              {s.currentPriceInr ? (
                <p className="text-xs font-semibold text-teal-600 mt-0.5">₹{s.currentPriceInr.toLocaleString("en-IN")}</p>
              ) : (
                <p className="text-xs text-gray-400 mt-0.5">Price not set</p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button size="sm" variant="outline" className="text-xs h-7 px-2" onClick={() => { resetForm(s); setEditItem(s); setShowAdd(true); }}>
                <Edit2 size={12} />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={showAdd} onOpenChange={(o) => { setShowAdd(o); if (!o) { setEditItem(null); resetForm(); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-serif">{editItem ? "Edit Service" : "Add Service"}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-1">
            <div>
              <Label>Service name <span className="text-red-500">*</span></Label>
              <Input value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. OT Session" className="mt-1" />
            </div>
            <div>
              <Label>Type</Label>
              <select value={form.serviceType} onChange={(e) => setForm(p => ({ ...p, serviceType: e.target.value }))} className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-400">
                {SERVICE_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Duration (min)</Label>
                <Input type="number" min={15} step={15} value={form.durationMinutes} onChange={(e) => setForm(p => ({ ...p, durationMinutes: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label>Mode</Label>
                <select value={form.mode} onChange={(e) => setForm(p => ({ ...p, mode: e.target.value as "in_centre" | "home_visit" | "online" }))} className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-400">
                  <option value="in_centre">In-Centre</option>
                  <option value="home_visit">Home Visit</option>
                  <option value="online">Online</option>
                </select>
              </div>
            </div>
            <div>
              <Label>Description <span className="text-gray-400 text-xs">(optional)</span></Label>
              <Textarea value={form.description} onChange={(e) => setForm(p => ({ ...p, description: e.target.value }))} className="mt-1 min-h-[60px] text-sm" />
            </div>
            <div>
              <Label>Price you charge (₹) <span className="text-gray-400 text-xs">(optional)</span></Label>
              <Input type="number" min={1} value={form.priceInr} onChange={(e) => setForm(p => ({ ...p, priceInr: e.target.value }))} placeholder="e.g. 1500" className="mt-1 w-36" />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.assessmentRequired} onChange={(e) => setForm(p => ({ ...p, assessmentRequired: e.target.checked }))} className="accent-teal-600" />
              Assessment required before booking
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setShowAdd(false); setEditItem(null); resetForm(); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.name.trim()} className="bg-teal-600 hover:bg-teal-700 text-white">
              {saving ? <Loader2 size={14} className="animate-spin mr-1" /> : null} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CancellationPolicyTab({ centreId, policy, onRefresh }: { centreId: number; policy: CancellationPolicy | null; onRefresh: () => void }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<CancellationPolicy>({
    window1Hours: 24, window1RefundPct: 100,
    window2Hours: 2, window2RefundPct: 50,
    insideWindow2RefundPct: 0, noShowRefundPct: 0,
    centreNoShowRefundPct: 100, offerCompensationSlot: true,
  });

  useEffect(() => { if (policy) setForm(policy); }, [policy]);

  async function handleSave() {
    setSaving(true);
    try {
      await fetchWithAuth(`/api/centres/${centreId}/cancellation-policy`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      });
      onRefresh();
      toast({ title: "Cancellation policy saved ✓" });
    } catch { toast({ title: "Failed to save", variant: "destructive" }); }
    finally { setSaving(false); }
  }

  function pctField(label: string, key: keyof CancellationPolicy) {
    return (
      <div>
        <Label className="text-xs">{label}</Label>
        <div className="flex items-center gap-2 mt-1">
          <Input type="number" min={0} max={100} value={form[key] as number} onChange={(e) => setForm(p => ({ ...p, [key]: Number(e.target.value) }))} className="w-24 text-sm" />
          <span className="text-sm text-gray-500">%</span>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h2 className="text-lg font-serif font-bold text-[#1A2340]">Cancellation Policy</h2>
        <p className="text-xs text-gray-400 mt-1">Configure your cancellation windows and refund percentages.</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-xs">Window 1 — Free cancellation before</Label>
            <div className="flex items-center gap-2 mt-1">
              <Input type="number" min={0} value={form.window1Hours} onChange={(e) => setForm(p => ({ ...p, window1Hours: Number(e.target.value) }))} className="w-24 text-sm" />
              <span className="text-sm text-gray-500">hours</span>
            </div>
          </div>
          {pctField("Refund % for Window 1", "window1RefundPct")}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-xs">Window 2 — Partial refund before</Label>
            <div className="flex items-center gap-2 mt-1">
              <Input type="number" min={0} value={form.window2Hours} onChange={(e) => setForm(p => ({ ...p, window2Hours: Number(e.target.value) }))} className="w-24 text-sm" />
              <span className="text-sm text-gray-500">hours</span>
            </div>
          </div>
          {pctField("Refund % for Window 2", "window2RefundPct")}
        </div>

        {pctField("Refund % inside Window 2 (last-minute)", "insideWindow2RefundPct")}
        {pctField("Refund % — Parent no-show", "noShowRefundPct")}
        {pctField("Refund % — Centre no-show (full refund recommended)", "centreNoShowRefundPct")}

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={form.offerCompensationSlot} onChange={(e) => setForm(p => ({ ...p, offerCompensationSlot: e.target.checked }))} className="accent-teal-600" />
          Offer a compensation slot on an alternate date instead of refund
        </label>
      </div>

      <Button onClick={handleSave} disabled={saving} className="bg-teal-600 hover:bg-teal-700 text-white gap-2">
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
        Save Policy
      </Button>
    </div>
  );
}

type ProfileForm = {
  name: string; description: string; address: string; city: string; state: string;
  pincode: string; phone: string; email: string; website: string;
  registrationNumbers: string; yearsInOperation: string;
  therapyTypesOffered: string[]; languagesSpoken: string;
  photoUrl: string;
};

function ProfileSettingsTab({ form, setForm, onSave, saving }: {
  centre: TherapyCentre;
  form: ProfileForm;
  setForm: React.Dispatch<React.SetStateAction<ProfileForm>>;
  onSave: () => void;
  saving: boolean;
}) {
  function toggleTherapyType(t: string) {
    setForm((prev) => ({
      ...prev,
      therapyTypesOffered: prev.therapyTypesOffered.includes(t)
        ? prev.therapyTypesOffered.filter((x) => x !== t)
        : [...prev.therapyTypesOffered, t],
    }));
  }

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <h2 className="text-lg font-serif font-bold text-[#1A2340]">Centre Profile</h2>
        <p className="text-xs text-gray-400 mt-1">Update your centre's public profile.</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm space-y-4">
        <div>
          <Label className="mb-2 block">Centre Photo</Label>
          <div className="flex items-center gap-4">
            {form.photoUrl && (
              <img src={form.photoUrl} alt="Centre" className="w-16 h-16 rounded-xl object-cover border border-gray-200 shrink-0" />
            )}
            <FileUploadField
              label={form.photoUrl ? "Change photo" : "Upload photo"}
              onUploaded={(key) => setForm((p) => ({ ...p, photoUrl: key }))}
              uploadedPath={form.photoUrl}
              accept="image/*"
            />
          </div>
        </div>
        <div><Label>Centre Name</Label><Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} className="mt-1" /></div>
        <div><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} className="mt-1 min-h-[90px]" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>City</Label><Input value={form.city} onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))} className="mt-1" /></div>
          <div><Label>State</Label><Input value={form.state} onChange={(e) => setForm((p) => ({ ...p, state: e.target.value }))} className="mt-1" /></div>
        </div>
        <div><Label>Address</Label><Textarea value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} className="mt-1 min-h-[60px]" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="flex items-center gap-1"><Phone size={12} />Phone</Label><Input value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} className="mt-1" /></div>
          <div><Label className="flex items-center gap-1"><Mail size={12} />Email</Label><Input value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} className="mt-1" /></div>
        </div>
        <div><Label className="flex items-center gap-1"><Globe size={12} />Website</Label><Input value={form.website} onChange={(e) => setForm((p) => ({ ...p, website: e.target.value }))} placeholder="https://..." className="mt-1" /></div>
        <div><Label>Registration / License No.</Label><Input value={form.registrationNumbers} onChange={(e) => setForm((p) => ({ ...p, registrationNumbers: e.target.value }))} className="mt-1" /></div>
        <div><Label>Years in operation</Label><Input type="number" min={0} value={form.yearsInOperation} onChange={(e) => setForm((p) => ({ ...p, yearsInOperation: e.target.value }))} className="mt-1 w-28" /></div>
        <div><Label>Languages spoken</Label><Input value={form.languagesSpoken} onChange={(e) => setForm((p) => ({ ...p, languagesSpoken: e.target.value }))} placeholder="English, Hindi, Kannada" className="mt-1" /></div>
        <div>
          <Label className="mb-2 block">Therapy types offered</Label>
          <div className="flex flex-wrap gap-2">
            {THERAPY_TYPES.map((t) => {
              const selected = form.therapyTypesOffered.includes(t);
              return (
                <button key={t} type="button" onClick={() => toggleTherapyType(t)}
                  className={`px-3 py-1 rounded-full border text-sm font-medium transition-all ${selected ? "bg-teal-600 text-white border-teal-600" : "bg-white border-gray-200 text-gray-700 hover:border-teal-400"}`}>
                  {t}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <Button onClick={onSave} disabled={saving} className="bg-teal-600 hover:bg-teal-700 text-white gap-2">
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
        Save Changes
      </Button>
    </div>
  );
}
