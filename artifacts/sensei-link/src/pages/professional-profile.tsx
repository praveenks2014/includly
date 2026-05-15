import { useState } from "react";
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
import { getSpecialtyLabel, SPECIALTY_COLORS } from "@/lib/specialties";
import { UnlockPaymentModal } from "@/components/UnlockPaymentModal";
import { BookingWidget } from "@/components/BookingWidget";
import { useToast } from "@/hooks/use-toast";
import {
  BadgeCheck, MapPin, Phone, Mail, Lock, ArrowLeft,
  Loader2, Star, IndianRupee, Pencil, Clock, Home,
  Navigation, Video, Copy, CheckCircle2, Globe, GraduationCap,
} from "lucide-react";

function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Star rating picker">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star)}
          onMouseEnter={() => setHovered(star)}
          onMouseLeave={() => setHovered(0)}
          aria-label={`Rate ${star} star${star !== 1 ? "s" : ""}`}
          className="p-0.5 focus-visible:ring-2 focus-visible:ring-[#2EC4A5] rounded"
        >
          <Star
            size={22}
            className={`transition-colors ${(hovered || value) >= star ? "text-[#FFB830] fill-[#FFB830]" : "text-gray-300"}`}
          />
        </button>
      ))}
    </div>
  );
}

function StarDisplay({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <div className="flex items-center gap-0.5" role="img" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((s) => (
        <Star key={s} size={size} className={value >= s ? "text-[#FFB830] fill-[#FFB830]" : "text-gray-200"} />
      ))}
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button
      onClick={handleCopy}
      aria-label={`Copy ${label}`}
      className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-[#2EC4A5] transition-colors focus-visible:ring-2 focus-visible:ring-[#2EC4A5]"
    >
      {copied ? <CheckCircle2 size={15} className="text-[#2EC4A5]" /> : <Copy size={15} />}
    </button>
  );
}

