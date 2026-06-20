---
name: Parent hub-and-tabs IA
description: How the parent-side navigation is structured (primary tabs, secondary mobileHidden items, route redirects).
---

# Parent hub-and-tabs IA

Parent navigation is a hub-and-tabs information architecture defined in
`artifacts/sensei-link/src/nav/config.ts` (`NAV.parent`):

- **Primary** (always visible — bottom nav on mobile, side nav on desktop):
  Home, Services, Progress, Inbox.
- **Secondary** (`mobileHidden: true` — desktop side nav under a divider; mobile
  "More" sheet in `BottomNav.tsx`): Community, Resources, Ask Includly. The mobile
  More sheet also surfaces Child Profile → `/children/${selectedChildId}/edit`.

Routing lives in `App.tsx`:
- New routes: `/services`, `/progress` (ParentShell>AppShell>ParentDashboard),
  `/community` (ForumPage), `/ask` (ComingSoon).
- Redirects: `/explore` → `/services`, `/journey` → `/progress`.
- `/resources` is wrapped in AuthShell and added to `Layout`'s signed-in
  navbar-hide special case.

**Why:** This was an IA + routing-only restructure (no restyle, no behavior change
to underlying flows). The Services tab is a chooser (Shadow Teacher → /shadow-teacher;
specialists/coach → in-shell FindTab; Therapy Centre + Tutor → ComingSoon). The
Progress tab finds the active engagement (parent-engagements + selectedChildId) and
reuses the shared `EngagementProgress` component — same logs/goals/trends surface as
the shadow-teacher workspace, with identical childId query-key scoping.

**How to apply:** Add new parent destinations to `NAV.parent` (+ SHELL_PREFIXES) and
wire the route in `App.tsx`. Secondary/low-traffic items get `mobileHidden: true`.
Do not duplicate the logs/goals/trends UI — reuse `EngagementProgress`.
