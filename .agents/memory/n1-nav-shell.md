---
name: N1 nav shell architecture
description: Routing layout decisions from the N1 navigation pass — what was built, key constraints, and what N2 must change.
---

## What was built

`src/nav/config.ts` — single source of truth: `NavItem[]` per role, `SHELL_ROOT` map, `isShellPath()` predicate.

`AppShell` = `flex h-dvh flex-col` with `TopBar` (h-14, sticky) + `flex-1 min-h-0` row containing `SideNav` (hidden md:flex, w-56) + `<main overflow-y-auto>` + `BottomNav` (md:hidden, h-16 in flow, not fixed).

Guards: `RequireRole` reads `me?.role`, redirects to `SHELL_ROOT[role]` on mismatch. `RequireChildProfile` is a pass-through stub until V2 Phase 1.

## Route → tab mapping (N1)

| URL | Dashboard prop |
|-----|---------------|
| `/home` | `ParentDashboard initialTab="home"` |
| `/explore` | `ParentDashboard initialTab="find"` |
| `/bookings` | `ParentDashboard initialTab="bookings"` |
| `/inbox` | `ParentDashboard initialTab="messages"` |
| `/pro/today` | `ProfessionalDashboard initialTab="home"` |
| `/pro/calendar` | `ProfessionalDashboard initialTab="availability"` |
| `/pro/inbox` | `ProfessionalDashboard initialTab="messages"` |
| `/pro/earnings` | `ProfessionalDashboard initialTab="earnings"` |
| `/centre/overview` | `CentreDashboard initialTab="overview"` |
| `/centre/roster` | `CentreDashboard initialTab="therapists"` |
| `/centre/services` | `CentreDashboard initialTab="services"` |

Stub pages (no existing content): `/journey`, `/pro/clients`, `/onboarding/child`.

## Key constraints

**Why double-nav in N1:** The three dashboard components own their own internal sidebar/bottom-nav. N1 adds the AppShell chrome on top without touching page internals ("mount without redesigning"). N2 removes the internal navbars and makes each route render only its panel content.

**Why BottomNav is in-flow (not fixed):** AppShell uses `flex flex-col h-dvh` so BottomNav as a flex child naturally sits at the bottom without overlapping content. No `pb-16` needed on main.

**Legacy redirect map:** `/dashboard` → `LegacyDashboardRedirect` (reads role, replace-navigates to `SHELL_ROOT[role]`). Simple static rewrites: `/choose-role`→`/onboarding`, `/onboard`→`/onboarding/pro`, `/centre-dashboard`→`/centre/overview`, `/availability`→`/pro/calendar`, `/engagements`→`/pro/clients`, `/professionals/:id`→`/p/:id`.

**`dashboard.tsx` is now dead code** — no longer imported in App.tsx. Keep until N2 cleanup.

## What N2 must do

- Remove the internal sidebar/bottom-nav from `ParentDashboard`, `ProfessionalDashboard`, `CentreDashboard`
- Each URL renders only the panel content (not the full tabbed component)
- Add per-tab scroll restoration (context keyed by tab root)
- Wire badge counts (unreadMessages, pendingRequests) from React Query into `NavItem.badge`
- Child switcher in TopBar → real data from `GET /api/children` (V2 Phase 1 dependency)
- Centre `/centre/bookings` and `/centre/inbox` need real tabs added to CentreDashboard