function ProfileSkeleton() {
  return (
    <div className="min-h-screen bg-[#F5F7FA]">
      <div className="h-48 bg-gray-200 animate-pulse" />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 -mt-12">
        <div className="flex gap-6 mb-6">
          <div className="w-24 h-24 rounded-full bg-gray-300 animate-pulse shrink-0 border-4 border-white" />
          <div className="flex-1 pt-12 space-y-2">
            <div className="h-6 w-48 bg-gray-200 rounded animate-pulse" />
            <div className="h-4 w-32 bg-gray-100 rounded animate-pulse" />
          </div>
        </div>
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            {[1, 2, 3].map(i => <div key={i} className="h-32 bg-white rounded-xl animate-pulse" />)}
          </div>
          <div className="h-64 bg-white rounded-xl animate-pulse" />
        </div>
      </div>
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
  const unlockPrice = 0;
  const isFree = true;

  function handleUnlock() {
    if (!isSignedIn) { setLocation("/sign-in"); return; }
    setShowPayModal(true);
  }

  function handleUnlockSuccess() {
    queryClient.invalidateQueries({ queryKey: getGetProfessionalQueryKey(professionalId) });
    queryClient.invalidateQueries({ queryKey: getCheckUnlockStatusQueryKey(professionalId) });
  }

  function handleStartReview() {
    if (myRating) { setReviewScore(myRating.score); setReviewComment(myRating.comment ?? ""); }
    else { setReviewScore(0); setReviewComment(""); }
    setShowReviewForm(true);
  }

  async function handleSubmitReview() {
    if (!isSignedIn) { setLocation("/sign-in"); return; }
    if (reviewScore === 0) { toast({ title: "Please select a star rating", variant: "destructive" }); return; }
    setIsSubmittingReview(true);
    try {
      await submitRating({ data: { professionalId, score: reviewScore, comment: reviewComment.trim() || undefined } });
      toast({ title: myRating ? "Review updated! ✓" : "Review submitted! ✓", description: "Thank you for your feedback." });
      setShowReviewForm(false);
      queryClient.invalidateQueries({ queryKey: getGetRatingsForProfessionalQueryKey(professionalId) });
      queryClient.invalidateQueries({ queryKey: getGetMyRatingForProfessionalQueryKey(professionalId) });
      queryClient.invalidateQueries({ queryKey: getGetProfessionalQueryKey(professionalId) });
    } catch {
      toast({ title: "Failed to submit review", description: "Please try again.", variant: "destructive" });
    } finally { setIsSubmittingReview(false); }
  }

  if (isLoading) return <ProfileSkeleton />;

  if (!professional) {
    return (
      <div className="min-h-screen bg-[#F5F7FA] flex flex-col items-center justify-center gap-6 px-4">
        <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
          <circle cx="40" cy="40" r="40" fill="#2EC4A5" fillOpacity="0.1"/>
          <circle cx="40" cy="32" r="12" fill="#2EC4A5" fillOpacity="0.3"/>
          <path d="M20 64c0-11 9-18 20-18s20 7 20 18" stroke="#2EC4A5" strokeWidth="2.5" strokeLinecap="round"/>
          <path d="M55 25l8 8M63 25l-8 8" stroke="#FF6B6B" strokeWidth="2.5" strokeLinecap="round"/>
        </svg>
        <div className="text-center">
          <p className="font-serif text-2xl font-bold text-[#1A2340] mb-2">Specialist not found</p>
          <p className="text-gray-500 mb-6">This profile may have been removed or the link is incorrect.</p>
          <Button onClick={() => setLocation("/search")} className="bg-[#2EC4A5] hover:bg-[#26a88d] focus-visible:ring-2 focus-visible:ring-[#2EC4A5]" aria-label="Back to search">
            Back to Search
          </Button>
        </div>
      </div>
    );
  }

  const p = professional;
  const ratings = ratingsData ?? [];
  const firstName = p.fullName?.split(" ")[0] ?? "Professional";
  const initials = p.fullName ? p.fullName.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase() : "PR";
  const specialtyLabel = getSpecialtyLabel(p.specialty);

  // Cover gradient based on specialty
  const coverGradients: Record<string, string> = {
    speech_therapy: "from-blue-600 to-blue-800",
    occupational_therapy: "from-orange-500 to-orange-700",
    shadow_teacher: "from-violet-600 to-violet-800",
    aba_therapy: "from-emerald-600 to-emerald-800",
    child_psychologist: "from-pink-600 to-pink-800",
    default: "from-[#1A2340] to-[#2a3660]",
  };
  const coverGrad = coverGradients[p.specialty] ?? coverGradients.default;

  return (
    <div className="min-h-screen bg-[#F5F7FA]">
      {/* Cover */}
      <div className={`bg-gradient-to-br ${coverGrad} h-44 sm:h-52 relative`}>
        <button
          onClick={() => setLocation(`/search?specialty=${encodeURIComponent(p.specialty)}`)}
          className="absolute top-4 left-4 sm:top-6 sm:left-6 flex items-center gap-1.5 text-white/80 hover:text-white text-sm font-medium focus-visible:ring-2 focus-visible:ring-white rounded-lg px-2 py-1 transition-colors"
          aria-label="Back to search"
          data-testid="back-btn"
        >
          <ArrowLeft size={16} />
          Back to search
        </button>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        {/* Avatar row */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-4 -mt-14 sm:-mt-16 mb-6">
          <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-[#2EC4A5] border-4 border-white shadow-lg flex items-center justify-center shrink-0">
            <span className="text-white text-2xl sm:text-3xl font-bold font-serif">{initials}</span>
          </div>
          <div className="pb-1 flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h1 className="font-serif text-2xl sm:text-3xl font-bold text-[#1A2340]">{p.fullName ?? "Professional"}</h1>
              {p.isVerified && p.verificationStatus === "verified" && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#2EC4A5] bg-[#2EC4A5]/10 border border-[#2EC4A5]/20 px-2.5 py-0.5 rounded-full">
                  <BadgeCheck size={13} />
                  Verified
                </span>
              )}
              {p.isPremium && (
                <span className="text-xs font-semibold text-[#FFB830] bg-[#FFB830]/10 border border-[#FFB830]/20 px-2 py-0.5 rounded-full">
                  ⭐ Pro
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm text-gray-500">
              <span className="font-medium text-[#2EC4A5]">{specialtyLabel}</span>
              {(p.displayArea || p.city) && (
                <span className="flex items-center gap-1">
                  <MapPin size={13} />
                  {p.displayArea ?? p.city}{p.country ? `, ${p.country}` : ""}
                </span>
              )}
              {p.averageRating ? (
                <span className="flex items-center gap-1">
                  <Star size={13} className="text-[#FFB830] fill-[#FFB830]" />
                  <strong>{p.averageRating.toFixed(1)}</strong>
                  <span className="text-gray-400">({p.totalRatings ?? 0})</span>
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6 pb-16 lg:pb-6">
          {/* Left column: main content */}
          <div className="lg:col-span-2 space-y-5">
            {/* Verification pending banner */}
            {p.verificationStatus === "pending" && (
              <div className="flex items-center gap-3 px-4 py-3 bg-[#FFB830]/10 border border-[#FFB830]/30 rounded-xl text-sm text-[#1A2340]">
                <Clock size={16} className="text-[#FFB830] shrink-0" />
                Verification pending — credentials are being reviewed by our team.
              </div>
            )}

            {/* About */}
            {p.bio && (
              <section className="bg-white rounded-xl p-6 shadow-[0_4px_24px_rgba(26,35,64,0.08)]" aria-label="About">
                <h2 className="font-serif text-lg font-bold text-[#1A2340] mb-3">About</h2>
                <p className="text-gray-600 leading-relaxed">{p.bio}</p>
                {p.qualifications && (
                  <div className="mt-4 pt-4 border-t border-gray-50">
                    <p className="text-sm font-semibold text-[#1A2340] mb-1">Qualifications</p>
                    <p className="text-sm text-gray-500">{p.qualifications}</p>
                  </div>
                )}
              </section>
            )}

            {/* Specialties */}
            {Array.isArray(p.specializationTags) && p.specializationTags.length > 0 && (
              <section className="bg-white rounded-xl p-6 shadow-[0_4px_24px_rgba(26,35,64,0.08)]" aria-label="Specialties">
                <h2 className="font-serif text-lg font-bold text-[#1A2340] mb-3">Specializes In</h2>
                <div className="flex flex-wrap gap-2">
                  {p.specializationTags.map((tag: string) => (
                    <span key={tag} className="px-3 py-1 rounded-full text-sm bg-[#2EC4A5]/10 text-[#2EC4A5] border border-[#2EC4A5]/20 font-medium">
                      {tag}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* Session info */}
            <section className="bg-white rounded-xl p-6 shadow-[0_4px_24px_rgba(26,35,64,0.08)]" aria-label="Session information">
              <h2 className="font-serif text-lg font-bold text-[#1A2340] mb-4">Session Info</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                {p.yearsExperience && (
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-[#2EC4A5]/10 flex items-center justify-center shrink-0">
                      <GraduationCap size={18} className="text-[#2EC4A5]" />
                    </div>
                    <div>
                      <p className="text-xs text-gray-400">Experience</p>
                      <p className="text-sm font-semibold text-[#1A2340]">{p.yearsExperience} {p.yearsExperience === 1 ? "year" : "years"}</p>
                    </div>
                  </div>
                )}
                {(p.pricingMinINR || p.pricingMaxINR) && (
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-green-50 flex items-center justify-center shrink-0">
                      <IndianRupee size={18} className="text-green-600" />
                    </div>
                    <div>
                      <p className="text-xs text-gray-400">Fee per session</p>
                      <p className="text-sm font-semibold text-green-700">
                        {p.pricingMinINR && p.pricingMaxINR
                          ? `₹${p.pricingMinINR.toLocaleString("en-IN")} – ₹${p.pricingMaxINR.toLocaleString("en-IN")}`
                          : p.pricingMinINR ? `From ₹${p.pricingMinINR.toLocaleString("en-IN")}`
                          : `Up to ₹${p.pricingMaxINR!.toLocaleString("en-IN")}`}
                      </p>
                    </div>
                  </div>
                )}
                {p.offersHomeVisits && (
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                      <Home size={18} className="text-blue-600" />
                    </div>
                    <div>
                      <p className="text-xs text-gray-400">Home visits</p>
                      <p className="text-sm font-semibold text-[#1A2340]">Available</p>
                    </div>
                  </div>
                )}
                {p.willingToTravel && p.travelRadiusKm && (
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-violet-50 flex items-center justify-center shrink-0">
                      <Navigation size={18} className="text-violet-600" />
                    </div>
                    <div>
                      <p className="text-xs text-gray-400">Travel radius</p>
                      <p className="text-sm font-semibold text-[#1A2340]">{p.travelRadiusKm} km</p>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-orange-50 flex items-center justify-center shrink-0">
                    <Video size={18} className="text-orange-500" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Session mode</p>
                    <p className="text-sm font-semibold text-[#1A2340]">Online &amp; Offline</p>
                  </div>
                </div>
              </div>
            </section>

            {/* Certifications */}
            <section className="bg-white rounded-xl p-6 shadow-[0_4px_24px_rgba(26,35,64,0.08)]" aria-label="Certifications">
              <h2 className="font-serif text-lg font-bold text-[#1A2340] mb-3">Credentials</h2>
              {p.verificationStatus === "verified" ? (
                <div className="flex items-center gap-3 p-3 bg-[#2EC4A5]/5 border border-[#2EC4A5]/20 rounded-xl">
                  <BadgeCheck size={20} className="text-[#2EC4A5] shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-[#2EC4A5]">Identity Verified by Includly</p>
                    <p className="text-xs text-gray-400">Certifications and ID documents reviewed by our team.</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-400 italic">Credential verification is pending or not yet submitted.</p>
              )}
            </section>

            {/* Reviews */}
            <section className="bg-white rounded-xl p-6 shadow-[0_4px_24px_rgba(26,35,64,0.08)]" aria-label="Reviews">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="font-serif text-lg font-bold text-[#1A2340]">Reviews</h2>
                  {p.averageRating && (
                    <div className="flex items-center gap-2 mt-1">
                      <StarDisplay value={Math.round(p.averageRating)} />
                      <span className="text-sm font-semibold text-[#1A2340]">{p.averageRating.toFixed(1)}</span>
                      <span className="text-sm text-gray-400">({p.totalRatings ?? 0} reviews)</span>
                    </div>
                  )}
                </div>
                {isSignedIn && isUnlocked && !showReviewForm && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleStartReview}
                    className="gap-1.5 rounded-lg border-gray-200 text-[#1A2340] hover:border-[#2EC4A5] hover:text-[#2EC4A5] focus-visible:ring-2 focus-visible:ring-[#2EC4A5]"
                    aria-label={myRating ? "Edit your review" : "Write a review"}
                    data-testid="write-review-btn"
                  >
                    <Pencil size={13} />
                    {myRating ? "Edit review" : "Write a review"}
                  </Button>
                )}
              </div>

              {showReviewForm && (
                <div className="mb-6 p-4 bg-gray-50 border border-gray-100 rounded-xl">
                  <h3 className="text-sm font-semibold text-[#1A2340] mb-3">{myRating ? "Edit your review" : "Write a review"}</h3>
                  <div className="mb-3">
                    <label className="text-xs text-gray-400 mb-1.5 block">Your rating</label>
                    <StarPicker value={reviewScore} onChange={setReviewScore} />
                  </div>
                  <div className="mb-3">
                    <label className="text-xs text-gray-400 mb-1.5 block">Comment (optional)</label>
                    <textarea
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm resize-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2EC4A5]"
                      rows={3}
                      placeholder="Share your experience..."
                      value={reviewComment}
                      onChange={(e) => setReviewComment(e.target.value)}
                      aria-label="Review comment"
                      data-testid="review-comment-input"
                    />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button variant="ghost" size="sm" onClick={() => setShowReviewForm(false)} disabled={isSubmittingReview} aria-label="Cancel review">Cancel</Button>
                    <Button
                      size="sm"
                      onClick={handleSubmitReview}
                      disabled={isSubmittingReview || reviewScore === 0}
                      className="bg-[#2EC4A5] hover:bg-[#26a88d] focus-visible:ring-2 focus-visible:ring-[#2EC4A5]"
                      aria-label="Submit review"
                      data-testid="submit-review-btn"
                    >
                      {isSubmittingReview && <Loader2 size={13} className="animate-spin mr-1" />}
                      {myRating ? "Update" : "Submit"}
                    </Button>
                  </div>
                </div>
              )}

              {ratings.length === 0 ? (
                <div className="text-center py-8">
                  <svg width="52" height="52" viewBox="0 0 52 52" fill="none" className="mx-auto mb-3 opacity-40">
                    <circle cx="26" cy="26" r="26" fill="#FFB830" fillOpacity="0.15"/>
                    <path d="M26 14l3 9h9l-7 5 3 9-8-6-8 6 3-9-7-5h9z" stroke="#FFB830" strokeWidth="2" strokeLinejoin="round"/>
                  </svg>
                  <p className="text-sm font-semibold text-gray-500">No reviews yet</p>
                  {isSignedIn && isUnlocked && !showReviewForm && (
                    <p className="text-xs text-gray-400 mt-1">Be the first to share your experience.</p>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {ratings.map((r: any) => (
                    <div key={r.id} className="pb-4 border-b border-gray-50 last:border-0 last:pb-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <StarDisplay value={r.score} size={13} />
                        {r.reviewerName && <span className="text-xs font-semibold text-[#1A2340]">{r.reviewerName}</span>}
                        <span className="text-xs text-gray-400">
                          {new Date(r.createdAt).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" })}
                        </span>
                      </div>
                      {r.comment && <p className="text-sm text-gray-600">{r.comment}</p>}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Booking widget */}
            {isSignedIn && (
              <BookingWidget
                professionalId={professionalId}
                professionalName={p.fullName}
                specialty={p.specialty}
                offersHomeVisits={p.offersHomeVisits}
              />
            )}
          </div>

          {/* Right column: sticky action card (desktop) */}
          <div className="hidden lg:block">
            <div className="sticky top-20">
              <ActionCard
                p={p}
                isSignedIn={!!isSignedIn}
                isUnlocked={isUnlocked}
                isFree={isFree}
                unlockPrice={unlockPrice}
                firstName={firstName}
                onUnlock={handleUnlock}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Mobile sticky action bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 shadow-[0_-4px_24px_rgba(26,35,64,0.08)] p-4 lg:hidden z-40">
        <MobileActionBar
          p={p}
          isSignedIn={!!isSignedIn}
          isUnlocked={isUnlocked}
          isFree={isFree}
          unlockPrice={unlockPrice}
          firstName={firstName}
          onUnlock={handleUnlock}
        />
      </div>

      <UnlockPaymentModal
        open={showPayModal}
        onClose={() => setShowPayModal(false)}
        professionalId={professionalId}
        professionalName={p.fullName ?? undefined}
        specialty={p.specialty}
        onUnlockSuccess={handleUnlockSuccess}
      />
    </div>
  );
}

interface ActionProps {
  p: any;
  isSignedIn: boolean;
  isUnlocked: boolean;
  isFree: boolean;
  unlockPrice: number;
  firstName: string;
  onUnlock: () => void;
}

function ActionCard({ p, isSignedIn, isUnlocked, isFree, unlockPrice, firstName, onUnlock }: ActionProps) {
  return (
    <div className="bg-white rounded-xl shadow-[0_8px_40px_rgba(26,35,64,0.12)] border border-gray-100 overflow-hidden">
      {isUnlocked ? (
        <div className="p-5 space-y-3">
          <div className="flex items-center gap-2 mb-4">
            <BadgeCheck size={18} className="text-[#2EC4A5]" />
            <p className="text-sm font-semibold text-[#2EC4A5]">Contact Unlocked</p>
          </div>
          {p.phone && (
            <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-xl">
              <Phone size={15} className="text-[#2EC4A5] shrink-0" />
              <a href={`tel:${p.phone}`} className="text-sm text-[#1A2340] font-medium hover:text-[#2EC4A5] flex-1 focus-visible:ring-2 focus-visible:ring-[#2EC4A5] rounded" aria-label="Call professional" data-testid="contact-phone">{p.phone}</a>
              <CopyButton text={p.phone} label="phone number" />
            </div>
          )}
          {p.email && (
            <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-xl">
              <Mail size={15} className="text-[#2EC4A5] shrink-0" />
              <a href={`mailto:${p.email}`} className="text-sm text-[#1A2340] font-medium hover:text-[#2EC4A5] flex-1 truncate focus-visible:ring-2 focus-visible:ring-[#2EC4A5] rounded" aria-label="Email professional" data-testid="contact-email">{p.email}</a>
              <CopyButton text={p.email} label="email" />
            </div>
          )}
        </div>
      ) : isSignedIn ? (
        <div className="p-5">
          <div className="relative rounded-xl overflow-hidden border border-gray-100 mb-4">
            <div className="px-4 py-4 blur-[4px] select-none pointer-events-none" aria-hidden="true">
              <div className="flex items-center gap-2 text-sm font-mono text-gray-400 mb-2">
                <Phone size={13} /> {p.phoneBlurred}
              </div>
              <div className="flex items-center gap-2 text-sm font-mono text-gray-400">
                <Mail size={13} /> {p.emailBlurred}
              </div>
            </div>
            <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center p-3 text-center">
              <div className="w-9 h-9 rounded-full bg-[#2EC4A5]/10 flex items-center justify-center mb-2">
                <Lock size={16} className="text-[#2EC4A5]" />
              </div>
              <p className="text-xs font-semibold text-[#1A2340]">Contact details locked</p>
            </div>
          </div>
          <Button
            onClick={onUnlock}
            className="w-full bg-[#2EC4A5] hover:bg-[#26a88d] text-white font-semibold rounded-xl focus-visible:ring-2 focus-visible:ring-[#2EC4A5]"
            aria-label={isFree ? "Contact for free" : `Unlock contact for ₹${unlockPrice}`}
            data-testid="unlock-contact-btn"
          >
            <Lock size={14} className="mr-2" />
            {isFree ? `Contact ${firstName} for Free` : `Unlock Contact · ₹${unlockPrice}`}
          </Button>
        </div>
      ) : (
        <div className="p-5 text-center">
          <div className="w-10 h-10 rounded-full bg-[#2EC4A5]/10 flex items-center justify-center mx-auto mb-3">
            <Lock size={18} className="text-[#2EC4A5]" />
          </div>
          <p className="text-sm font-semibold text-[#1A2340] mb-1">Sign in to contact {firstName}</p>
          <p className="text-xs text-gray-400 mb-4">Create a free account to view contact details.</p>
          <Button
            onClick={onUnlock}
            className="w-full bg-[#2EC4A5] hover:bg-[#26a88d] focus-visible:ring-2 focus-visible:ring-[#2EC4A5]"
            aria-label="Sign in to contact professional"
          >
            Sign In to Contact
          </Button>
        </div>
      )}

      {/* Quick stats */}
      <div className="px-5 py-4 bg-gray-50 border-t border-gray-100 grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-lg font-bold font-serif text-[#1A2340]">{p.yearsExperience ?? "—"}</p>
          <p className="text-xs text-gray-400">Yrs exp.</p>
        </div>
        <div>
          <p className="text-lg font-bold font-serif text-[#1A2340]">{p.averageRating?.toFixed(1) ?? "—"}</p>
          <p className="text-xs text-gray-400">Rating</p>
        </div>
        <div>
          <p className="text-lg font-bold font-serif text-[#1A2340]">{p.totalRatings ?? 0}</p>
          <p className="text-xs text-gray-400">Reviews</p>
        </div>
      </div>
    </div>
  );
}

function MobileActionBar({ p, isSignedIn, isUnlocked, isFree, unlockPrice, firstName, onUnlock }: ActionProps) {
  if (isUnlocked) {
    return (
      <div className="flex gap-3">
        {p.phone && (
          <a
            href={`tel:${p.phone}`}
            className="flex-1 flex items-center justify-center gap-2 h-11 bg-[#2EC4A5] text-white rounded-xl font-semibold text-sm focus-visible:ring-2 focus-visible:ring-[#2EC4A5]"
            aria-label="Call professional"
          >
            <Phone size={16} /> Call
          </a>
        )}
        {p.email && (
          <a
            href={`mailto:${p.email}`}
            className="flex-1 flex items-center justify-center gap-2 h-11 border border-[#2EC4A5] text-[#2EC4A5] rounded-xl font-semibold text-sm focus-visible:ring-2 focus-visible:ring-[#2EC4A5]"
            aria-label="Email professional"
          >
            <Mail size={16} /> Email
          </a>
        )}
      </div>
    );
  }
  return (
    <Button
      onClick={onUnlock}
      className="w-full h-12 bg-[#2EC4A5] hover:bg-[#26a88d] text-white font-semibold rounded-xl text-base focus-visible:ring-2 focus-visible:ring-[#2EC4A5]"
      aria-label={isSignedIn ? (isFree ? `Contact ${firstName} for Free` : `Unlock Contact · ₹${unlockPrice}`) : "Sign In to Contact"}
      data-testid="unlock-contact-btn"
    >
      <Lock size={16} className="mr-2" />
      {isSignedIn
        ? (isFree ? `Contact ${firstName} for Free` : `Unlock Contact · ₹${unlockPrice}`)
        : "Sign In to Contact"}
    </Button>
  );
}
