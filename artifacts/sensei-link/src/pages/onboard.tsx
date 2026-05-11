import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { fetchWithAuth } from "@/lib/api";
import {
  useGetMyProfessionalProfile,
  useGetMe,
  useSetMyRole,
  getCreateProfessionalProfileMutationOptions,
  getUpdateProfessionalProfileMutationOptions,
  getGetMyProfessionalProfileQueryKey,
  getGetMeQueryKey,
  type CreateProfessionalProfileBodySpecialty,
} from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { SPECIALTY_OPTIONS, SPECIALTY_ICONS, SPECIALTY_ICON_COLORS } from "@/lib/specialties";
import { Loader2, CheckCircle2, IndianRupee } from "lucide-react";
import { LocationPicker, type PickedLocation } from "@/components/LocationPicker";

const TRAVEL_RADIUS_OPTIONS = [5, 10, 25, 50];
const STEPS = ["Basic info", "Details", "Location", "Contact", "Pricing"];

const TAG_OPTIONS = [
  "ADHD",
  "Autism",
  "Dyslexia",
  "Cerebral Palsy",
  "Down Syndrome",
  "Speech Delay",
  "Learning Disabilities",
];

export default function OnboardPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: existingProfile, isLoading } = useGetMyProfessionalProfile();

  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
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
    displayArea: existingProfile?.displayArea ?? "",
    clinicAddress: existingProfile?.clinicAddress ?? "",
    willingToTravel: existingProfile?.willingToTravel ?? false,
    travelRadiusKm: existingProfile?.travelRadiusKm?.toString() ?? "10",
    phone: existingProfile?.phone ?? "",
    email: existingProfile?.email ?? "",
    pricingMinINR: existingProfile?.pricingMinINR?.toString() ?? "",
    pricingMaxINR: existingProfile?.pricingMaxINR?.toString() ?? "",
    upiId: existingProfile?.upiId ?? "",
    centreRegistrationNo: "",
    numTherapists: "",
    specializationTags: (existingProfile?.specializationTags ?? []) as string[],
  });

  const { data: me, isError: meError } = useGetMe();
  const { mutateAsync: setMyRoleAsync } = useSetMyRole();
  const [roleReady, setRoleReady] = useState(false);
  const roleSetTriggered = useRef(false);

  useEffect(() => {
    sessionStorage.removeItem("includly_signup_as");
    localStorage.removeItem("includly_signup_as");
  }, []);

  useEffect(() => {
    // If /users/me itself errors (e.g. transient 500), still unblock the form.
    // POST /professionals/me sets the role server-side, so we don't need to
    // block on the role-set call succeeding here.
    if (meError && !roleSetTriggered.current) {
      setRoleReady(true);
      return;
    }
    if (!me) return;
    if (roleSetTriggered.current) return;
    if (me.role === "professional" || me.role === "admin") {
      setRoleReady(true);
      return;
    }
    // User has role "parent" — only proceed if they explicitly chose
    // "I'm a professional" on the choose-role page. Otherwise send them back
    // to choose-role so they can make the choice themselves.
    const choseProf = sessionStorage.getItem("chose_professional");
    sessionStorage.removeItem("chose_professional");
    if (!choseProf) {
      setLocation("/choose-role");
      return;
    }
    roleSetTriggered.current = true;
    setMyRoleAsync({ data: { role: "professional" } })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      })
      .catch(() => {
        // Non-fatal: POST /professionals/me also sets the role server-side.
        // Allow the user to proceed so they can fill in their profile.
        roleSetTriggered.current = false;
      })
      .finally(() => {
        setRoleReady(true);
      });
  }, [me]);

  const createMutation = useMutation(getCreateProfessionalProfileMutationOptions());
  const updateMutation = useMutation(getUpdateProfessionalProfileMutationOptions());

  if (isLoading || !roleReady) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3">
        <Loader2 className="animate-spin text-primary" size={28} />
        {!roleReady && me && me.role === "parent" && (
          <p className="text-sm text-muted-foreground">Setting up your specialist account…</p>
        )}
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

  async function handleSubmit() {
    const qualificationsValue = isTherapyCentre
      ? [
          form.qualifications,
          form.numTherapists ? `Staff: ${form.numTherapists} therapists` : "",
          form.centreRegistrationNo ? `Reg. No: ${form.centreRegistrationNo}` : "",
        ].filter(Boolean).join(" | ")
      : form.qualifications;

    const payload = {
      fullName: form.fullName,
      specialty: form.specialty as CreateProfessionalProfileBodySpecialty,
      bio: form.bio,
      qualifications: qualificationsValue,
      yearsExperience: Number(form.yearsExperience),
      city: form.city,
      country: form.country,
      displayArea: form.displayArea.trim() || undefined,
      clinicAddress: form.clinicAddress.trim() || undefined,
      latitude: form.latitude,
      longitude: form.longitude,
      willingToTravel: form.willingToTravel,
      travelRadiusKm: form.willingToTravel ? Number(form.travelRadiusKm) : undefined,
      phone: form.phone,
      email: form.email,
      pricingMinINR: form.pricingMinINR ? Number(form.pricingMinINR) : undefined,
      pricingMaxINR: form.pricingMaxINR ? Number(form.pricingMaxINR) : undefined,
      upiId: form.upiId.trim() || undefined,
      specializationTags: form.specializationTags.length > 0 ? form.specializationTags : undefined,
    };

    setIsSubmitting(true);
    try {
      if (existingProfile) {
        await updateMutation.mutateAsync({ data: payload });
      } else {
        await createMutation.mutateAsync({ data: payload });
      }
      queryClient.invalidateQueries({ queryKey: getGetMyProfessionalProfileQueryKey() });

      if (!existingProfile?.paymentActivated) {
        const activateRes = await fetchWithAuth("/api/professionals/me/free-activate", { method: "POST" });
        if (!activateRes.ok) {
          const body = await activateRes.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? "Activation failed");
        }
        queryClient.invalidateQueries({ queryKey: getGetMyProfessionalProfileQueryKey() });
        toast({
          title: "Profile created & activated!",
          description: "Next: upload your verification document from your dashboard to appear in search results.",
        });
      } else {
        toast({ title: "Profile updated!" });
      }
      setTimeout(() => setLocation("/dashboard"), 1200);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  }

  const isTherapyCentre = form.specialty === "therapy_centre";
  const isGeoFencedSpecialty = ["shadow_teacher", "special_tutor"].includes(form.specialty);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-xl mx-auto px-4 sm:px-6 py-10">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-serif font-semibold text-foreground mb-1">
            {existingProfile ? "Edit your profile" : "Set up your profile"}
          </h1>
          <p className="text-muted-foreground text-sm">Step {step + 1} of {STEPS.length}: {STEPS[step]}</p>
        </div>

        {/* Step progress */}
        <div className="flex gap-2 mb-8">
          {STEPS.map((s, i) => (
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
                <Label className="mb-2 block">Primary specialty</Label>
                <div className="grid grid-cols-2 gap-2" data-testid="select-specialty">
                  {SPECIALTY_OPTIONS.map((opt) => {
                    const Icon = SPECIALTY_ICONS[opt.value] ?? CheckCircle2;
                    const selected = form.specialty === opt.value;
                    const colorClass = SPECIALTY_ICON_COLORS[opt.value] ?? "text-primary bg-primary/10";
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          set("specialty", opt.value);
                          setForm((prev) => ({
                            ...prev,
                            specialty: opt.value,
                            specializationTags: prev.specializationTags.filter(
                              (t) => !t.startsWith("specialty:") || t === `specialty:${opt.value}`
                            ).filter((t) => t !== `specialty:${opt.value}`),
                          }));
                        }}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium text-left transition-all ${
                          selected
                            ? "border-primary bg-primary/10 text-primary shadow-sm"
                            : "border-border bg-background text-foreground hover:border-primary/50"
                        }`}
                        data-testid={`specialty-card-${opt.value}`}
                      >
                        <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${colorClass}`}>
                          <Icon size={15} />
                        </span>
                        <span className="leading-tight">{opt.label}</span>
                        {selected && <CheckCircle2 size={14} className="ml-auto text-primary shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {form.specialty && form.specialty !== "therapy_centre" && (
                <div>
                  <Label className="mb-2 block text-sm">
                    Also practise as <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {SPECIALTY_OPTIONS
                      .filter((opt) => opt.value !== form.specialty && opt.value !== "therapy_centre")
                      .map((opt) => {
                        const tagKey = `specialty:${opt.value}`;
                        const selected = form.specializationTags.includes(tagKey);
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => {
                              setForm((prev) => ({
                                ...prev,
                                specializationTags: selected
                                  ? prev.specializationTags.filter((t) => t !== tagKey)
                                  : [...prev.specializationTags, tagKey],
                              }));
                            }}
                            className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                              selected
                                ? "bg-primary/10 border-primary text-primary font-medium"
                                : "bg-background border-border text-muted-foreground hover:border-primary/50"
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                  </div>
                </div>
              )}
              <div>
                <Label htmlFor="fullName">
                  {isTherapyCentre ? "Centre name" : "Full name"}
                </Label>
                <Input
                  id="fullName"
                  value={form.fullName}
                  onChange={(e) => set("fullName", e.target.value)}
                  placeholder={isTherapyCentre ? "e.g. Bloom Therapy Centre" : "Dr. Priya Sharma"}
                  className="mt-1"
                  data-testid="input-fullName"
                />
              </div>
              {!isTherapyCentre && (
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
              )}
              {isTherapyCentre && (
                <div>
                  <Label htmlFor="yearsExperience">Years in operation</Label>
                  <Input
                    id="yearsExperience"
                    type="number"
                    min={0}
                    max={100}
                    value={form.yearsExperience}
                    onChange={(e) => set("yearsExperience", e.target.value)}
                    placeholder="e.g. 5"
                    className="mt-1"
                    data-testid="input-yearsExperience"
                  />
                </div>
              )}
            </div>
          )}

          {/* Step 1: Details */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="bio">
                  {isTherapyCentre ? "About your centre" : "Bio"}
                </Label>
                <Textarea
                  id="bio"
                  value={form.bio}
                  onChange={(e) => set("bio", e.target.value)}
                  placeholder={
                    isTherapyCentre
                      ? "Describe your centre's mission, facilities, and approach to therapy..."
                      : "Tell parents about your approach, methods, and experience..."
                  }
                  className="mt-1 min-h-[120px]"
                  data-testid="input-bio"
                />
              </div>
              <div>
                <Label htmlFor="qualifications">
                  {isTherapyCentre ? "Therapies & services offered" : "Qualifications"}
                </Label>
                <Textarea
                  id="qualifications"
                  value={form.qualifications}
                  onChange={(e) => set("qualifications", e.target.value)}
                  placeholder={
                    isTherapyCentre
                      ? "ABA Therapy, Speech Therapy, Occupational Therapy, Behaviour Intervention..."
                      : "B.Ed Special Education, ASHA Certified, etc."
                  }
                  className="mt-1 min-h-[80px]"
                  data-testid="input-qualifications"
                />
              </div>
              <div>
                <Label>Specialization tags <span className="text-muted-foreground text-xs">(pick up to 5)</span></Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {TAG_OPTIONS.map((tag) => {
                    const selected = form.specializationTags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => {
                          setForm((prev) => {
                            if (prev.specializationTags.includes(tag)) {
                              return { ...prev, specializationTags: prev.specializationTags.filter((t) => t !== tag) };
                            }
                            if (prev.specializationTags.length >= 5) return prev;
                            return { ...prev, specializationTags: [...prev.specializationTags, tag] };
                          });
                        }}
                        className={`px-3 py-1 rounded-full text-sm border transition-colors ${selected ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-foreground hover:border-primary"}`}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </div>

              {isTherapyCentre && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="numTherapists">No. of therapists</Label>
                      <Input
                        id="numTherapists"
                        type="number"
                        min={1}
                        value={form.numTherapists}
                        onChange={(e) => set("numTherapists", e.target.value)}
                        placeholder="e.g. 8"
                        className="mt-1"
                        data-testid="input-numTherapists"
                      />
                    </div>
                    <div>
                      <Label htmlFor="centreRegistrationNo">Registration No. <span className="text-muted-foreground text-xs">(optional)</span></Label>
                      <Input
                        id="centreRegistrationNo"
                        value={form.centreRegistrationNo}
                        onChange={(e) => set("centreRegistrationNo", e.target.value)}
                        placeholder="e.g. MH/TC/2020/1234"
                        className="mt-1"
                        data-testid="input-centreRegistrationNo"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Registration number will be shown on your centre's profile page to build parent trust.
                  </p>
                </>
              )}

              {!isTherapyCentre && (
                <>
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
                      {isGeoFencedSpecialty && (
                        <p className="mt-2 text-xs text-muted-foreground" data-testid="geofencing-label">
                          Parents within {form.travelRadiusKm} km of your location can find you when searching for home visits.
                        </p>
                      )}
                    </div>
                  )}
                </>
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
              <div>
                <Label htmlFor="displayArea">Area shown to parents <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input
                  id="displayArea"
                  value={form.displayArea}
                  onChange={(e) => set("displayArea", e.target.value)}
                  placeholder="e.g. Bandra West, Mumbai"
                  className="mt-1"
                  data-testid="input-display-area"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Shown on your public profile. Your exact address is never shared before a booking is confirmed.
                </p>
              </div>
              <div>
                <Label htmlFor="clinicAddress">Full clinic / practice address <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input
                  id="clinicAddress"
                  value={form.clinicAddress}
                  onChange={(e) => set("clinicAddress", e.target.value)}
                  placeholder="e.g. 204 Sunrise Chambers, SV Road, Bandra West, Mumbai 400050"
                  className="mt-1"
                  data-testid="input-clinic-address"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Shared with parents only after a booking is confirmed.
                </p>
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

              <div className="border-t border-border pt-4 mt-2">
                <Label htmlFor="upiId" className="flex items-center gap-1.5">
                  UPI ID <span className="text-xs text-muted-foreground font-normal">(for receiving session payments)</span>
                </Label>
                <Input
                  id="upiId"
                  type="text"
                  placeholder="yourname@upi"
                  value={form.upiId}
                  onChange={(e) => set("upiId", e.target.value)}
                  className="mt-1"
                  data-testid="input-upiId"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Parents pay for sessions via Razorpay. Your payout will be transferred to this UPI ID. Only you can see this — it's never shown to parents.
                </p>
              </div>
            </div>
          )}

        </div>

        {/* Navigation */}
        <div className="flex justify-between mt-6">
          <Button variant="outline" onClick={handleBack} disabled={step === 0 || isSubmitting}>
            Back
          </Button>
          {step < STEPS.length - 1 ? (
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
              disabled={isSubmitting}
              className="gap-2"
              data-testid="submit-profile-btn"
            >
              {isSubmitting ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <CheckCircle2 size={15} />
              )}
              {isSubmitting
                ? "Saving…"
                : existingProfile
                ? "Save changes"
                : "Create & activate profile"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
