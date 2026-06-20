import { useState } from "react";
import { useLocation } from "wouter";
import {
  useSetMyRole,
  useUpdateMe,
  getGetMeQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  LocateFixed,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Check,
} from "lucide-react";

type RoleChoice = "parent" | "professional" | "centre";

const ROLE_CARDS: {
  id: RoleChoice;
  emoji: string;
  title: string;
  desc: string;
  bg: string;
}[] = [
  {
    id: "parent",
    emoji: "👨‍👩‍👧",
    title: "Parent / Family",
    desc: "I'm looking for verified therapists, shadow teachers, or specialists for my child.",
    bg: "bg-rose-50",
  },
  {
    id: "professional",
    emoji: "👩‍⚕️",
    title: "Professional / Therapist",
    desc: "I'm a therapist, special educator, shadow teacher, or related specialist.",
    bg: "bg-teal-50",
  },
  {
    id: "centre",
    emoji: "🏥",
    title: "Therapy Centre",
    desc: "I represent a multi-discipline therapy centre, ABA centre, or special school.",
    bg: "bg-violet-50",
  },
];

const SUPPORT_TYPES = [
  "Occupational Therapist", "Speech Therapist", "Special Education Teacher",
  "Shadow Teacher", "Behavioral Therapist", "Psychologist / Counsellor",
  "Developmental Paediatrician", "Not sure yet",
];

const CHILD_COUNT_OPTIONS: { label: string; value: number }[] = [
  { label: "1", value: 1 },
  { label: "2", value: 2 },
  { label: "3", value: 3 },
  { label: "4+", value: 4 },
];

const PARENT_STEPS = ["Support needed", "Your family", "Your location"];

