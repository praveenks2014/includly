---
name: Shadow-teacher zero-candidates diagnosis
description: How to diagnose why a parent's shadow-teacher match request surfaced 0 candidates, and the admin ID-lookup gap this often surfaces alongside it.
---

## Symptom
Parent sees zero shadow-teacher matches for a `shadow_teacher_matches` row; `shadow_match_candidates` has 0 rows for that match id.

## Where to look, in order
1. `surfaceCandidatesForMatch` (artifacts/api-server/src/routes/shadowTeacher.ts) hard-filters on specialty=shadow_teacher, verificationStatus=verified, **paymentActivated=true**, pricingMinINR not null, identity doc exists. Any professional failing these is excluded entirely before scoring.
2. `filterBySchoolHours` (same file) is a **second hard filter**, applied after the above: if the child has `schoolStartTime`/`schoolEndTime` set AND a professional has explicit rows in `professional_availability` (isActive, day 1-5), the professional is excluded unless at least one availability slot overlaps `[schoolStart, schoolEnd)`. A professional with zero availability rows is treated as "flexible" and always passes.
3. `rankCandidates`/`scoreCandidate` (shadowTeacherScoring.ts) has **no hard cutoff** — budget/city/language mismatches only lower the score, never exclude. If you see 0 candidates, the cause is always filter #1 or #2, never the scoring step.

**Why:** it's easy to assume a soft-scored field (like budget) caused the empty result; it never does. Confirm by checking whether the sole/all in-city, payment-activated, verified professionals have availability rows that fail to overlap the child's school hours — that's the far more common real cause.

## Admin manual-assign ID gap
The admin "Add candidate" / "Assign Shadow Teacher" dialogs (artifacts/sensei-link/src/pages/admin.tsx) require typing a raw professional profile ID, with a hint "Find the ID in the Professionals tab" — but historically the Professionals tab table and review modal never actually rendered the numeric ID anywhere, making it impossible to find. Fixed by displaying `prof.id` under the name/email in the table row (click-to-copy) and in the review modal. If this regresses again, it silently breaks the admin manual-override workflow.
