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
  ChevronRight,
  ChevronLeft,
  ArrowRight,
} from "lucide-react";

const STEPS = ["Role", "About you", "Languages", "Location", "Pricing"];

const VERTICAL_CARDS = [
  {
    value: "shadow_teacher",
    emoji: "🧑‍🏫",
    title: "Shadow Teacher",
    desc: "I support children with special needs inside school, helping them participate in mainstream classrooms.",
    bg: "bg-teal-50",
    accent: "border-teal-500 ring-teal-200",
    iconBg: "bg-teal-100",
  },
  {
    value: "home_tutor",
    emoji: "📚",
    title: "Home Tutor",
    desc: "I teach academic subjects to children with learning differences at home, at their pace.",
    bg: "bg-blue-50",
    accent: "border-blue-500 ring-blue-200",
    iconBg: "bg-blue-100",
  },
  {
    value: "therapist",
    emoji: "🩺",
    title: "Therapist / Special Educator",
    desc: "I provide speech, OT, behavioural (ABA), or special education therapy. RCI registration required.",
    bg: "bg-violet-50",
    accent: "border-violet-500 ring-violet-200",
    iconBg: "bg-violet-100",
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
    upiId: existingProfile?.upiId ?? "",
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
        upiId: prev.upiId || existingProfile.upiId || "",
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
          upiId: form.upiId.trim() || undefined,
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#f0faf8] via-[#f7fbf9] to-[#f0f4ff]">
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

      <div className="max-w-xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-serif font-semibold text-gray-900 mb-1">
            {isEditing ? "Edit your profile" : "Set up your profile"}
          </h1>
          <p className="text-muted-foreground text-sm">
            Step {step + 1} of {STEPS.length}: <span className="text-gray-700 font-medium">{STEPS[step]}</span>
          </p>
        </div>

        <div className="flex gap-1.5 mb-8">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`flex-1 h-1.5 rounded-full transition-colors ${i <= step ? "bg-teal-500" : "bg-gray-200"}`}
            />
          ))}
        </div>

        <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">

          {step === 0 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-1">What kind of professional are you?</h2>
                <p className="text-sm text-gray-500 mb-4">Choose your primary role — you can update this later.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {VERTICAL_CARDS.slice(0, 2).map((card) => {
                    const selected = vertical === card.value;
                    return (
                      <button
                        key={card.value}
                        type="button"
                        onClick={() => setVertical(card.value)}
                        className={`relative text-left rounded-2xl p-5 border-2 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${
                          selected
                            ? `${card.accent} ring-2 shadow-md bg-white`
                            : "border-gray-100 hover:border-gray-300 bg-white hover:shadow-sm"
                        }`}
                        data-testid={`vertical-card-${card.value}`}
                      >
                        {selected && (
                          <div className="absolute top-3 right-3 w-6 h-6 rounded-full bg-teal-500 flex items-center justify-center">
                            <CheckCircle2 size={14} className="text-white" strokeWidth={3} />
                          </div>
                        )}
                        <div className={`w-12 h-12 ${card.iconBg} rounded-xl flex items-center justify-center text-2xl mb-3`}>
                          {card.emoji}
                        </div>
                        <h3 className={`font-semibold text-sm mb-1 ${selected ? "text-teal-700" : "text-gray-900"}`}>
                          {card.title}
                        </h3>
                        <p className="text-xs text-gray-500 leading-relaxed">{card.desc}</p>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3">
                  {VERTICAL_CARDS.slice(2).map((card) => {
                    const selected = vertical === card.value;
                    return (
                      <button
                        key={card.value}
                        type="button"
                        onClick={() => setVertical(card.value)}
                        className={`relative w-full text-left rounded-2xl p-5 border-2 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${
                          selected
                            ? `${card.accent} ring-2 shadow-md bg-white`
                            : "border-gray-100 hover:border-gray-300 bg-white hover:shadow-sm"
                        }`}
                        data-testid={`vertical-card-${card.value}`}
                      >
                        {selected && (
                          <div className="absolute top-3 right-3 w-6 h-6 rounded-full bg-teal-500 flex items-center justify-center">
                            <CheckCircle2 size={14} className="text-white" strokeWidth={3} />
                          </div>
                        )}
                        <div className="flex items-center gap-4">
                          <div className={`w-12 h-12 ${card.iconBg} rounded-xl flex items-center justify-center text-2xl shrink-0`}>
                            {card.emoji}
                          </div>
                          <div>
                            <h3 className={`font-semibold text-sm mb-0.5 ${selected ? "text-teal-700" : "text-gray-900"}`}>
                              {card.title}
                            </h3>
                            <p className="text-xs text-gray-500 leading-relaxed">{card.desc}</p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-1">Tell us about yourself</h2>
                <p className="text-sm text-gray-500 mb-4">This appears on your public profile.</p>
              </div>
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

          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-1">Languages you work in</h2>
                <p className="text-sm text-gray-500 mb-4">
                  Parents filter by language — select all you're comfortable working in.
                </p>
              </div>
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

          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-1">Where are you based?</h2>
                <p className="text-sm text-gray-500 mb-4">
                  Helps parents nearby find you. Your exact address is never shared before a booking.
                </p>
              </div>
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
              <div className="flex items-center justify-between py-2.5 px-3 border border-gray-200 rounded-xl">
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

          {step === 4 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-1">Pricing & payment</h2>
                <p className="text-sm text-gray-500 mb-4">
                  Let parents know your session rate. You can always update this later.
                </p>
              </div>
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
              <div className="border-t border-gray-100 pt-4">
                <Label htmlFor="upiId" className="text-sm font-medium">
                  UPI ID <span className="text-gray-400 font-normal">(for payouts)</span>
                </Label>
                <Input
                  id="upiId"
                  value={form.upiId}
                  onChange={(e) => setField("upiId", e.target.value)}
                  placeholder="yourname@upi"
                  className="mt-1"
                  data-testid="input-upiId"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Parents pay via Razorpay. Your payout goes to this UPI. Never shown to parents.
                </p>
              </div>
              <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-700 leading-relaxed">
                After this step you'll answer a few more questions specific to your role, then your profile will be reviewed by our team.
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-between mt-6">
          <Button
            variant="outline"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0 || isSaving}
            className="gap-1 border-gray-200"
          >
            <ChevronLeft size={15} /> Back
          </Button>
          <Button
            onClick={handleContinue}
            disabled={!canAdvance() || isSaving}
            className="gap-2 bg-teal-600 hover:bg-teal-700 text-white min-w-[120px]"
            data-testid={step === 4 ? "submit-stage1-btn" : "next-step-btn"}
          >
            {isSaving ? (
              <Loader2 size={15} className="animate-spin" />
            ) : step === 4 ? (
              <>Save & continue <ChevronRight size={15} /></>
            ) : (
              <>Continue <ChevronRight size={15} /></>
            )}
          </Button>
        </div>

        <p className="text-center text-xs text-gray-400 mt-5">
          Your progress is saved automatically at each step.
        </p>
      </div>
    </div>
  );
}
