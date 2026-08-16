---
name: openapi.yaml drift reconciliation (tracked follow-up)
description: openapi.yaml is stale relative to the live API surface; a full orval codegen regen would silently destroy hand-patched fields. Needs a dedicated reconciliation pass, not urgent but a landmine for the next person who runs codegen without knowing to check first.
---

## Status: not started — standalone follow-up item, logged 2026-08-16

During the district/state onboarding-autofill fix, running `orval` codegen
from `lib/api-spec/openapi.yaml` (to add two fields to the professional
profile contract) produced a 394-line diff entirely unrelated to that
change — see `generated-api-hand-patches.md` for the general mechanism
(hand-patches to generated files were never backported to the yaml). This
entry tracks the actual reconciliation work, not just the pattern.

**Confirmed missing from openapi.yaml but present/relied-on in the live
generated files** (found via a real regen diff, not guessed):
- `coaching` enum member — missing from `specialty` everywhere (create/update/
  profile schemas) and from `vertical`
- `centre_admin` enum member — missing from `UserProfileRole`
- `generalAvailabilityJson` + `earliestStartDate` — missing from
  `ProfessionalProfile`/`UpdateProfessionalProfileBody` in the split
  `types/*.ts` output (already present in the combined `api.ts` zod schemas,
  so the drift is inconsistent even within api-zod's own two outputs)
- `supportTypes` + `childCount` — missing from `UserProfile`/`UpdateUserBody`
  (parent-onboarding fields)
- `scheduleWarningBufferMinutes` — missing from `MySettings`
- `credentialKind`/`credentialNumber` type extraction (`AdminProfessionalRow`)
  and a few other enum/type extractions (`servicesViewMode`, etc.) — cosmetic
  but part of the same drift

**Why this matters:** every one of these is a real, live field working
correctly today purely because someone hand-patched the generated output
directly. The yaml being wrong isn't just a docs problem — it's a trap:
the ONE tool that's supposed to make schema changes safe (codegen) is
currently unsafe to run at all, and nothing marks which generated fields
are yaml-backed vs. hand-patch-only.

**How to apply when this gets picked up:** diff a full regen against HEAD
field-by-field (not just typecheck) for every generated file, reconcile the
yaml to match the fields above (and any others a full diff turns up — this
list is only what surfaced from one incidental regen, not an exhaustive
audit), then re-run codegen clean and verify the diff is empty. Until then,
keep hand-patching per `generated-api-hand-patches.md`.
