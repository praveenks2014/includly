import { useState } from "react";
import { useLocation } from "wouter";
import {
  useGetMyProfessionalProfile,
  getCreateProfessionalProfileMutationOptions,
  getUpdateProfessionalProfileMutationOptions,
  getGetMyProfessionalProfileQueryKey,
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
import { SPECIALTY_OPTIONS } from "@/lib/specialties";
import { Loader2, CheckCircle2 } from "lucide-react";

const TRAVEL_RADIUS_OPTIONS = [5, 10, 15, 25, 50];
const STEPS = ["Basic info", "Details", "Contact"];

export default function OnboardPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: existingProfile, isLoading } = useGetMyProfessionalProfile();

  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    fullName: existingProfile?.fullName ?? "",
    specialty: existingProfile?.specialty ?? "",
    bio: existingProfile?.bio ?? "",
    qualifications: existingProfile?.qualifications ?? "",
    yearsExperience: existingProfile?.yearsExperience?.toString() ?? "0",
    city: existingProfile?.city ?? "",
    country: existingProfile?.country ?? "India",
    willingToTravel: existingProfile?.willingToTravel ?? false,
    travelRadiusKm: existingProfile?.travelRadiusKm?.toString() ?? "10",
    phone: existingProfile?.phone ?? "",
    email: existingProfile?.email ?? "",
  });

  const createMutation = useMutation({
    ...getCreateProfessionalProfileMutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetMyProfessionalProfileQueryKey() });
      toast({ title: "Profile created!", description: "Your profile is now live." });
      setLocation("/dashboard");
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
      setLocation("/dashboard");
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

  function set(field: string, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }));
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
      willingToTravel: form.willingToTravel,
      travelRadiusKm: form.willingToTravel ? Number(form.travelRadiusKm) : undefined,
      phone: form.phone,
      email: form.email,
    };

    if (existingProfile) {
      updateMutation.mutate({ data: payload });
    } else {
      createMutation.mutate({ data: payload });
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

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
              <div className="grid grid-cols-2 gap-4">
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

          {/* Step 2: Contact */}
          {step === 2 && (
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
        </div>

        {/* Navigation */}
        <div className="flex justify-between mt-6">
          <Button variant="outline" onClick={handleBack} disabled={step === 0}>
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
      </div>
    </div>
  );
}
