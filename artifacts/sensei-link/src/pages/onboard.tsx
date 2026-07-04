import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { fetchWithAuth } from "@/lib/api";
import {
  useGetMyProfessionalProfile,
  useGetMe,
  useSetMyRole,
  getCreateProfessionalProfileMutationOptions,
  getUpdateProfessionalProfileMutationOptions,
  getGetMyProfessionalProfileQueryKey,
  getGetMeQueryKey,
  type CreateProfessionalProfileBodySpecialty,
} from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { CityAutocomplete, type CityResult } from "@/components/CityAutocomplete";
import {
  Loader2,
  CheckCircle2,
  IndianRupee,
  ArrowRight,
} from "lucide-react";

const STEPS = ["Role", "About", "Languages", "Location", "Pricing"];

const STEP_HEADINGS = [
  "What brings you here?",
  "Tell us about yourself",
  "Languages you work in",
  "Where are you based?",
  "Pricing & payment",
];

const STEP_SUBTITLES = [
  "Choose the role that best describes your work with children.",
  "This appears on your public profile.",
  "Parents filter by language — select all you're comfortable working in.",
  "Helps parents nearby find you. Your exact address is never shared before a booking.",
  "Let parents know your session rate. You can always update this later.",
];

const VERTICAL_CARDS = [
  {
    value: "shadow_teacher",
    emoji: "🧑‍🏫",
    title: "Shadow Teacher",
    desc: "I support children with special needs inside school, helping them participate in mainstream classrooms.",
    selectedBorder: "#0D9488",
    selectedBg: "#F0FDFB",
    selectedRing: "rgba(13,148,136,0.18)",
    iconBg: "#CCFBF1",
  },
  {
    value: "home_tutor",
    emoji: "📚",
    title: "Home Tutor",
    desc: "I teach academic subjects to children with learning differences at home, at their pace.",
    selectedBorder: "#3B82F6",
    selectedBg: "#EFF6FF",
    selectedRing: "rgba(59,130,246,0.18)",
    iconBg: "#DBEAFE",
  },
  {
    value: "therapist",
    emoji: "🩺",
    title: "Therapist / Special Educator",
    desc: "I provide speech, OT, behavioural (ABA), or special education therapy. RCI registration required.",
    selectedBorder: "#7C3AED",
    selectedBg: "#F5F3FF",
    selectedRing: "rgba(124,58,237,0.18)",
    iconBg: "#EDE9FE",
  },
] as const;

type VerticalValue = (typeof VERTICAL_CARDS)[number]["value"];

const VERTICAL_TO_SPECIALTY: Record<VerticalValue, CreateProfessionalProfileBodySpecialty> = {
  shadow_teacher: "shadow_teacher",
  home_tutor: "special_tutor",
  therapist: "speech_therapy",
};

const LANGUAGE_OPTIONS = [
  "English", "Hindi", "Tamil", "Telugu", "Kannada", "Malayalam",
  "Marathi", "Bengali", "Gujarati", "Punjabi", "Odia", "Urdu",
];

const TRAVEL_RADIUS_OPTIONS = [5, 10, 25, 50];

