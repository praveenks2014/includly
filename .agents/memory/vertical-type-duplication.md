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
