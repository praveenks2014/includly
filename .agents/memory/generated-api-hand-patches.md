---
name: Generated API files contain undocumented hand-patches
description: openapi.yaml is NOT the full source of truth for lib/api-zod and lib/api-client-react generated files; regenerating from it destroys fields that only ever existed as manual patches.
---

Many schemas/fields present in `lib/api-zod/src/generated/*` and
`lib/api-client-react/src/generated/api.schemas.ts` were hand-added directly
to the generated output over time and were never captured in
`lib/api-spec/openapi.yaml`. Examples found so far: nullable
`phoneBlurred`/`emailBlurred` on search results, the `coaching` specialty and
`centre_admin` role enum members, several professional-profile fields
(`languages`, `verticalDetails`, `rciCrrNumber`, `certifications`,
`profileComplete`, `rciVerified`, `vertical`), most of `AdminSettings` /
`UpdateAdminSettingsBody` (matching/markup/gst/salary-cut/notice/buyout/tiers
fields), `razorpaySubscriptionId` on `VerifyRazorpayBody`, and `totalCentres`.

**Why:** Running the orval/openapi codegen pipeline regenerates these files
strictly from openapi.yaml and silently drops any field not declared there —
no error, no warning. This caused live regressions (e.g. non-nullable
contact fields that would 500 on shadow-teacher search, an admin-settings
save that would silently drop most fields) that were only caught by an
architect review diffing behavior, not by typecheck.

**How to apply:** Do not run full codegen regeneration on this repo. When a
new field is needed in a generated schema, hand-edit the generated
`api.ts`/`api.schemas.ts`/`types/*.ts` files directly (and rebuild dist via
`tsc -p tsconfig.json` per the api-client-react-rebuild memory), then
best-effort backport the same field into `openapi.yaml` so documentation
doesn't drift further — but treat openapi.yaml sync as secondary to the
generated files actually being correct. If codegen must ever be run, first
diff every generated file against HEAD field-by-field (not just typecheck)
and restore anything wiped that isn't newly obsolete. To restore
hand-patched files without git checkout (blocked as destructive in the main
agent sandbox), use `git show HEAD:<path> > <path>` and verify with `cmp`,
not `git diff`/`git status`.

**Separately:** entire route files can be missing from openapi.yaml, not just
fields. `shadow-teacher` and `engagements` routers in api-server have zero
path entries in openapi.yaml even though dozens of endpoints exist and are
called from the frontend — those callers use raw `fetchWithAuth`, not the
generated client. When adding new endpoints to an already-undocumented router,
don't single out just the new ones for openapi.yaml paths; that's scope creep
that won't fix the pre-existing gap. Leave the file's coverage as-is unless
asked to backfill the whole router.
