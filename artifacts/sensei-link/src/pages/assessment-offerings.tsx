import { useState } from "react";
import { useUser } from "@clerk/react";
import { Redirect } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  useGetMyAssessmentOfferings,
  useCreateAssessmentOffering,
  useUpdateAssessmentOffering,
  useDeleteAssessmentOffering,
  getMyAssessmentOfferingsQueryKey,
  type AssessmentOfferingType,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Pencil, Clock, IndianRupee, ToggleLeft, ToggleRight, Trash2, ClipboardList } from "lucide-react";

const ASSESSMENT_TYPES = [
  "Developmental Assessment",
  "Speech & Language Assessment",
  "Occupational Therapy Assessment",
  "Psychological Assessment",
  "Educational Assessment",
  "Behavioural Assessment",
  "Sensory Processing Assessment",
  "Neuropsychological Assessment",
  "Other",
];

interface OfferingFormState {
  title: string;
  assessmentType: string;
  description: string;
  durationMinutes: string;
  priceInr: string;
  whatIsIncluded: string;
}

const EMPTY_FORM: OfferingFormState = {
  title: "",
  assessmentType: ASSESSMENT_TYPES[0]!,
  description: "",
  durationMinutes: "60",
  priceInr: "",
  whatIsIncluded: "",
};

function offeringToForm(o: AssessmentOfferingType): OfferingFormState {
  return {
    title: o.title,
    assessmentType: o.assessmentType,
    description: o.description ?? "",
    durationMinutes: String(o.durationMinutes),
    priceInr: String(o.priceInr),
    whatIsIncluded: o.whatIsIncluded ?? "",
  };
}

interface OfferingFormProps {
  open: boolean;
  onClose: () => void;
  editing: AssessmentOfferingType | null;
}

