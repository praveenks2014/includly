import { useEffect, useState, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { fetchWithAuth } from "@/lib/api";
import {
  useGetMyProfessionalProfile,
  getGetMyProfessionalProfileQueryKey,
  useGetMyIdentityVerification,
  useGetMyCertifications,
  useCreateUpiVerificationOrder,
  useConfirmUpiVerification,
} from "@workspace/api-client-react";
import { loadRazorpayScript, buildUpiTestCheckoutConfig } from "@/lib/razorpay";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { MultiSelectChips } from "@/components/MultiSelectChips";
import { FileUploadField } from "@/components/FileUploadField";
import {
  Loader2,
  ArrowLeft,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
} from "lucide-react";

type VerticalValue = "shadow_teacher" | "home_tutor" | "therapist";

const VERTICAL_META: Record<
  VerticalValue,
  { emoji: string; title: string; color: "teal" | "blue" | "violet" }
> = {
  shadow_teacher: { emoji: "🧑‍🏫", title: "Shadow Teacher", color: "teal" },
  home_tutor: { emoji: "📚", title: "Home Tutor", color: "blue" },
  therapist: { emoji: "🩺", title: "Therapist / Special Educator", color: "violet" },
};

const CONDITIONS_OPTIONS = [
  { value: "autism_asd", label: "Autism (ASD)" },
  { value: "adhd", label: "ADHD" },
  { value: "down_syndrome", label: "Down Syndrome" },
  { value: "cerebral_palsy", label: "Cerebral Palsy" },
  { value: "dyslexia", label: "Dyslexia" },
  { value: "dyspraxia", label: "Dyspraxia / DCD" },
  { value: "speech_language_delay", label: "Speech / Language Delay" },
  { value: "hearing_impairment", label: "Hearing Impairment" },
  { value: "visual_impairment", label: "Visual Impairment" },
  { value: "intellectual_disability", label: "Intellectual Disability" },
  { value: "multiple_disabilities", label: "Multiple Disabilities" },
  { value: "sensory_processing", label: "Sensory Processing Disorder" },
  { value: "no_experience", label: "No experience" },
  { value: "others", label: "Others" },
];

const GRADE_LEVELS = [
  { value: "pre_k_nursery", label: "Pre-K / Nursery" },
  { value: "kg", label: "KG / LKG / UKG" },
  { value: "grade_1_2", label: "Grade 1–2" },
  { value: "grade_3_5", label: "Grade 3–5" },
  { value: "grade_6_8", label: "Grade 6–8" },
  { value: "grade_9_10", label: "Grade 9–10" },
  { value: "grade_11_12", label: "Grade 11–12" },
];

const EDUCATION_OPTIONS = [
  "B.Ed (Bachelor of Education)",
  "M.Ed (Master of Education)",
  "B.Sc Special Education",
  "M.Sc Special Education",
  "BA Psychology",
  "MA Psychology",
  "Diploma in Special Education",
  "PGDSE (Post-Graduate Diploma in Special Education)",
  "Other",
];

const SHADOW_SETTINGS = [
  { value: "mainstream_school", label: "Mainstream / Regular School" },
  { value: "special_school", label: "Special School" },
  { value: "inclusive_classroom", label: "Inclusive Classroom" },
  { value: "home_setting", label: "Home Setting" },
  { value: "resource_room", label: "Resource Room" },
];

const SHADOW_APPROACHES = [
  { value: "aba", label: "ABA" },
  { value: "dir_floortime", label: "DIR / Floortime" },
  { value: "pecs", label: "PECS" },
  { value: "sensory_integration", label: "Sensory Integration" },
  { value: "teacch", label: "TEACCH" },
  { value: "play_therapy", label: "Play Therapy" },
  { value: "structured_teaching", label: "Structured Teaching" },
  { value: "visual_supports", label: "Visual Supports" },
];

const TUTOR_SUBJECTS = [
  { value: "mathematics", label: "Mathematics" },
  { value: "science", label: "Science" },
  { value: "english", label: "English" },
  { value: "hindi", label: "Hindi" },
  { value: "social_studies", label: "Social Studies" },
  { value: "evs", label: "Environmental Science (EVS)" },
  { value: "computer_science", label: "Computer Science" },
  { value: "art_craft", label: "Art & Craft" },
  { value: "music", label: "Music" },
  { value: "life_skills", label: "Life Skills" },
];

const TUTOR_BOARDS = [
  { value: "cbse", label: "CBSE" },
  { value: "icse", label: "ICSE / ISC" },
  { value: "ib", label: "IB (International Baccalaureate)" },
  { value: "cambridge", label: "Cambridge / IGCSE" },
  { value: "state_board", label: "State Board" },
  { value: "montessori", label: "Montessori" },
];

const TUTOR_APPROACHES = [
  { value: "multi_sensory", label: "Multi-sensory" },
  { value: "play_based", label: "Play-based" },
  { value: "visual_aids", label: "Visual Aids" },
  { value: "activity_based", label: "Activity-based" },
  { value: "structured", label: "Structured / Step-by-step" },
  { value: "oral_verbal", label: "Oral & Verbal" },
  { value: "assistive_tech", label: "Assistive Technology" },
];

const THERAPIST_DISCIPLINES = [
  "Occupational Therapy (OT)",
  "Speech & Language Therapy (SLT)",
  "Applied Behavior Analysis (ABA)",
  "Behavioral Therapy",
  "Physiotherapy",
  "Developmental Therapy",
  "Special Education",
  "Psychotherapy / Counselling",
  "Clinical Psychology",
  "Developmental Pediatrician",
  "Psychiatrist",
  "Rehabilitation Counselling",
  "Other",
];

// Not every therapist discipline is RCI-regulated in India — mirrors the
// backend's disciplineCredentialKind() in
// artifacts/api-server/src/lib/verificationRequirements.ts. Duplicated, not
// shared, because frontend/backend are separate packages with no shared
// constants module — keep both in sync if this mapping ever changes.
type TherapistCredentialKind = "rci" | "ot" | "medical" | "aba" | "ancillary";

const RCI_REQUIRED_DISCIPLINES = new Set([
  "Speech & Language Therapy (SLT)",
  "Special Education",
  "Clinical Psychology",
  "Rehabilitation Counselling",
]);
const MEDICAL_COUNCIL_DISCIPLINES = new Set(["Developmental Pediatrician", "Psychiatrist"]);
const ABA_DISCIPLINES = new Set(["Applied Behavior Analysis (ABA)", "Behavioral Therapy"]);

function disciplineCredentialKind(discipline: string): TherapistCredentialKind {
  if (discipline === "Occupational Therapy (OT)") return "ot";
  if (RCI_REQUIRED_DISCIPLINES.has(discipline)) return "rci";
  if (MEDICAL_COUNCIL_DISCIPLINES.has(discipline)) return "medical";
  if (ABA_DISCIPLINES.has(discipline)) return "aba";
  return "ancillary";
}

const ABA_CREDENTIAL_TYPES = ["BCBA", "RBT", "QABA"];

const THERAPIST_CONDITIONS = [
  { value: "autism_asd", label: "Autism (ASD)" },
  { value: "adhd", label: "ADHD" },
  { value: "cerebral_palsy", label: "Cerebral Palsy" },
  { value: "down_syndrome", label: "Down Syndrome" },
  { value: "developmental_delay", label: "Developmental Delay" },
  { value: "sensory_processing", label: "Sensory Processing Disorder" },
  { value: "communication_disorders", label: "Communication Disorders" },
  { value: "learning_disabilities", label: "Learning Disabilities" },
  { value: "intellectual_disability", label: "Intellectual Disability" },
  { value: "anxiety_ocd", label: "Anxiety / OCD" },
  { value: "others", label: "Others" },
];

const SESSION_MODES = [
  { value: "in_clinic", label: "In-clinic" },
  { value: "home_visit", label: "Home Visit" },
  { value: "online_teletherapy", label: "Online / Teletherapy" },
];

const AGE_GROUPS = [
  { value: "0_3", label: "0–3 yrs (Early Intervention)" },
  { value: "3_6", label: "3–6 years" },
  { value: "6_12", label: "6–12 years" },
  { value: "12_18", label: "12–18 years" },
  { value: "adults_18plus", label: "Adults (18+)" },
];

type ShadowForm = {
  highestEducation: string;
  highestEducationOther: string;
  conditionsSupported: string[];
  conditionsSupportedOther: string;
  settings: string[];
  gradeLevels: string[];
  approaches: string[];
  homeSession: boolean | null;
  certKey: string;
};

type TutorForm = {
  subjects: string[];
  boards: string[];
  gradeLevels: string[];
  specialNeedsExp: boolean | null;
  teachingApproaches: string[];
  certKey: string;
};

type TherapistForm = {
  discipline: string;
  disciplineOther: string;
  // "rci" kind — Speech & Language Therapy, Special Education, Clinical
  // Psychology, Rehabilitation Counselling
  rciRegistered: boolean | null;
  rciCrrNumber: string;
  // "ot" kind — Occupational Therapy
  aiotaMembershipNumber: string;
  ncahpRegistrationNumber: string; // optional — NCAHP still rolling out
  // "medical" kind — Developmental Pediatrician, Psychiatrist
  medicalCouncilRegistrationNumber: string;
  // "aba" kind — ABA / Behavioral Therapy
  abaCredentialType: string; // "BCBA" | "RBT" | "QABA"
  abaCredentialNumber: string;
  individuallyCredentialed: boolean | null; // capture-only, not enforced
  supervisingProfessionalName: string; // capture-only, not enforced
  supervisingRciNumber: string; // capture-only, not enforced
  // "ancillary" kind — Physiotherapy, Developmental Therapy,
  // Psychotherapy/Counselling, Other. All optional, no gate.
  statePhysioCouncilNumber: string; // Physiotherapy only
  ancillaryCertificationBody: string;
  conditionsTreated: string[];
  conditionsTreatedOther: string;
  sessionModes: string[];
  ageGroups: string[];
  certKey: string;
};

function SelectField({
  label,
  value,
  options,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-semibold text-gray-800">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </Label>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full h-10 pl-3 pr-10 text-sm border border-gray-200 rounded-lg bg-white appearance-none focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 text-gray-800"
        >
          <option value="">{placeholder ?? "Select one…"}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown size={14} className="absolute right-3 top-3 text-gray-400 pointer-events-none" />
      </div>
    </div>
  );
}

// Options where the underlying value is identical to its displayed label
// (plain string lists like EDUCATION_OPTIONS / THERAPIST_DISCIPLINES).
function toSelectOptions(values: string[]): { value: string; label: string }[] {
  return values.map((v) => ({ value: v, label: v }));
}

// Enforces that selecting `exclusiveValue` clears every other selection, and
// selecting anything else clears `exclusiveValue` — used for "No experience"
// vs. the rest of the multi-select chip list.
function applyExclusiveOption(next: string[], prev: string[], exclusiveValue: string): string[] {
  const justAddedExclusive = next.includes(exclusiveValue) && !prev.includes(exclusiveValue);
  if (justAddedExclusive) return [exclusiveValue];
  if (next.includes(exclusiveValue) && next.length > 1) return next.filter((v) => v !== exclusiveValue);
  return next;
}

function ChipsField({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-semibold text-gray-800">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </Label>
      {hint && <p className="text-xs text-gray-500 -mt-1">{hint}</p>}
      {children}
    </div>
  );
}

function YesNoField({
  label,
  required,
  value,
  onChange,
  color,
}: {
  label: string;
  required?: boolean;
  value: boolean | null;
  onChange: (v: boolean) => void;
  color: "teal" | "blue" | "violet";
}) {
  const activeClass =
    color === "teal"
      ? "bg-teal-600 text-white border-teal-600"
      : color === "blue"
      ? "bg-blue-600 text-white border-blue-600"
      : "bg-violet-600 text-white border-violet-600";

  return (
    <div className="space-y-2">
      <Label className="text-sm font-semibold text-gray-800">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </Label>
      <div className="flex gap-2">
        {[true, false].map((v) => (
          <button
            key={String(v)}
            type="button"
            onClick={() => onChange(v)}
            className={`px-5 py-1.5 rounded-full border text-sm font-medium transition-all ${
              value === v
                ? activeClass
                : "bg-white text-gray-700 border-gray-200 hover:border-gray-300"
            }`}
          >
            {v ? "Yes" : "No"}
          </button>
        ))}
      </div>
    </div>
  );
}

const ID_DOC_TYPES = [
  { value: "aadhar", label: "Aadhaar Card (India)" },
  { value: "passport", label: "Passport" },
  { value: "driving_licence", label: "Driving Licence" },
  { value: "national_id", label: "National ID" },
];

// Mandatory for ALL verticals — a professional cannot be reviewed/approved
// (and therefore cannot be listed in parent search) without a government ID
// on file. See artifacts/api-server/src/lib/verificationRequirements.ts.
function IdentityDocumentSection({
  idDocType,
  setIdDocType,
  idFileKey,
  setIdFileKey,
  dpdpConsent,
  setDpdpConsent,
  alreadySubmitted,
  disabled,
}: {
  idDocType: string;
  setIdDocType: (v: string) => void;
  idFileKey: string;
  setIdFileKey: (v: string) => void;
  dpdpConsent: boolean;
  setDpdpConsent: (v: boolean) => void;
  alreadySubmitted: boolean;
  disabled: boolean;
}) {
  if (alreadySubmitted) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-4 flex items-center gap-2 text-green-700 text-sm font-medium">
        <CheckCircle2 size={16} />
        Government ID already submitted for verification.
      </div>
    );
  }

  return (
    <div className="space-y-3 border-t border-gray-100 pt-6">
      <Label className="text-sm font-semibold text-gray-800">
        Government ID <span className="text-red-500 ml-1">*</span>
      </Label>
      <p className="text-xs text-gray-500">
        Required to appear in parent search — Aadhaar, Passport, Driving Licence, or National ID.
      </p>

      <div className="space-y-2">
        <SelectField
          label="Document type"
          value={idDocType}
          options={ID_DOC_TYPES}
          onChange={setIdDocType}
        />
      </div>

      <FileUploadField label="Upload government ID" onUploaded={setIdFileKey} uploadedPath={idFileKey} disabled={disabled} />

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
        <p className="text-xs font-semibold text-amber-900">Data Processing Consent — DPDP Act 2023</p>
        <p className="text-xs text-amber-800 leading-relaxed">
          Your ID document is collected solely for professional verification on Includly, stored securely, and will not be shared
          with third parties. You may request deletion at any time via Account Settings.
        </p>
        <div className="flex items-start gap-2">
          <Checkbox
            id="onboard-dpdp-consent"
            checked={dpdpConsent}
            onCheckedChange={(v) => setDpdpConsent(v === true)}
          />
          <label htmlFor="onboard-dpdp-consent" className="text-xs text-amber-900 leading-relaxed cursor-pointer">
            I consent to Includly processing my identity document for verification as described above.
          </label>
        </div>
      </div>
    </div>
  );
}

