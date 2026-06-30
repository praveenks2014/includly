import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { fetchWithAuth } from "@/lib/api";
import {
  useGetMyProfessionalProfile,
  getGetMyProfessionalProfileQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle2, AlertTriangle, ArrowRight } from "lucide-react";

type VerticalValue = "shadow_teacher" | "home_tutor" | "therapist";

const VERTICAL_META: Record<VerticalValue, { emoji: string; title: string; color: string }> = {
  shadow_teacher: { emoji: "🧑‍🏫", title: "Shadow Teacher", color: "teal" },
  home_tutor: { emoji: "📚", title: "Home Tutor", color: "blue" },
  therapist: { emoji: "🩺", title: "Therapist / Special Educator", color: "violet" },
};

export default function OnboardStage2Page() {
  const params = useParams<{ vertical: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: profile, isLoading } = useGetMyProfessionalProfile();

  const vertical = (params.vertical ?? profile?.vertical ?? "shadow_teacher") as VerticalValue;
  const meta = VERTICAL_META[vertical] ?? VERTICAL_META.shadow_teacher;
  const isTherapist = vertical === "therapist";

  const [isActivating, setIsActivating] = useState(false);

  useEffect(() => {
    if (!isLoading && !profile) {
      setLocation("/onboarding/pro", { replace: true });
    }
  }, [isLoading, profile]);

  async function handleContinue() {
    if (isTherapist) {
      setLocation("/pro/today");
      return;
    }
    setIsActivating(true);
    try {
      const res = await fetchWithAuth("/api/professionals/me/free-activate", { method: "POST" });
      if (!res.ok && res.status !== 409) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Activation failed");
      }
      queryClient.invalidateQueries({ queryKey: getGetMyProfessionalProfileQueryKey() });
      toast({ title: "Profile activated!", description: "You'll appear in search results once our team reviews your profile." });
      setLocation("/pro/today");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      toast({ title: "Activation error", description: msg, variant: "destructive" });
    } finally {
      setIsActivating(false);
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-teal-600" size={28} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#f0faf8] via-[#f7fbf9] to-[#f0f4ff]">
      <div className="flex justify-center pt-8 pb-2">
        <a href="/" className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-teal-600 flex items-center justify-center shadow-sm">
            <span className="text-white font-bold text-base">In</span>
          </div>
          <span className="font-serif font-semibold text-xl text-gray-900">
            Includly<span className="text-teal-500 ml-0.5">·</span>
          </span>
        </a>
      </div>

      <div className="max-w-lg mx-auto px-4 sm:px-6 py-10">
        <div className="flex gap-1.5 mb-8">
          {["Role", "About you", "Languages", "Location", "Pricing"].map((_, i) => (
            <div key={i} className="flex-1 h-1.5 rounded-full bg-teal-500" />
          ))}
        </div>

        <div className="bg-white border border-gray-100 rounded-2xl p-8 shadow-sm text-center space-y-6">
          <div className={`w-20 h-20 rounded-2xl flex items-center justify-center text-4xl mx-auto bg-${meta.color}-50`}>
            {meta.emoji}
          </div>

          <div>
            <div className="flex items-center justify-center gap-2 mb-2">
              <CheckCircle2 size={20} className="text-teal-500" />
              <span className="text-sm font-medium text-teal-700">Stage 1 complete</span>
            </div>
            <h1 className="text-2xl font-serif font-semibold text-gray-900 mb-2">
              Almost there!
            </h1>
            <p className="text-gray-500 text-sm leading-relaxed">
              Your basic profile as a <strong>{meta.title}</strong> has been saved.
            </p>
          </div>

          {isTherapist ? (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 text-left space-y-2">
              <div className="flex items-center gap-2 text-amber-700 font-semibold text-sm">
                <AlertTriangle size={16} />
                Stage 2 required before going live
              </div>
              <p className="text-xs text-amber-700 leading-relaxed">
                Therapist profiles require your <strong>RCI CRR number</strong>, discipline, and practice details before they can appear in parent search. Stage 2 questions are launching shortly — you'll get an email when they're ready.
              </p>
              <p className="text-xs text-amber-600">
                Your profile is saved as a draft. You will <strong>not</strong> appear in search until Stage 2 is complete.
              </p>
            </div>
          ) : (
            <div className="bg-teal-50 border border-teal-100 rounded-xl px-5 py-4 text-left space-y-2">
              <p className="text-sm font-medium text-teal-800">What happens next</p>
              <ul className="text-xs text-teal-700 space-y-1 leading-relaxed">
                <li>• Your profile will be reviewed by our team (usually within 24 hours)</li>
                <li>• Upload a verification document from your dashboard to go live faster</li>
                <li>• Stage 2 (role-specific questions) launches soon — you'll be notified</li>
              </ul>
            </div>
          )}

          <Button
            onClick={handleContinue}
            disabled={isActivating}
            className="w-full gap-2 bg-teal-600 hover:bg-teal-700 text-white h-11 text-base"
          >
            {isActivating ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <>
                {isTherapist ? "Go to dashboard (draft)" : "Go to dashboard"}
                <ArrowRight size={16} />
              </>
            )}
          </Button>

          <p className="text-xs text-gray-400">
            You can always come back to update your profile from your dashboard.
          </p>
        </div>
      </div>
    </div>
  );
}
