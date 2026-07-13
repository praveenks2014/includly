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
    tab("Inbox", MessageSquare, "/inbox", "unreadMessages"),
    { ...tab("Community", Users, "/community"), mobileHidden: true },
    { ...tab("Resources", BookOpen, "/resources"), mobileHidden: true, comingSoon: true },
    { ...tab("Ask Includly", Sparkles, "/ask"), mobileHidden: true, comingSoon: true },
  ],
  professional: [
    tab("Today", LayoutDashboard, "/pro/today", "pendingRequests"),
    tab("Calendar", CalendarDays, "/pro/calendar"),
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
  "/community",
  "/ask",
  "/account",
  "/pro/",
  "/centre/",
  "/onboarding",
];

export function isShellPath(loc: string): boolean {
  return SHELL_PREFIXES.some((p) => loc === p || loc.startsWith(p));
}
