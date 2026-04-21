import { useState } from "react";
import { useSignIn, useAuth } from "@clerk/react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Eye, EyeOff } from "lucide-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function SignInPage() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const { isSignedIn } = useAuth();
  const [, setLocation] = useLocation();

  const redirectUrl =
    new URLSearchParams(window.location.search).get("redirect_url") ||
    `${basePath}/dashboard`;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState("");

  if (isSignedIn) {
    setLocation(redirectUrl);
    return null;
  }

  async function handleEmailSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }
    if (!password) {
      setError("Please enter your password.");
      return;
    }
    if (!isLoaded) {
      setError("Authentication is still loading. Please wait a moment and try again.");
      return;
    }

    setLoading(true);
    try {
      const result = await signIn.create({
        identifier: email.trim(),
        password,
      });
      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
        setLocation(redirectUrl);
      } else {
        setError("Sign in could not be completed. Please try again.");
      }
    } catch (err: unknown) {
      const clerkError = err as { errors?: { code?: string; message?: string; longMessage?: string }[] };
      const code = clerkError?.errors?.[0]?.code;
      const msg = clerkError?.errors?.[0]?.longMessage || clerkError?.errors?.[0]?.message;
      if (code === "form_password_incorrect") {
        setError("Incorrect password. Please try again.");
      } else if (code === "form_identifier_not_found") {
        setError("No account found with this email. Please sign up first.");
      } else {
        setError(msg || "Sign in failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    if (!isLoaded) {
      setError("Authentication is still loading. Please try again in a moment.");
      return;
    }
    setGoogleLoading(true);
    setError("");
    try {
      await signIn.authenticateWithRedirect({
        strategy: "oauth_google",
        redirectUrl: `${window.location.origin}${basePath}/sso-callback`,
        redirectUrlComplete: `${window.location.origin}${redirectUrl}`,
      });
    } catch (err: unknown) {
      const clerkError = err as { errors?: { message?: string; longMessage?: string }[] };
      const msg = clerkError?.errors?.[0]?.longMessage || clerkError?.errors?.[0]?.message;
      setError(msg || "Could not start Google sign-in. Please try signing in with email and password instead.");
      setGoogleLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-card border border-border rounded-xl shadow-sm p-8">
        <div className="text-center mb-6">
          <h1 className="text-xl font-semibold text-foreground">Sign in to Sproutly</h1>
          <p className="text-sm text-muted-foreground mt-1">Welcome back! Please sign in to continue.</p>
        </div>

        <Button
          type="button"
          variant="outline"
          className="w-full mb-4 gap-2"
          onClick={handleGoogleSignIn}
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

        <form onSubmit={handleEmailSignIn} className="space-y-4">
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
              disabled={loading}
            />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <div className="relative mt-1">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-10"
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

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
            Sign in
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground mt-6">
          Don't have an account?{" "}
          <Link href={`${basePath}/sign-up`} className="text-primary font-medium hover:underline">
            Sign up
          </Link>
        </p>

        <p className="text-center text-xs text-muted-foreground mt-2">
          <a
            href={`${basePath}/sign-in#forgot`}
            className="hover:underline"
            onClick={(e) => {
              e.preventDefault();
              if (!isLoaded || !email.trim()) {
                setError("Enter your email address above, then click 'Forgot password?'.");
                return;
              }
              signIn.create({ strategy: "reset_password_email_code", identifier: email.trim() })
                .then(() => setError("Password reset email sent — check your inbox."))
                .catch(() => setError("Could not send password reset. Please check your email address."));
            }}
          >
            Forgot password?
          </a>
        </p>
      </div>
    </div>
  );
}
