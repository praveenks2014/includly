import { useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import { CheckCircle2, ArrowRight, Search, Loader2, Phone, Mail, MapPin, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getApiBase } from "@/lib/api";
import { avatarSrc } from "@/components/ProfessionalAvatar";

interface ProfessionalSnapshot {
  fullName: string;
  avatarUrl: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  expiresAt: string | null;
}

interface SessionResult {
  status: string;
  plan: string;
  professionalId: number | null;
  isSubscriptionActive: boolean;
  unlockedProfessionalId: number | null;
  professional?: ProfessionalSnapshot | null;
}

async function verifyStripeSession(sessionId: string): Promise<SessionResult | null> {
  try {
    const res = await fetch(`${getApiBase()}/payments/stripe/session/${encodeURIComponent(sessionId)}`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    return (await res.json()) as SessionResult;
  } catch {
    return null;
  }
}

async function fetchUnlockSnapshot(professionalId: number): Promise<ProfessionalSnapshot | null> {
  try {
    const res = await fetch(`${getApiBase()}/payments/unlock-snapshot/${professionalId}`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    return (await res.json()) as ProfessionalSnapshot;
  } catch {
    return null;
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

function TeacherCard({
  professional,
  professionalId,
  plan,
}: {
  professional: ProfessionalSnapshot;
  professionalId: number;
  plan: string;
}) {
  const isPlanA = plan === "plan_a_subscription";

  return (
    <div className="mt-6 rounded-2xl border border-border bg-card p-5 text-left space-y-4 w-full">
      <div className="flex items-start gap-3">
        {professional.avatarUrl ? (
          <img
            src={avatarSrc(professional.avatarUrl)!}
            alt={professional.fullName}
            className="w-12 h-12 rounded-full object-cover shrink-0"
          />
        ) : (
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <span className="text-primary font-bold text-lg">
              {professional.fullName ? professional.fullName.charAt(0).toUpperCase() : "?"}
            </span>
          </div>
        )}
        <div>
          <p className="font-semibold text-foreground text-base leading-tight">{professional.fullName}</p>
          {professional.city && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
              <MapPin size={11} />
              {professional.city}
            </p>
          )}
        </div>
      </div>

      {(professional.phone || professional.email) && (
        <div className="space-y-2">
          {professional.phone && (
            <a
              href={`tel:${professional.phone}`}
              className="flex items-center gap-2 text-sm text-foreground hover:text-primary transition-colors"
            >
              <Phone size={14} className="text-primary shrink-0" />
              <span>{professional.phone}</span>
            </a>
          )}
          {professional.email && (
            <a
              href={`mailto:${professional.email}`}
              className="flex items-center gap-2 text-sm text-foreground hover:text-primary transition-colors"
            >
              <Mail size={14} className="text-primary shrink-0" />
              <span>{professional.email}</span>
            </a>
          )}
        </div>
      )}

      {isPlanA && professional.expiresAt && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          <Calendar size={13} className="shrink-0" />
          <span>Contact access expires on <strong>{formatDate(professional.expiresAt)}</strong></span>
        </div>
      )}

      <Link href={`/professionals/${professionalId}`}>
        <Button className="w-full gap-2 mt-1" data-testid="go-profile-btn">
          <ArrowRight size={15} />
          View this teacher's profile
        </Button>
      </Link>
    </div>
  );
}

export default function PaymentSuccessPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const sessionId = params.get("session_id");
  const planParam = params.get("plan") ?? "";
  const professionalIdParam = params.get("professionalId");

  const [verifying, setVerifying] = useState(!!sessionId);
  const [result, setResult] = useState<SessionResult | null>(null);
  const [snapshot, setSnapshot] = useState<ProfessionalSnapshot | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    verifyStripeSession(sessionId).then((r) => {
      setResult(r);
      setVerifying(false);
    });
  }, [sessionId]);

  const plan = result?.plan ?? planParam;
  const isSubscription = plan === "plan_a_subscription" || result?.isSubscriptionActive;
  const isContact = plan === "plan_b_per_contact" || !!result?.unlockedProfessionalId;
  const isFeatured = plan === "plan_c_featured";

  const unlockedProfId: number | null =
    result?.unlockedProfessionalId ??
    result?.professionalId ??
    (professionalIdParam ? parseInt(professionalIdParam, 10) : null);

  const resolvedSnapshot: ProfessionalSnapshot | null = result?.professional ?? snapshot ?? null;

  const showTeacherCard = (isSubscription || isContact) && unlockedProfId && resolvedSnapshot;

  useEffect(() => {
    if (!unlockedProfId) return;
    if (result?.professional) return;
    if (snapshot) return;
    if (verifying) return;
    setSnapshotLoading(true);
    fetchUnlockSnapshot(unlockedProfId).then((s) => {
      setSnapshot(s);
      setSnapshotLoading(false);
    });
  }, [unlockedProfId, verifying, snapshot, result?.professional]);

  const isGeneralSubscription = isSubscription && !unlockedProfId;

  let title = "Payment successful!";
  let message = "Thank you for your purchase.";

  if (isGeneralSubscription) {
    title = "Subscription activated!";
    message = "Your 30-day shadow teacher access is now active. Browse and unlock up to 5 shadow teacher profiles.";
  } else if (isSubscription || isContact) {
    const firstName = resolvedSnapshot?.fullName?.split(" ")[0];
    title = "Contact unlocked!";
    message = isSubscription
      ? firstName
        ? `You now have 30-day access to ${firstName}'s contact details. Reach out directly using the information below.`
        : "You now have 30-day access to this teacher's contact details."
      : firstName
        ? `You can now view ${firstName}'s full contact details below.`
        : "You can now view the full contact details of this specialist.";
  } else if (isFeatured) {
    title = "You're now featured!";
    message = "Your profile will appear at the top of search results for the next 30 days.";
  }

  if (verifying || snapshotLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="text-center">
          <Loader2 className="animate-spin text-primary mx-auto mb-4" size={36} />
          <p className="text-muted-foreground">Confirming your payment…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
      <div className="max-w-md w-full text-center">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 size={40} className="text-green-600" />
        </div>
        <h1 className="text-2xl font-serif font-bold text-foreground mb-3">{title}</h1>
        <p className="text-muted-foreground mb-2">{message}</p>

        {isGeneralSubscription && (
          <div className="mt-6 rounded-2xl border border-primary/30 bg-primary/5 p-5 text-left space-y-3">
            <p className="text-sm font-medium text-foreground">What's included in your subscription:</p>
            <ul className="text-sm text-muted-foreground space-y-1.5">
              <li className="flex items-center gap-2">
                <CheckCircle2 size={14} className="text-green-600 shrink-0" />
                Unlock and view contact details for up to 5 shadow teachers
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 size={14} className="text-green-600 shrink-0" />
                30 days of access starting from today
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 size={14} className="text-green-600 shrink-0" />
                Direct phone &amp; email access to each teacher
              </li>
            </ul>
          </div>
        )}

        {showTeacherCard && unlockedProfId && resolvedSnapshot ? (
          <TeacherCard
            professional={resolvedSnapshot}
            professionalId={unlockedProfId}
            plan={plan}
          />
        ) : null}

        <div className="flex flex-col sm:flex-row gap-3 justify-center mt-6">
          {isFeatured ? (
            <Link href="/dashboard">
              <Button className="gap-2 w-full sm:w-auto" data-testid="go-dashboard-btn">
                <ArrowRight size={16} />
                View dashboard
              </Button>
            </Link>
          ) : null}
          {isGeneralSubscription ? (
            <Link href="/search?specialty=shadow_teacher">
              <Button className="gap-2 w-full sm:w-auto" data-testid="go-search-btn">
                <Search size={16} />
                Browse shadow teachers
              </Button>
            </Link>
          ) : null}
          {!isSubscription && !isContact && !isFeatured ? (
            <Link href="/search">
              <Button className="gap-2 w-full sm:w-auto" data-testid="go-search-btn">
                <Search size={16} />
                Find specialists
              </Button>
            </Link>
          ) : null}
          {(isSubscription || isContact) && !showTeacherCard && !isGeneralSubscription ? (
            <Link href="/search">
              <Button className="gap-2 w-full sm:w-auto" data-testid="go-search-btn">
                <Search size={16} />
                Find specialists
              </Button>
            </Link>
          ) : null}
          <Link href="/dashboard">
            <Button variant="outline" className="w-full sm:w-auto">Go to dashboard</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
