import { useState, useEffect, useRef, type ReactNode } from "react";
import { useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Plus, X, Check } from "lucide-react";
import { CHILD_PROFILE_SKIP_KEY } from "@/contexts/SelectedChildContext";
import {
  useCreateChild,
  useUpdateChild,
  useGetChild,
  type CreateChildPayload,
} from "@workspace/api-client-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type WizardData = {
  name: string;
  dob: string;
  gender: string;
  city: string;
  diagnosisStatus: string;
  conditions: string[];
  schoolType: string;
  grade: string;
  schoolStartTime: string;
  schoolEndTime: string;
  existingTherapies: { type: string; frequency: string }[];
  goalsAreas: string[];
  preferredModes: string[];
  availableTimeWindows: string[];
  languages: string[];
  budgetKey: string;
  budgetMinInr: number | null;
  budgetMaxInr: number | null;
  careNotes: { calming: string; triggers: string; communicationMode: string; favorites: string };
  consent: { intakeShare: boolean; media: boolean; reports: boolean };
};

const DEFAULT: WizardData = {
  name: "",
  dob: "",
  gender: "",
  city: "",
  diagnosisStatus: "",
  conditions: [],
  schoolType: "",
  grade: "",
  schoolStartTime: "",
  schoolEndTime: "",
  existingTherapies: [],
  goalsAreas: [],
  preferredModes: [],
  availableTimeWindows: [],
  languages: [],
  budgetKey: "",
  budgetMinInr: null,
  budgetMaxInr: null,
  careNotes: { calming: "", triggers: "", communicationMode: "", favorites: "" },
  consent: { intakeShare: false, media: false, reports: false },
};

// ─── Option lists ─────────────────────────────────────────────────────────────

const DIAGNOSIS_STATUS = [
  { value: "formal_diagnosis", label: "Yes, we have a diagnosis" },
  { value: "awaiting_assessment", label: "Awaiting assessment" },
  { value: "exploring", label: "Not sure / exploring" },
  { value: "support_only", label: "Seeking support, no diagnosis" },
];

const CONDITIONS = [
  "Autism Spectrum (ASD)", "ADHD / ADD", "Dyslexia", "Dyspraxia / DCD",
  "Cerebral Palsy", "Down Syndrome", "Intellectual Disability",
  "Speech / Language delay", "Sensory processing", "Anxiety / Emotional regulation",
  "Global developmental delay", "Visual impairment", "Hearing impairment", "Other",
];

const SCHOOL_TYPES = [
  "Playschool / nursery", "Regular school", "Inclusive school",
  "Special school", "Home-schooled", "Not in school yet",
];

const GOALS = [
  "Communication & speech", "Academics & learning", "Motor skills",
  "Sensory integration", "Behaviour & regulation", "Social skills",
  "Life skills", "Parent / caregiver support",
];

const PREFERRED_MODES = ["In-centre", "Home visit", "Online"];

const TIME_WINDOWS = [
  "Weekday mornings", "Weekday afternoons", "Weekday evenings",
  "Saturday", "Sunday", "Flexible",
];

const LANGUAGES = [
  "English", "Hindi", "Tamil", "Telugu", "Kannada",
  "Malayalam", "Marathi", "Bengali", "Gujarati", "Punjabi", "Odia",
];

const BUDGET_PRESETS = [
  { key: "0-500",     label: "Up to ₹500",    min: 0,    max: 500  },
  { key: "500-1000",  label: "₹500–₹1,000",   min: 500,  max: 1000 },
  { key: "1000-2000", label: "₹1,000–₹2,000", min: 1000, max: 2000 },
  { key: "2000+",     label: "₹2,000+",       min: 2000, max: null  },
  { key: "flexible",  label: "Flexible",       min: null, max: null  },
];

// ─── Small helpers ────────────────────────────────────────────────────────────

