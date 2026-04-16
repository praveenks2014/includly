import { useParams, useLocation } from "wouter";
import { useUser } from "@clerk/react";
import {
  useGetProfessional,
  useGetRatingsForProfessional,
  useCheckUnlockStatus,
  useGetMyRatingForProfessional,
  useCreateRating,
  getGetProfessionalQueryKey,
  getCheckUnlockStatusQueryKey,
  getGetRatingsForProfessionalQueryKey,
  getGetMyRatingForProfessionalQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { StarRating } from "@/components/StarRating";
import { getSpecialtyLabel, SPECIALTY_COLORS } from "@/lib/specialties";
import { UnlockPaymentModal } from "@/components/UnlockPaymentModal";
import { BookingWidget } from "@/components/BookingWidget";
import { useState } from "react";
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
  IndianRupee,
  Pencil,
} from "lucide-react";


function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hovered, setHovered] = useState(0);

  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star)}
          onMouseEnter={() => setHovered(star)}
          onMouseLeave={() => setHovered(0)}
          className="p-0.5 focus:outline-none"
          aria-label={`Rate ${star} stars`}
        >
          <Star
            size={22}
            className={`transition-colors ${
              (hovered || value) >= star
                ? "text-yellow-400 fill-yellow-400"
                : "text-muted-foreground"
            }`}
          />
        </button>
      ))}
    </div>
  );
}