export default function ChooseRolePage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { mutateAsync: setMyRoleAsync } = useSetMyRole();
  const { mutateAsync: updateMe } = useUpdateMe();

  const [phase, setPhase] = useState<"choose" | "parent-wizard">("choose");
  const [selected, setSelected] = useState<RoleChoice | null>(null);
  const [step, setStep] = useState(0);

  const [supportTypes, setSupportTypes] = useState<string[]>([]);
  const [childCount, setChildCount] = useState<number | null>(null);
  const [locationText, setLocationText] = useState("");
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function toggleSupportType(type: string) {
    setSupportTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  }

  function canProceedWizard() {
    if (step === 0) return supportTypes.length > 0;
    if (step === 1) return childCount !== null;
    return true;
  }

  function handleContinue() {
    if (!selected) return;
    if (selected === "parent") {
      setPhase("parent-wizard");
      setStep(0);
    } else {
      sessionStorage.setItem("chose_professional", "true");
      if (selected === "centre") {
        sessionStorage.setItem("is_therapy_centre", "true");
      }
      setLocation("/onboard");
    }
  }

  function handleWizardBack() {
    if (step === 0) {
      setPhase("choose");
    } else {
      setStep((s) => s - 1);
    }
  }

  async function handleAutoDetect() {
    if (!navigator.geolocation) return;
    setIsGettingLocation(true);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 })
      );
      const { latitude: lat, longitude: lng } = pos.coords;
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
        { headers: { "Accept-Language": "en" } }
      );
      const data = await res.json() as {
        address?: { suburb?: string; city_district?: string; city?: string; state_district?: string };
      };
      const area = data.address?.suburb || data.address?.city_district || "";
      const city = data.address?.city || data.address?.state_district || "";
      const detected = [area, city].filter(Boolean).join(", ");
      if (detected) setLocationText(detected);
    } catch {
      // fail silently
    } finally {
      setIsGettingLocation(false);
    }
  }

  async function handleSubmitParent() {
    setIsSubmitting(true);
    try {
      await setMyRoleAsync({ data: { role: "parent" } });
      queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });

      await updateMe({
        data: {
          supportTypes,
          ...(childCount != null && { childCount }),
          ...(locationText.trim() && { location: locationText.trim() }),
        },
      });

      setLocation("/dashboard");
    } catch {
      toast({ title: "Something went wrong", description: "Please try again.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#dff2ec] via-[#f7fbf9] to-[#f0f4ff] flex flex-col">
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

      <div className="flex-1 flex items-center justify-center px-4 py-10">

        {/* ── ROLE SELECTION ── */}
        {phase === "choose" && (
          <div className="w-full max-w-3xl">
            <div className="text-center mb-10">
              <h1 className="text-3xl sm:text-4xl font-serif font-semibold text-gray-900 mb-3 leading-snug">
                Welcome to Includly!<br />How are you joining us?
              </h1>
              <p className="text-gray-500 text-base max-w-md mx-auto">
                Pick your role below so we can personalise your experience.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
              {ROLE_CARDS.map((card) => {
                const isSelected = selected === card.id;
                return (
                  <button
                    key={card.id}
                    onClick={() => setSelected(card.id)}
                    data-testid={`role-card-${card.id}`}
                    className={`relative text-left bg-white rounded-2xl p-6 border-2 transition-all duration-150 shadow-sm hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${
                      isSelected
                        ? "border-teal-500 ring-2 ring-teal-200 shadow-md"
                        : "border-gray-100 hover:border-teal-200"
                    }`}
                  >
                    <div
                      className={`absolute top-3 right-3 w-6 h-6 rounded-full flex items-center justify-center transition-all duration-150 ${
                        isSelected
                          ? "bg-teal-500 text-white scale-100 opacity-100"
                          : "bg-gray-100 text-transparent scale-75 opacity-0"
                      }`}
                    >
                      <Check size={13} strokeWidth={3} />
                    </div>

                    <div className={`w-14 h-14 ${card.bg} rounded-2xl flex items-center justify-center text-3xl mb-4`}>
                      {card.emoji}
                    </div>

                    <h3 className={`font-semibold text-base mb-1.5 transition-colors ${
                      isSelected ? "text-teal-700" : "text-gray-900"
                    }`}>
                      {card.title}
                    </h3>
                    <p className="text-sm text-gray-500 leading-relaxed">{card.desc}</p>
                  </button>
                );
              })}
            </div>

            <div className="flex justify-center">
              <Button
                onClick={handleContinue}
                disabled={!selected}
                size="lg"
                className="bg-teal-600 hover:bg-teal-700 text-white px-12 h-12 text-base gap-2 disabled:opacity-40"
                data-testid="choose-role-continue"
              >
                Continue
                <ChevronRight size={18} />
              </Button>
            </div>

            <p className="text-center text-xs text-gray-400 mt-5">
              Already have an account?{" "}
              <a href="/sign-in" className="underline text-teal-600 hover:text-teal-700">Sign in</a>
            </p>
          </div>
        )}

        {/* ── PARENT WIZARD ── */}
        {phase === "parent-wizard" && (
          <div className="w-full max-w-lg">
            {/* Progress */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-gray-500 font-medium">
                  Step {step + 1} of {PARENT_STEPS.length}: <span className="text-gray-800">{PARENT_STEPS[step]}</span>
                </p>
                <span className="text-xs text-gray-400">{Math.round(((step + 1) / PARENT_STEPS.length) * 100)}%</span>
              </div>
              <div className="flex gap-2">
                {PARENT_STEPS.map((_, i) => (
                  <div
                    key={i}
                    className={`flex-1 h-1.5 rounded-full transition-colors duration-300 ${
                      i <= step ? "bg-teal-500" : "bg-gray-200"
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Step 0 — Support types */}
            {step === 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm space-y-5">
                <div>
                  <h2 className="text-xl font-serif font-semibold text-gray-900 mb-1">What kind of support do you need?</h2>
                  <p className="text-sm text-gray-500">Select all that apply — you can explore more later.</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {SUPPORT_TYPES.map((type) => (
                    <button
                      key={type}
                      onClick={() => toggleSupportType(type)}
                      className={`px-4 py-2 rounded-full border text-sm font-medium transition-all flex items-center gap-1.5 ${
                        supportTypes.includes(type)
                          ? "bg-teal-600 text-white border-teal-600"
                          : "bg-white border-gray-200 text-gray-700 hover:border-teal-400"
                      }`}
                    >
                      {supportTypes.includes(type) && <CheckCircle2 size={13} />}
                      {type}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Step 1 — Child count */}
            {step === 1 && (
              <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm space-y-5">
                <div>
                  <h2 className="text-xl font-serif font-semibold text-gray-900 mb-1">Your family</h2>
                  <p className="text-sm text-gray-500">Helps us understand how many children you're finding support for.</p>
                </div>

                <div>
                  <p className="text-sm font-medium text-gray-800 mb-3">
                    How many children do you have? <span className="text-red-500">*</span>
                  </p>
                  <div className="flex gap-3">
                    {CHILD_COUNT_OPTIONS.map(({ label, value }) => (
                      <button
                        key={label}
                        onClick={() => setChildCount(value)}
                        className={`flex-1 py-3 rounded-xl border text-base font-semibold transition-all ${
                          childCount === value
                            ? "bg-teal-600 text-white border-teal-600 shadow-sm"
                            : "bg-white border-gray-200 text-gray-700 hover:border-teal-400"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-gray-400">
                    You can always add more children later — this is just a starting count.
                  </p>
                </div>
              </div>
            )}

            {/* Step 2 — Location */}
            {step === 2 && (
              <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm space-y-5">
                <div>
                  <h2 className="text-xl font-serif font-semibold text-gray-900 mb-1">Where are you based?</h2>
                  <p className="text-sm text-gray-500">We'll show professionals closest to you. You can update this anytime.</p>
                </div>

                <div className="space-y-3">
                  <Input
                    value={locationText}
                    onChange={(e) => setLocationText(e.target.value)}
                    placeholder="e.g. Koramangala, Bengaluru"
                    className="text-base border-gray-200 focus:border-teal-500"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAutoDetect}
                    disabled={isGettingLocation}
                    className="gap-2 w-full border-gray-200"
                  >
                    {isGettingLocation
                      ? <Loader2 size={13} className="animate-spin" />
                      : <LocateFixed size={13} />}
                    {isGettingLocation ? "Detecting location…" : "Auto-detect my location"}
                  </Button>
                </div>

                <div className="bg-teal-50 border border-teal-100 rounded-xl p-3 text-xs text-teal-700 leading-relaxed">
                  Your location helps us find verified professionals in your city or neighbourhood.
                  We never share your exact address.
                </div>
              </div>
            )}

            {/* Wizard nav */}
            <div className="flex justify-between mt-6">
              <Button
                variant="outline"
                onClick={handleWizardBack}
                disabled={isSubmitting}
                className="gap-1 border-gray-200"
              >
                <ChevronLeft size={15} /> Back
              </Button>

              {step < PARENT_STEPS.length - 1 ? (
                <Button
                  onClick={() => setStep((s) => s + 1)}
                  disabled={!canProceedWizard()}
                  className="gap-1 bg-teal-600 hover:bg-teal-700 text-white"
                >
                  Continue <ChevronRight size={15} />
                </Button>
              ) : (
                <Button
                  onClick={handleSubmitParent}
                  disabled={isSubmitting}
                  className="gap-2 bg-teal-600 hover:bg-teal-700 text-white"
                >
                  {isSubmitting && <Loader2 size={14} className="animate-spin" />}
                  {isSubmitting ? "Setting up…" : "Go to dashboard"}
                </Button>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
