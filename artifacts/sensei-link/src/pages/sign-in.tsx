import { SignIn } from "@clerk/react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function SignInPage() {
  const redirectUrl =
    new URLSearchParams(window.location.search).get("redirect_url") ||
    `${basePath}/dashboard`;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
        fallbackRedirectUrl={redirectUrl}
      />
    </div>
  );
}