// Mandatory for therapists only — RCI (Rehabilitation Council of India)
// registration is a legal requirement to practice, so both the CRR number
// and the certificate scan are hard-gated before a therapist can be
// approved or appear in parent search.
function RciCertificateSection({
  rciCertFileKey,
  setRciCertFileKey,
  alreadySubmitted,
  disabled,
  rciCrrNumber,
  setRciCrrNumber,
}: {
  rciCertFileKey: string;
  setRciCertFileKey: (v: string) => void;
  alreadySubmitted: boolean;
  disabled: boolean;
  rciCrrNumber: string;
  setRciCrrNumber: (v: string) => void;
}) {
  if (alreadySubmitted) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-4 flex items-center gap-2 text-green-700 text-sm font-medium">
        <CheckCircle2 size={16} />
        RCI certificate already submitted for verification.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-sm font-semibold text-gray-800">
          RCI certificate <span className="text-red-500 ml-1">*</span>
        </Label>
        <p className="text-xs text-gray-500 mt-1">
          Your Rehabilitation Council of India Certificate of Registration number and scan/photo — mandatory before
          you can appear in parent search.
        </p>
      </div>
      <div className="space-y-2">
        <Label className="text-xs font-medium text-gray-600">
          RCI certificate number <span className="text-red-500 ml-1">*</span>
        </Label>
        <Input
          value={rciCrrNumber}
          onChange={(e) => setRciCrrNumber(e.target.value)}
          placeholder="e.g. A12345"
          disabled={disabled}
          className="h-10 text-sm"
        />
      </div>
      <FileUploadField
        label="Upload RCI certificate"
        onUploaded={setRciCertFileKey}
        uploadedPath={rciCertFileKey}
        disabled={disabled}
      />
    </div>
  );
}

