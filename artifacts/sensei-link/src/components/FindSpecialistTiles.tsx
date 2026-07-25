import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  GraduationCap,
  NotebookPen,
  Stethoscope,
  Brain,
  Baby,
  Activity,
  Building2,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { fetchWithAuth } from "@/lib/api";
import { useSelectedChild } from "@/contexts/SelectedChildContext";
import { ComingSoon } from "@/components/ComingSoon";
import {
  SHOW_TUTOR_SEARCH,
  SHOW_THERAPIST_SEARCH,
  SHOW_CONSULTATION_TILES,
  SHOW_COACH_TILE,
} from "@/features";

type DotState = "active" | "pending" | "none";

interface EngagementRow {
  status: string;
  childId: number | null;
}

const ACTIVE_STATUSES = ["active", "notice_period", "paused"];
const PENDING_STATUSES = ["pending_start", "pending_activation_fee", "pending_teacher_acceptance"];

function deriveDot(engagements: EngagementRow[], childId: number | null): DotState {
  const forChild = engagements.filter((e) => e.childId === childId);
  if (forChild.some((e) => ACTIVE_STATUSES.includes(e.status))) return "active";
  if (forChild.some((e) => PENDING_STATUSES.includes(e.status))) return "pending";
  return "none";
}

// GET /api/professionals/specialty-availability (commit 0b28b15) has no
// generated hook yet — same ad hoc useQuery+fetchWithAuth convention as
// SideNav.tsx's locally-duplicated useMyOfferings, not a gap to fill by
// regenerating orval output for one endpoint.
function useSpecialtyAvailability() {
  return useQuery<{ counts: Record<string, number> }>({
    queryKey: ["specialty-availability"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/professionals/specialty-availability");
      if (!res.ok) throw new Error("Failed to fetch specialty availability");
      return res.json();
    },
    staleTime: 60_000,
  });
}

interface ComingSoonInfo {
  icon: LucideIcon;
  title: string;
  description: string;
}

interface TileConfig {
  key: string;
  label: string;
  mobileLabel?: string;
  icon: LucideIcon;
  iconClass: string;
  dot: DotState;
  onClick: () => void;
}

