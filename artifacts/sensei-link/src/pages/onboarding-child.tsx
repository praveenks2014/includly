import { useLocation } from "wouter";
import { Baby, ArrowRight } from "lucide-react";
import { CHILD_PROFILE_SKIP_KEY } from "@/contexts/SelectedChildContext";

export default function ChildOnboardingPage() {
  const [, setLocation] = useLocation();

  function handleSkip() {
    sessionStorage.setItem(CHILD_PROFILE_SKIP_KEY, "1");
    setLocation("/home", { replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 px-8 py-20 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-teal-50">
        <Baby className="h-8 w-8 text-teal-500" />
      </div>

      <div className="max-w-xs space-y-2">
        <h1 className="text-xl font-bold text-gray-900">
          Let's set up your child's profile
        </h1>
        <p className="text-sm text-muted-foreground">
          A profile helps us personalise recommendations, track progress, and
          means you never have to repeat your story to every provider.
        </p>
      </div>

      <div className="flex flex-col items-center gap-2">
        <button
          disabled
          className="inline-flex cursor-not-allowed items-center gap-2 rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-medium text-white opacity-50"
        >
          Get started
          <ArrowRight size={14} />
        </button>
        <p className="text-xs text-muted-foreground">
          Full wizard coming very soon — check back shortly.
        </p>
      </div>

      <button
        onClick={handleSkip}
        className="mt-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        Skip for now
      </button>
    </div>
  );
}
