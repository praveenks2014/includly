// Server-side enforcement for the 4 admin-settings-backed vertical
// visibility toggles that have NO dedicated router to gate (psychiatrist/
// developmental_pediatrician/neurologist/coaching route through the
// generic, specialty-agnostic /sessions/book and /sessions-v2/book
// endpoints, shared with occupational_therapy/speech_therapy/other
// already-live specialties — see the Step 1 audit in chat).
//
// Deliberately NOT a router.use() prefix gate (unsafe here — traced and
// confirmed: /sessions and /sessions-v2 are shared by many specialties,
// and their professional-side lifecycle routes, e.g. verify-start-otp,
// live on the same prefix). This is a per-specialty inline check, called
// only from inside POST /sessions/book and POST /sessions-v2/book, after
// the specialty lookup — never touches professional onboarding, the
// professional dashboard, or any other specialty's booking.
export interface VerticalVisibilitySettings {
  psychiatristVisible: boolean;
  developmentalPediatricianVisible: boolean;
  neurologistVisible: boolean;
  coachingVisible: boolean;
}

const GATED_SPECIALTIES: Record<string, keyof VerticalVisibilitySettings> = {
  psychiatrist: "psychiatristVisible",
  developmental_pediatrician: "developmentalPediatricianVisible",
  neurologist: "neurologistVisible",
  coaching: "coachingVisible",
};

// Returns true only when `specialty` is one of the 4 gated verticals AND
// its admin flag is currently off. Every other specialty (including
// occupational_therapy/speech_therapy, which share this same booking
// endpoint) always returns false here — untouched by these 4 toggles.
export function isVerticalBookingBlocked(
  specialty: string | null | undefined,
  settings: VerticalVisibilitySettings,
): boolean {
  if (!specialty) return false;
  const flagKey = GATED_SPECIALTIES[specialty];
  if (!flagKey) return false;
  return settings[flagKey] === false;
}