function OfferingFormDialog({ open, onClose, editing }: OfferingFormProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<OfferingFormState>(editing ? offeringToForm(editing) : EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const createMutation = useCreateAssessmentOffering();
  const updateMutation = useUpdateAssessmentOffering();

  function set(key: keyof OfferingFormState, val: string) {
    setForm((prev) => ({ ...prev, [key]: val }));
  }

  async function handleSave() {
    if (!form.title.trim() || !form.priceInr) {
      toast({ title: "Title and price are required", variant: "destructive" });
      return;
    }
    const priceInr = parseInt(form.priceInr, 10);
    const durationMinutes = parseInt(form.durationMinutes, 10);
    if (isNaN(priceInr) || priceInr < 0) {
      toast({ title: "Enter a valid price", variant: "destructive" });
      return;
    }
    if (isNaN(durationMinutes) || durationMinutes < 15) {
      toast({ title: "Duration must be at least 15 minutes", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        await updateMutation.mutateAsync({
          id: editing.id,
          data: {
            title: form.title.trim(),
            assessmentType: form.assessmentType,
            description: form.description.trim() || undefined,
            durationMinutes,
            priceInr,
            whatIsIncluded: form.whatIsIncluded.trim() || undefined,
          },
        });
        toast({ title: "Offering updated" });
      } else {
        await createMutation.mutateAsync({
          title: form.title.trim(),
          assessmentType: form.assessmentType,
          description: form.description.trim() || undefined,
          durationMinutes,
          priceInr,
          whatIsIncluded: form.whatIsIncluded.trim() || undefined,
        });
        toast({ title: "Assessment offering added" });
      }
      void qc.invalidateQueries({ queryKey: getMyAssessmentOfferingsQueryKey() });
      onClose();
    } catch {
      toast({ title: "Could not save offering", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif text-[#1A2340]">
            {editing ? "Edit Offering" : "Add Assessment Offering"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">Title *</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="e.g. Comprehensive Developmental Assessment"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2EC4A5]"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">Type *</label>
            <select
              value={form.assessmentType}
              onChange={(e) => set("assessmentType", e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2EC4A5] bg-white"
            >
              {ASSESSMENT_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">Description</label>
            <Textarea
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="What does this assessment involve? Who is it for?"
              rows={3}
              className="text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Duration (minutes) *</label>
              <input
                type="number"
                value={form.durationMinutes}
                onChange={(e) => set("durationMinutes", e.target.value)}
                min="15"
                max="480"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2EC4A5]"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Price (₹) *</label>
              <input
                type="number"
                value={form.priceInr}
                onChange={(e) => set("priceInr", e.target.value)}
                min="0"
                placeholder="e.g. 2500"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2EC4A5]"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">What's included</label>
            <input
              type="text"
              value={form.whatIsIncluded}
              onChange={(e) => set("whatIsIncluded", e.target.value)}
              placeholder="e.g. Written report, parent consultation, follow-up call"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2EC4A5]"
            />
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button
            className="flex-1 bg-[#2EC4A5] hover:bg-[#25a98d] text-white"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? <Loader2 className="animate-spin" size={14} /> : editing ? "Save Changes" : "Add Offering"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function AssessmentOfferingsPage() {
  const { isSignedIn, isLoaded, user } = useUser();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [editingOffering, setEditingOffering] = useState<AssessmentOfferingType | null>(null);

  const { data: offerings = [], isLoading } = useGetMyAssessmentOfferings();
  const toggleMutation = useUpdateAssessmentOffering();
  const deleteMutation = useDeleteAssessmentOffering();

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-[#F5F7FA] flex items-center justify-center">
        <Loader2 className="animate-spin text-[#2EC4A5]" size={32} />
      </div>
    );
  }

  if (!isSignedIn) return <Redirect to="/sign-in" />;

  const role = (user.publicMetadata as { role?: string }).role ?? "parent";
  if (role !== "professional" && role !== "admin") return <Redirect to="/dashboard" />;

  async function handleToggle(o: AssessmentOfferingType) {
    try {
      await toggleMutation.mutateAsync({ id: o.id, data: { isActive: !o.isActive } });
      void qc.invalidateQueries({ queryKey: getMyAssessmentOfferingsQueryKey() });
      toast({ title: o.isActive ? "Offering hidden from parents" : "Offering now visible to parents" });
    } catch {
      toast({ title: "Could not update offering", variant: "destructive" });
    }
  }

  async function handleDelete(o: AssessmentOfferingType) {
    if (!confirm(`Remove "${o.title}"? Parents won't be able to book it.`)) return;
    try {
      await deleteMutation.mutateAsync(o.id);
      void qc.invalidateQueries({ queryKey: getMyAssessmentOfferingsQueryKey() });
      toast({ title: "Offering removed" });
    } catch {
      toast({ title: "Could not remove offering", variant: "destructive" });
    }
  }

  return (
    <div className="min-h-screen bg-[#F5F7FA]">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="font-serif text-2xl sm:text-3xl font-bold text-[#1A2340]">My Assessment Offerings</h1>
            <p className="text-sm text-gray-500 mt-1">
              List the assessments you offer. Parents can browse and book them from your profile.
            </p>
          </div>
          <Button
            className="bg-[#2EC4A5] hover:bg-[#25a98d] text-white shrink-0"
            onClick={() => { setEditingOffering(null); setFormOpen(true); }}
          >
            <Plus size={15} className="mr-1" /> Add
          </Button>
        </div>

        {isLoading && (
          <div className="flex justify-center py-12">
            <Loader2 className="animate-spin text-[#2EC4A5]" size={28} />
          </div>
        )}

        {!isLoading && offerings.length === 0 && (
          <div className="text-center py-14">
            <div className="w-14 h-14 rounded-full bg-[#2EC4A5]/10 flex items-center justify-center mx-auto mb-4">
              <ClipboardList size={28} className="text-[#2EC4A5]" />
            </div>
            <p className="font-medium text-gray-600">No offerings yet</p>
            <p className="text-sm text-gray-400 mt-1 mb-4">Add your first assessment offering to make it bookable.</p>
            <Button
              className="bg-[#2EC4A5] hover:bg-[#25a98d] text-white"
              onClick={() => { setEditingOffering(null); setFormOpen(true); }}
            >
              <Plus size={14} className="mr-1" /> Add your first offering
            </Button>
          </div>
        )}

        <div className="space-y-3">
          {offerings.map((o) => (
            <div
              key={o.id}
              className={`bg-white rounded-xl p-4 shadow-[0_2px_12px_rgba(26,35,64,0.06)] border transition-all ${
                o.isActive ? "border-gray-50" : "border-gray-100 opacity-60"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="font-semibold text-[#1A2340] text-sm">{o.title}</p>
                    {!o.isActive && (
                      <Badge className="text-xs bg-gray-100 text-gray-500">Hidden</Badge>
                    )}
                  </div>
                  <p className="text-xs text-[#2EC4A5] font-medium">{o.assessmentType}</p>
                  {o.description && (
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">{o.description}</p>
                  )}
                  <div className="flex items-center gap-3 mt-2">
                    <span className="flex items-center gap-1 text-xs text-gray-400">
                      <Clock size={11} /> {o.durationMinutes} min
                    </span>
                    <span className="flex items-center gap-1 text-xs font-semibold text-[#1A2340]">
                      <IndianRupee size={11} /> ₹{o.priceInr.toLocaleString("en-IN")}
                    </span>
                  </div>
                  {o.whatIsIncluded && (
                    <p className="text-xs text-gray-400 mt-1">{o.whatIsIncluded}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleToggle(o)}
                    title={o.isActive ? "Hide from parents" : "Show to parents"}
                    className="p-1.5 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    {o.isActive
                      ? <ToggleRight size={18} className="text-[#2EC4A5]" />
                      : <ToggleLeft size={18} className="text-gray-400" />}
                  </button>
                  <button
                    onClick={() => { setEditingOffering(o); setFormOpen(true); }}
                    title="Edit"
                    className="p-1.5 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <Pencil size={14} className="text-gray-400" />
                  </button>
                  <button
                    onClick={() => handleDelete(o)}
                    title="Remove"
                    className="p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                  >
                    <Trash2 size={14} className="text-gray-400 hover:text-red-500" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {formOpen && (
          <OfferingFormDialog
            open={formOpen}
            onClose={() => { setFormOpen(false); setEditingOffering(null); }}
            editing={editingOffering}
          />
        )}
      </div>
    </div>
  );
}
