import { useParams, useLocation } from "wouter";
import { useUser } from "@clerk/react";
import {
  useGetProfessional,
  useGetRatingsForProfessional,
  useCheckUnlockStatus,
  getCreateUnlockMutationOptions,
  getGetProfessionalQueryKey,
  getCheckUnlockStatusQueryKey,
} from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { StarRating } from "@/components/StarRating";
import { getSpecialtyLabel, SPECIALTY_COLORS } from "@/lib/specialties";
import { useToast } from "@/hooks/use-toast";
import {
  BadgeCheck,
  Clock,
  MapPin,
  Navigation,
  Phone,
  Mail,
  Lock,
  ArrowLeft,
  Loader2,
  Star,
} from "lucide-react";

export default function ProfessionalProfilePage() {
  const { id } = useParams<{ id: string }>();
  const professionalId = Number(id);
  const [, setLocation] = useLocation();
  const { isSignedIn } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: professional, isLoading } = useGetProfessional(professionalId);
  const { data: ratingsData } = useGetRatingsForProfessional(professionalId);
  const { data: unlockStatus } = useCheckUnlockStatus(professionalId, {
    query: {
      enabled: isSignedIn === true,
      retry: false,
      queryKey: getCheckUnlockStatusQueryKey(professionalId),
    },
  });

  const isUnlocked = unlockStatus?.isUnlocked ?? false;

  const unlockMutation = useMutation({
    ...getCreateUnlockMutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetProfessionalQueryKey(professionalId) });
      queryClient.invalidateQueries({ queryKey: getCheckUnlockStatusQueryKey(professionalId) });
      toast({ title: "Contact unlocked", description: "You can now view their contact details." });
    },
    onError: (error: unknown) => {
      const status = (error as { status?: number })?.status;
      if (status === 402) {
        toast({
          title: "Purchase required",
          description: "Get a plan to view contact details.",
        });
        setLocation(`/pricing`);
        return;
      }
      toast({ title: "Could not unlock", description: "Please try again.", variant: "destructive" });
    },
  });

  function handleUnlock() {
    if (!isSignedIn) {
      setLocation("/sign-in");
      return;
    }
    unlockMutation.mutate({ data: { professionalId } });
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    );
  }

  if (!professional) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Specialist not found.</p>
        <Button variant="outline" onClick={() => setLocation("/search")}>
          Back to search
        </Button>
      </div>
    );
  }

  const p = professional;
  const specialtyColor = SPECIALTY_COLORS[p.specialty] ?? "bg-gray-100 text-gray-800";
  const ratings = ratingsData ?? [];

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        {/* Back */}
        <button
          onClick={() => window.history.back()}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
          data-testid="back-btn"
        >
          <ArrowLeft size={16} />
          Back
        </button>

        {/* Profile header */}
        <div className="bg-card border border-border rounded-xl p-6 mb-6 shadow-sm">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <h1 className="text-2xl font-serif font-semibold text-foreground">{p.fullName ?? "Professional"}</h1>
                {p.isVerified && p.verificationStatus === "verified" && (
                  <BadgeCheck size={22} className="text-primary" />
                )}
              </div>
              <span className={`inline-block text-sm font-medium px-3 py-1 rounded-full ${specialtyColor}`}>
                {getSpecialtyLabel(p.specialty)}
              </span>
            </div>
            {p.averageRating ? (
              <div className="text-right shrink-0">
                <div className="flex items-center gap-1 justify-end">
                  <Star size={16} className="text-yellow-400 fill-yellow-400" />
                  <span className="text-lg font-bold">{p.averageRating.toFixed(1)}</span>
                </div>
                <p className="text-xs text-muted-foreground">{p.totalRatings ?? 0} reviews</p>
              </div>
            ) : null}
          </div>

          {/* Meta info */}
          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground mb-4">
            <span className="flex items-center gap-1.5">
              <Clock size={14} />
              {p.yearsExperience} {p.yearsExperience === 1 ? "year" : "years"} experience
            </span>
            {p.city && (
              <span className="flex items-center gap-1.5">
                <MapPin size={14} />
                {p.city}{p.country ? `, ${p.country}` : ""}
              </span>
            )}
            {p.willingToTravel && p.travelRadiusKm && (
              <span className="flex items-center gap-1.5">
                <Navigation size={14} />
                Travels up to {p.travelRadiusKm} km
              </span>
            )}
          </div>

          {p.verificationStatus === "pending" && (
            <div className="mb-4 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
              Verification pending — credentials are being reviewed.
            </div>
          )}

          {/* Bio */}
          {p.bio && (
            <p className="text-foreground/80 leading-relaxed mb-4">{p.bio}</p>
          )}

          {/* Qualifications */}
          {p.qualifications && (
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-foreground mb-1">Qualifications</h3>
              <p className="text-sm text-muted-foreground">{p.qualifications}</p>
            </div>
          )}

          <Separator className="my-4" />

          {/* Contact unlock section */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3">Contact information</h3>
            {isUnlocked ? (
              <div className="space-y-2">
                {p.phone && (
                  <a
                    href={`tel:${p.phone}`}
                    className="flex items-center gap-2 text-sm text-foreground hover:text-primary transition-colors"
                    data-testid="contact-phone"
                  >
                    <Phone size={15} className="text-primary" />
                    {p.phone}
                  </a>
                )}
                {p.email && (
                  <a
                    href={`mailto:${p.email}`}
                    className="flex items-center gap-2 text-sm text-foreground hover:text-primary transition-colors"
                    data-testid="contact-email"
                  >
                    <Mail size={15} className="text-primary" />
                    {p.email}
                  </a>
                )}
              </div>
            ) : (
              <div className="bg-muted/40 border border-border rounded-lg p-4 flex items-start gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground/60 font-mono mb-1">
                    <Phone size={13} />
                    {p.phoneBlurred}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground/60 font-mono">
                    <Mail size={13} />
                    {p.emailBlurred}
                  </div>
                </div>
                <Button
                  onClick={handleUnlock}
                  disabled={unlockMutation.isPending}
                  className="gap-2 shrink-0"
                  data-testid="unlock-contact-btn"
                >
                  {unlockMutation.isPending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Lock size={14} />
                  )}
                  {unlockMutation.isPending ? "Unlocking..." : "Unlock contact"}
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Ratings */}
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-serif font-semibold mb-4">
            Reviews {ratings.length > 0 && <span className="text-base font-normal text-muted-foreground">({ratings.length})</span>}
          </h2>
          {ratings.length === 0 ? (
            <p className="text-muted-foreground text-sm">No reviews yet.</p>
          ) : (
            <div className="space-y-4">
              {ratings.map((r) => (
                <div key={r.id} className="pb-4 border-b border-border last:border-0 last:pb-0">
                  <div className="flex items-center gap-2 mb-1">
                    <StarRating value={r.score} size={14} />
                    <span className="text-xs text-muted-foreground">
                      {new Date(r.createdAt).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" })}
                    </span>
                  </div>
                  {r.comment && <p className="text-sm text-foreground/80">{r.comment}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
