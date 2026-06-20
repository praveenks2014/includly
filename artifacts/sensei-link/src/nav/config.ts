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
} from "lucide-react";

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
    { ...tab("Resources", BookOpen, "/resources"), mobileHidden: true },
    { ...tab("Ask Includly", Sparkles, "/ask"), mobileHidden: true },
  ],
  professional: [
    tab("Today", LayoutDashboard, "/pro/today", "pendingRequests"),
    tab("Calendar", CalendarDays, "/pro/calendar"),
    tab("Clients", Users, "/pro/clients"),
    tab("Inbox", MessageSquare, "/pro/inbox", "unreadMessages"),
    tab("Earnings", Wallet, "/pro/earnings"),
    tab("Enquiries", Inbox, "/pro/enquiries", undefined, "shadow_teacher"),
    tab("Engagement", BookOpen, "/pro/engagement", undefined, "shadow_teacher"),
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
