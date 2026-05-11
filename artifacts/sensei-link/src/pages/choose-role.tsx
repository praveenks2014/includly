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
  Heart,
  Briefcase,
  Loader2,
  LocateFixed,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";

const AGE_RANGES = ["0–3 years", "3–6 years", "6–12 years", "12–18 years", "18+ years"];

const CONDITIONS = [
  "ADHD",
  "Autism",
  "Dyslexia",
  "Cerebral Palsy",
  "Down Syndrome",
  "Speech Delay",
  "Learning Disabilities",
  "Multiple Disabilities",
  "Not sure yet",
];

const SUPPORT_TYPES = [
  "Occupational Therapist",
  "Speech Therapist",
  "Special Education Teacher",
  "Shadow Teacher",
  "Behavioral Therapist",
  "Psychologist / Counsellor",
  "Developmental Paediatrician",
  "Not sure yet",
];

const PARENT_STEPS = ["Your child", "Support needed", "Your location"];

export default function ChooseRolePage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { mutateAsync: setMyRoleAsync } = useSetMyRole();
  const { mutateAsync: updateMe } = useUpdateMe();

  const [phase, setPhase] = useState<"choose" | "parent">("choose");
  const [step, setStep] = useState(0);

  const [childAge, setChildAge] = useState("");
  const [condition, setCondition] = useState("");
  const [supportTypes, setSupportTypes] = useState<string[]>([]);
  const [locationText, setLocationText] = useState("");
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function toggleSupportType(type: string) {
    setSupportTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  }

  function canProceed() {
    if (step === 0) return !!childAge && !!condition;
    if (step === 1) return supportTypes.length > 0;
    return true;
  }

  function handleBack() {
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

      if (locationText.trim()) {
        await updateMe({ data: { location: locationText.trim() } });
      }

      localStorage.setItem("includly_child_age", childAge);
      localStorage.setItem("includly_child_condition", condition);
      localStorage.setItem("includly_support_types", JSON.stringify(supportTypes));

      setLocation("/dashboard");
    } catch {
      toast({ title: "Something went wrong", description: "Please try again.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleChooseProfessional() {
    sessionStorage.setItem("chose_professional", "true");
    setLocation("/onboard");
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-blue-50 flex flex-col">
      <div className="flex justify-center pt-8 pb-4">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
            <span className="text-white font-bold text-base">In</span>
          </div>
          <span className="font-serif font-semibold text-xl text-foreground">Includly</span>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-lg">

          {phase === "choose" && (
            <div>
              <div className="text-center mb-8">
                <h1 className="text-2xl font-serif font-semibold text-foreground mb-2">
                  Welcome to Includly
                </h1>
                <p className="text-muted-foreground text-sm">
                  Tell us how you're joining so we can personalise your experience.
                </p>
              </div>

              <div className="grid gap-4">
                <button
                  onClick={() => { setPhase("parent"); setStep(0); }}
                  className="group w-full text-left bg-white border-2 border-border hover:border-primary rounded-2xl p-6 transition-all hover:shadow-md"
                >
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-rose-100 flex items-center justify-center shrink-0 group-hover:bg-rose-200 transition-colors">
                      <Heart size={22} className="text-rose-600" />
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-foreground text-base mb-1">I'm a Parent / Caregiver</p>
                      <p className="text-sm text-muted-foreground">
                        I'm looking for verified special education professionals for my child.
                      </p>
                    </div>
                    <ChevronRight size={18} className="text-muted-foreground shrink-0 mt-1 group-hover:text-primary transition-colors" />
                  </div>
                </button>

                <button
                  onClick={handleChooseProfessional}
                  className="group w-full text-left bg-white border-2 border-border hover:border-primary rounded-2xl p-6 transition-all hover:shadow-md"
                >
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-violet-100 flex items-center justify-center shrink-0 group-hover:bg-violet-200 transition-colors">
                      <Briefcase size={22} className="text-violet-600" />
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-foreground text-base mb-1">I'm a Professional</p>
                      <p className="text-sm text-muted-foreground">
                        I'm a therapist, special educator, shadow teacher, or related specialist.
                      </p>
                    </div>
                    <ChevronRight size={18} className="text-muted-foreground shrink-0 mt-1 group-hover:text-primary transition-colors" />
                  </div>
                </button>
              </div>

              <p className="text-center text-xs text-muted-foreground mt-6">
                Already have an account?{" "}
                <a href="/sign-in" className="underline text-primary">Sign in</a>
              </p>
            </div>
          )}

          {phase === "parent" && (
            <div>
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-muted-foreground font-medium">
                    Step {step + 1} of {PARENT_STEPS.length}: {PARENT_STEPS[step]}
                  </p>
                </div>
                <div className="flex gap-2">
                  {PARENT_STEPS.map((_, i) => (
                    <div
                      key={i}
                      className={`flex-1 h-1.5 rounded-full transition-colors ${i <= step ? "bg-primary" : "bg-muted"}`}
                    />
                  ))}
                </div>
              </div>

              {step === 0 && (
                <div className="bg-white rounded-2xl border border-border p-6 shadow-sm space-y-6">
                  <div>
                    <h2 className="text-xl font-serif font-semibold text-foreground mb-1">
                      Tell us about your child
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      This helps us show the most relevant professionals near you.
                    </p>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-foreground mb-3">
                      Child's age group <span className="text-destructive">*</span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {AGE_RANGES.map((age) => (
                        <button
                          key={age}
                          onClick={() => setChildAge(age)}
                          className={`px-4 py-2 rounded-full border text-sm font-medium transition-all ${
                            childAge === age
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-white border-border text-foreground hover:border-primary"
                          }`}
                        >
                          {age}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-foreground mb-3">
                      Primary challenge / condition <span className="text-destructive">*</span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {CONDITIONS.map((cond) => (
                        <button
                          key={cond}
                          onClick={() => setCondition(cond)}
                          className={`px-4 py-2 rounded-full border text-sm font-medium transition-all ${
                            condition === cond
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-white border-border text-foreground hover:border-primary"
                          }`}
                        >
                          {cond}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {step === 1 && (
                <div className="bg-white rounded-2xl border border-border p-6 shadow-sm space-y-5">
                  <div>
                    <h2 className="text-xl font-serif font-semibold text-foreground mb-1">
                      What kind of support do you need?
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Select all that apply — you can explore more professionals later.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {SUPPORT_TYPES.map((type) => (
                      <button
                        key={type}
                        onClick={() => toggleSupportType(type)}
                        className={`px-4 py-2 rounded-full border text-sm font-medium transition-all flex items-center gap-1.5 ${
                          supportTypes.includes(type)
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-white border-border text-foreground hover:border-primary"
                        }`}
                      >
                        {supportTypes.includes(type) && <CheckCircle2 size={13} />}
                        {type}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="bg-white rounded-2xl border border-border p-6 shadow-sm space-y-5">
                  <div>
                    <h2 className="text-xl font-serif font-semibold text-foreground mb-1">
                      Where are you based?
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      We'll show professionals closest to you. You can update this anytime.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <Input
                      value={locationText}
                      onChange={(e) => setLocationText(e.target.value)}
                      placeholder="e.g. Koramangala, Bengaluru"
                      className="text-base"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleAutoDetect}
                      disabled={isGettingLocation}
                      className="gap-2 w-full"
                    >
                      {isGettingLocation
                        ? <Loader2 size={13} className="animate-spin" />
                        : <LocateFixed size={13} />}
                      {isGettingLocation ? "Detecting location…" : "Auto-detect my location"}
                    </Button>
                  </div>

                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700 leading-relaxed">
                    Your location helps us find verified professionals in your city or neighbourhood.
                    We never share your exact address.
                  </div>
                </div>
              )}

              <div className="flex justify-between mt-6">
                <Button
                  variant="outline"
                  onClick={handleBack}
                  disabled={isSubmitting}
                  className="gap-1"
                >
                  <ChevronLeft size={15} /> Back
                </Button>

                {step < PARENT_STEPS.length - 1 ? (
                  <Button
                    onClick={() => setStep((s) => s + 1)}
                    disabled={!canProceed()}
                    className="gap-1"
                  >
                    Continue <ChevronRight size={15} />
                  </Button>
                ) : (
                  <Button
                    onClick={handleSubmitParent}
                    disabled={isSubmitting}
                    className="gap-2"
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
    </div>
  );
}
