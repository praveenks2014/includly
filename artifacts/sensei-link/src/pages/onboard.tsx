import { useState } from "react";
import { useLocation } from "wouter";
import {
  useGetMyProfessionalProfile,
  getCreateProfessionalProfileMutationOptions,
  getUpdateProfessionalProfileMutationOptions,
  getGetMyProfessionalProfileQueryKey,
  useCreateRazorpayOrder,
  useVerifyRazorpayPayment,
  type CreateProfessionalProfileBodySpecialty,
} from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { SPECIALTY_OPTIONS } from "@/lib/specialties";
import { Loader2, CheckCircle2, IndianRupee, ShieldCheck } from "lucide-react";
import { LocationPicker, type PickedLocation } from "@/components/LocationPicker";
import { loadRazorpayScript, type RazorpayPaymentResponse } from "@/lib/razorpay";
import { FileUploadField } from "@/components/FileUploadField";

const TRAVEL_RADIUS_OPTIONS = [5, 10, 25, 50];
const STEPS = ["Basic info", "Details", "Location", "Contact", "Pricing", "Verify ID", "Activate"];

const ID_DOCUMENT_TYPES = [
  { value: "aadhar", label: "Aadhaar Card (India)" },
  { value: "passport", label: "Passport" },
  { value: "driving_licence", label: "Driving Licence" },
  { value: "national_id", label: "National ID" },
] as const;

