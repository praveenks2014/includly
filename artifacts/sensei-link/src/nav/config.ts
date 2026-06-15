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
    tab("Explore", Search, "/explore"),
    tab("Bookings", CalendarDays, "/bookings"),
    tab("Journey", LineChart, "/journey"),
    tab("Inbox", MessageSquare, "/inbox", "unreadMessages"),
  ],
  professional: [
    tab("Today", LayoutDashboard, "/pro/today", "pendingRequests"),
    tab("Calendar", CalendarDays, "/pro/calendar"),
    tab("Clients", Users, "/pro/clients"),
    tab("Inbox", MessageSquare, "/pro/inbox", "unreadMessages"),
    tab("Earnings", Wallet, "/pro/earnings"),
    tab("Enquiries", Inbox, "/pro/enquiries", undefined, "shadow_teacher"),
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
  "/bookings",
  "/journey",
  "/inbox",
  "/shadow-teacher",
  "/account",
  "/pro/",
  "/centre/",
  "/onboarding",
];

export function isShellPath(loc: string): boolean {
  return SHELL_PREFIXES.some((p) => loc === p || loc.startsWith(p));
}
