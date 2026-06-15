---
name: Specialty-conditional nav items
description: How to show a nav item only to professionals with a specific specialty (e.g. shadow_teacher)
---

## The rule
Add `specialtyFilter?: string` to `NavItem` in `nav/config.ts`. Pass it as the 5th arg to `tab()`. SideNav and BottomNav filter out items where `item.specialtyFilter && proProfile?.specialty !== item.specialtyFilter`.

## How it works
Both nav components call `useGetMyProfessionalProfile({ query: { enabled: role === "professional" } })`. For non-professionals the query is disabled (returns undefined) so specialty-filtered items are always hidden. For professionals the query is a React Query cache hit (ProfessionalDashboard already fetches it), so no extra HTTP round-trip.

**Why:** The global nav (SideNav/BottomNav) has no specialty context by default. Adding the profile hook with `enabled` is the least-invasive way to gate items without restructuring the nav or adding a new context.

**How to apply:** Any future feature that only applies to a specific professional specialty (e.g. "shadow_teacher", "occupational_therapy") should use this same pattern rather than hardcoding role checks or adding separate pages.