export default function OnboardPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: existingProfile, isLoading: profileLoading } = useGetMyProfessionalProfile();
  const { data: me, isError: meError } = useGetMe();

  const [step, setStep] = useState(0);
  const [isSaving, setIsSaving] = useState(false);

  const [vertical, setVertical] = useState<VerticalValue | "">(
    (existingProfile?.vertical as VerticalValue | undefined) ?? ""
  );
  const [form, setForm] = useState({
    fullName: existingProfile?.fullName ?? "",
    bio: existingProfile?.bio ?? "",
    yearsExperience: existingProfile?.yearsExperience?.toString() ?? "0",
    languages: (existingProfile?.languages ?? []) as string[],
    city: existingProfile?.city ?? "",
    country: existingProfile?.country ?? "India",
    latitude: existingProfile?.latitude ?? undefined as number | undefined,
    longitude: existingProfile?.longitude ?? undefined as number | undefined,
    displayArea: existingProfile?.displayArea ?? "",
    willingToTravel: existingProfile?.willingToTravel ?? false,
    travelRadiusKm: existingProfile?.travelRadiusKm?.toString() ?? "10",
    pricingMinINR: existingProfile?.pricingMinINR?.toString() ?? "",
    pricingMaxINR: existingProfile?.pricingMaxINR?.toString() ?? "",
  });

  const profileExists = useRef(!!existingProfile);

  useEffect(() => {
    if (existingProfile) {
      profileExists.current = true;
      if (existingProfile.vertical && !vertical) {
        setVertical(existingProfile.vertical as VerticalValue);
      }
      setForm((prev) => ({
        ...prev,
        fullName: prev.fullName || existingProfile.fullName || "",
        bio: prev.bio || existingProfile.bio || "",
        yearsExperience: prev.yearsExperience !== "0" ? prev.yearsExperience : existingProfile.yearsExperience?.toString() ?? "0",
        languages: prev.languages.length > 0 ? prev.languages : (existingProfile.languages ?? []),
        city: prev.city || existingProfile.city || "",
        country: prev.country || existingProfile.country || "India",
        displayArea: prev.displayArea || existingProfile.displayArea || "",
        pricingMinINR: prev.pricingMinINR || existingProfile.pricingMinINR?.toString() || "",
        pricingMaxINR: prev.pricingMaxINR || existingProfile.pricingMaxINR?.toString() || "",
      }));
    }
  }, [existingProfile]);

  const { mutateAsync: setMyRoleAsync } = useSetMyRole();
  const [roleReady, setRoleReady] = useState(false);
  const roleSetTriggered = useRef(false);

  useEffect(() => {
    sessionStorage.removeItem("includly_signup_as");
    localStorage.removeItem("includly_signup_as");
  }, []);

  useEffect(() => {
    if (meError && !roleSetTriggered.current) {
      setRoleReady(true);
      return;
    }
    if (!me) return;
    if (roleSetTriggered.current) return;

    if (me.role === "centre_admin") {
      setLocation("/centre/overview", { replace: true });
      return;
    }

    if (me.role === "professional" || me.role === "admin") {
      setRoleReady(true);
      return;
    }

    const choseProf = sessionStorage.getItem("chose_professional");
    sessionStorage.removeItem("chose_professional");
    if (!choseProf) {
      setLocation("/onboarding", { replace: true });
      return;
    }

    const isCentre = sessionStorage.getItem("is_therapy_centre") === "true";
    sessionStorage.removeItem("is_therapy_centre");
    if (isCentre) {
      roleSetTriggered.current = true;
      setMyRoleAsync({ data: { role: "centre_admin" as "professional" } })
        .then(() => queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() }))
        .catch(() => { roleSetTriggered.current = false; })
        .finally(() => setLocation("/centre/overview", { replace: true }));
      return;
    }

    roleSetTriggered.current = true;
    setMyRoleAsync({ data: { role: "professional" } })
      .then(() => queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() }))
      .catch(() => { roleSetTriggered.current = false; })
      .finally(() => setRoleReady(true));
  }, [me, meError]);

  const createMutation = useMutation(getCreateProfessionalProfileMutationOptions());
  const updateMutation = useMutation(getUpdateProfessionalProfileMutationOptions());

  if (profileLoading || !roleReady) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-teal-600" size={28} />
      </div>
    );
  }

  const isCoachingUser = existingProfile?.specialty === "coaching";

  if (isCoachingUser) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="w-16 h-16 bg-orange-50 rounded-2xl flex items-center justify-center mx-auto text-3xl">🏆</div>
          <div>
            <h2 className="text-xl font-serif font-semibold text-foreground mb-2">Coaching profiles</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Your coaching profile is managed separately from the new onboarding flow. Head to your dashboard to view and update your profile details.
            </p>
          </div>
          <Button onClick={() => setLocation("/pro/today")} className="gap-2 bg-teal-600 hover:bg-teal-700 text-white">
            Go to dashboard <ArrowRight size={16} />
          </Button>
        </div>
      </div>
    );
  }

  function setField(field: string, value: string | boolean | number | string[] | undefined) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function toggleLanguage(lang: string) {
    setForm((prev) => ({
      ...prev,
      languages: prev.languages.includes(lang)
        ? prev.languages.filter((l) => l !== lang)
        : [...prev.languages, lang],
    }));
  }

  async function saveVertical() {
    if (!vertical) return;
    const specialty = VERTICAL_TO_SPECIALTY[vertical];
    setIsSaving(true);
    try {
      if (!profileExists.current) {
        await createMutation.mutateAsync({
          data: {
            vertical,
            specialty,
            fullName: "",
            qualifications: "",
            yearsExperience: 0,
          },
        });
        profileExists.current = true;
      } else {
        await updateMutation.mutateAsync({
          data: { vertical, specialty },
        });
      }
      queryClient.invalidateQueries({ queryKey: getGetMyProfessionalProfileQueryKey() });
      setStep(1);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not save — please try again.";
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }

  async function saveIdentity() {
    setIsSaving(true);
    try {
      await updateMutation.mutateAsync({
        data: {
          fullName: form.fullName,
          bio: form.bio || undefined,
          yearsExperience: Number(form.yearsExperience),
        },
      });
      queryClient.invalidateQueries({ queryKey: getGetMyProfessionalProfileQueryKey() });
      setStep(2);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not save — please try again.";
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }

  async function saveLanguages() {
    setIsSaving(true);
    try {
      await updateMutation.mutateAsync({
        data: { languages: form.languages },
      });
      queryClient.invalidateQueries({ queryKey: getGetMyProfessionalProfileQueryKey() });
      setStep(3);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not save — please try again.";
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }

  async function saveLocation() {
    setIsSaving(true);
    try {
      await updateMutation.mutateAsync({
        data: {
          city: form.city || undefined,
          country: form.country || undefined,
          latitude: form.latitude,
          longitude: form.longitude,
          displayArea: form.displayArea.trim() || undefined,
          willingToTravel: form.willingToTravel,
          travelRadiusKm: form.willingToTravel ? Number(form.travelRadiusKm) : undefined,
        },
      });
      queryClient.invalidateQueries({ queryKey: getGetMyProfessionalProfileQueryKey() });
      setStep(4);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not save — please try again.";
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }

  async function savePricing() {
    setIsSaving(true);
    try {
      await updateMutation.mutateAsync({
        data: {
          pricingMinINR: form.pricingMinINR ? Number(form.pricingMinINR) : undefined,
          pricingMaxINR: form.pricingMaxINR ? Number(form.pricingMaxINR) : undefined,
        },
      });
      queryClient.invalidateQueries({ queryKey: getGetMyProfessionalProfileQueryKey() });
      setLocation(`/onboarding/pro/stage2/${vertical}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not save — please try again.";
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }

  function handleContinue() {
    if (step === 0) return saveVertical();
    if (step === 1) return saveIdentity();
    if (step === 2) return saveLanguages();
    if (step === 3) return saveLocation();
    if (step === 4) return savePricing();
  }

  function canAdvance(): boolean {
    if (step === 0) return !!vertical;
    if (step === 1) return !!form.fullName.trim();
    return true;
  }

  const isEditing = !!existingProfile?.paymentActivated;
  const canProceed = canAdvance() && !isSaving;

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "linear-gradient(160deg, #F4FAF9 0%, #FFFFFF 60%)" }}
    >
      {/* ── Top bar ── */}
      <div className="flex items-center justify-between px-5 pt-4 pb-2.5 shrink-0 max-w-lg w-full mx-auto">
        <button
          type="button"
          onClick={() => step > 0 && !isSaving && setStep((s) => s - 1)}
          className="text-[13px] font-medium transition-colors select-none"
          style={{ color: step === 0 ? "#D1D5DB" : "#6B7280", cursor: step === 0 ? "default" : "pointer" }}
        >
          ← Back
        </button>

        <a
          href="/"
          className="font-bold tracking-tight"
          style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 19, color: "#0D9488", letterSpacing: "-0.02em" }}
        >
          includly
        </a>

        <span className="w-[52px] flex justify-end">
          {isEditing && (
            <span className="text-[10px] font-semibold text-teal-700 bg-teal-50 border border-teal-100 rounded-full px-2 py-0.5">
              Editing
            </span>
          )}
        </span>
      </div>

      {/* ── Progress bar ── */}
      <div className="px-5 pb-4 shrink-0 max-w-lg w-full mx-auto">
        <div className="flex gap-[5px] mb-[5px]">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className="flex-1 rounded-full transition-colors"
              style={{ height: 4, background: i <= step ? "#0D9488" : "#E5E7EB" }}
            />
          ))}
        </div>
        <div className="flex justify-between">
          {STEPS.map((label, i) => (
            <span
              key={i}
              className="transition-colors"
              style={{
                fontSize: 10,
                fontWeight: i === step ? 600 : 400,
                color: i === step ? "#0D9488" : "#9CA3AF",
              }}
            >
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* ── Step heading ── */}
      <div className="px-5 pb-[18px] shrink-0 max-w-lg w-full mx-auto">
        <h1
          className="font-bold text-gray-900 leading-tight"
          style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 24, letterSpacing: "-0.02em" }}
        >
          {isEditing && step === 0 ? "Update your role" : STEP_HEADINGS[step]}
        </h1>
        <p className="text-gray-500 mt-[7px] leading-relaxed" style={{ fontSize: 13.5 }}>
          {STEP_SUBTITLES[step]}
        </p>
      </div>

      {/* ── Scrollable content ── */}
      <div className="flex-1 overflow-y-auto px-5 pb-2 max-w-lg w-full mx-auto">

        {/* Step 0 — Role picker */}
        {step === 0 && (
          <div className="flex flex-col gap-3">
            {VERTICAL_CARDS.map((card) => {
              const isSelected = vertical === card.value;
              return (
                <button
                  key={card.value}
                  type="button"
                  onClick={() => setVertical(card.value)}
                  className="flex items-start text-left w-full relative focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
                  style={{
                    gap: 14,
                    padding: "15px 14px",
                    border: `2px solid ${isSelected ? card.selectedBorder : "#E5E7EB"}`,
                    borderRadius: 16,
                    background: isSelected ? card.selectedBg : "#FFFFFF",
                    boxShadow: isSelected
                      ? `0 0 0 4px ${card.selectedRing}`
                      : "0 1px 3px rgba(0,0,0,0.06)",
                    transition: "all 0.18s ease",
                    minHeight: 80,
                  }}
                  data-testid={`vertical-card-${card.value}`}
                >
                  <div
                    className="flex items-center justify-center shrink-0 transition-colors"
                    style={{
                      width: 50,
                      height: 50,
                      borderRadius: 13,
                      background: isSelected ? card.iconBg : "#F9FAFB",
                      fontSize: 24,
                    }}
                  >
                    {card.emoji}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-gray-900 mb-1 leading-tight" style={{ fontSize: 15 }}>
                      {card.title}
                    </div>
                    <div className="text-gray-500 leading-relaxed" style={{ fontSize: 12.5 }}>
                      {card.desc}
                    </div>
                  </div>

                  {isSelected && (
                    <div className="absolute top-[10px] right-[10px]">
                      <CheckCircle2 size={20} style={{ color: card.selectedBorder }} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Step 1 — About you */}
        {step === 1 && (
          <div className="space-y-5">
            <div>
              <Label htmlFor="fullName" className="text-sm font-medium">
                Full name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="fullName"
                value={form.fullName}
                onChange={(e) => setField("fullName", e.target.value)}
                placeholder="Dr. Priya Sharma"
                className="mt-1"
                data-testid="input-fullName"
              />
            </div>
            <div>
              <Label htmlFor="bio" className="text-sm font-medium">
                Short bio <span className="text-gray-400 font-normal">(optional)</span>
              </Label>
              <Textarea
                id="bio"
                value={form.bio}
                onChange={(e) => setField("bio", e.target.value)}
                placeholder="Tell parents about your approach, experience, and what makes you a great fit for children with special needs…"
                className="mt-1 min-h-[110px]"
                data-testid="input-bio"
              />
            </div>
            <div>
              <Label htmlFor="yearsExperience" className="text-sm font-medium">
                Years of experience
              </Label>
              <Input
                id="yearsExperience"
                type="number"
                min={0}
                max={60}
                value={form.yearsExperience}
                onChange={(e) => setField("yearsExperience", e.target.value)}
                className="mt-1"
                data-testid="input-yearsExperience"
              />
            </div>
          </div>
        )}

        {/* Step 2 — Languages */}
        {step === 2 && (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              {LANGUAGE_OPTIONS.map((lang) => {
                const selected = form.languages.includes(lang);
                return (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => toggleLanguage(lang)}
                    className={`px-4 py-2 rounded-full border text-sm font-medium transition-all ${
                      selected
                        ? "bg-teal-600 text-white border-teal-600"
                        : "bg-white border-gray-200 text-gray-700 hover:border-teal-400"
                    }`}
                  >
                    {lang}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-gray-400">You can skip this — it's optional but improves your match score.</p>
          </div>
        )}

        {/* Step 3 — Location */}
        {step === 3 && (
          <div className="space-y-4">
            <CityAutocomplete
              city={form.city}
              area={form.displayArea}
              onSelect={(result: CityResult) => {
                setField("city", result.city);
                setField("displayArea", result.area || form.displayArea);
                setField("latitude", result.lat);
                setField("longitude", result.lng);
              }}
              onManualChange={(city) => setField("city", city)}
            />
            <div>
              <Label htmlFor="country" className="text-sm font-medium">Country</Label>
              <Input
                id="country"
                value={form.country}
                onChange={(e) => setField("country", e.target.value)}
                placeholder="India"
                className="mt-1"
                data-testid="input-country"
              />
            </div>
            <div>
              <Label htmlFor="displayArea" className="text-sm font-medium">
                Area shown to parents <span className="text-gray-400 font-normal">(optional)</span>
              </Label>
              <Input
                id="displayArea"
                value={form.displayArea}
                onChange={(e) => setField("displayArea", e.target.value)}
                placeholder="e.g. Bandra West, Mumbai"
                className="mt-1"
                data-testid="input-display-area"
              />
            </div>
            <div className="flex items-center justify-between py-2.5 px-3 border border-gray-200 rounded-xl bg-white">
              <div>
                <p className="text-sm font-medium text-gray-800">Willing to travel / home visits</p>
                <p className="text-xs text-gray-500">Do you travel to the child's location?</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={form.willingToTravel}
                onClick={() => setField("willingToTravel", !form.willingToTravel)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 ${form.willingToTravel ? "bg-teal-600" : "bg-gray-200"}`}
                data-testid="switch-travel"
              >
                <span className={`pointer-events-none block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform ${form.willingToTravel ? "translate-x-5" : "translate-x-0"}`} />
              </button>
            </div>
            {form.willingToTravel && (
              <div>
                <Label className="text-sm font-medium">Travel radius</Label>
                <div className="flex gap-2 mt-1">
                  {TRAVEL_RADIUS_OPTIONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setField("travelRadiusKm", r.toString())}
                      className={`flex-1 py-2 rounded-xl border text-sm font-medium transition-all ${
                        form.travelRadiusKm === r.toString()
                          ? "bg-teal-600 text-white border-teal-600"
                          : "bg-white border-gray-200 text-gray-700 hover:border-teal-400"
                      }`}
                    >
                      {r} km
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 4 — Pricing */}
        {step === 4 && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="pricingMinINR" className="text-sm font-medium">Min. rate (₹)</Label>
                <div className="relative mt-1">
                  <IndianRupee size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="pricingMinINR"
                    type="number"
                    min={0}
                    value={form.pricingMinINR}
                    onChange={(e) => setField("pricingMinINR", e.target.value)}
                    placeholder="500"
                    className="pl-7"
                    data-testid="input-pricingMinINR"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="pricingMaxINR" className="text-sm font-medium">Max. rate (₹)</Label>
                <div className="relative mt-1">
                  <IndianRupee size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="pricingMaxINR"
                    type="number"
                    min={0}
                    value={form.pricingMaxINR}
                    onChange={(e) => setField("pricingMaxINR", e.target.value)}
                    placeholder="2000"
                    className="pl-7"
                    data-testid="input-pricingMaxINR"
                  />
                </div>
              </div>
            </div>
            {form.pricingMinINR && form.pricingMaxINR && (
              <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-800 font-medium">
                Profile will show: ₹{Number(form.pricingMinINR).toLocaleString("en-IN")} – ₹{Number(form.pricingMaxINR).toLocaleString("en-IN")} / session
              </div>
            )}
            <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-700 leading-relaxed">
              After this step you'll answer a few more questions specific to your role, then your profile will be reviewed by our team. You can verify your UPI ID for payouts from your dashboard once your profile is live.
            </div>
          </div>
        )}
      </div>

      {/* ── Sticky CTA ── */}
      <div
        className="shrink-0 px-5 pb-6 pt-3.5 max-w-lg w-full mx-auto"
        style={{
          borderTop: "1px solid rgba(229,231,235,0.5)",
          background: "linear-gradient(to top, #fff 80%, rgba(255,255,255,0))",
        }}
      >
        <button
          type="button"
          onClick={handleContinue}
          disabled={!canProceed}
          className="w-full flex items-center justify-center gap-2 font-semibold transition-all"
          style={{
            height: 52,
            borderRadius: 14,
            fontSize: 16,
            border: "none",
            background: canProceed ? "#0D9488" : "#E5E7EB",
            color: canProceed ? "#FFFFFF" : "#9CA3AF",
            cursor: canProceed ? "pointer" : "not-allowed",
            letterSpacing: "0.01em",
          }}
          data-testid={step === 4 ? "submit-stage1-btn" : "next-step-btn"}
        >
          {isSaving ? (
            <Loader2 size={18} className="animate-spin" />
          ) : step === 4 ? (
            <>Save & continue <ArrowRight size={16} /></>
          ) : (
            <>Continue <ArrowRight size={16} /></>
          )}
        </button>
        <p className="text-center text-gray-400 mt-[9px]" style={{ fontSize: 11.5 }}>
          Step {step + 1} of {STEPS.length} · Takes about 3 minutes
        </p>
      </div>
    </div>
  );
}