export function FindSpecialistTiles() {
  const [, setLocation] = useLocation();
  const { selectedChildId } = useSelectedChild();
  const [comingSoon, setComingSoon] = useState<ComingSoonInfo | null>(null);

  // Shadow Teacher — reuses the exact same query key/endpoint
  // ShadowTeacherTab already fetches elsewhere on this page, so react-query
  // dedupes this instead of firing a second identical request.
  const { data: stEngagements = [] } = useQuery<EngagementRow[]>({
    queryKey: ["parent-engagements"],
    queryFn: () => fetchWithAuth("/api/engagements").then((r) => r.json()),
    staleTime: 20_000,
  });
  const shadowDot = deriveDot(stEngagements, selectedChildId);

  // Tutor / Therapist — only queried when their flag is on; the backend
  // 404s these routes entirely while the flag is off (app.ts's gate), so
  // there's nothing to fetch until then.
  const { data: tutorEngagements = [] } = useQuery<EngagementRow[]>({
    queryKey: ["parent-tutor-engagements"],
    queryFn: () => fetchWithAuth("/api/tutor/engagements").then((r) => r.json()),
    staleTime: 20_000,
    enabled: SHOW_TUTOR_SEARCH,
  });
  const tutorDot = SHOW_TUTOR_SEARCH ? deriveDot(tutorEngagements, selectedChildId) : "none";

  const { data: therapistEngagements = [] } = useQuery<EngagementRow[]>({
    queryKey: ["parent-therapist-engagements"],
    queryFn: () => fetchWithAuth("/api/therapist/engagements").then((r) => r.json()),
    staleTime: 20_000,
    enabled: SHOW_THERAPIST_SEARCH,
  });
  const therapistDot = SHOW_THERAPIST_SEARCH ? deriveDot(therapistEngagements, selectedChildId) : "none";

  // Consultation (Psychiatrist/Dev Ped/Neurologist) and Inclusive Coach have
  // no "engagement" concept at all — one-off session bookings, no match/
  // relationship table — so there is nothing to query for their dot state.
  // Always "none" by design, not because a query was skipped.

  const { data: availability } = useSpecialtyAvailability();
  const counts = availability?.counts ?? {};

  function goToSearch(specialty: string) {
    setLocation(`/search?specialty=${specialty}`);
  }

  const tiles: TileConfig[] = [
    {
      key: "shadow_teacher",
      label: "Shadow Teacher",
      icon: GraduationCap,
      iconClass: "text-blue-600 bg-blue-50",
      dot: shadowDot,
      onClick: () => setLocation("/shadow-teacher"),
    },
    {
      key: "home_tutor",
      label: "Home Tutor",
      icon: NotebookPen,
      iconClass: "text-lime-600 bg-lime-50",
      dot: tutorDot,
      onClick: () =>
        SHOW_TUTOR_SEARCH
          ? setLocation("/tutor-search")
          : setComingSoon({
              icon: NotebookPen,
              title: "Home Tutors coming soon",
              description: "Find patient, special-needs-aware tutors for academic support at home. This service is on the way.",
            }),
    },
    {
      key: "therapist",
      label: "Therapist",
      icon: Stethoscope,
      iconClass: "text-pink-600 bg-pink-50",
      dot: therapistDot,
      onClick: () =>
        SHOW_THERAPIST_SEARCH
          ? setLocation("/therapist-search")
          : setComingSoon({
              icon: Stethoscope,
              title: "Therapist matching coming soon",
              description: "Get matched with a verified, RCI-registered therapist across OT, speech, ABA, and more.",
            }),
    },
    {
      key: "psychiatrist",
      label: "Psychiatrist",
      icon: Brain,
      iconClass: "text-indigo-600 bg-indigo-50",
      dot: "none",
      onClick: () =>
        SHOW_CONSULTATION_TILES && (counts["psychiatrist"] ?? 0) > 0
          ? goToSearch("psychiatrist")
          : setComingSoon({
              icon: Brain,
              title: "Psychiatrist consultations coming soon",
              description: "Book a consultation with a verified psychiatrist. This category isn't open yet.",
            }),
    },
    {
      key: "developmental_pediatrician",
      label: "Developmental Pediatrician",
      mobileLabel: "Dev. Pediatrician",
      icon: Baby,
      iconClass: "text-emerald-600 bg-emerald-50",
      dot: "none",
      onClick: () =>
        SHOW_CONSULTATION_TILES && (counts["developmental_pediatrician"] ?? 0) > 0
          ? goToSearch("developmental_pediatrician")
          : setComingSoon({
              icon: Baby,
              title: "Developmental Pediatrician consultations coming soon",
              description: "Book a consultation with a verified developmental pediatrician. This category isn't open yet.",
            }),
    },
    {
      key: "neurologist",
      label: "Neurologist",
      icon: Activity,
      iconClass: "text-purple-600 bg-purple-50",
      dot: "none",
      onClick: () =>
        SHOW_CONSULTATION_TILES && (counts["neurologist"] ?? 0) > 0
          ? goToSearch("neurologist")
          : setComingSoon({
              icon: Activity,
              title: "Neurologist consultations coming soon",
              description: "Book a consultation with a verified neurologist. This category isn't open yet.",
            }),
    },
    {
      key: "therapy_centre",
      label: "Therapy Centre",
      icon: Building2,
      iconClass: "text-rose-600 bg-rose-50",
      dot: "none",
      onClick: () =>
        setComingSoon({
          icon: Building2,
          title: "Therapy Centres coming soon",
          description: "Browse and book verified therapy centres near you — occupational, speech, behavioural and more. We're onboarding centres now.",
        }),
    },
    {
      key: "coaching",
      label: "Inclusive Coach",
      icon: Trophy,
      iconClass: "text-orange-600 bg-orange-50",
      dot: "none",
      onClick: () =>
        SHOW_COACH_TILE && (counts["coaching"] ?? 0) > 0
          ? goToSearch("coaching")
          : setComingSoon({
              icon: Trophy,
              title: "Inclusive Coach booking coming soon",
              description: "Find a coach for swimming, dance, music, sports, and more. This category isn't open yet.",
            }),
    },
  ];

  if (comingSoon) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => setComingSoon(null)}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-teal-600 transition-colors"
        >
          <ArrowLeft size={14} /> Back
        </button>
        <ComingSoon icon={comingSoon.icon} accent="amber" title={comingSoon.title} description={comingSoon.description} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Single breakpoint at lg: 4-across (2 rows) below 1024px, 8-across
          at 1024px+ — wraps, never horizontal-scrolls, at 1280/768/375. */}
      <div className="grid grid-cols-4 lg:grid-cols-8 gap-2">
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={t.onClick}
              className="relative bg-white border border-gray-100 rounded-2xl p-3 pt-3.5 flex flex-col items-center gap-1.5 text-center hover:shadow-md hover:border-gray-200 transition-all"
            >
              {t.dot !== "none" && (
                <span
                  className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ring-2 ring-white ${
                    t.dot === "active" ? "bg-emerald-500" : "bg-amber-500"
                  }`}
                />
              )}
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${t.iconClass}`}>
                <Icon size={16} />
              </div>
              <span className="text-[10px] font-bold text-[#1A2340] leading-tight">
                <span className="lg:hidden">{t.mobileLabel ?? t.label}</span>
                <span className="hidden lg:inline">{t.label}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-400">
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Active engagement
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Request in progress
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-gray-300" /> No relationship yet
        </span>
      </div>
    </div>
  );
}