export default function ProfessionalProfilePage() {
  const { id } = useParams<{ id: string }>();
  const professionalId = Number(id);
  const [, setLocation] = useLocation();
  const { isSignedIn } = useUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showPayModal, setShowPayModal] = useState(false);
  const [reviewScore, setReviewScore] = useState(0);
  const [reviewComment, setReviewComment] = useState("");
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [showReviewForm, setShowReviewForm] = useState(false);

  const { data: professional, isLoading } = useGetProfessional(professionalId);
  const { data: ratingsData } = useGetRatingsForProfessional(professionalId);
  const { data: unlockStatus } = useCheckUnlockStatus(professionalId, {
    query: {
      enabled: isSignedIn === true,
      retry: false,
      queryKey: getCheckUnlockStatusQueryKey(professionalId),
    },
  });
  const { data: myRatingData } = useGetMyRatingForProfessional(professionalId, {
    query: {
      enabled: isSignedIn === true,
      retry: false,
      queryKey: getGetMyRatingForProfessionalQueryKey(professionalId),
    },
  });
  const { mutateAsync: submitRating } = useCreateRating();

  const isUnlocked = unlockStatus?.isUnlocked ?? false;
  const myRating = myRatingData?.rating ?? null;

  function handleUnlock() {
    if (!isSignedIn) {
      setLocation("/sign-in");
      return;
    }
    setShowPayModal(true);
  }

  function handleUnlockSuccess() {
    queryClient.invalidateQueries({ queryKey: getGetProfessionalQueryKey(professionalId) });
    queryClient.invalidateQueries({ queryKey: getCheckUnlockStatusQueryKey(professionalId) });
  }

  function handleStartReview() {
    if (myRating) {
      setReviewScore(myRating.score);
      setReviewComment(myRating.comment ?? "");
    } else {
      setReviewScore(0);
      setReviewComment("");
    }
    setShowReviewForm(true);
  }

  async function handleSubmitReview() {
    if (!isSignedIn) {
      setLocation("/sign-in");
      return;
    }
    if (reviewScore === 0) {
      toast({ title: "Please select a star rating", variant: "destructive" });
      return;
    }
    setIsSubmittingReview(true);
    try {
      await submitRating({
        data: {
          professionalId,
          score: reviewScore,
          comment: reviewComment.trim() || undefined,
        },
      });
      toast({
        title: myRating ? "Review updated!" : "Review submitted!",
        description: "Thank you for your feedback.",
      });
      setShowReviewForm(false);
      queryClient.invalidateQueries({ queryKey: getGetRatingsForProfessionalQueryKey(professionalId) });
      queryClient.invalidateQueries({ queryKey: getGetMyRatingForProfessionalQueryKey(professionalId) });
      queryClient.invalidateQueries({ queryKey: getGetProfessionalQueryKey(professionalId) });
    } catch {
      toast({
        title: "Failed to submit review",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmittingReview(false);
    }
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
                {p.isPremium && (
                  <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                    ⭐ Pro
                  </span>
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
            {(p.pricingMinINR || p.pricingMaxINR) && (
              <span className="flex items-center gap-1.5 text-green-700 font-medium">
                <IndianRupee size={14} />
                {p.pricingMinINR && p.pricingMaxINR
                  ? `₹${p.pricingMinINR.toLocaleString("en-IN")} – ₹${p.pricingMaxINR.toLocaleString("en-IN")}`
                  : p.pricingMinINR
                    ? `From ₹${p.pricingMinINR.toLocaleString("en-IN")}`
                    : `Up to ₹${p.pricingMaxINR!.toLocaleString("en-IN")}`}
                {" "}/session
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

          {/* Specialization tags */}
          {Array.isArray(p.specializationTags) && p.specializationTags.length > 0 && (
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-foreground mb-2">Specializes in</h3>
              <div className="flex flex-wrap gap-1.5">
                {p.specializationTags.map((tag) => (
                  <span key={tag} className="px-2.5 py-1 rounded-full text-xs bg-primary/10 text-primary border border-primary/20 font-medium">
                    {tag}
                  </span>
                ))}
              </div>
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
                  className="gap-2 shrink-0"
                  data-testid="unlock-contact-btn"
                >
                  <Lock size={14} />
                  Unlock contact
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Booking widget — shown to all signed-in visitors */}
        {isSignedIn && (
          <BookingWidget
            professionalId={professionalId}
            professionalName={professional?.fullName}
            specialty={professional?.specialty}
          />
        )}

        {/* Reviews */}
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-serif font-semibold">
              Reviews {ratings.length > 0 && <span className="text-base font-normal text-muted-foreground">({ratings.length})</span>}
            </h2>
            {isSignedIn && isUnlocked && !showReviewForm && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={handleStartReview}
                data-testid="write-review-btn"
              >
                <Pencil size={13} />
                {myRating ? "Edit review" : "Write a review"}
              </Button>
            )}
          </div>

          {/* Review form */}
          {showReviewForm && (
            <div className="mb-6 p-4 bg-muted/30 border border-border rounded-xl">
              <h3 className="text-sm font-semibold mb-3">{myRating ? "Edit your review" : "Write a review"}</h3>
              <div className="mb-3">
                <label className="text-xs text-muted-foreground mb-1.5 block">Your rating</label>
                <StarPicker value={reviewScore} onChange={setReviewScore} />
              </div>
              <div className="mb-3">
                <label className="text-xs text-muted-foreground mb-1.5 block">Comment (optional)</label>
                <textarea
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                  rows={3}
                  placeholder="Share your experience..."
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  data-testid="review-comment-input"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowReviewForm(false)}
                  disabled={isSubmittingReview}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSubmitReview}
                  disabled={isSubmittingReview || reviewScore === 0}
                  data-testid="submit-review-btn"
                >
                  {isSubmittingReview ? <Loader2 size={13} className="animate-spin mr-1" /> : null}
                  {myRating ? "Update review" : "Submit review"}
                </Button>
              </div>
            </div>
          )}

          {ratings.length === 0 ? (
            <p className="text-muted-foreground text-sm">No reviews yet.{isSignedIn && isUnlocked && !showReviewForm ? " Be the first to write one." : ""}</p>
          ) : (
            <div className="space-y-4">
              {ratings.map((r) => (
                <div key={r.id} className="pb-4 border-b border-border last:border-0 last:pb-0">
                  <div className="flex items-center gap-2 mb-1">
                    <StarRating value={r.score} size={14} />
                    {r.reviewerName && (
                      <span className="text-xs font-medium text-foreground">{r.reviewerName}</span>
                    )}
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

      {/* Payment modal */}
      <UnlockPaymentModal
        open={showPayModal}
        onClose={() => setShowPayModal(false)}
        professionalId={professionalId}
        professionalName={professional?.fullName ?? undefined}
        onUnlockSuccess={handleUnlockSuccess}
      />
    </div>
  );
}
