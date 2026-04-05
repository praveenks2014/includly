export const PLANS = {
  plan_a_subscription: {
    id: "plan_a_subscription",
    name: "Premium Search (30 days)",
    description: "Unlock unlimited contact details for 30 days. Ideal for parents actively searching.",
    amountPaise: 49900,
    currency: "INR",
    durationDays: 30,
    stripePriceId: process.env["STRIPE_PLAN_A_PRICE_ID"] ?? null,
  },
  plan_b_per_contact: {
    id: "plan_b_per_contact",
    name: "Single Contact Unlock",
    description: "Unlock one professional's contact details. Pay as you go.",
    amountPaise: 9900,
    currency: "INR",
    durationDays: null,
    stripePriceId: process.env["STRIPE_PLAN_B_PRICE_ID"] ?? null,
  },
  plan_c_featured: {
    id: "plan_c_featured",
    name: "Featured Listing (30 days)",
    description: "Boost your profile to the top of search results for 30 days.",
    amountPaise: 29900,
    currency: "INR",
    durationDays: 30,
    stripePriceId: process.env["STRIPE_PLAN_C_PRICE_ID"] ?? null,
  },
} as const;

export type PlanId = keyof typeof PLANS;
