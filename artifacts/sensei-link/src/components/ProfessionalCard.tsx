import { Link } from "wouter";
import { BadgeCheck, Clock, MapPin, Star, Navigation, IndianRupee } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getSpecialtyLabel, SPECIALTY_COLORS } from "@/lib/specialties";

interface Professional {
  id: number;
  fullName?: string | null;
  specialty: string;
  bio?: string | null;
  yearsExperience: number;
  city?: string | null;
  country?: string | null;
  travelRadiusKm?: number | null;
  willingToTravel?: boolean;
  isVerified: boolean;
  verificationStatus: string;
  averageRating?: number | null;
  totalRatings?: number;
  phoneBlurred?: string | null;
  emailBlurred?: string | null;
  phone?: string | null;
  email?: string | null;
  isUnlocked?: boolean;
  pricingMinINR?: number | null;
  pricingMaxINR?: number | null;
  paymentActivated?: boolean;
  isPremium?: boolean;
  specializationTags?: string[] | null;
}

interface ProfessionalCardProps {
  professional: Professional;
  onUnlock?: (id: number) => void;
  unlocking?: boolean;
  distanceKm?: number;
}

export function ProfessionalCard({ professional: p, onUnlock, unlocking, distanceKm }: ProfessionalCardProps) {
  const specialtyColor = SPECIALTY_COLORS[p.specialty] ?? "bg-gray-100 text-gray-800";
  const phone = p.isUnlocked ? p.phone : p.phoneBlurred;
  const email = p.isUnlocked ? p.email : p.emailBlurred;

  return (
    <Card className="hover:shadow-md transition-shadow duration-200 border-border">
      <CardContent className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Link href={`/professionals/${p.id}`} className="hover:underline">
                <h3 className="font-semibold text-foreground text-base leading-tight truncate">
                  {p.fullName ?? "Professional"}
                </h3>
              </Link>
              {p.isVerified && p.verificationStatus === "verified" && (
                <BadgeCheck size={16} className="text-primary shrink-0" />
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
            <span className={`inline-block mt-1 text-xs font-medium px-2.5 py-0.5 rounded-full ${specialtyColor}`}>
              {getSpecialtyLabel(p.specialty)}
            </span>
          </div>
          {p.averageRating ? (
            <div className="flex items-center gap-1 shrink-0">
              <Star size={14} className="text-yellow-400 fill-yellow-400" />
              <span className="text-sm font-semibold text-foreground">{p.averageRating.toFixed(1)}</span>
              <span className="text-xs text-muted-foreground">({p.totalRatings ?? 0})</span>
            </div>
          ) : null}
        </div>

        {/* Bio */}
        {p.bio && (
          <p className="text-sm text-muted-foreground line-clamp-2 mb-2">{p.bio}</p>
        )}

        {/* Specialization tags */}
        {Array.isArray(p.specializationTags) && p.specializationTags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {p.specializationTags.slice(0, 4).map((tag) => (
              <span key={tag} className="px-2 py-0.5 rounded-full text-xs bg-primary/10 text-primary border border-primary/20">
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Meta */}
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mb-4">
          <span className="flex items-center gap-1">
            <Clock size={12} />
            {p.yearsExperience} {p.yearsExperience === 1 ? "yr" : "yrs"} experience
          </span>
          {p.city && (
            <span className="flex items-center gap-1">
              <MapPin size={12} />
              {p.city}{p.country && p.country !== "India" ? `, ${p.country}` : ""}
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
              {" "}/session
            </span>
          )}
        </div>

        {/* Contact + CTA */}
        <div className="flex items-center justify-between gap-3 pt-3 border-t border-border/60">
          <div className="flex-1 min-w-0">
            {phone && (
              <p className={`text-xs font-mono ${p.isUnlocked ? "text-foreground" : "text-muted-foreground/60 tracking-widest"}`}>
                {phone}
              </p>
            )}
            {email && (
              <p className={`text-xs font-mono truncate ${p.isUnlocked ? "text-foreground" : "text-muted-foreground/60 tracking-widest"}`}>
                {email}
              </p>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <Link href={`/professionals/${p.id}`}>
              <Button variant="outline" size="sm" data-testid={`view-profile-${p.id}`}>
                View profile
              </Button>
            </Link>
            {!p.isUnlocked && onUnlock && (
              <Button
                size="sm"
                onClick={() => onUnlock(p.id)}
                disabled={unlocking}
                data-testid={`unlock-btn-${p.id}`}
              >
                {unlocking ? "Unlocking..." : "Unlock"}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