export default function OnboardPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: existingProfile, isLoading } = useGetMyProfessionalProfile();

  const [step, setStep] = useState(0);
  const [profileCreatedId, setProfileCreatedId] = useState<number | null>(null);
  const [paymentDone, setPaymentDone] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [verificationSubmitting, setVerificationSubmitting] = useState(false);
  const [verificationDone, setVerificationDone] = useState(false);
  const [idDocType, setIdDocType] = useState<string>("aadhar");
  const [idFileKey, setIdFileKey] = useState<string>("");
  const [certFileKey, setCertFileKey] = useState<string>("");
  const [certDocType, setCertDocType] = useState<string>("degree");
  const [dpdpConsent, setDpdpConsent] = useState(false);
  const [form, setForm] = useState({
    fullName: existingProfile?.fullName ?? "",
    specialty: existingProfile?.specialty ?? "",
    bio: existingProfile?.bio ?? "",
    qualifications: existingProfile?.qualifications ?? "",
    yearsExperience: existingProfile?.yearsExperience?.toString() ?? "0",
    city: existingProfile?.city ?? "",
    country: existingProfile?.country ?? "India",
    latitude: existingProfile?.latitude ?? undefined as number | undefined,
    longitude: existingProfile?.longitude ?? undefined as number | undefined,
    willingToTravel: existingProfile?.willingToTravel ?? false,
    travelRadiusKm: existingProfile?.travelRadiusKm?.toString() ?? "10",
    phone: existingProfile?.phone ?? "",
    email: existingProfile?.email ?? "",
    pricingMinINR: existingProfile?.pricingMinINR?.toString() ?? "",
    pricingMaxINR: existingProfile?.pricingMaxINR?.toString() ?? "",
  });

  const { mutateAsync: createOrderAsync } = useCreateRazorpayOrder();
  const { mutateAsync: verifyPaymentAsync } = useVerifyRazorpayPayment();

  const createMutation = useMutation({
    ...getCreateProfessionalProfileMutationOptions(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: getGetMyProfessionalProfileQueryKey() });
      toast({ title: "Profile created!", description: "Now verify your identity." });
      if (data && typeof data === "object" && "id" in data) {
        setProfileCreatedId((data as { id: number }).id);
      }
      setStep(5); // Verify ID step
    },
    onError: () => {
      toast({ title: "Error", description: "Could not save your profile. Please try again.", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    ...getUpdateProfessionalProfileMutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetMyProfessionalProfileQueryKey() });
      toast({ title: "Profile updated!" });
      if (existingProfile?.paymentActivated) {
        setLocation("/dashboard");
      } else {
        setStep(5); // Verify ID step
      }
    },
    onError: () => {
      toast({ title: "Error", description: "Could not update your profile.", variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-primary" size={28} />
      </div>
    );
  }

  function set(field: string, value: string | boolean | number | undefined) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleLocationChange(loc: PickedLocation) {
    setForm((prev) => ({
      ...prev,
      latitude: loc.lat,
      longitude: loc.lng,
      city: loc.city || prev.city,
      country: loc.country || prev.country,
    }));
  }

  function handleNext() {
    if (step < STEPS.length - 1) setStep(step + 1);
  }

  function handleBack() {
    if (step > 0) setStep(step - 1);
  }

  function handleSubmit() {
    const payload = {
      fullName: form.fullName,
      specialty: form.specialty as CreateProfessionalProfileBodySpecialty,
      bio: form.bio,
      qualifications: form.qualifications,
      yearsExperience: Number(form.yearsExperience),
      city: form.city,
      country: form.country,
      latitude: form.latitude,
      longitude: form.longitude,
      willingToTravel: form.willingToTravel,
      travelRadiusKm: form.willingToTravel ? Number(form.travelRadiusKm) : undefined,
      phone: form.phone,
      email: form.email,
      pricingMinINR: form.pricingMinINR ? Number(form.pricingMinINR) : undefined,
      pricingMaxINR: form.pricingMaxINR ? Number(form.pricingMaxINR) : undefined,
    };

    if (existingProfile) {
      updateMutation.mutate({ data: payload });
    } else {
      createMutation.mutate({ data: payload });
    }
  }

  async function handlePayment() {
    const loaded = await loadRazorpayScript();
    if (!loaded) {
      toast({ title: "Could not load payment module", description: "Please try again.", variant: "destructive" });
      return;
    }

    setPaymentLoading(true);
    try {
      const order = await createOrderAsync({
        data: { plan: "plan_d_pro_onetime" },
      });

      const rzp = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: "Sproutly",
        description: order.planName,
        order_id: order.orderId,
        handler: async (response: RazorpayPaymentResponse) => {
          try {
            await verifyPaymentAsync({
              data: {
                razorpayPaymentId: response.razorpay_payment_id,
                razorpayOrderId: response.razorpay_order_id,
                razorpaySignature: response.razorpay_signature,
                paymentId: order.paymentId,
              },
            });
            toast({ title: "Payment successful!", description: "Your profile is now live." });
            setPaymentDone(true);
            queryClient.invalidateQueries({ queryKey: getGetMyProfessionalProfileQueryKey() });
            setTimeout(() => setLocation("/dashboard"), 1500);
          } catch {
            toast({ title: "Verification failed", description: "Please contact support.", variant: "destructive" });
          }
        },
        theme: { color: "#4f46e5" },
        modal: {
          ondismiss: () => {
            setPaymentLoading(false);
            toast({ title: "Payment cancelled", description: "You can activate your profile anytime." });
          },
        },
      });

      rzp.open();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      toast({ title: "Could not initiate payment", description: msg, variant: "destructive" });
    } finally {
      setPaymentLoading(false);
    }
  }

  async function handleSubmitVerification() {
    if (!idFileKey) {
      toast({ title: "Please upload your ID document first", variant: "destructive" });
      return;
    }
    if (!dpdpConsent) {
      toast({ title: "Please accept the consent to proceed", variant: "destructive" });
      return;
    }
    setVerificationSubmitting(true);
    try {
      const idRes = await fetch("/api/verifications/identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentType: idDocType, fileKey: idFileKey, dpdpConsent }),
      });
      if (!idRes.ok) throw new Error("Failed to submit identity verification");

      if (certFileKey) {
        const certRes = await fetch("/api/verifications/certifications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documentType: certDocType, fileKey: certFileKey }),
        });
        if (!certRes.ok) {
          const body = await certRes.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? "Failed to submit certification document");
        }
      }
      setVerificationDone(true);
      toast({ title: "Documents submitted", description: "Your profile will show Verified once reviewed (2-3 business days)." });
    } catch {
      toast({ title: "Error", description: "Could not submit documents. Please try again.", variant: "destructive" });
    } finally {
      setVerificationSubmitting(false);
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;
  const isVerifyStep = step === 5;
  const isActivationStep = step === 6;
  const alreadyActivated = existingProfile?.paymentActivated ?? false;

  const stepsToShow = existingProfile && alreadyActivated ? STEPS.slice(0, 5) : STEPS;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-xl mx-auto px-4 sm:px-6 py-10">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-serif font-semibold text-foreground mb-1">
            {existingProfile ? "Edit your profile" : "Set up your profile"}
          </h1>
          <p className="text-muted-foreground text-sm">Step {step + 1} of {stepsToShow.length}: {stepsToShow[step]}</p>
        </div>

        {/* Step progress */}
        <div className="flex gap-2 mb-8">
          {stepsToShow.map((s, i) => (
            <div
              key={s}
              className={`flex-1 h-1.5 rounded-full transition-colors ${i <= step ? "bg-primary" : "bg-muted"}`}
            />
          ))}
        </div>

        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          {/* Step 0: Basic info */}
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="fullName">Full name</Label>
                <Input
                  id="fullName"
                  value={form.fullName}
                  onChange={(e) => set("fullName", e.target.value)}
                  placeholder="Dr. Priya Sharma"
                  className="mt-1"
                  data-testid="input-fullName"
                />
              </div>
              <div>
                <Label htmlFor="specialty">Specialty</Label>
                <Select value={form.specialty} onValueChange={(v) => set("specialty", v)}>
                  <SelectTrigger className="mt-1" data-testid="select-specialty">
                    <SelectValue placeholder="Select your specialty" />
                  </SelectTrigger>
                  <SelectContent>
                    {SPECIALTY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="yearsExperience">Years of experience</Label>
                <Input
                  id="yearsExperience"
                  type="number"
                  min={0}
                  max={60}
                  value={form.yearsExperience}
                  onChange={(e) => set("yearsExperience", e.target.value)}
                  className="mt-1"
                  data-testid="input-yearsExperience"
                />
              </div>
            </div>
          )}

          {/* Step 1: Details */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="bio">Bio</Label>
                <Textarea
                  id="bio"
                  value={form.bio}
                  onChange={(e) => set("bio", e.target.value)}
                  placeholder="Tell parents about your approach, methods, and experience..."
                  className="mt-1 min-h-[120px]"
                  data-testid="input-bio"
                />
              </div>
              <div>
                <Label htmlFor="qualifications">Qualifications</Label>
                <Textarea
                  id="qualifications"
                  value={form.qualifications}
                  onChange={(e) => set("qualifications", e.target.value)}
                  placeholder="B.Ed Special Education, ASHA Certified, etc."
                  className="mt-1 min-h-[80px]"
                  data-testid="input-qualifications"
                />
              </div>
              <div className="flex items-center justify-between py-2">
                <div>
                  <Label>Willing to travel</Label>
                  <p className="text-xs text-muted-foreground">Do you offer home visits or travel to clients?</p>
                </div>
                <Switch
                  checked={form.willingToTravel}
                  onCheckedChange={(v) => set("willingToTravel", v)}
                  data-testid="switch-travel"
                />
              </div>
              {form.willingToTravel && (
                <div>
                  <Label htmlFor="travelRadius">Travel radius</Label>
                  <Select value={form.travelRadiusKm} onValueChange={(v) => set("travelRadiusKm", v)}>
                    <SelectTrigger className="mt-1" data-testid="select-travel-radius">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TRAVEL_RADIUS_OPTIONS.map((r) => (
                        <SelectItem key={r} value={r.toString()}>{r} km</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Location */}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Pin your location so parents can find you on the map and in nearby searches.
              </p>
              <LocationPicker
                lat={form.latitude}
                lng={form.longitude}
                city={form.city}
                country={form.country}
                onLocationChange={handleLocationChange}
              />
              <div className="grid grid-cols-2 gap-4 mt-2">
                <div>
                  <Label htmlFor="city">City</Label>
                  <Input
                    id="city"
                    value={form.city}
                    onChange={(e) => set("city", e.target.value)}
                    placeholder="Mumbai"
                    className="mt-1"
                    data-testid="input-city"
                  />
                </div>
                <div>
                  <Label htmlFor="country">Country</Label>
                  <Input
                    id="country"
                    value={form.country}
                    onChange={(e) => set("country", e.target.value)}
                    placeholder="India"
                    className="mt-1"
                    data-testid="input-country"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Contact */}
          {step === 3 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-3 border border-border">
                Your contact details will only be visible to parents who unlock your profile.
              </p>
              <div>
                <Label htmlFor="phone">Phone number</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  placeholder="+91 98765 43210"
                  className="mt-1"
                  data-testid="input-phone"
                />
              </div>
              <div>
                <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="you@example.com"
                  className="mt-1"
                  data-testid="input-email"
                />
              </div>
            </div>
          )}

          {/* Step 4: Pricing */}
          {step === 4 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-3 border border-border">
                Let parents know your expected session rate. This helps them filter by budget.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="pricingMinINR">Min. price (₹)</Label>
                  <div className="relative mt-1">
                    <IndianRupee size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="pricingMinINR"
                      type="number"
                      min={0}
                      value={form.pricingMinINR}
                      onChange={(e) => set("pricingMinINR", e.target.value)}
                      placeholder="500"
                      className="pl-8"
                      data-testid="input-pricingMinINR"
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="pricingMaxINR">Max. price (₹)</Label>
                  <div className="relative mt-1">
                    <IndianRupee size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="pricingMaxINR"
                      type="number"
                      min={0}
                      value={form.pricingMaxINR}
                      onChange={(e) => set("pricingMaxINR", e.target.value)}
                      placeholder="2000"
                      className="pl-8"
                      data-testid="input-pricingMaxINR"
                    />
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Leave blank if you prefer to discuss pricing directly with parents.
              </p>
              {form.pricingMinINR && form.pricingMaxINR && (
                <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-800 font-medium">
                  Your profile will show: ₹{Number(form.pricingMinINR).toLocaleString("en-IN")} – ₹{Number(form.pricingMaxINR).toLocaleString("en-IN")} / session
                </div>
              )}
            </div>
          )}

          {/* Step 5: Verify Identity */}
          {step === 5 && (
            <div className="space-y-5">
              {verificationDone ? (
                <div className="text-center py-6">
                  <ShieldCheck size={48} className="text-primary mx-auto mb-3" />
                  <h3 className="text-lg font-semibold text-foreground mb-1">Documents Submitted</h3>
                  <p className="text-sm text-muted-foreground">
                    Your verification is under review. We'll update your status within 2–3 business days.
                  </p>
                </div>
              ) : (
                <>
                  <div className="text-center">
                    <ShieldCheck size={36} className="text-primary mx-auto mb-2" />
                    <h3 className="text-lg font-semibold text-foreground mb-1">Verify Your Identity</h3>
                    <p className="text-sm text-muted-foreground">
                      Upload your ID and qualifications to earn a Verified badge. Parents trust verified professionals more.
                    </p>
                  </div>

                  <div className="bg-card border border-border rounded-xl p-5 space-y-4">
                    <h4 className="font-medium text-sm">Identity Document <span className="text-destructive">*</span></h4>
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">Document type</Label>
                      <Select value={idDocType} onValueChange={setIdDocType}>
                        <SelectTrigger data-testid="id-doc-type-select">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ID_DOCUMENT_TYPES.map((t) => (
                            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <FileUploadField
                      label="Upload ID document"
                      onUploaded={setIdFileKey}
                      uploadedPath={idFileKey}
                    />
                  </div>

                  <div className="bg-card border border-border rounded-xl p-5 space-y-4">
                    <h4 className="font-medium text-sm">Qualification Certificate <span className="text-muted-foreground text-xs">(optional)</span></h4>
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">Certificate type</Label>
                      <Input
                        value={certDocType}
                        onChange={(e) => setCertDocType(e.target.value)}
                        placeholder="e.g. B.Ed, OT Diploma, Speech Therapy Degree"
                        data-testid="cert-doc-type-input"
                      />
                    </div>
                    <FileUploadField
                      label="Upload certificate"
                      onUploaded={setCertFileKey}
                      uploadedPath={certFileKey}
                    />
                  </div>

                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
                    <p className="text-xs font-semibold text-amber-900">Data Processing Consent — DPDP / GDPR</p>
                    <p className="text-xs text-amber-800 leading-relaxed">
                      Your identity and qualification documents are collected solely for professional verification purposes on Sproutly.
                      Documents are stored securely and will not be shared with third parties.
                      Under India's DPDP Act 2023 and GDPR, you have the right to request deletion of your documents at any time
                      by using the "Delete My Account" option in Account Settings.
                    </p>
                    <div className="flex items-start gap-2">
                      <Checkbox
                        id="dpdp-consent"
                        checked={dpdpConsent}
                        onCheckedChange={(v) => setDpdpConsent(v === true)}
                        data-testid="dpdp-consent-checkbox"
                      />
                      <label htmlFor="dpdp-consent" className="text-xs text-amber-900 leading-relaxed cursor-pointer">
                        I consent to Sproutly processing my documents for identity verification as described above.
                      </label>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <Button
                      className="flex-1 gap-2"
                      onClick={handleSubmitVerification}
                      disabled={verificationSubmitting || !idFileKey || !dpdpConsent}
                      data-testid="submit-verification-btn"
                    >
                      {verificationSubmitting ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                      {verificationSubmitting ? "Submitting…" : "Submit for Verification"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setStep(6)}
                      data-testid="skip-verification-btn"
                    >
                      Skip for now
                    </Button>
                  </div>

                  <p className="text-xs text-center text-muted-foreground">
                    Verification typically takes 2–3 business days. Your profile will show "Verification Pending" until reviewed.
                  </p>
                </>
              )}
            </div>
          )}

          {/* Step 6: Activate Profile */}
          {step === 6 && (
            <div className="space-y-4">
              {alreadyActivated || paymentDone ? (
                <div className="text-center py-4">
                  <CheckCircle2 size={48} className="text-green-500 mx-auto mb-3" />
                  <h3 className="text-lg font-semibold text-foreground mb-1">Profile is Live!</h3>
                  <p className="text-muted-foreground text-sm">Your profile is active and visible to parents.</p>
                </div>
              ) : (
                <>
                  <div className="text-center py-2">
                    <h3 className="text-lg font-semibold text-foreground mb-2">Activate Your Profile</h3>
                    <p className="text-muted-foreground text-sm mb-4">
                      A one-time listing fee of ₹999 is required to make your profile live and visible to parents searching for specialists.
                    </p>
                  </div>
                  <div className="bg-muted/40 border border-border rounded-xl p-5 space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium text-foreground">Professional Listing Fee</span>
                      <span className="text-lg font-bold text-foreground">₹999</span>
                    </div>
                    <ul className="space-y-1.5 text-sm text-muted-foreground">
                      <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-green-500" /> One-time payment</li>
                      <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-green-500" /> Profile goes live immediately</li>
                      <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-green-500" /> Visible to parents searching in your city</li>
                      <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-green-500" /> No recurring charges</li>
                    </ul>
                  </div>
                  <Button
                    className="w-full gap-2"
                    onClick={handlePayment}
                    disabled={paymentLoading}
                    data-testid="pay-listing-fee-btn"
                  >
                    {paymentLoading ? <Loader2 size={15} className="animate-spin" /> : <IndianRupee size={15} />}
                    {paymentLoading ? "Processing…" : "Pay ₹999 & Activate Profile"}
                  </Button>
                  <p className="text-xs text-center text-muted-foreground">
                    Secured by Razorpay. UPI, cards & netbanking accepted.
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-muted-foreground"
                    onClick={() => setLocation("/dashboard")}
                  >
                    Skip for now (profile won't be visible)
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Navigation */}
        {!isActivationStep && !isVerifyStep && (
          <div className="flex justify-between mt-6">
            <Button variant="outline" onClick={handleBack} disabled={step === 0}>
              Back
            </Button>
            {step < 4 ? (
              <Button
                onClick={handleNext}
                disabled={step === 0 && (!form.specialty || !form.fullName)}
                data-testid="next-step-btn"
              >
                Continue
              </Button>
            ) : (
              <Button
                onClick={handleSubmit}
                disabled={isPending}
                className="gap-2"
                data-testid="submit-profile-btn"
              >
                {isPending ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <CheckCircle2 size={15} />
                )}
                {existingProfile ? "Save changes" : "Create profile"}
              </Button>
            )}
          </div>
        )}

        {isVerifyStep && verificationDone && (
          <div className="mt-6">
            <Button className="w-full" onClick={() => setStep(6)}>
              Continue to Activate
            </Button>
          </div>
        )}

        {isActivationStep && (alreadyActivated || paymentDone) && (
          <div className="mt-6">
            <Button className="w-full" onClick={() => setLocation("/dashboard")}>
              Go to Dashboard
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
