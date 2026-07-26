// Single source of truth for the 8 Find-a-Specialist categories — static
// metadata (label/icon/tint/description) plus a shared hook resolving each
// category's live state (dot/coming-soon/destination). Both
// FindSpecialistTiles (grid) and ServiceCategoryList (list) consume this
// and render its output; neither should independently re-derive any of
// this logic — that's exactly the drift that caused the two UIs to fall
// out of sync with each other in the first place.
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
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
import {
  SHOW_TUTOR_SEARCH,
  SHOW_THERAPIST_SEARCH,
  SHOW_CONSULTATION_TILES,
  SHOW_COACH_TILE,
} from "@/features";

export type DotState = "active" | "pending" | "none";

export interface ComingSoonInfo {
  icon: LucideIcon;
  title: string;
  description: string;
}

export interface ServiceCategoryMeta {
  key: string;
  label: string;
  mobileLabel?: string;
  description: string;
  icon: LucideIcon;
  iconClass: string;
}

export const SERVICE_CATEGORIES: ServiceCategoryMeta[] = [
  {
    key: "shadow_teacher",
    label: "Shadow Teacher",
    description: "Get matched with a verified shadow teacher for your child",
    icon: GraduationCap,
    iconClass: "text-blue-600 bg-blue-50",
  },
  {
    key: "home_tutor",
    label: "Home Tutor",
    description: "Academic support tailored for your child",
    icon: NotebookPen,
    iconClass: "text-lime-600 bg-lime-50",
  },
  {
    key: "therapist",
    label: "Therapist",
    description: "OT, speech, ABA, and more — get matched with a verified therapist",
    icon: Stethoscope,
    iconClass: "text-pink-600 bg-pink-50",
  },
  {
    key: "psychiatrist",
    label: "Psychiatrist",
    description: "Book a consultation with a verified psychiatrist",
    icon: Brain,
    iconClass: "text-indigo-600 bg-indigo-50",
  },
  {
    key: "developmental_pediatrician",
    label: "Developmental Pediatrician",
    mobileLabel: "Dev. Pediatrician",
    description: "Book a consultation with a verified developmental pediatrician",
    icon: Baby,
    iconClass: "text-emerald-600 bg-emerald-50",
  },
  {
    key: "neurologist",
    label: "Neurologist",
    description: "Book a consultation with a verified neurologist",
    icon: Activity,
    iconClass: "text-purple-600 bg-purple-50",
  },
  {
    key: "therapy_centre",
    label: "Therapy Centre",
    description: "Centre-based programmes near you",
    icon: Building2,
    iconClass: "text-rose-600 bg-rose-50",
  },
  {
    key: "coaching",
    label: "Inclusive Coach",
    description: "Swimming, dance, music, sports, and more",
    icon: Trophy,
    iconClass: "text-orange-600 bg-orange-50",
  },
];

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

export interface ResolvedServiceCategory extends ServiceCategoryMeta {
  dot: DotState;
  // Whether this category is actually reachable right now (flag on AND, for
  // consultation/coach categories, a verified professional exists). Purely
  // informational — lets a component show an upfront "Coming soon" badge
  // without needing to click first. Derived from the exact same condition
  // onClick uses below, not a separate/duplicated check.
  isLive: boolean;
  // Takes the CALLER's own local "show this ComingSoon panel" setter — the
  // decision of whether to navigate or show coming-soon lives here, once;
  // how a component displays coming-soon (inline replace, etc.) is the only
  // thing left to the caller, and that's just local UI state, not logic
  // about category state.
  onClick: (showComingSoon: (info: ComingSoonInfo) => void) => void;
}

export type ServiceCategoryViewMode = "tiles" | "list";

