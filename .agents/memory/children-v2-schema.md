---
name: Children V2 schema pattern
description: Column types, API shape, and access-control rules for the children table V2 expansion
---

**Column type conventions:**
- Filterable multi-value fields: `text("field").array()` — e.g. conditions, languages, goalsAreas, preferredModes, availableTimeWindows
- Structured objects: `jsonb("field")` — e.g. existingTherapies, careNotes, consent
- `diagnosis_tags` stays in DB (not dropped) but is no longer in the Drizzle schema; `conditions` is its successor

**completionPct calculation (8 fields):**
conditions (non-empty), diagnosisStatus, goalsAreas (non-empty), schoolType, languages (non-empty), preferredModes (non-empty), budgetMinInr (not null), careNotes (not null)

**GET /api/children/:id access rules:**
- Parent or admin → full row + completionPct
- Professional → intake card only (id, name, ageMonths, conditions, diagnosisStatus, goalsAreas, languages, careNotes), gated on:
  1. `consent.intakeShare === true`
  2. At least one session_booking joining professional_profiles.user_id = caller's userId AND status IN (paid_held, session_started, session_completed, releasable, released)
- Anyone else → 403

**POST /api/children:**
- `consent` is required; `consent.consentedAt` is always stamped server-side (never trusted from client)

**PUT /api/children/:id:**
- Replaces PATCH; `consent.consentedAt` is preserved from the existing DB row (never overwritten)

**Hook types:**
- `CreateChildPayload` and `UpdateChildPayload` exported from `@workspace/api-client-react`
- `useGetChild(id)` for single-child fetch; `useGetMyChildren()` for list
- `useUpdateChild` uses PUT (not PATCH)
