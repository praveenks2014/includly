// Backend feature flags.
//
// SHOW_TUTOR_SEARCH/SHOW_THERAPIST_SEARCH used to live here — removed as
// part of Step 3 (platform-admin vertical visibility toggle), which
// replaced both with a live admin_settings-backed toggle (homeTutorVisible/
// therapistVisible), enforced inside tutor.ts's/therapist.ts's own
// router.use() gates. No redeploy-requiring code constant governs either
// vertical's reachability anymore.
//
// SHOW_CONSULTATION_TILES / SHOW_COACH_TILE — unlike the two removed flags
// described above, these have no dedicated route to 404-gate: the
// consultation/coach tiles
// route entirely through already-live, generic endpoints (search,
// bookable-slots, sessions/book) shared with other, already-launched
// specialties. These flags are consumed frontend-only (features.ts), to
// decide whether the tile itself renders — there is no backend
// enforcement surface for them the way the tutor/therapist flags have.
export const SHOW_CONSULTATION_TILES = false;
export const SHOW_COACH_TILE = false;
