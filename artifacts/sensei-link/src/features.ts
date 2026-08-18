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
 * SHOW_TUTOR_SEARCH / SHOW_THERAPIST_SEARCH — Step 3 (platform-admin
 * vertical visibility toggle) replaced these as the source of truth for
 * PARENT-FACING discoverability with a live admin_settings-backed toggle
 * (see serviceCategories.ts's useServiceCategoryStatus, which now reads
 * GET /settings/me's homeTutorVisible/therapistVisible instead of these
 * constants). The backend's matching constants
 * (artifacts/api-server/src/lib/features.ts) were removed entirely for the
 * same reason — tutor.ts/therapist.ts's own router gates now read the live
 * DB value directly.
 *
 * These two are kept, permanently `true`, only because a handful of
 * OTHER, non-parent-discovery concerns still import them: App.tsx's
 * /tutor-search and /therapist-search ROUTE REGISTRATION (now always-on,
 * matching /therapy-centres' own unconditional-registration precedent —
 * actual reachability is enforced by the backend's live gate + the tile's
 * own isLive, not by whether the route exists), a professional's own
 * "request an additional offering" options in professional-dashboard.tsx,
 * and the corresponding nav tab in nav/config.ts (both about a
 * PROFESSIONAL managing their own offerings, an axis Step 3 deliberately
 * doesn't touch — see requirement #4, existing/in-progress professional
 * activity stays unaffected by the parent-facing toggle).
 */
export const SHOW_TUTOR_SEARCH = true;
export const SHOW_THERAPIST_SEARCH = true;

// SHOW_CONSULTATION_TILES / SHOW_COACH_TILE used to live here — removed,
// same reasoning as SHOW_TUTOR_SEARCH/SHOW_THERAPIST_SEARCH above: replaced
// by a live admin_settings-backed toggle per vertical (psychiatristVisible/
// developmentalPediatricianVisible/neurologistVisible/coachingVisible, read
// via GET /settings/me in serviceCategories.ts's useServiceCategoryStatus),
// so changing any of these 4 no longer requires a redeploy. The backend's
// dead copy (artifacts/api-server/src/lib/features.ts) was deleted outright
// — it had no route to gate and nothing read it. Each tile's isLive still
// ANDs the settings flag with GET /professionals/specialty-availability
// reporting at least one professional for that specialty — the flag alone
// still isn't sufficient, same as before.

export const STAT_THRESHOLDS = {
  specialists: 50,
  centres: 20,
  parents: 100,
} as const;
