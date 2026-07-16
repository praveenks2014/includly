import { Link } from "wouter";
import { BadgeCheck, Clock, MapPin, Star, Navigation, IndianRupee, Home, Heart } from "lucide-react";
import { motion } from "framer-motion";
import { useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getSpecialtyLabel, SPECIALTY_COLORS, getSpecialtyIcon, isInPersonOnly, getCoachingSubTypeLabel, getCoachingSubTypeIcon } from "@/lib/specialties";
import { ProfessionalAvatar } from "@/components/ProfessionalAvatar";

interface Professional {
  id: number;
  fullName?: string | null;
  specialty: string;
  bio?: string | null;
  yearsExperience: number;
  city?: string | null;
  country?: string | null;
  displayArea?: string | null;
  offersHomeVisits?: boolean;
  travelRadiusKm?: number | null;
  willingToTravel?: boolean;
  isVerified: boolean;
  verificationStatus: string;
  averageRating?: number | null;
  totalRatings?: number;
  phone?: string | null;
  email?: string | null;
  pricingMinINR?: number | null;
  pricingMaxINR?: number | null;
  paymentActivated?: boolean;
  isPremium?: boolean;
  specializationTags?: string[] | null;
  coachingSubType?: string | null;
  inclusiveExperience?: boolean;
  avatarUrl?: string | null;
}

interface ProfessionalCardProps {
  professional: Professional;
  distanceKm?: number;
}

export function ProfessionalCard({ professional: p, distanceKm }: ProfessionalCardProps) {
  const prefersReduced = useReducedMotion();
  const specialtyColor = SPECIALTY_COLORS[p.specialty] ?? "bg-gray-100 text-gray-800";
  const SpecialtyIcon = getSpecialtyIcon(p.specialty);
  const inPersonOnly = isInPersonOnly(p.specialty);
  const isCoach = p.specialty === "coaching";
  const CoachSubIcon = p.coachingSubType ? getCoachingSubTypeIcon(p.coachingSubType) : null;

  return (
    <motion.div
      whileHover={prefersReduced ? {} : { y: -4, transition: { duration: 0.2, ease: "easeOut" } }}
    >
      <Card className="border-border/60 shadow-sm hover:shadow-md transition-shadow duration-200 bg-white h-full">
        <CardContent className="p-5">
          <div className="flex items-start gap-4">
            <ProfessionalAvatar avatarUrl={p.avatarUrl} fullName={p.fullName} size="md" className="mt-0.5" />
            <div className="flex-1 min-w-0">
              {/* Name + credentials */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <Link href={`/professionals/${p.id}`} className="hover:underline">
                  <h3 className="font-bold text-foreground text-lg leading-tight truncate">
                    {p.fullName ?? "Specialist"}
                  </h3>
                </Link>
                {p.isVerified && p.verificationStatus === "verified" && (
                  <BadgeCheck size={17} className="text-primary shrink-0" />
                )}
                {p.verificationStatus === "pending" && (
                  <span className="text-xs font-medium text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded-full border border-yellow-200">
                    Pending
                  </span>
                )}
                {p.isPremium && (
                  <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                    ⭐ Pro
                  </span>
                )}
              </div>

              {/* Specialty subtitle */}
              <p className="text-sm text-muted-foreground mt-0.5">
                {isCoach && p.coachingSubType
                  ? `${getCoachingSubTypeLabel(p.coachingSubType)} Coach`
                  : getSpecialtyLabel(p.specialty)}
                {isCoach && p.inclusiveExperience && (
                  <span className="ml-1.5 inline-flex items-center gap-1 text-xs font-medium text-green-700">
                    <Heart size={10} /> Inclusive
                  </span>
                )}
              </p>

              {/* Detail bullets — specialization tags */}
              {Array.isArray(p.specializationTags) && p.specializationTags.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {[p.specializationTags.slice(0, 2), p.specializationTags.slice(2, 6)]
                    .filter((group) => group.length > 0)
                    .map((group, i) => (
                      <li key={i} className="flex gap-1.5 text-sm text-foreground/80">
                        <span className="text-muted-foreground">—</span>
                        <span className="truncate">
                          {group.slice(0, 2).join(", ")}
                          {group.length > 2 && <span className="text-primary font-medium"> +{group.length - 2}</span>}
                        </span>
                      </li>
                    ))}
                </ul>
              )}
            </div>

            {/* Location / mode column */}
            <div className="text-right shrink-0 space-y-1.5">
              {p.averageRating ? (
                <div className="flex items-center justify-end gap-1">
                  <Star size={13} className="text-amber-400 fill-amber-400" />
                  <span className="text-sm font-semibold text-foreground">{p.averageRating.toFixed(1)}</span>
                  <span className="text-xs text-muted-foreground">({p.totalRatings ?? 0})</span>
                </div>
              ) : null}
              {inPersonOnly ? (
                <p className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
                  <MapPin size={12} />In-person only
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Online</p>
              )}
              {(p.displayArea || p.city) && (
                <p className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
                  <MapPin size={12} />
                  {p.displayArea ?? p.city}{p.country && p.country !== "India" ? `, ${p.country}` : ""}
                </p>
              )}
            </div>
          </div>

          {/* Bio */}
          {p.bio && (
            <p className="text-sm text-muted-foreground line-clamp-2 mt-3">{p.bio}</p>
          )}

          {/* Meta row */}
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mt-3 pt-3 border-t border-border/50">
            <span className="flex items-center gap-1">
              <Clock size={12} />
              {p.yearsExperience} {p.yearsExperience === 1 ? "yr" : "yrs"} experience
            </span>
            {p.offersHomeVisits && (
              <span className="flex items-center gap-1">
                <Home size={12} />
                Home visits
              </span>
            )}
            {p.willingToTravel && p.travelRadiusKm && (
              <span className="flex items-center gap-1">
                <Navigation size={12} />
                Travels up to {p.travelRadiusKm}km
              </span>
            )}
            {distanceKm !== undefined && (
              <span className="flex items-center gap-1 text-primary font-medium">
                <Navigation size={12} />
                {distanceKm} km away
              </span>
            )}
            {(p.pricingMinINR || p.pricingMaxINR) && (
              <span className="flex items-center gap-1 text-green-700 font-medium">
                <IndianRupee size={12} />
                {p.pricingMinINR && p.pricingMaxINR
                  ? `₹${p.pricingMinINR.toLocaleString("en-IN")}–₹${p.pricingMaxINR.toLocaleString("en-IN")}`
                  : p.pricingMinINR
                    ? `From ₹${p.pricingMinINR.toLocaleString("en-IN")}`
                    : `Up to ₹${p.pricingMaxINR!.toLocaleString("en-IN")}`}
                {" "}/hour
              </span>
            )}
          </div>

          {/* CTA */}
          <div className="flex justify-end mt-3">
            <Link href={`/professionals/${p.id}`}>
              <Button size="sm" className="font-medium" data-testid={`view-profile-${p.id}`}>
                View Profile
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
