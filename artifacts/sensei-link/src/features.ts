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

export const STAT_THRESHOLDS = {
  specialists: 50,
  centres: 20,
  parents: 100,
} as const;
