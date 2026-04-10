import { useState } from "react";
import { useSignUp } from "@clerk/react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Phone, ShieldCheck, ArrowLeft } from "lucide-react";

const SIGNUP_AS_KEY = "sproutly_signup_as";
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

type Step = "phone" | "otp";

export default function PhoneSignUpPage() {
  const { isLoaded, signUp, setActive } = useSignUp();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

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

  async function sendOtp() {
    if (!isLoaded || !signUp) return;
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) {
      toast({ title: "Enter a valid 10-digit mobile number", variant: "destructive" });
      return;
    }
    const phoneNumber = `+91${digits.slice(-10)}`;
    setLoading(true);
    try {
      await signUp.create({ phoneNumber });
      await signUp.preparePhoneNumberVerification({ strategy: "phone_code" });
      setStep("otp");
      toast({ title: "OTP sent", description: `We've sent a 6-digit code to ${phoneNumber}` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not send OTP";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp() {
    if (!isLoaded || !signUp) return;
    if (otp.length !== 6) {
      toast({ title: "Enter the 6-digit OTP", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const result = await signUp.attemptPhoneNumberVerification({ code: otp });
      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
        setLocation(isProfessional ? `${basePath}/onboard` : `${basePath}/dashboard`);
      } else {
        toast({ title: "Verification incomplete", description: "Please try again.", variant: "destructive" });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Invalid OTP";
      toast({ title: "Incorrect OTP", description: msg, variant: "destructive" });
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
              : `Enter the 6-digit code sent to +91 ${phone.replace(/\D/g, "").slice(-10)}`}
          </p>
        </div>

        {isProfessional && (
          <div className="mb-5 flex items-center justify-center">
            <span className="inline-flex items-center gap-2 bg-primary/10 text-primary rounded-full px-4 py-1.5 text-sm font-medium border border-primary/20">
              🌱 Joining as a specialist
            </span>
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
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
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
                onClick={() => { setStep("phone"); setOtp(""); }}
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
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="123456"
                  className="mt-1 tracking-[0.4em] text-center text-xl font-bold"
                  onKeyDown={(e) => e.key === "Enter" && verifyOtp()}
                  autoFocus
                  data-testid="input-otp"
                />
              </div>
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
