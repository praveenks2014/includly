import { useState } from "react";
import { useSignIn } from "@clerk/react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Phone, ShieldCheck, ArrowLeft } from "lucide-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
type Step = "phone" | "otp";

export default function PhoneSignInPage() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const redirectUrl =
    new URLSearchParams(window.location.search).get("redirect_url") ||
    `${basePath}/dashboard`;

  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [phoneNumberId, setPhoneNumberId] = useState<string | null>(null);

  async function sendOtp() {
    if (!isLoaded || !signIn) return;
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) {
      toast({ title: "Enter a valid 10-digit mobile number", variant: "destructive" });
      return;
    }
    const phoneNumber = `+91${digits.slice(-10)}`;
    setLoading(true);
    try {
      const result = await signIn.create({ identifier: phoneNumber });
      const factor = result.supportedFirstFactors?.find(
        (f) => f.strategy === "phone_code"
      ) as { strategy: string; phoneNumberId: string } | undefined;

      if (!factor) {
        toast({
          title: "Phone sign-in not available",
          description: "Please use email or contact support.",
          variant: "destructive",
        });
        return;
      }
      setPhoneNumberId(factor.phoneNumberId);
      await signIn.prepareFirstFactor({
        strategy: "phone_code",
        phoneNumberId: factor.phoneNumberId,
      });
      setStep("otp");
      toast({ title: "OTP sent", description: `Code sent to +91 ${digits.slice(-10)}` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not send OTP";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp() {
    if (!isLoaded || !signIn) return;
    if (otp.length !== 6) {
      toast({ title: "Enter the 6-digit OTP", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const result = await signIn.attemptFirstFactor({
        strategy: "phone_code",
        code: otp,
      });
      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
        setLocation(redirectUrl);
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

  async function resendOtp() {
    if (!signIn || !phoneNumberId) return;
    setLoading(true);
    try {
      await signIn.prepareFirstFactor({
        strategy: "phone_code",
        phoneNumberId,
      });
      toast({ title: "OTP resent" });
    } catch {
      toast({ title: "Could not resend OTP", variant: "destructive" });
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
            {step === "phone" ? "Welcome back" : "Verify your number"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {step === "phone"
              ? "Sign in with your registered mobile number"
              : `Enter the 6-digit code sent to +91 ${phone.replace(/\D/g, "").slice(-10)}`}
          </p>
        </div>

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
                    data-testid="input-phone-signin"
                  />
                </div>
              </div>
              <Button
                className="w-full gap-2"
                onClick={sendOtp}
                disabled={loading || !isLoaded || phone.length < 10}
                data-testid="btn-send-otp-signin"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Phone size={16} />}
                {loading ? "Sending OTP…" : "Send OTP"}
              </Button>
            </>
          ) : (
            <>
              <button
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-2 -mt-1"
                onClick={() => { setStep("phone"); setOtp(""); setPhoneNumberId(null); }}
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
                  data-testid="input-otp-signin"
                />
              </div>
              <Button
                className="w-full gap-2"
                onClick={verifyOtp}
                disabled={loading || otp.length !== 6}
                data-testid="btn-verify-otp-signin"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                {loading ? "Signing in…" : "Sign in"}
              </Button>
              <button
                className="w-full text-xs text-muted-foreground hover:text-foreground underline mt-1"
                disabled={loading}
                onClick={resendOtp}
              >
                Resend OTP
              </button>
            </>
          )}
        </div>

        <p className="text-center text-sm text-muted-foreground mt-6">
          New to Sproutly?{" "}
          <Link href="/sign-up" className="text-primary hover:underline font-medium">
            Create account
          </Link>
        </p>
      </div>
    </div>
  );
}
