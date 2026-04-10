import { useState } from "react";
import { useSignUp } from "@clerk/react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Phone, ShieldCheck, ArrowLeft, AlertCircle, ExternalLink } from "lucide-react";

const SIGNUP_AS_KEY = "sproutly_signup_as";
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

type Step = "phone" | "otp";

interface ClerkApiError {
  errors?: Array<{ code: string; message: string; longMessage?: string }>;
  message?: string;
}

function extractClerkError(err: unknown): string {
  if (!err) return "Something went wrong";
  const clerkErr = err as ClerkApiError;
  if (clerkErr.errors && clerkErr.errors.length > 0) {
    return clerkErr.errors[0].longMessage ?? clerkErr.errors[0].message;
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}

function isPhoneNotEnabledError(err: unknown): boolean {
  const clerkErr = err as ClerkApiError;
  return clerkErr?.errors?.some(
    (e) => e.code === "form_identifier_not_found" || e.code === "strategy_for_user_invalid" || e.message?.toLowerCase().includes("phone")
  ) ?? false;
}

export default function PhoneSignUpPage() {
  const { isLoaded, signUp, setActive } = useSignUp();
  const [, setLocation] = useLocation();

  const queryAs = new URLSearchParams(window.location.search).get("as");
  if (queryAs === "professional") {
    sessionStorage.setItem(SIGNUP_AS_KEY, "professional");
  }
  const isProfessional =
    queryAs === "professional" ||
    sessionStorage.getItem(SIGNUP_AS_KEY) === "professional";

  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phoneNotConfigured, setPhoneNotConfigured] = useState(false);

  async function sendOtp(phoneOverride?: string) {
    if (!isLoaded || !signUp) return;
    setError(null);
    setPhoneNotConfigured(false);
    const digits = (phoneOverride ?? phone).replace(/\D/g, "");
    if (digits.length < 10) {
      setError("Please enter a valid 10-digit mobile number.");
      return;
    }
    const phoneNumber = `+91${digits.slice(-10)}`;
    setLoading(true);
    try {
      await signUp.create({ phoneNumber });
      await signUp.preparePhoneNumberVerification({ strategy: "phone_code" });
      setStep("otp");
    } catch (err: unknown) {
      console.error("[Sproutly] Sign-up OTP error:", err);
      const msg = extractClerkError(err);
      if (isPhoneNotEnabledError(err) || msg.toLowerCase().includes("phone") || msg.toLowerCase().includes("identifier")) {
        setPhoneNotConfigured(true);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp(otpOverride?: string) {
    if (!isLoaded || !signUp) return;
    setError(null);
    const code = otpOverride ?? otp;
    if (code.length !== 6) {
      setError("Enter the 6-digit OTP sent to your number.");
      return;
    }
    setLoading(true);
    try {
      const result = await signUp.attemptPhoneNumberVerification({ code });
      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
        setLocation(isProfessional ? `${basePath}/onboard` : `${basePath}/dashboard`);
      } else {
        setError("Verification incomplete. Please try again.");
      }
    } catch (err: unknown) {
      console.error("[Sproutly] OTP verification error:", err);
      setError(extractClerkError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-6">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm">
              SL
            </div>
            <span className="font-semibold text-foreground">Sproutly</span>
          </Link>
          <h1 className="text-2xl font-bold text-foreground">
            {step === "phone" ? "Create your account" : "Verify your number"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {step === "phone"
              ? "Enter your Indian mobile number to get started"
              : `Enter the 6-digit code sent to +91 ${phone}`}
          </p>
        </div>

        {isProfessional && (
          <div className="mb-5 flex items-center justify-center">
            <span className="inline-flex items-center gap-2 bg-primary/10 text-primary rounded-full px-4 py-1.5 text-sm font-medium border border-primary/20">
              🌱 Joining as a specialist
            </span>
          </div>
        )}

        {phoneNotConfigured && (
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm">
            <div className="flex items-start gap-2 mb-2">
              <AlertCircle size={16} className="text-amber-600 mt-0.5 shrink-0" />
              <p className="text-amber-800 font-medium">Phone OTP needs to be enabled</p>
            </div>
            <p className="text-amber-700 text-xs mb-3 pl-6">
              To use mobile phone sign-up, enable phone number authentication in your Clerk dashboard:
            </p>
            <ol className="text-xs text-amber-700 pl-6 space-y-1 list-decimal">
              <li>Go to <strong>dashboard.clerk.com</strong></li>
              <li>Open your application</li>
              <li>Go to <strong>User &amp; Authentication → Email, Phone, Username</strong></li>
              <li>Enable <strong>Phone number</strong> as an identifier</li>
              <li>Set verification to <strong>SMS code</strong></li>
              <li>Save and come back here</li>
            </ol>
            <a
              href="https://dashboard.clerk.com"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1 text-xs text-amber-800 font-semibold underline pl-6"
            >
              Open Clerk Dashboard <ExternalLink size={11} />
            </a>
          </div>
        )}

        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
          {step === "phone" ? (
            <>
              <div>
                <Label htmlFor="phone">Mobile number</Label>
                <div className="flex mt-1">
                  <div className="flex items-center px-3 border border-r-0 border-input rounded-l-md bg-muted text-muted-foreground text-sm font-medium select-none">
                    🇮🇳 +91
                  </div>
                  <Input
                    id="phone"
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    value={phone}
                    onChange={(e) => {
                      setError(null);
                      setPhoneNotConfigured(false);
                      const val = e.target.value.replace(/\D/g, "").slice(0, 10);
                      setPhone(val);
                      if (val.length === 10) {
                        sendOtp(val);
                      }
                    }}
                    placeholder="98765 43210"
                    className="rounded-l-none"
                    onKeyDown={(e) => e.key === "Enter" && sendOtp()}
                    autoFocus
                    data-testid="input-phone-signup"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">
                  We'll send a one-time password to verify your number.
                </p>
              </div>

              {error && (
                <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/20 text-destructive rounded-lg px-3 py-2 text-sm">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  {error}
                </div>
              )}

              <Button
                className="w-full gap-2"
                onClick={sendOtp}
                disabled={loading || !isLoaded || phone.length < 10}
                data-testid="btn-send-otp"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Phone size={16} />}
                {loading ? "Sending OTP…" : "Send OTP"}
              </Button>
            </>
          ) : (
            <>
              <button
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-2 -mt-1"
                onClick={() => { setStep("phone"); setOtp(""); setError(null); }}
              >
                <ArrowLeft size={14} /> Change number
              </button>
              <div>
                <Label htmlFor="otp">One-time password</Label>
                <Input
                  id="otp"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => {
                    setError(null);
                    const val = e.target.value.replace(/\D/g, "").slice(0, 6);
                    setOtp(val);
                    if (val.length === 6) {
                      verifyOtp(val);
                    }
                  }}
                  placeholder="123456"
                  className="mt-1 tracking-[0.4em] text-center text-xl font-bold"
                  onKeyDown={(e) => e.key === "Enter" && verifyOtp()}
                  autoFocus
                  data-testid="input-otp"
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/20 text-destructive rounded-lg px-3 py-2 text-sm">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  {error}
                </div>
              )}

              <Button
                className="w-full gap-2"
                onClick={verifyOtp}
                disabled={loading || otp.length !== 6}
                data-testid="btn-verify-otp"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                {loading ? "Verifying…" : "Verify & continue"}
              </Button>
              <button
                className="w-full text-xs text-muted-foreground hover:text-foreground underline mt-1"
                disabled={loading}
                onClick={sendOtp}
              >
                Resend OTP
              </button>
            </>
          )}
        </div>

        <p className="text-center text-sm text-muted-foreground mt-6">
          Already have an account?{" "}
          <Link href="/sign-in" className="text-primary hover:underline font-medium">
            Sign in
          </Link>
        </p>
        <p className="text-center text-xs text-muted-foreground mt-3">
          By continuing you agree to our{" "}
          <Link href="/terms" className="underline">Terms</Link>
          {" "}and{" "}
          <Link href="/privacy" className="underline">Privacy Policy</Link>.
        </p>
      </div>
    </div>
  );
}