function Chip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium border transition-colors ${
        selected
          ? "bg-teal-600 text-white border-teal-600"
          : "bg-white text-gray-700 border-gray-200 hover:border-teal-400 hover:text-teal-700"
      }`}
    >
      {selected && <Check size={12} strokeWidth={3} />}
      {label}
    </button>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
      {children}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, type = "text" }: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm placeholder:text-gray-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
    />
  );
}

function TextArea({ value, onChange, placeholder, rows = 3 }: {
  value: string; onChange: (v: string) => void; placeholder?: string; rows?: number;
}) {
  return (
    <textarea
      rows={rows}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm placeholder:text-gray-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 resize-none"
    />
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ChildOnboardingPage() {
  const params = useParams<{ id?: string }>();
  const editChildId = params.id ? parseInt(params.id, 10) : undefined;

  const [step, setStep] = useState(1);
  const [data, setData] = useState<WizardData>(DEFAULT);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveAttempted, setSaveAttempted] = useState(false);
  const consentRef = useRef<HTMLDivElement>(null);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const createChild = useCreateChild();
  const updateChild = useUpdateChild();
  const { data: existingChild } = useGetChild(editChildId ?? 0, { query: { enabled: !!editChildId } });

  useEffect(() => {
    if (!existingChild || !editChildId) return;
    const c = existingChild as Record<string, unknown>;
    const budgetMin = c.budgetMinInr as number | null;
    const budgetMax = c.budgetMaxInr as number | null;
    const matchedPreset = BUDGET_PRESETS.find(
      (p) => p.min === budgetMin && p.max === budgetMax,
    );
    setData({
      name:                 (c.name as string) ?? "",
      dob:                  (c.dob as string) ?? "",
      gender:               (c.gender as string) ?? "",
      city:                 (c.city as string) ?? "",
      diagnosisStatus:      (c.diagnosisStatus as string) ?? "",
      conditions:           (c.conditions as string[]) ?? [],
      schoolType:           (c.schoolType as string) ?? "",
      grade:                (c.grade as string) ?? "",
      schoolStartTime:      (c.schoolStartTime as string) ?? "",
      schoolEndTime:        (c.schoolEndTime as string) ?? "",
      existingTherapies:    (c.existingTherapies as { type: string; frequency: string }[]) ?? [],
      goalsAreas:           (c.goalsAreas as string[]) ?? [],
      preferredModes:       (c.preferredModes as string[]) ?? [],
      availableTimeWindows: (c.availableTimeWindows as string[]) ?? [],
      languages:            (c.languages as string[]) ?? [],
      budgetKey:            matchedPreset?.key ?? "",
      budgetMinInr:         budgetMin,
      budgetMaxInr:         budgetMax,
      careNotes:            (c.careNotes as WizardData["careNotes"]) ?? DEFAULT.careNotes,
      consent:              (c.consent as WizardData["consent"]) ?? DEFAULT.consent,
    });
  }, [existingChild, editChildId]);

  function update<K extends keyof WizardData>(key: K, value: WizardData[K]) {
    setData((prev) => ({ ...prev, [key]: value }));
  }

  function toggleChip(key: "conditions" | "goalsAreas" | "preferredModes" | "availableTimeWindows" | "languages", item: string) {
    setData((prev) => {
      const arr = prev[key];
      return { ...prev, [key]: arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item] };
    });
  }

  function selectBudget(preset: typeof BUDGET_PRESETS[number]) {
    const toggling = preset.key === data.budgetKey;
    update("budgetKey", toggling ? "" : preset.key);
    update("budgetMinInr", toggling ? null : preset.min);
    update("budgetMaxInr", toggling ? null : preset.max ?? null);
  }

  function addTherapy() {
    setData((prev) => ({ ...prev, existingTherapies: [...prev.existingTherapies, { type: "", frequency: "" }] }));
  }

  function updateTherapy(idx: number, field: "type" | "frequency", value: string) {
    setData((prev) => ({
      ...prev,
      existingTherapies: prev.existingTherapies.map((t, i) => i === idx ? { ...t, [field]: value } : t),
    }));
  }

  function removeTherapy(idx: number) {
    setData((prev) => ({ ...prev, existingTherapies: prev.existingTherapies.filter((_, i) => i !== idx) }));
  }

  function handleSkip() {
    sessionStorage.setItem(CHILD_PROFILE_SKIP_KEY, "1");
    setLocation("/home", { replace: true });
  }

  async function handleSubmit() {
    setSaveError(null);
    const payload: CreateChildPayload = {
      name: data.name.trim(),
      ...(data.dob && { dob: data.dob }),
      ...(data.gender && { gender: data.gender }),
      ...(data.city.trim() && { city: data.city.trim() }),
      ...(data.diagnosisStatus && { diagnosisStatus: data.diagnosisStatus }),
      ...(data.conditions.length > 0 && { conditions: data.conditions }),
      ...(data.schoolType && { schoolType: data.schoolType }),
      ...(data.grade.trim() && { grade: data.grade.trim() }),
      ...(data.schoolStartTime && { schoolStartTime: data.schoolStartTime }),
      ...(data.schoolEndTime && { schoolEndTime: data.schoolEndTime }),
      ...(data.existingTherapies.filter((t) => t.type).length > 0 && {
        existingTherapies: data.existingTherapies.filter((t) => t.type),
      }),
      ...(data.goalsAreas.length > 0 && { goalsAreas: data.goalsAreas }),
      ...(data.preferredModes.length > 0 && { preferredModes: data.preferredModes }),
      ...(data.availableTimeWindows.length > 0 && { availableTimeWindows: data.availableTimeWindows }),
      ...(data.languages.length > 0 && { languages: data.languages }),
      ...(data.budgetMinInr != null && { budgetMinInr: data.budgetMinInr }),
      ...(data.budgetMaxInr != null && { budgetMaxInr: data.budgetMaxInr }),
      careNotes: data.careNotes,
      consent: data.consent,
    };

    try {
      if (editChildId) {
        await updateChild.mutateAsync({ id: editChildId, data: payload });
        queryClient.invalidateQueries({ queryKey: ["/children"] });
        queryClient.invalidateQueries({ queryKey: [`/children/${editChildId}`] });
        setLocation("/home", { replace: true });
      } else {
        await createChild.mutateAsync(payload);
        queryClient.invalidateQueries({ queryKey: ["/children"] });
        sessionStorage.removeItem(CHILD_PROFILE_SKIP_KEY);
        setLocation("/home", { replace: true });
      }
    } catch (e: unknown) {
      setSaveError((e as Error)?.message ?? "Something went wrong. Please try again.");
    }
  }

  const childName = data.name.trim() || "your child";
  const canNext1 = data.name.trim().length > 0;
  const canSubmit = data.consent.intakeShare;

  // ─── Step content ───────────────────────────────────────────────────────────

  function renderStep() {
    switch (step) {
      case 1:
        return (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold text-gray-900">{editChildId ? "Edit child profile" : "Let's start with the basics"}</h2>
              <p className="mt-1 text-sm text-gray-500">
                {editChildId ? "Update details below — changes save on the last step." : "This helps us personalise everything — you can always update it later."}
              </p>
            </div>

            <Field label="Child's name *">
              <TextInput
                value={data.name}
                onChange={(v) => update("name", v)}
                placeholder="e.g. Arjun"
              />
            </Field>

            <Field label="Date of birth">
              <TextInput type="date" value={data.dob} onChange={(v) => update("dob", v)} />
            </Field>

            <Field label="Gender">
              <div className="flex flex-wrap gap-2">
                {["Boy", "Girl", "Other", "Prefer not to say"].map((g) => (
                  <Chip key={g} label={g} selected={data.gender === g} onClick={() => update("gender", data.gender === g ? "" : g)} />
                ))}
              </div>
            </Field>

            <Field label="City">
              <TextInput
                value={data.city}
                onChange={(v) => update("city", v)}
                placeholder="e.g. Hyderabad"
              />
            </Field>
          </div>
        );

      case 2:
        return (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Diagnosis & conditions</h2>
              <p className="mt-1 text-sm text-gray-500">
                No diagnosis yet? That's completely fine — pick what fits best.
              </p>
            </div>

            <Field label="Where are you in the journey?">
              <div className="flex flex-wrap gap-2">
                {DIAGNOSIS_STATUS.map((opt) => (
                  <Chip
                    key={opt.value}
                    label={opt.label}
                    selected={data.diagnosisStatus === opt.value}
                    onClick={() => update("diagnosisStatus", data.diagnosisStatus === opt.value ? "" : opt.value)}
                  />
                ))}
              </div>
            </Field>

            {data.diagnosisStatus === "exploring" && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-900">Not sure where to start?</p>
                <p className="mt-1 text-sm text-amber-800">
                  That's okay. Our specialists are experienced in helping families who are still figuring things out.
                </p>
                <button
                  onClick={() => setLocation("/search")}
                  className="mt-3 inline-flex items-center gap-1 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
                >
                  Browse specialists <ArrowRight size={14} />
                </button>
              </div>
            )}

            <Field label={`Conditions (select all that apply for ${childName})`}>
              <div className="flex flex-wrap gap-2">
                {CONDITIONS.map((c) => (
                  <Chip key={c} label={c} selected={data.conditions.includes(c)} onClick={() => toggleChip("conditions", c)} />
                ))}
              </div>
            </Field>
          </div>
        );

      case 3:
        return (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold text-gray-900">School & current therapies</h2>
              <p className="mt-1 text-sm text-gray-500">
                Helps specialists understand {childName}'s current routine.
              </p>
            </div>

            <Field label="School type">
              <div className="flex flex-wrap gap-2">
                {SCHOOL_TYPES.map((s) => (
                  <Chip key={s} label={s} selected={data.schoolType === s} onClick={() => update("schoolType", data.schoolType === s ? "" : s)} />
                ))}
              </div>
            </Field>

            <Field label="Grade / class">
              <TextInput value={data.grade} onChange={(v) => update("grade", v)} placeholder="e.g. Grade 2, LKG, Nursery" />
            </Field>

            <Field label="School hours (optional)" hint="Used to match shadow teachers who are free during school time">
              <div className="flex items-center gap-3">
                <div className="flex flex-1 flex-col gap-1">
                  <label className="text-xs text-gray-500">Start</label>
                  <input
                    type="time"
                    value={data.schoolStartTime}
                    onChange={(e) => update("schoolStartTime", e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                  />
                </div>
                <span className="mt-5 text-gray-400">–</span>
                <div className="flex flex-1 flex-col gap-1">
                  <label className="text-xs text-gray-500">End</label>
                  <input
                    type="time"
                    value={data.schoolEndTime}
                    onChange={(e) => update("schoolEndTime", e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                  />
                </div>
              </div>
            </Field>

            <Field label="Current therapies">
              <div className="space-y-2">
                {data.existingTherapies.map((t, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      value={t.type}
                      onChange={(e) => updateTherapy(i, "type", e.target.value)}
                      placeholder="e.g. Speech therapy"
                      className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                    />
                    <input
                      value={t.frequency}
                      onChange={(e) => updateTherapy(i, "frequency", e.target.value)}
                      placeholder="e.g. 2x/week"
                      className="w-28 rounded-lg border border-gray-200 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                    />
                    <button
                      type="button"
                      onClick={() => removeTherapy(i)}
                      className="rounded-lg border border-gray-200 p-2 text-gray-400 hover:border-red-200 hover:text-red-500"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addTherapy}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-500 hover:border-teal-400 hover:text-teal-600"
                >
                  <Plus size={14} /> Add therapy
                </button>
              </div>
            </Field>
          </div>
        );

      case 4:
        return (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Goals & session preferences</h2>
              <p className="mt-1 text-sm text-gray-500">
                What outcomes matter most? Select everything that applies.
              </p>
            </div>

            <Field label="Goals for this support">
              <div className="flex flex-wrap gap-2">
                {GOALS.map((g) => (
                  <Chip key={g} label={g} selected={data.goalsAreas.includes(g)} onClick={() => toggleChip("goalsAreas", g)} />
                ))}
              </div>
            </Field>

            <Field label="Preferred session format">
              <div className="flex flex-wrap gap-2">
                {PREFERRED_MODES.map((m) => (
                  <Chip key={m} label={m} selected={data.preferredModes.includes(m)} onClick={() => toggleChip("preferredModes", m)} />
                ))}
              </div>
            </Field>
          </div>
        );

      case 5:
        return (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Availability & budget</h2>
              <p className="mt-1 text-sm text-gray-500">
                This helps us surface the right options, nothing is locked in.
              </p>
            </div>

            <Field label="Available time slots">
              <div className="flex flex-wrap gap-2">
                {TIME_WINDOWS.map((t) => (
                  <Chip key={t} label={t} selected={data.availableTimeWindows.includes(t)} onClick={() => toggleChip("availableTimeWindows", t)} />
                ))}
              </div>
            </Field>

            <Field label="Language preference">
              <div className="flex flex-wrap gap-2">
                {LANGUAGES.map((l) => (
                  <Chip key={l} label={l} selected={data.languages.includes(l)} onClick={() => toggleChip("languages", l)} />
                ))}
              </div>
            </Field>

            <Field label="Budget per session">
              <div className="flex flex-wrap gap-2">
                {BUDGET_PRESETS.map((p) => (
                  <Chip key={p.key} label={p.label} selected={data.budgetKey === p.key} onClick={() => selectBudget(p)} />
                ))}
              </div>
            </Field>
          </div>
        );

      case 6:
        return (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Care notes & consent</h2>
              <p className="mt-1 text-sm text-gray-500">
                Optional notes help specialists prepare. Consent is required to save the profile.
              </p>
            </div>

            <Field label="What calms or comforts them?">
              <TextArea
                value={data.careNotes.calming}
                onChange={(v) => update("careNotes", { ...data.careNotes, calming: v })}
                placeholder="e.g. Soft toys, quiet music, predictable routines"
              />
            </Field>

            <Field label="Triggers to be aware of">
              <TextArea
                value={data.careNotes.triggers}
                onChange={(v) => update("careNotes", { ...data.careNotes, triggers: v })}
                placeholder="e.g. Loud noises, sudden changes, crowded spaces"
              />
            </Field>

            <Field label="Communication mode">
              <TextInput
                value={data.careNotes.communicationMode}
                onChange={(v) => update("careNotes", { ...data.careNotes, communicationMode: v })}
                placeholder="e.g. Verbal, AAC device, sign language, picture cards"
              />
            </Field>

            <Field label="Favourites (icebreakers)">
              <TextInput
                value={data.careNotes.favorites}
                onChange={(v) => update("careNotes", { ...data.careNotes, favorites: v })}
                placeholder="e.g. Trains, dinosaurs, Peppa Pig, cricket"
              />
            </Field>

            <div
              ref={consentRef}
              className={`rounded-xl border p-4 space-y-3 transition-colors ${
                saveAttempted && !data.consent.intakeShare
                  ? "border-red-400 bg-red-50 ring-2 ring-red-300"
                  : "border-gray-200 bg-gray-50"
              }`}
            >
              <p className="text-sm font-semibold text-gray-800">Permissions</p>
              {([
                { key: "intakeShare" as const, label: "Share this profile with matched specialists", required: true },
                { key: "media" as const, label: "Allow session photos / videos with my consent" },
                { key: "reports" as const, label: "Share session reports between specialists" },
              ]).map(({ key, label, required }) => (
                <label key={key} className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={data.consent[key]}
                    onChange={(e) => {
                      update("consent", { ...data.consent, [key]: e.target.checked });
                      if (key === "intakeShare" && e.target.checked) setSaveAttempted(false);
                    }}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                  />
                  <span className="text-sm text-gray-700">
                    {label}
                    {required && <span className="ml-1 text-teal-600 font-medium">*</span>}
                  </span>
                </label>
              ))}
            </div>

            {saveError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {saveError}
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  }

  // ─── Layout ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen flex-col bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-6 pb-2">
        <button
          onClick={() => step > 1 ? setStep((s) => s - 1) : editChildId ? setLocation("/home") : handleSkip()}
          className="flex h-9 w-9 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100"
        >
          <ArrowLeft size={20} />
        </button>

        <div className="flex items-center gap-1.5">
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              className={`h-1.5 w-5 rounded-full transition-colors ${
                i + 1 < step ? "bg-teal-500" : i + 1 === step ? "bg-teal-600" : "bg-gray-200"
              }`}
            />
          ))}
        </div>

        {!editChildId && (
          <button
            onClick={handleSkip}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Skip for now
          </button>
        )}
      </div>

      <p className="px-5 text-xs text-gray-400">Step {step} of 6</p>

      {/* Step content */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {renderStep()}
      </div>

      {/* Footer */}
      <div className="sticky bottom-0 border-t border-gray-100 bg-white px-5 py-4">
        {step === 6 && saveAttempted && !canSubmit && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700">
            Tick "Share this profile with matched specialists" above to save.
          </div>
        )}
        {step < 6 ? (
          <button
            onClick={() => setStep((s) => s + 1)}
            disabled={step === 1 && !canNext1}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-40 hover:bg-teal-700 active:bg-teal-800 transition-colors"
          >
            Continue <ArrowRight size={16} />
          </button>
        ) : (
          <button
            onClick={() => {
              if (!canSubmit) {
                setSaveAttempted(true);
                consentRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
              } else {
                void handleSubmit();
              }
            }}
            disabled={createChild.isPending || updateChild.isPending}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-40 hover:bg-teal-700 active:bg-teal-800 transition-colors"
          >
            {(createChild.isPending || updateChild.isPending) ? "Saving…" : editChildId ? `Update ${data.name.trim() || "profile"} →` : `Save ${data.name.trim() || "profile"} →`}
          </button>
        )}

        {step === 6 && !editChildId && (
          <button
            onClick={handleSkip}
            className="mt-3 w-full text-center text-xs text-gray-400 hover:text-gray-600"
          >
            I'll set this up later
          </button>
        )}
      </div>
    </div>
  );
}
