// Backend feature flags for the tutor/therapist match/booking API.
//
// CROSS-REFERENCE: artifacts/sensei-link/src/features.ts (the frontend flag
// file) does NOT share state with this one — they must be flipped together
// when this feature is ready to launch. This file is the server-side source
// of truth: every tutor/therapist route checks its flag and returns 404
// (not 403 — a disabled feature shouldn't even hint it exists) when off, so
// nothing is reachable even if a URL is guessed while the frontend is hidden.
export const SHOW_TUTOR_SEARCH = false;
export const SHOW_THERAPIST_SEARCH = false;