// A professional's PRIMARY vertical (set at signup) hydrates from
// useGetMyProfessionalProfile as before. An ADDITIONAL vertical they're
// adding later hydrates from its own professional_offerings row instead —
// fetched here so this same Stage-2 form can complete either one.
interface MyOffering {
  isPrimary: boolean;
  vertical: VerticalValue;
  verticalDetails: unknown;
  rciCrrNumber: string | null;
  verificationStatus: string;
}

function useMyOfferings() {
  return useQuery<MyOffering[]>({
    queryKey: ["my-offerings"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/professionals/me/offerings");
      if (!res.ok) throw new Error("Failed to fetch offerings");
      const data = await res.json();
      return data.offerings as MyOffering[];
    },
  });
}

type IdentitySectionProps = {
  idDocType: string;
  setIdDocType: (v: string) => void;
  idFileKey: string;
  setIdFileKey: (v: string) => void;
  dpdpConsent: boolean;
  setDpdpConsent: (v: boolean) => void;
  alreadySubmitted: boolean;
};

function ShadowTeacherForm({
  form,
  setForm,
  isSaving,
  idProps,
}: {
  form: ShadowForm;
  setForm: React.Dispatch<React.SetStateAction<ShadowForm>>;
  isSaving: boolean;
  idProps: IdentitySectionProps;
}) {
  return (
    <div className="space-y-7">
      <div className="space-y-2">
        <SelectField
          label="Highest education qualification"
          value={form.highestEducation}
          options={toSelectOptions(EDUCATION_OPTIONS)}
          onChange={(v) => setForm((f) => ({ ...f, highestEducation: v }))}
          required
        />
        {form.highestEducation === "Other" && (
          <Input
            value={form.highestEducationOther}
            onChange={(e) => setForm((f) => ({ ...f, highestEducationOther: e.target.value }))}
            placeholder="Enter your highest qualification"
            disabled={isSaving}
            className="h-10 text-sm"
          />
        )}
      </div>

      <ChipsField
        label="Conditions you have experience supporting"
        required
        hint="Select all that apply"
      >
        <MultiSelectChips
          options={CONDITIONS_OPTIONS}
          selected={form.conditionsSupported}
          onChange={(v) =>
            setForm((f) => ({
              ...f,
              conditionsSupported: applyExclusiveOption(v, f.conditionsSupported, "no_experience"),
            }))
          }
          color="teal"
          disabled={isSaving}
        />
        {form.conditionsSupported.includes("others") && (
          <Input
            value={form.conditionsSupportedOther}
            onChange={(e) => setForm((f) => ({ ...f, conditionsSupportedOther: e.target.value }))}
            placeholder="Describe the conditions you have experience supporting"
            disabled={isSaving}
            className="h-10 text-sm mt-2"
          />
        )}
      </ChipsField>

      <ChipsField label="Settings you've worked in" required hint="Select all that apply">
        <MultiSelectChips
          options={SHADOW_SETTINGS}
          selected={form.settings}
          onChange={(v) => setForm((f) => ({ ...f, settings: v }))}
          color="teal"
          disabled={isSaving}
        />
      </ChipsField>

      <ChipsField label="Grade levels you can support" required hint="Select all that apply">
        <MultiSelectChips
          options={GRADE_LEVELS}
          selected={form.gradeLevels}
          onChange={(v) => setForm((f) => ({ ...f, gradeLevels: v }))}
          color="teal"
          disabled={isSaving}
        />
      </ChipsField>

      <ChipsField label="Intervention approaches you use" hint="Optional — select all that apply">
        <MultiSelectChips
          options={SHADOW_APPROACHES}
          selected={form.approaches}
          onChange={(v) => setForm((f) => ({ ...f, approaches: v }))}
          color="teal"
          disabled={isSaving}
        />
      </ChipsField>

      <YesNoField
        label="Do you offer home sessions?"
        value={form.homeSession}
        onChange={(v) => setForm((f) => ({ ...f, homeSession: v }))}
        color="teal"
      />

      <div className="space-y-2">
        <Label className="text-sm font-semibold text-gray-800">
          Training certificate{" "}
          <span className="text-gray-400 font-normal">(encouraged, not required)</span>
        </Label>
        <p className="text-xs text-gray-500">
          B.Ed certificate, RCI card, or any relevant credential — profiles with a training certificate on file are
          reviewed faster and shown as more trusted to parents.
        </p>
        <FileUploadField
          label="Upload document"
          onUploaded={(key) => setForm((f) => ({ ...f, certKey: key }))}
          uploadedPath={form.certKey}
          disabled={isSaving}
        />
      </div>

      <IdentityDocumentSection {...idProps} disabled={isSaving} />
    </div>
  );
}

