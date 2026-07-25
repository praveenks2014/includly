export type FeatureStatus = "enabled" | "coming_soon" | "hidden";

export const FEATURES = {
  professional_search: "coming_soon",
  resources: "hidden",
  ask_includly: "hidden",
  pro_clients: "hidden",
} as const satisfies Record<string, FeatureStatus>;

/**
 * SHOW_PRO_UPGRADE — controls the ₹499/month "Includly Pro" upsell card.
 *
 * The backend is FULLY BUILT. To re-enable when ready:
 *   1. Flip this flag to `true`.
 *   2. Ensure `plan_e_pro_monthly` is configured as a recurring subscription
 *      plan in the Razorpay dashboard (the server calls razorpay.plans.create
 *      dynamically, so no plan ID needs to be hardcoded — just confirm the
 *      Razorpay account is live and subscription feature is enabled).
 *
 * This single flag controls both account.tsx (settings card) and
 * pricing.tsx (Go Pro CTA). One switch, both surfaces.
 */
export const SHOW_PRO_UPGRADE = false;

/**
 * SHOW_TUTOR_SEARCH / SHOW_THERAPIST_SEARCH — gate the tutor/therapist
 * parent-facing search+match flows. CROSS-REFERENCE: the backend's own
 * flags of the same name (artifacts/api-server/src/lib/features.ts) do NOT
 * share state with these — both must be flipped together at launch. The
 * backend already 404s every tutor/therapist route regardless of this
 * flag, so this is a cosmetic gate (don't show a nav link to a dead page),
 * not the source of truth for whether the feature is reachable.
 */
export const SHOW_TUTOR_SEARCH = false;
export const SHOW_THERAPIST_SEARCH = false;

/**
 * SHOW_CONSULTATION_TILES / SHOW_COACH_TILE — gate the Find-a-Specialist
 * tile grid's Psychiatrist/Developmental Pediatrician/Neurologist tiles
 * and Inclusive Coach tile respectively. Same cross-reference caveat as
 * SHOW_TUTOR_SEARCH/SHOW_THERAPIST_SEARCH above — the backend copy of
 * these flags (artifacts/api-server/src/lib/features.ts) does not share
 * state, both must be flipped together. Even once true, an individual
 * tile also needs GET /professionals/specialty-availability to report at
 * least one verified professional for its specialty before it renders as
 * live rather than staying hidden — the flag alone isn't sufficient.
 */
export const SHOW_CONSULTATION_TILES = false;
export const SHOW_COACH_TILE = false;

export const STAT_THRESHOLDS = {
  specialists: 50,
  centres: 20,
  parents: 100,
} as const;
