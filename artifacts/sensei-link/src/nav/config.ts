import type { LucideIcon } from "lucide-react";
import {
  Home,
  Search,
  CalendarDays,
  LineChart,
  MessageSquare,
  LayoutDashboard,
  Users,
  Wallet,
  Layers,
  Inbox,
  BookOpen,
  Sparkles,
  ClipboardList,
  CalendarCheck,
} from "lucide-react";
import { SHOW_TUTOR_SEARCH, SHOW_THERAPIST_SEARCH } from "@/features";

export type Role = "parent" | "professional" | "centre_admin" | "admin";

export type BadgeKey = "unreadMessages" | "pendingRequests";

export interface NavItem {
  label: string;
  icon: LucideIcon;
  path: string;
  match: (loc: string) => boolean;
  badge?: BadgeKey;
  specialtyFilter?: string;
  /** Hidden from the mobile bottom bar's primary slots; surfaced via the "More" sheet instead. */
  mobileHidden?: boolean;
  /** Renders as a disabled "Coming soon" item instead of a navigable link. */
  comingSoon?: boolean;
}

function tab(
  label: string,
  icon: LucideIcon,
  path: string,
  badge?: BadgeKey,
  specialtyFilter?: string,
): NavItem {
  return {
    label,
    icon,
    path,
    match: (loc) => loc === path || loc.startsWith(path + "/"),
    badge,
    specialtyFilter,
  };
}

export const NAV: Record<Exclude<Role, "admin">, NavItem[]> = {
  parent: [
    tab("Home", Home, "/home"),
    tab("Services", Layers, "/services"),
    tab("Progress", LineChart, "/progress"),
    tab("Bookings", CalendarCheck, "/bookings"),
    tab("Inbox", MessageSquare, "/inbox", "unreadMessages"),
    { ...tab("Community", Users, "/community"), mobileHidden: true },
    { ...tab("Resources", BookOpen, "/resources"), mobileHidden: true, comingSoon: true },
    { ...tab("Ask Includly", Sparkles, "/ask"), mobileHidden: true, comingSoon: true },
  ],
  professional: [
    tab("Today", LayoutDashboard, "/pro/today", "pendingRequests"),
    tab("Calendar", CalendarDays, "/pro/calendar"),
    // Confirm/reject one-off session bookings (assessments, tutor/therapist
    // interview sessions, consultation/coach bookings) — BookingsTab already
    // existed but had no route or nav entry pointing at it at all.
    tab("Bookings", CalendarCheck, "/pro/bookings"),
    { ...tab("Clients", Users, "/pro/clients"), comingSoon: true },
    tab("Inbox", MessageSquare, "/pro/inbox", "unreadMessages"),
    tab("Earnings", Wallet, "/pro/earnings"),
    tab("Enquiries", Inbox, "/pro/enquiries", undefined, "shadow_teacher"),
    tab("Engagement", BookOpen, "/pro/engagement", undefined, "shadow_teacher"),
    // No specialtyFilter — a professional's tutor/therapist involvement may
    // be an ADDITIONAL offering, not their primary specialty, so the
    // existing specialtyFilter (primary-specialty-only) can't gate this.
    // VerticalRequestsTab itself checks GET /professionals/me/offerings and
    // renders nothing if the professional holds neither vertical.
    ...(SHOW_TUTOR_SEARCH || SHOW_THERAPIST_SEARCH
      ? [tab("Requests", ClipboardList, "/pro/vertical-requests")]
      : []),
  ],
  centre_admin: [
    tab("Overview", LayoutDashboard, "/centre/overview"),
    tab("Bookings", CalendarCheck, "/centre/bookings"),
    tab("Roster", Users, "/centre/roster"),
    tab("Services", Layers, "/centre/services"),
  ],
};

export const SHELL_ROOT: Record<Role, string> = {
  parent: "/home",
  professional: "/pro/today",
  centre_admin: "/centre/overview",
  admin: "/admin",
};

export const SHELL_PREFIXES = [
  "/home",
  "/explore",
  "/services",
  "/bookings",
  "/journey",
  "/progress",
  "/inbox",
  "/shadow-teacher",
  "/tutor-search",
  "/therapist-search",
  "/community",
  "/ask",
  "/account",
  "/children",
  "/pro/",
  "/centre/",
  "/onboarding",
  // "/p/" (trailing slash) — not "/p" — to avoid matching /pricing, /pro/*,
  // /progress. This is the canonical professional-profile URL (search
  // results, candidate cards, and the /professionals/:id legacy redirect
  // all land here), previously missing the same way /search was.
  "/p/",
  "/search",
  // AdminPage renders its own bespoke full-page layout (no AppShell — see
  // App.tsx's "existing layout — no AppShell" comment) — this entry only
  // suppresses the marketing Navbar for /admin, same as everywhere else in
  // this list; it does not force AppShell, since isShellPath/hideNav and
  // AppShell wrapping are decoupled (Layout only ever renders {children}
  // as App.tsx's route composed it).
  "/admin",
  // /forum is RequireAuth-gated (signed-in only, not public) but has no
  // Navbar/AppShell/AuthShell of its own and wasn't covered by Layout's
  // signed-in exception either (that one only names /support and
  // /resources) — found while auditing this exact gap, same bug.
  "/forum",
];

export function isShellPath(loc: string): boolean {
  return SHELL_PREFIXES.some((p) => loc === p || loc.startsWith(p));
}

// Paths where a signed-in user seeing the marketing Navbar instead of shell
// chrome is a deliberate, reviewed choice — genuine public/marketing/
// transactional pages — not a routing gap. Used only by App.tsx's dev-mode
// tripwire inside Layout: any path a signed-in user reaches that's in
// NEITHER this list NOR SHELL_PREFIXES/HIDE_NAVBAR_PATHS trips a console
// warning, so a future route can't
// silently fall through this gap the way /search, /p/:id, /admin, /forum,
// and /choose-role all did. "/" needs exact match (every path starts with
// "/", so prefix-matching it would defeat the whole check).
const PUBLIC_EVEN_WHEN_SIGNED_IN_EXACT = ["/"];
const PUBLIC_EVEN_WHEN_SIGNED_IN_PREFIXES = [
  "/pricing",
  "/about",
  "/privacy",
  "/terms",
  "/payment/success",
  "/payment/cancel",
];
export function isKnownPublicPath(loc: string): boolean {
  return (
    PUBLIC_EVEN_WHEN_SIGNED_IN_EXACT.includes(loc) ||
    PUBLIC_EVEN_WHEN_SIGNED_IN_PREFIXES.some((p) => loc.startsWith(p))
  );
}