function HomeTutorForm({
  form,
  setForm,
  isSaving,
  idProps,
}: {
  form: TutorForm;
  setForm: React.Dispatch<React.SetStateAction<TutorForm>>;
  isSaving: boolean;
  idProps: IdentitySectionProps;
}) {
  return (
    <div className="space-y-7">
      <ChipsField label="Subjects you teach" required hint="Select all that apply">
        <MultiSelectChips
          options={TUTOR_SUBJECTS}
          selected={form.subjects}
          onChange={(v) => setForm((f) => ({ ...f, subjects: v }))}
          color="blue"
          disabled={isSaving}
        />
      </ChipsField>

      <ChipsField label="Curriculum boards you cover" required hint="Select all that apply">
        <MultiSelectChips
          options={TUTOR_BOARDS}
          selected={form.boards}
          onChange={(v) => setForm((f) => ({ ...f, boards: v }))}
          color="blue"
          disabled={isSaving}
        />
      </ChipsField>

      <ChipsField label="Grade levels you teach" required hint="Select all that apply">
        <MultiSelectChips
          options={GRADE_LEVELS}
          selected={form.gradeLevels}
          onChange={(v) => setForm((f) => ({ ...f, gradeLevels: v }))}
          color="blue"
          disabled={isSaving}
        />
      </ChipsField>

      <YesNoField
        label="Do you have experience teaching children with special needs?"
        required
        value={form.specialNeedsExp}
        onChange={(v) => setForm((f) => ({ ...f, specialNeedsExp: v }))}
        color="blue"
      />

      <ChipsField
        label="Teaching approaches you use"
        hint="Optional — select all that apply"
      >
        <MultiSelectChips
          options={TUTOR_APPROACHES}
          selected={form.teachingApproaches}
          onChange={(v) => setForm((f) => ({ ...f, teachingApproaches: v }))}
          color="blue"
          disabled={isSaving}
        />
      </ChipsField>

      <div className="space-y-2">
        <Label className="text-sm font-semibold text-gray-800">
          Certification document{" "}
          <span className="text-gray-400 font-normal">(optional)</span>
        </Label>
        <p className="text-xs text-gray-500">
          Degree certificate or any relevant credential — helps with faster verification.
        </p>
        <FileUploadField
          label="Upload document"
          onUploaded={(key) => setForm((f) => ({ ...f, certKey: key }))}
          uploadedPath={form.certKey}
          disabled={isSaving}
        />
      </div>

      <IdentityDocumentSection {...idProps} disabled={isSaving} />
    </div>
  );
}

