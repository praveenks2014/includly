import { SignUp } from "@clerk/react";
import { Link } from "wouter";

const SIGNUP_AS_KEY = "sproutly_signup_as";
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function SignUpPage() {
  const queryAs = new URLSearchParams(window.location.search).get("as");
  if (queryAs === "professional") {
    // Use localStorage so intent survives Google/Apple OAuth redirects
    // (sessionStorage is wiped when the browser leaves the page)
    localStorage.setItem(SIGNUP_AS_KEY, "professional");
    sessionStorage.setItem(SIGNUP_AS_KEY, "professional");
  }
  const isProfessional =
    queryAs === "professional" ||
    localStorage.getItem(SIGNUP_AS_KEY) === "professional" ||
    sessionStorage.getItem(SIGNUP_AS_KEY) === "professional";

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      {isProfessional && (
        <div className="mb-5">
          <span className="inline-flex items-center gap-2 bg-primary/10 text-primary rounded-full px-4 py-1.5 text-sm font-medium border border-primary/20">
            🌱 Joining as a specialist — we'll set up your profile after sign-up
          </span>
        </div>
      )}
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
        fallbackRedirectUrl={isProfessional ? `${basePath}/onboard` : `${basePath}/dashboard`}
        forceRedirectUrl={isProfessional ? `${basePath}/onboard` : undefined}
      />
    </div>
  );
}
