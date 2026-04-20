import { useState } from "react";
import { useSignUp } from "@clerk/react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Eye, EyeOff, Mail } from "lucide-react";

const SIGNUP_AS_KEY = "sproutly_signup_as";
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function SignUpPage() {
  const { isLoaded, signUp, setActive } = useSignUp();
  const [, setLocation] = useLocation();

  const queryAs = new URLSearchParams(window.location.search).get("as");
  if (queryAs === "professional") {
    localStorage.setItem(SIGNUP_AS_KEY, "professional");
    sessionStorage.setItem(SIGNUP_AS_KEY, "professional");
  }
  const isProfessional =
    queryAs === "professional" ||
    localStorage.getItem(SIGNUP_AS_KEY) === "professional" ||
    sessionStorage.getItem(SIGNUP_AS_KEY) === "professional";

  const redirectUrl = isProfessional ? `${basePath}/onboard` : `${basePath}/dashboard`;

  const [step, setStep] = useState<"form" | "verify">("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState("");
  const [alreadyExists, setAlreadyExists] = useState(false);

  async function handleGoogleSignUp() {
    if (!isLoaded) return;
    setGoogleLoading(true);
    setError("");
    try {
      await signUp.authenticateWithRedirect({
        strategy: "oauth_google",
        redirectUrl: `${window.location.origin}${basePath}/sso-callback`,
        redirectUrlComplete: redirectUrl,
      });
    } catch {
      setError("Could not start Google sign-up. Please try again.");
      setGoogleLoading(false);
    }
  }

  async function handleEmailSignUp(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded) return;
    setLoading(true);
    setError("");
    setAlreadyExists(false);
    try {
      await signUp.create({
        emailAddress: email,
        password,
      });
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      setStep("verify");
    } catch (err: unknown) {
      const clerkError = err as { errors?: { code?: string; message?: string; longMessage?: string }[] };
      const code = clerkError?.errors?.[0]?.code;
      const msg = clerkError?.errors?.[0]?.longMessage || clerkError?.errors?.[0]?.message;
      if (
        code === "form_identifier_exists" ||
        code === "form_identifier_taken" ||
        msg?.toLowerCase().includes("already")
      ) {
        setAlreadyExists(true);
        setError("");
      } else if (code === "form_password_pwned") {
        setError("This password is too common. Please choose a stronger password.");
      } else if (code === "form_password_length_too_short") {
        setError("Password must be at least 8 characters long.");
      } else {
        setError(msg || "Could not create account. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded) return;
    setLoading(true);
    setError("");
    try {
      const result = await signUp.attemptEmailAddressVerification({ code });
      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
        sessionStorage.removeItem(SIGNUP_AS_KEY);
        localStorage.removeItem(SIGNUP_AS_KEY);
        setLocation(redirectUrl);
      } else {
        setError("Verification could not be completed. Please try again.");
      }
    } catch (err: unknown) {
      const clerkError = err as { errors?: { code?: string; message?: string; longMessage?: string }[] };
      const code = clerkError?.errors?.[0]?.code;
      const msg = clerkError?.errors?.[0]?.longMessage || clerkError?.errors?.[0]?.message;
      if (code === "form_code_incorrect") {
        setError("Incorrect code. Please check your email and try again.");
      } else if (code === "verification_expired") {
        setError("Code expired. Click below to resend a new one.");
      } else {
        setError(msg || "Verification failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (!isLoaded) return;
    setError("");
    try {
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      setError("A new code has been sent to your email.");
    } catch {
      setError("Could not resend code. Please try again.");
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      {isProfessional && (
        <div className="mb-5">
          <span className="inline-flex items-center gap-2 bg-primary/10 text-primary rounded-full px-4 py-1.5 text-sm font-medium border border-primary/20">
            🌱 Joining as a specialist — we'll set up your profile after sign-up
          </span>
        </div>
      )}

      <div className="w-full max-w-sm bg-card border border-border rounded-xl shadow-sm p-8">
        {step === "form" ? (
          <>
            <div className="text-center mb-6">
              <h1 className="text-xl font-semibold text-foreground">Create your account</h1>
              <p className="text-sm text-muted-foreground mt-1">Welcome! Please fill in the details to get started.</p>
            </div>

            <Button
              type="button"
              variant="outline"
              className="w-full mb-4 gap-2"
              onClick={handleGoogleSignUp}
              disabled={googleLoading || loading}
            >
              {googleLoading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
              )}
              Continue with Google
            </Button>

            <div className="relative mb-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-card px-2 text-muted-foreground">or</span>
              </div>
            </div>

            {alreadyExists ? (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-center space-y-3">
                <p className="text-sm font-medium text-amber-800">
                  An account already exists with <span className="font-semibold">{email}</span>
                </p>
                <p className="text-xs text-amber-700">
                  It looks like you've already signed up. Please sign in to continue.
                </p>
                <Button
                  className="w-full"
                  onClick={() => setLocation(`${basePath}/sign-in`)}
                >
                  Sign in instead
                </Button>
                <button
                  type="button"
                  className="text-xs text-amber-600 hover:underline"
                  onClick={() => { setAlreadyExists(false); setEmail(""); setPassword(""); }}
                >
                  Use a different email
                </button>
              </div>
            ) : (
              <form onSubmit={handleEmailSignUp} className="space-y-4">
                <div>
                  <Label htmlFor="email">Email address</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-1"
                    required
                    disabled={loading}
                  />
                </div>
                <div>
                  <Label htmlFor="password">Password</Label>
                  <div className="relative mt-1">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Create a password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pr-10"
                      required
                      disabled={loading}
                    />
                    <button
                      type="button"
                      className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowPassword((v) => !v)}
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                {error && (
                  <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
                    {error}
                  </p>
                )}

                <Button type="submit" className="w-full" disabled={loading || !email || !password}>
                  {loading ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
                  Continue
                </Button>
              </form>
            )}

            <p className="text-center text-sm text-muted-foreground mt-6">
              Already have an account?{" "}
              <Link href={`${basePath}/sign-in`} className="text-primary font-medium hover:underline">
                Sign in
              </Link>
            </p>
          </>
        ) : (
          <>
            <div className="text-center mb-6">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Mail className="text-primary" size={24} />
              </div>
              <h1 className="text-xl font-semibold text-foreground">Check your email</h1>
              <p className="text-sm text-muted-foreground mt-1">
                We sent a 6-digit verification code to{" "}
                <span className="font-medium text-foreground">{email}</span>
              </p>
            </div>

            <form onSubmit={handleVerify} className="space-y-4">
              <div>
                <Label htmlFor="code">Verification code</Label>
                <Input
                  id="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="Enter 6-digit code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="mt-1 text-center text-lg tracking-widest"
                  maxLength={6}
                  required
                  autoFocus
                  disabled={loading}
                />
              </div>

              {error && (
                <p className={`text-sm rounded-md px-3 py-2 border ${
                  error.includes("sent")
                    ? "text-green-700 bg-green-50 border-green-200"
                    : "text-destructive bg-destructive/10 border-destructive/20"
                }`}>
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={loading || code.length < 6}>
                {loading ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
                Verify email
              </Button>
            </form>

            <div className="mt-4 text-center space-y-2">
              <p className="text-xs text-muted-foreground">
                Didn't receive it?{" "}
                <button
                  type="button"
                  onClick={handleResend}
                  className="text-primary hover:underline"
                  disabled={loading}
                >
                  Resend code
                </button>
              </p>
              <button
                type="button"
                onClick={() => { setStep("form"); setCode(""); setError(""); }}
                className="text-xs text-muted-foreground hover:underline"
              >
                ← Back to sign up
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