function TherapistForm({
  form,
  setForm,
  isSaving,
  idProps,
  rciCertProps,
}: {
  form: TherapistForm;
  setForm: React.Dispatch<React.SetStateAction<TherapistForm>>;
  isSaving: boolean;
  idProps: IdentitySectionProps;
  rciCertProps: { rciCertFileKey: string; setRciCertFileKey: (v: string) => void; alreadySubmitted: boolean };
}) {
  const kind = disciplineCredentialKind(form.discipline);
  const showRciBlock = kind === "rci" && form.rciRegistered === false;

  return (
    <div className="space-y-7">
      <div className="space-y-2">
        <SelectField
          label="Your primary discipline"
          value={form.discipline}
          options={toSelectOptions(THERAPIST_DISCIPLINES)}
          onChange={(v) => setForm((f) => ({ ...f, discipline: v }))}
          required
        />
        {form.discipline === "Other" && (
          <Input
            value={form.disciplineOther}
            onChange={(e) => setForm((f) => ({ ...f, disciplineOther: e.target.value }))}
            placeholder="Enter your primary discipline"
            disabled={isSaving}
            className="h-10 text-sm"
          />
        )}
      </div>

      {/* Credential section — branches by discipline. Each discipline shows
          ONLY its own correct credential field(s); the "RCI Number" label
          never appears for OT, Developmental Pediatrician, Psychiatrist, or
          ABA/Behavioral Therapy. */}
      {kind === "rci" && (
        <>
          <YesNoField
            label="Are you RCI registered?"
            required
            value={form.rciRegistered}
            onChange={(v) => setForm((f) => ({ ...f, rciRegistered: v }))}
            color="violet"
          />
          {showRciBlock && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-4 space-y-1.5">
              <div className="flex items-center gap-2 text-amber-700 font-semibold text-sm">
                <AlertTriangle size={15} />
                Profile will be saved as a draft
              </div>
              <p className="text-xs text-amber-700 leading-relaxed">
                RCI registration is required for this discipline to appear in parent search on Includly. You can
                still complete your profile and submit for review, but you <strong>will not be listed</strong> until
                you obtain your RCI CRR number and update your profile.
              </p>
            </div>
          )}
        </>
      )}

      {kind === "ot" && (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-gray-800">
              AIOTA membership number <span className="text-red-500 ml-1">*</span>
            </Label>
            <p className="text-xs text-gray-500">
              Your All India Occupational Therapists&apos; Association membership number — mandatory to appear in
              parent search.
            </p>
            <Input
              value={form.aiotaMembershipNumber}
              onChange={(e) => setForm((f) => ({ ...f, aiotaMembershipNumber: e.target.value }))}
              placeholder="e.g. AIOTA/12345"
              disabled={isSaving}
              className="h-10 text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-medium text-gray-600">
              NCAHP registration number <span className="text-gray-400 ml-1">(optional — if you have one)</span>
            </Label>
            <Input
              value={form.ncahpRegistrationNumber}
              onChange={(e) => setForm((f) => ({ ...f, ncahpRegistrationNumber: e.target.value }))}
              placeholder="e.g. NCAHP/12345"
              disabled={isSaving}
              className="h-10 text-sm"
            />
          </div>
        </div>
      )}

      {kind === "medical" && (
        <div className="space-y-2">
          <Label className="text-sm font-semibold text-gray-800">
            NMC / State Medical Council registration number <span className="text-red-500 ml-1">*</span>
          </Label>
          <p className="text-xs text-gray-500">
            Your National Medical Commission or State Medical Council registration number — mandatory to appear in
            parent search.
          </p>
          <Input
            value={form.medicalCouncilRegistrationNumber}
            onChange={(e) => setForm((f) => ({ ...f, medicalCouncilRegistrationNumber: e.target.value }))}
            placeholder="e.g. MCI/12345"
            disabled={isSaving}
            className="h-10 text-sm"
          />
        </div>
      )}

      {kind === "aba" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <SelectField
              label="Credential type"
              value={form.abaCredentialType}
              options={toSelectOptions(ABA_CREDENTIAL_TYPES)}
              onChange={(v) => setForm((f) => ({ ...f, abaCredentialType: v }))}
              required
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-gray-800">
              Credential number <span className="text-red-500 ml-1">*</span>
            </Label>
            <Input
              value={form.abaCredentialNumber}
              onChange={(e) => setForm((f) => ({ ...f, abaCredentialNumber: e.target.value }))}
              placeholder="e.g. 1-23-45678"
              disabled={isSaving}
              className="h-10 text-sm"
            />
          </div>
          <YesNoField
            label="Are you individually credentialed, or do you practice under a supervising RCI-registered professional / therapy centre?"
            value={form.individuallyCredentialed}
            onChange={(v) => setForm((f) => ({ ...f, individuallyCredentialed: v }))}
            color="violet"
          />
          <p className="text-xs text-gray-400 leading-relaxed -mt-2">
            This is captured for our records only — not yet a requirement to be listed. Whether ABA/behavioral
            therapists must practice under RCI supervision is still an unsettled area in Indian regulation.
          </p>
          {form.individuallyCredentialed === false && (
            <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50/60 p-3">
              <div className="space-y-2">
                <Label className="text-xs font-medium text-gray-600">Supervising professional&apos;s name</Label>
                <Input
                  value={form.supervisingProfessionalName}
                  onChange={(e) => setForm((f) => ({ ...f, supervisingProfessionalName: e.target.value }))}
                  placeholder="Full name"
                  disabled={isSaving}
                  className="h-10 text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium text-gray-600">Supervising professional&apos;s RCI number</Label>
                <Input
                  value={form.supervisingRciNumber}
                  onChange={(e) => setForm((f) => ({ ...f, supervisingRciNumber: e.target.value }))}
                  placeholder="e.g. A12345"
                  disabled={isSaving}
                  className="h-10 text-sm"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {kind === "ancillary" && (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-gray-800">
              Certification / governing body <span className="text-gray-400 ml-1">(optional)</span>
            </Label>
            <p className="text-xs text-gray-500">
              e.g. your yoga/art-therapy certifying body, or the relevant professional association for your
              discipline. There&apos;s no single mandatory regulator for this discipline in India today.
            </p>
            <Input
              value={form.ancillaryCertificationBody}
              onChange={(e) => setForm((f) => ({ ...f, ancillaryCertificationBody: e.target.value }))}
              placeholder="e.g. Indian Association of Yoga Therapists"
              disabled={isSaving}
              className="h-10 text-sm"
            />
          </div>
          {form.discipline === "Physiotherapy" && (
            <div className="space-y-2">
              <Label className="text-xs font-medium text-gray-600">
                State physiotherapy council registration number <span className="text-gray-400 ml-1">(if your state requires one)</span>
              </Label>
              <Input
                value={form.statePhysioCouncilNumber}
                onChange={(e) => setForm((f) => ({ ...f, statePhysioCouncilNumber: e.target.value }))}
                placeholder="e.g. HRPC/12345"
                disabled={isSaving}
                className="h-10 text-sm"
              />
            </div>
          )}
        </div>
      )}

      <ChipsField
        label="Conditions / populations you work with"
        required
        hint="Select all that apply"
      >
        <MultiSelectChips
          options={THERAPIST_CONDITIONS}
          selected={form.conditionsTreated}
          onChange={(v) => setForm((f) => ({ ...f, conditionsTreated: v }))}
          color="violet"
          disabled={isSaving}
        />
        {form.conditionsTreated.includes("others") && (
          <Input
            value={form.conditionsTreatedOther}
            onChange={(e) => setForm((f) => ({ ...f, conditionsTreatedOther: e.target.value }))}
            placeholder="Describe the conditions / populations you work with"
            disabled={isSaving}
            className="h-10 text-sm mt-2"
          />
        )}
      </ChipsField>

      <ChipsField label="Session modes you offer" required hint="Select all that apply">
        <MultiSelectChips
          options={SESSION_MODES}
          selected={form.sessionModes}
          onChange={(v) => setForm((f) => ({ ...f, sessionModes: v }))}
          color="violet"
          disabled={isSaving}
        />
      </ChipsField>

      <ChipsField label="Age groups you serve" required hint="Select all that apply">
        <MultiSelectChips
          options={AGE_GROUPS}
          selected={form.ageGroups}
          onChange={(v) => setForm((f) => ({ ...f, ageGroups: v }))}
          color="violet"
          disabled={isSaving}
        />
      </ChipsField>

      {kind === "rci" && (
        <RciCertificateSection
          rciCertFileKey={rciCertProps.rciCertFileKey}
          setRciCertFileKey={rciCertProps.setRciCertFileKey}
          alreadySubmitted={rciCertProps.alreadySubmitted}
          disabled={isSaving}
          rciCrrNumber={form.rciCrrNumber}
          setRciCrrNumber={(v) => setForm((f) => ({ ...f, rciCrrNumber: v }))}
        />
      )}

      <IdentityDocumentSection {...idProps} disabled={isSaving} />
    </div>
  );
}

export default function OnboardStage2Page() {
  const params = useParams<{ vertical: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: profile, isLoading: profileLoading } = useGetMyProfessionalProfile();
  const { data: idVerificationRaw, isLoading: idLoading } = useGetMyIdentityVerification();
  const { data: certsRaw, isLoading: certsLoading } = useGetMyCertifications();
  const { data: offerings, isLoading: offeringsLoading } = useMyOfferings();
  const isLoading = profileLoading || idLoading || certsLoading || offeringsLoading;
  const scrollRef = useRef<HTMLDivElement>(null);

  const vertical = (params.vertical ?? profile?.vertical ?? "shadow_teacher") as VerticalValue;
  const meta = VERTICAL_META[vertical] ?? VERTICAL_META.shadow_teacher;
  const isShadow = vertical === "shadow_teacher";
  const isTutor = vertical === "home_tutor";
  const isTherapist = vertical === "therapist";

  // Is this vertical the professional's original/primary one, or an
  // additional offering they're adding on top of it?
  const isAdditionalOffering = !!profile && vertical !== profile.vertical;
  const myOffering = offerings?.find((o) => o.vertical === vertical);

  const [isSaving, setIsSaving] = useState(false);

  const existingVd = (
    isAdditionalOffering ? (myOffering?.verticalDetails ?? {}) : (profile?.verticalDetails ?? {})
  ) as Record<string, unknown>;

  const [shadowForm, setShadowForm] = useState<ShadowForm>({
    highestEducation: (existingVd.highestEducation as string) ?? "",
    highestEducationOther: (existingVd.highestEducationOther as string) ?? "",
    conditionsSupported: (existingVd.conditionsSupported as string[]) ?? [],
    conditionsSupportedOther: (existingVd.conditionsSupportedOther as string) ?? "",
    settings: (existingVd.settings as string[]) ?? [],
    gradeLevels: (existingVd.gradeLevels as string[]) ?? [],
    approaches: (existingVd.approaches as string[]) ?? [],
    homeSession: existingVd.homeSession !== undefined ? (existingVd.homeSession as boolean) : null,
    certKey: (existingVd.certKey as string) ?? "",
  });

  const [tutorForm, setTutorForm] = useState<TutorForm>({
    subjects: (existingVd.subjects as string[]) ?? [],
    boards: (existingVd.boards as string[]) ?? [],
    gradeLevels: (existingVd.gradeLevels as string[]) ?? [],
    specialNeedsExp:
      existingVd.specialNeedsExp !== undefined ? (existingVd.specialNeedsExp as boolean) : null,
    teachingApproaches: (existingVd.teachingApproaches as string[]) ?? [],
    certKey: (existingVd.certKey as string) ?? "",
  });

  const [therapistForm, setTherapistForm] = useState<TherapistForm>({
    discipline: (existingVd.discipline as string) ?? "",
    disciplineOther: (existingVd.disciplineOther as string) ?? "",
    rciRegistered:
      existingVd.rciRegistered !== undefined ? (existingVd.rciRegistered as boolean) : null,
    rciCrrNumber: (isAdditionalOffering ? myOffering?.rciCrrNumber : profile?.rciCrrNumber) ?? "",
    aiotaMembershipNumber: (existingVd.aiotaMembershipNumber as string) ?? "",
    ncahpRegistrationNumber: (existingVd.ncahpRegistrationNumber as string) ?? "",
    medicalCouncilRegistrationNumber: (existingVd.medicalCouncilRegistrationNumber as string) ?? "",
    abaCredentialType: (existingVd.abaCredentialType as string) ?? "",
    abaCredentialNumber: (existingVd.abaCredentialNumber as string) ?? "",
    individuallyCredentialed:
      existingVd.individuallyCredentialed !== undefined ? (existingVd.individuallyCredentialed as boolean) : null,
    supervisingProfessionalName: (existingVd.supervisingProfessionalName as string) ?? "",
    supervisingRciNumber: (existingVd.supervisingRciNumber as string) ?? "",
    statePhysioCouncilNumber: (existingVd.statePhysioCouncilNumber as string) ?? "",
    ancillaryCertificationBody: (existingVd.ancillaryCertificationBody as string) ?? "",
    conditionsTreated: (existingVd.conditionsTreated as string[]) ?? [],
    conditionsTreatedOther: (existingVd.conditionsTreatedOther as string) ?? "",
    sessionModes: (existingVd.sessionModes as string[]) ?? [],
    ageGroups: (existingVd.ageGroups as string[]) ?? [],
    certKey: (existingVd.certKey as string) ?? "",
  });

  const [idDocType, setIdDocType] = useState("aadhar");
  const [idFileKey, setIdFileKey] = useState("");
  const [dpdpConsent, setDpdpConsent] = useState(false);
  const [rciCertFileKey, setRciCertFileKey] = useState("");

  const idVerif = idVerificationRaw as { status?: string } | null | undefined;
  const identityAlreadySubmitted = !!idVerif && idVerif.status !== "rejected";
  const certs = (certsRaw as { documentType: string }[] | undefined) ?? [];
  const rciCertAlreadySubmitted = certs.some((c) => c.documentType === "rci_certificate");
  const hasAnyCert = certs.length > 0;

  function identityValid() {
    return identityAlreadySubmitted || (!!idFileKey && dpdpConsent);
  }

  const idProps = {
    idDocType,
    setIdDocType,
    idFileKey,
    setIdFileKey,
    dpdpConsent,
    setDpdpConsent,
    alreadySubmitted: identityAlreadySubmitted,
  };

  const rciCertProps = {
    rciCertFileKey,
    setRciCertFileKey,
    alreadySubmitted: rciCertAlreadySubmitted,
  };

  // Hard gate for all professional verticals (payee roles) — the platform
  // pays out to this UPI ID, so onboarding cannot complete without a
  // server-verified one. Mirrors identityValid()'s "alreadySubmitted"
  // pattern exactly: profile.upiVerifiedAt already reflects the persisted
  // state on every load, so leaving mid-verification and coming back just
  // re-reads it — no separate draft/resume logic needed.
  const { mutateAsync: createUpiOrder } = useCreateUpiVerificationOrder();
  const { mutateAsync: confirmUpi } = useConfirmUpiVerification();
  const [verifyingUpi, setVerifyingUpi] = useState(false);
  const upiVerified = !!profile?.upiVerifiedAt;

  function upiValid() {
    return upiVerified;
  }

  async function handleVerifyUpi() {
    setVerifyingUpi(true);
    try {
      const order = await createUpiOrder();
      const loaded = await loadRazorpayScript();
      if (!loaded) {
        toast({ title: "Could not load payment gateway", description: "Please check your connection and try again.", variant: "destructive" });
        setVerifyingUpi(false);
        return;
      }
      const rzp = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: "Includly",
        description: "UPI verification (₹1, auto-refunded)",
        order_id: order.orderId,
        method: { upi: true, card: false, netbanking: false, wallet: false, emi: false, paylater: false },
        ...(order.testMode ? { config: buildUpiTestCheckoutConfig() } : {}),
        handler: async (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
          try {
            await confirmUpi({
              data: {
                razorpayPaymentId: response.razorpay_payment_id,
                razorpayOrderId: response.razorpay_order_id,
                razorpaySignature: response.razorpay_signature,
              },
            });
            await queryClient.invalidateQueries({ queryKey: getGetMyProfessionalProfileQueryKey() });
            toast({ title: "UPI verified", description: "Your ₹1 will be refunded automatically." });
          } catch (err: unknown) {
            toast({ title: "Verification failed", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
          } finally {
            setVerifyingUpi(false);
          }
        },
        modal: { ondismiss: () => setVerifyingUpi(false) },
        theme: { color: "#2EC4A5" },
      });
      rzp.open();
    } catch (err: unknown) {
      toast({ title: "Could not start verification", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
      setVerifyingUpi(false);
    }
  }

  useEffect(() => {
    if (!isLoading && !profile) {
      setLocation("/onboarding/pro", { replace: true });
    }
  }, [isLoading, profile]);

  function isShadowValid() {
    const base =
      !!shadowForm.highestEducation &&
      shadowForm.conditionsSupported.length > 0 &&
      shadowForm.settings.length > 0 &&
      shadowForm.gradeLevels.length > 0;
    if (!base) return false;
    if (shadowForm.highestEducation === "Other" && !shadowForm.highestEducationOther.trim()) return false;
    if (shadowForm.conditionsSupported.includes("others") && !shadowForm.conditionsSupportedOther.trim()) return false;
    return true;
  }

  function isTutorValid() {
    return (
      tutorForm.subjects.length > 0 &&
      tutorForm.boards.length > 0 &&
      tutorForm.gradeLevels.length > 0 &&
      tutorForm.specialNeedsExp !== null
    );
  }

  function isTherapistValid() {
    const kind = disciplineCredentialKind(therapistForm.discipline);
    const base =
      !!therapistForm.discipline &&
      therapistForm.conditionsTreated.length > 0 &&
      therapistForm.sessionModes.length > 0 &&
      therapistForm.ageGroups.length > 0 &&
      // "rci" kind still asks the yes/no question (existing draft-save
      // pattern, unchanged); the other kinds go straight to their required
      // field(s) below, with no "not yet obtained" escape hatch, since none
      // was requested for AIOTA/medical-council/ABA credentials.
      (kind !== "rci" || therapistForm.rciRegistered !== null);
    if (!base) return false;
    if (therapistForm.discipline === "Other" && !therapistForm.disciplineOther.trim()) return false;
    if (therapistForm.conditionsTreated.includes("others") && !therapistForm.conditionsTreatedOther.trim()) return false;

    if (kind === "rci" && therapistForm.rciRegistered === true) {
      if (!therapistForm.rciCrrNumber.trim()) return false;
      if (!rciCertAlreadySubmitted && !rciCertFileKey) return false;
    } else if (kind === "ot") {
      if (!therapistForm.aiotaMembershipNumber.trim()) return false;
      // NCAHP registration number is optional — not checked.
    } else if (kind === "medical") {
      if (!therapistForm.medicalCouncilRegistrationNumber.trim()) return false;
    } else if (kind === "aba") {
      if (!therapistForm.abaCredentialType || !therapistForm.abaCredentialNumber.trim()) return false;
      // Supervising-professional fields are capture-only — not checked.
    }
    // kind === "ancillary": no required field — optional certification body only.
    return true;
  }

  function isValid() {
    if (!identityValid()) return false;
    // TEMP: UPI verification made non-blocking for onboarding submission,
    // pending a final decision on whether it should be mandatory here —
    // Razorpay Test Mode currently makes the ₹1 verification hard/impossible
    // to complete in a test environment (Collect/VPA-entry tab not
    // reliably available, only QR). The panel, "already verified ✓" state,
    // and resume behavior below are all still fully built and usable — a
    // professional can still verify from this screen if they want to, it
    // just no longer blocks submission. Backend enforcement in
    // computeVerificationRequirements() is UNCHANGED and still
    // independently blocks the admin-review queue and admin approval
    // (and therefore listability) regardless of this. To restore the hard
    // gate here, uncomment the line below.
    // if (!upiValid()) return false;
    if (isShadow) return isShadowValid();
    if (isTutor) return isTutorValid();
    if (isTherapist) return isTherapistValid();
    return false;
  }

  async function handleSubmit() {
    if (!isValid() || isSaving) return;
    setIsSaving(true);

    try {
      let verticalDetails: Record<string, unknown>;
      let extraPatch: Record<string, unknown> = {};

      if (isShadow) {
        verticalDetails = {
          highestEducation: shadowForm.highestEducation,
          ...(shadowForm.highestEducation === "Other"
            ? { highestEducationOther: shadowForm.highestEducationOther.trim() }
            : {}),
          conditionsSupported: shadowForm.conditionsSupported,
          ...(shadowForm.conditionsSupported.includes("others")
            ? { conditionsSupportedOther: shadowForm.conditionsSupportedOther.trim() }
            : {}),
          settings: shadowForm.settings,
          gradeLevels: shadowForm.gradeLevels,
          approaches: shadowForm.approaches,
          homeSession: shadowForm.homeSession,
          ...(shadowForm.certKey ? { certKey: shadowForm.certKey } : {}),
        };
        // offersHomeVisits is a shared, account-level field — only meaningful
        // to set from the primary offering's Stage-2 form. An additional
        // offering can't yet express "home visits for this vertical only".
        if (shadowForm.homeSession !== null && !isAdditionalOffering) {
          extraPatch.offersHomeVisits = shadowForm.homeSession;
        }
      } else if (isTutor) {
        verticalDetails = {
          subjects: tutorForm.subjects,
          boards: tutorForm.boards,
          gradeLevels: tutorForm.gradeLevels,
          specialNeedsExp: tutorForm.specialNeedsExp,
          teachingApproaches: tutorForm.teachingApproaches,
          ...(tutorForm.certKey ? { certKey: tutorForm.certKey } : {}),
        };
      } else {
        const credentialKind = disciplineCredentialKind(therapistForm.discipline);
        verticalDetails = {
          discipline: therapistForm.discipline,
          ...(therapistForm.discipline === "Other"
            ? { disciplineOther: therapistForm.disciplineOther.trim() }
            : {}),
          ...(credentialKind === "rci" ? { rciRegistered: therapistForm.rciRegistered } : {}),
          ...(credentialKind === "ot"
            ? {
                aiotaMembershipNumber: therapistForm.aiotaMembershipNumber.trim(),
                ...(therapistForm.ncahpRegistrationNumber.trim()
                  ? { ncahpRegistrationNumber: therapistForm.ncahpRegistrationNumber.trim() }
                  : {}),
              }
            : {}),
          ...(credentialKind === "medical"
            ? { medicalCouncilRegistrationNumber: therapistForm.medicalCouncilRegistrationNumber.trim() }
            : {}),
          ...(credentialKind === "aba"
            ? {
                abaCredentialType: therapistForm.abaCredentialType,
                abaCredentialNumber: therapistForm.abaCredentialNumber.trim(),
                individuallyCredentialed: therapistForm.individuallyCredentialed,
                ...(therapistForm.individuallyCredentialed === false
                  ? {
                      supervisingProfessionalName: therapistForm.supervisingProfessionalName.trim(),
                      supervisingRciNumber: therapistForm.supervisingRciNumber.trim(),
                    }
                  : {}),
              }
            : {}),
          ...(credentialKind === "ancillary"
            ? {
                ...(therapistForm.ancillaryCertificationBody.trim()
                  ? { ancillaryCertificationBody: therapistForm.ancillaryCertificationBody.trim() }
                  : {}),
                ...(therapistForm.discipline === "Physiotherapy" && therapistForm.statePhysioCouncilNumber.trim()
                  ? { statePhysioCouncilNumber: therapistForm.statePhysioCouncilNumber.trim() }
                  : {}),
              }
            : {}),
          conditionsTreated: therapistForm.conditionsTreated,
          ...(therapistForm.conditionsTreated.includes("others")
            ? { conditionsTreatedOther: therapistForm.conditionsTreatedOther.trim() }
            : {}),
          sessionModes: therapistForm.sessionModes,
          ageGroups: therapistForm.ageGroups,
          ...(therapistForm.certKey ? { certKey: therapistForm.certKey } : {}),
        };
        if (credentialKind === "rci" && therapistForm.rciRegistered === true) {
          extraPatch.rciCrrNumber = therapistForm.rciCrrNumber.trim();
        }
      }

      const patchUrl = isAdditionalOffering
        ? `/api/professionals/me/offerings/${vertical}`
        : "/api/professionals/me";
      const patchRes = await fetchWithAuth(patchUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verticalDetails, ...extraPatch }),
      });

      if (!patchRes.ok) {
        const body = await patchRes.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Save failed");
      }

      // Government ID is person-level (shared across every offering) — but
      // `vertical` tells the backend WHICH offering's requirements to
      // recheck afterward. Harmless to always send: for the primary
      // vertical it resolves to the exact same recompute as before.
      if (!identityAlreadySubmitted && idFileKey) {
        const idRes = await fetchWithAuth("/api/verifications/identity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documentType: idDocType, fileKey: idFileKey, dpdpConsent, vertical }),
        });
        if (!idRes.ok) {
          const body = await idRes.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? "Identity document submission failed");
        }
      }

      // Therapist RCI certificate is mandatory once they claim RCI
      // registration — required alongside the CRR number for approval.
      // Explicitly re-checks the discipline's credential kind (not just
      // rciRegistered) in case a stale rciRegistered=true value lingers
      // from before the professional switched away from an RCI-required
      // discipline to a different one.
      if (
        isTherapist &&
        disciplineCredentialKind(therapistForm.discipline) === "rci" &&
        therapistForm.rciRegistered === true &&
        !rciCertAlreadySubmitted &&
        rciCertFileKey
      ) {
        const certRes = await fetchWithAuth("/api/verifications/certifications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documentType: "rci_certificate", fileKey: rciCertFileKey, vertical }),
        });
        if (!certRes.ok) {
          const body = await certRes.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? "RCI certificate submission failed");
        }
      }

      // Shadow teacher training certificate is encouraged, not mandatory —
      // best-effort submit so it clears the soft warning shown to admins.
      if (isShadow && !hasAnyCert && shadowForm.certKey) {
        await fetchWithAuth("/api/verifications/certifications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documentType: "training_certificate", fileKey: shadowForm.certKey, vertical }),
        }).catch(() => {});
      }

      // Free activation is account-level, not per-offering — already true by
      // the time a professional is adding a second/third offering.
      if (!isTherapist && !isAdditionalOffering) {
        const activateRes = await fetchWithAuth("/api/professionals/me/free-activate", {
          method: "POST",
        });
        if (!activateRes.ok && activateRes.status !== 409) {
          const body = await activateRes.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? "Activation failed");
        }
      }

      await queryClient.invalidateQueries({ queryKey: getGetMyProfessionalProfileQueryKey() });
      await queryClient.invalidateQueries({ queryKey: ["/api/verifications/identity"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/verifications/certifications"] });
      await queryClient.invalidateQueries({ queryKey: ["my-offerings"] });

      if (isTherapist && disciplineCredentialKind(therapistForm.discipline) === "rci" && therapistForm.rciRegistered === false) {
        toast({
          title: "Profile saved as draft",
          description:
            "Your profile has been saved. You'll need to add your RCI CRR number before you can appear in parent search.",
        });
      } else if (isAdditionalOffering) {
        toast({
          title: "Service added!",
          description: `Your ${meta.title} offering has been submitted for review. It's verified and listed independently of your other services.`,
        });
      } else {
        toast({
          title: "Profile complete!",
          description:
            "Your profile has been submitted for review. You'll appear in search once our team approves it.",
        });
      }

      setLocation("/pro/today");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-teal-600" size={28} />
      </div>
    );
  }

  const colorRing =
    meta.color === "teal"
      ? "ring-teal-500/30"
      : meta.color === "blue"
      ? "ring-blue-500/30"
      : "ring-violet-500/30";

  const accentBg =
    meta.color === "teal"
      ? "bg-teal-600 hover:bg-teal-700"
      : meta.color === "blue"
      ? "bg-blue-600 hover:bg-blue-700"
      : "bg-violet-600 hover:bg-violet-700";

  const validForm = isValid();

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#f0faf8] via-[#f7fbf9] to-[#f0f4ff] flex flex-col">
      {/* Logo */}
      <div className="flex justify-center pt-8 pb-2 shrink-0">
        <a href="/" className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-teal-600 flex items-center justify-center shadow-sm">
            <span className="text-white font-bold text-base">In</span>
          </div>
          <span className="font-serif font-semibold text-xl text-gray-900">
            Includly<span className="text-teal-500 ml-0.5">·</span>
          </span>
        </a>
      </div>

      {/* Scrollable body */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto pb-36">
        <div className="max-w-lg mx-auto px-4 sm:px-6 py-6">
          {/* Progress bar */}
          <div className="mb-7">
            <div className="flex gap-1.5 mb-2">
              {["Role", "About", "Languages", "Location", "Pricing"].map((label, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full h-1.5 rounded-full bg-teal-500" />
                  <span className="text-[10px] text-teal-600 font-medium hidden sm:block">
                    {label}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <CheckCircle2 size={14} className="text-teal-500 shrink-0" />
              <span className="text-xs text-teal-700 font-medium">Stage 1 complete</span>
              <span className="text-xs text-gray-400">— now complete your role profile</span>
            </div>
          </div>

          {/* Heading */}
          <div className="mb-6">
            <div
              className={`w-14 h-14 rounded-2xl flex items-center justify-center text-3xl mb-4 bg-${meta.color}-50`}
            >
              {meta.emoji}
            </div>
            <h1 className="text-2xl font-serif font-semibold text-gray-900 mb-1">
              Your {meta.title} profile
            </h1>
            <p className="text-sm text-gray-500 leading-relaxed">
              These details help parents find the right match for their child.
              {vertical === "therapist" &&
                " Therapist profiles require the credentials your discipline calls for to appear in search."}
            </p>
          </div>

          {/* UPI verification — hard gate, account-level (not vertical-specific),
              deliberately rendered as its own prominent card rather than a
              field inside the form below, so it can't be missed or skimmed
              past like a regular row. */}
          <div
            className={`rounded-2xl p-5 mb-5 border-2 ${
              upiVerified ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-300"
            }`}
          >
            {upiVerified ? (
              <div className="flex items-center gap-3">
                <CheckCircle2 size={22} className="text-green-600 shrink-0" />
                <div>
                  <p className="font-semibold text-green-800 text-sm">UPI ID verified</p>
                  <p className="text-xs text-green-700">You're all set to receive payouts.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <AlertTriangle size={22} className="text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold text-amber-900 text-sm">Verify your UPI ID to receive payouts</p>
                    <p className="text-xs text-amber-800 mt-0.5 leading-relaxed">
                      Required to complete your profile — the platform pays out to this UPI ID, so we confirm
                      ownership with a ₹1 payment via Razorpay (automatically refunded within a few days).
                      Your profile cannot be submitted for review until this is verified.
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  onClick={() => void handleVerifyUpi()}
                  disabled={verifyingUpi}
                  className="w-full gap-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl"
                >
                  {verifyingUpi ? <Loader2 size={15} className="animate-spin" /> : null}
                  {verifyingUpi ? "Verifying…" : "Verify UPI ID (₹1, refunded)"}
                </Button>
              </div>
            )}
          </div>

          {/* Form card */}
          <div className={`bg-white border border-gray-100 rounded-2xl p-6 shadow-sm ring-1 ${colorRing}`}>
            {isShadow && (
              <ShadowTeacherForm
                form={shadowForm}
                setForm={setShadowForm}
                isSaving={isSaving}
                idProps={idProps}
              />
            )}
            {isTutor && (
              <HomeTutorForm form={tutorForm} setForm={setTutorForm} isSaving={isSaving} idProps={idProps} />
            )}
            {isTherapist && (
              <TherapistForm
                form={therapistForm}
                setForm={setTherapistForm}
                isSaving={isSaving}
                idProps={idProps}
                rciCertProps={rciCertProps}
              />
            )}
          </div>

          <p className="text-center text-xs text-gray-400 mt-5">
            You can always update these details from your dashboard.
          </p>
        </div>
      </div>

      {/* Sticky CTA footer */}
      <div
        className="fixed bottom-0 left-0 right-0 px-4 pb-6 pt-4 z-30"
        style={{
          background: "linear-gradient(to top, #fff 80%, rgba(255,255,255,0))",
        }}
      >
        <div className="max-w-lg mx-auto flex gap-3">
          <button
            type="button"
            onClick={() => setLocation("/onboarding/pro")}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm text-gray-500 hover:text-gray-700 disabled:opacity-40"
          >
            <ArrowLeft size={15} />
            Back
          </button>

          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!validForm || isSaving}
            className={`flex-1 gap-2 text-white h-11 text-base rounded-xl ${accentBg} disabled:opacity-40`}
          >
            {isSaving ? (
              <Loader2 size={16} className="animate-spin" />
            ) : isTherapist && disciplineCredentialKind(therapistForm.discipline) === "rci" && therapistForm.rciRegistered === false ? (
              <>
                Save as draft
                <ArrowRight size={16} />
              </>
            ) : (
              <>
                Complete profile
                <ArrowRight size={16} />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
