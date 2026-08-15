# Vertical type duplicated across 9 sites, no shared source

`professionalVerticalEnum` (`lib/db/src/schema/professionals.ts`) is the one
real source of truth for the "vertical" value (shadow_teacher/home_tutor/
therapist/coaching). But the union type itself is independently hand-typed
in at least 9 separate places with no shared import:

- Backend: `VerificationVertical` (`artifacts/api-server/src/lib/verificationRequirements.ts`),
  `VerticalValue` (`artifacts/api-server/src/routes/professionals.ts`),
  `OfferingVertical` (`artifacts/api-server/src/lib/offeringResolver.ts`),
  plus hand-typed arrays that mirror it: `OFFERING_VERTICALS` (`admin.ts`),
  `KNOWN_VERTICALS` (`verifications.ts`).
- Frontend: separate `VerticalValue` in `onboard.tsx`, a separate
  `VerticalValue` in `onboard-stage2.tsx`, a separate `OfferingVertical` in
  `professional-dashboard.tsx`, plus `ALL_VERTICALS`/`VERTICAL_META`-style
  lookup tables keyed off each one.

Consequence: adding a new vertical value (e.g. the "coaching" vertical added
for Inclusive Coach onboarding) does NOT propagate anywhere automatically.
Each copy must be found and widened by hand. TypeScript only catches SOME of
the resulting gaps (`Record<VerticalValue, X>` exhaustive lookup tables) —
if/else and ternary chains keyed off the value silently fall through to
whatever branch happens to be last, with zero compile error. Two confirmed
real bugs from exactly this pattern during the coaching migration: a listing-
fee ternary in `isOfferingListable()` that silently applied the THERAPIST fee
toggle to any vertical it didn't recognize, and `onboard-stage2.tsx`'s
`VERTICAL_META[vertical] ?? VERTICAL_META.shadow_teacher` silently rendering
a new vertical's onboarding page with Shadow Teacher's branding.

One file already does this correctly: `artifacts/api-server/src/routes/professionalOfferings.ts`
uses `professionalVerticalEnum.enumValues` directly instead of a hand-typed
copy — new values propagate here with zero code changes.

**Not fixed as part of the coaching migration** — a full consolidation to one
shared type (exported from `lib/db` or `lib/api-zod`, imported everywhere
instead of re-declared) is real, worthwhile cleanup, but is its own
refactor, not blocking a single new vertical value. Whoever adds the NEXT
new vertical should either do this consolidation first, or re-run the same
kind of exhaustive grep-audit done for coaching (see the coaching-onboarding
plan/PR for the full site list) rather than rediscovering the sites one bug
report at a time.

## Sibling risk: flat `specialty` used where per-offering `vertical`/
## `professional_offerings` is correct

A related but distinct failure mode, surfaced during the platform-admin
vertical-visibility-toggle audit (2026-08-15): several sites gate or shape
behavior off `professionalProfilesTable.specialty` (a single legacy/primary
field) instead of resolving the SPECIFIC offering being acted on via
`professional_offerings` (see `offeringResolver.ts`'s `resolveOffering()`
and `verificationRequirements.ts`'s `isOfferingListable()` for the correct
pattern). For a multi-offering professional (e.g. holds both Shadow Teacher
and Therapist), this risks coupling one offering's state to an unrelated
offering's behavior.

Confirmed instances, roughly by priority:

1. **`dashboard.ts:67-71` — HIGHEST PRIORITY.** Contact-blur/unlock logic
   (`phoneBlurred`/`emailBlurred`/`isUnlocked`) is keyed on flat `specialty`,
   not the specific offering being viewed. Confirmed live/reachable today
   (not gated behind an unshipped feature). Failure mode: a professional
   whose primary specialty is shadow_teacher but whose contact info should
   be blurred/unlocked in a THERAPIST context (or vice versa) gets the wrong
   exposure decision — more consequential than the others below since it's
   a live information-exposure bug, not just a mis-surfacing/cosmetic one.
2. `shadowTeacher.ts`'s primary-offering branch in `surfaceCandidatesForMatch()`
   checks `specialty === "shadow_teacher"` where `tutor.ts`/`therapist.ts`'s
   equivalent branches correctly check `vertical === "home_tutor"/"therapist"`.
   Currently "correct by coincidence" only because `specialty` and `vertical`
   happen to share the literal string `"shadow_teacher"` — the same shape of
   bug that has already bitten this project twice before (this file's own
   listing-fee-ternary and `onboard-stage2.tsx` bugs above).
3. `professionals.ts`'s `/professionals/search` — single-table `specialty`
   filter, no `professional_offerings` join at all. A multi-offering
   professional whose primary specialty differs from the searched vertical
   never surfaces under their additional offering.
4. `professionals.ts:834` (`GET /professionals/:id`) — `isShadowTeacher`
   computed from flat `specialty`, drives response shaping off the primary
   row only.
5. Unreviewed candidates (select/display `specialty` directly, not
   confirmed as gating bugs, just flagged for whoever looks next):
   `community.ts:149,175`, `communityAi.ts:233`, `connect.ts:104,335,416`,
   `engagements.ts:134`, `unlocks.ts:167`, `assessments.ts:637,646`.

Also worth noting: `offeringResolver.ts:17` references a
`buildOfferingListabilityCondition()` helper as the reusable bulk-query
version of `isOfferingListable()` — **it doesn't actually exist**; all three
surfacing queries (shadow-teacher/tutor/therapist) hand-re-encode the same
rule independently instead of sharing it, which is exactly how #2 above
drifted from its two siblings.

**Not fixed as part of the visibility-toggle work** — the toggle's own 4
enforcement points (category-wide request-creation gates + `employingCentreId`-
based centre checks) don't reference `specialty` at all, so they don't add a
new instance of this bug. Items 1-5 above are real, pre-existing, and still
open.