export function useServiceCategoryStatus(viewMode: ServiceCategoryViewMode): ResolvedServiceCategory[] {
  const [, setLocation] = useLocation();
  const { selectedChildId } = useSelectedChild();

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

  const dots: Record<string, DotState> = {
    shadow_teacher: shadowDot,
    home_tutor: tutorDot,
    therapist: therapistDot,
    psychiatrist: "none",
    developmental_pediatrician: "none",
    neurologist: "none",
    therapy_centre: "none",
    coaching: "none",
  };

  // Single source of truth per category: isLive decides BOTH whether a
  // click navigates (vs. shows coming-soon) and whether a component wants
  // to show an upfront "coming soon" indicator before the click even
  // happens — computed once here, not as two conditions that could drift
  // apart from each other.
  type CategoryResolution = { isLive: boolean; navigate: () => void; comingSoon: ComingSoonInfo };
  const resolutions: Record<string, CategoryResolution> = {
    shadow_teacher: {
      isLive: true,
      // List View keeps the pre-existing page-navigation behavior;
      // Icon Grid expands inline on /services. Same category, same
      // isLive/dot/comingSoon — only the destination differs by mode.
      navigate: () =>
        setLocation(viewMode === "list" ? "/shadow-teacher" : "/services?open=shadow_teacher"),
      comingSoon: { icon: GraduationCap, title: "", description: "" }, // never reached, isLive is always true
    },
    home_tutor: {
      isLive: SHOW_TUTOR_SEARCH,
      navigate: () =>
        setLocation(viewMode === "list" ? "/tutor-search" : "/services?open=home_tutor"),
      comingSoon: {
        icon: NotebookPen,
        title: "Home Tutors coming soon",
        description: "Find patient, special-needs-aware tutors for academic support at home. This service is on the way.",
      },
    },
    therapist: {
      isLive: SHOW_THERAPIST_SEARCH,
      navigate: () =>
        setLocation(viewMode === "list" ? "/therapist-search" : "/services?open=therapist"),
      comingSoon: {
        icon: Stethoscope,
        title: "Therapist matching coming soon",
        description: "Get matched with a verified, RCI-registered therapist across OT, speech, ABA, and more.",
      },
    },
    psychiatrist: {
      isLive: SHOW_CONSULTATION_TILES && (counts["psychiatrist"] ?? 0) > 0,
      // List View goes straight to search results, unchanged; Icon Grid
      // expands the consultation mini-form inline first (same /services?open=
      // mechanism as shadow_teacher/home_tutor/therapist above).
      navigate: () =>
        viewMode === "list" ? goToSearch("psychiatrist") : setLocation("/services?open=psychiatrist"),
      comingSoon: {
        icon: Brain,
        title: "Psychiatrist consultations coming soon",
        description: "Book a consultation with a verified psychiatrist. This category isn't open yet.",
      },
    },
    developmental_pediatrician: {
      isLive: SHOW_CONSULTATION_TILES && (counts["developmental_pediatrician"] ?? 0) > 0,
      navigate: () =>
        viewMode === "list"
          ? goToSearch("developmental_pediatrician")
          : setLocation("/services?open=developmental_pediatrician"),
      comingSoon: {
        icon: Baby,
        title: "Developmental Pediatrician consultations coming soon",
        description: "Book a consultation with a verified developmental pediatrician. This category isn't open yet.",
      },
    },
    neurologist: {
      isLive: SHOW_CONSULTATION_TILES && (counts["neurologist"] ?? 0) > 0,
      navigate: () =>
        viewMode === "list" ? goToSearch("neurologist") : setLocation("/services?open=neurologist"),
      comingSoon: {
        icon: Activity,
        title: "Neurologist consultations coming soon",
        description: "Book a consultation with a verified neurologist. This category isn't open yet.",
      },
    },
    therapy_centre: {
      isLive: false,
      navigate: () => {},
      comingSoon: {
        icon: Building2,
        title: "Therapy Centres coming soon",
        description: "Browse and book verified therapy centres near you — occupational, speech, behavioural and more. We're onboarding centres now.",
      },
    },
    coaching: {
      isLive: SHOW_COACH_TILE && (counts["coaching"] ?? 0) > 0,
      navigate: () => goToSearch("coaching"),
      comingSoon: {
        icon: Trophy,
        title: "Inclusive Coach booking coming soon",
        description: "Find a coach for swimming, dance, music, sports, and more. This category isn't open yet.",
      },
    },
  };

  return SERVICE_CATEGORIES.map((cat) => {
    const r = resolutions[cat.key];
    return {
      ...cat,
      dot: dots[cat.key] ?? "none",
      isLive: r.isLive,
      onClick: (showComingSoon: (info: ComingSoonInfo) => void) => {
        if (r.isLive) r.navigate();
        else showComingSoon(r.comingSoon);
      },
    };
  });
}
