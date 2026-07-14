import { pgTable, serial, integer, timestamp, boolean, real, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const adminSettingsTable = pgTable("admin_settings", {
  id: serial("id").primaryKey(),
  contactLimitPerParent: integer("contact_limit_per_parent").notNull().default(5),
  // Flow A — Shadow Teacher matching fee
  matchingFeeInr: integer("matching_fee_inr").notNull().default(500),
  matchingFeeRefundable: boolean("matching_fee_refundable").notNull().default(true),
  // Flow B — per-session escrow markup (percentage OR flat; percentage takes precedence if non-zero)
  markupPct: real("markup_pct").notNull().default(10),
  markupFlatInr: integer("markup_flat_inr").notNull().default(0),
  // Tax configuration (rates admin-configurable; consult CA before enabling TCS/TDS)
  gstRatePct: real("gst_rate_pct").notNull().default(18),
  // Inactive placeholders pending CA confirmation of GST-TCS (Sec 52)/
  // Sec 194-O TDS treatment for this marketplace — not read anywhere yet.
  // Deliberately kept (not dead code in the "safe to remove" sense) until
  // that tax-treatment decision is made.
  tcsEnabled: boolean("tcs_enabled").notNull().default(false),
  tdsEnabled: boolean("tds_enabled").notNull().default(false),
  // OTP + auto-cancel
  otpValidityMinutes: integer("otp_validity_minutes").notNull().default(10),
  autoCancelHours: integer("auto_cancel_hours").notNull().default(2),
  // Shadow Teacher Engagement module
  salaryPlatformCutPct: real("salary_platform_cut_pct").notNull().default(10),
  noticePeriodDays: integer("notice_period_days").notNull().default(30),
  parentBuyoutDays: integer("parent_buyout_days").notNull().default(15),
  tiersJson: text("tiers_json"),
  // Trial day flow — fee charged to parent for a one-day trial with a shortlisted teacher
  trialFeeInr: integer("trial_fee_inr").notNull().default(500),
  // Monetization restructure — admin-configurable commit-moment fees + salary/trial model flags.
  // These flags are snapshotted onto individual rows (engagements, matches) at the moment they
  // apply; changing them here only affects rows created/transitioned AFTER the change.
  placementFeeInr: integer("placement_fee_inr").notNull().default(2999),
  activationFeeInr: integer("activation_fee_inr").notNull().default(999),
  platformSalaryEnabled: boolean("platform_salary_enabled").notNull().default(false),
  trialDirectPayEnabled: boolean("trial_direct_pay_enabled").notNull().default(true),
  // Tutor & Therapist verticals (Prompt 2) — same snapshot-at-transition-time
  // convention as the shadow-teacher fees above.
  tutorMatchingFeeInr: integer("tutor_matching_fee_inr").notNull().default(500),
  tutorPlacementFeeInr: integer("tutor_placement_fee_inr").notNull().default(1500),
  tutorActivationFeeInr: integer("tutor_activation_fee_inr").notNull().default(500),
  tutorTrialFeeInr: integer("tutor_trial_fee_inr").notNull().default(300),
  therapistMatchingFeeInr: integer("therapist_matching_fee_inr").notNull().default(750),
  therapistPlacementFeeInr: integer("therapist_placement_fee_inr").notNull().default(4000),
  therapistActivationFeeInr: integer("therapist_activation_fee_inr").notNull().default(1500),
  therapistTrialFeeInr: integer("therapist_trial_fee_inr").notNull().default(500),
  therapistAssessmentFeeInr: integer("therapist_assessment_fee_inr").notNull().default(1500),
  // Listing-fee gate (Prompt 2D) — a fee to be listable/matchable at all,
  // per category, fully admin-toggle-controlled. Deliberately all OFF and
  // all zero by default: this is a lever to turn on later, never a launch
  // default. Additive to the existing verification gate, never a replacement
  // — see the candidate-surfacing query changes.
  shadowTeacherListingFeeEnabled: boolean("shadow_teacher_listing_fee_enabled").notNull().default(false),
  shadowTeacherListingFeeInr: integer("shadow_teacher_listing_fee_inr").notNull().default(0),
  tutorListingFeeEnabled: boolean("tutor_listing_fee_enabled").notNull().default(false),
  tutorListingFeeInr: integer("tutor_listing_fee_inr").notNull().default(0),
  therapistListingFeeEnabled: boolean("therapist_listing_fee_enabled").notNull().default(false),
  therapistListingFeeInr: integer("therapist_listing_fee_inr").notNull().default(0),
  // Stuck shadow-teacher engagement lazy-timeout resolution — how long a
  // party may leave the other waiting before the engagement auto-cancels
  // (with refund) or, for the OTP-end case, auto-progresses. See
  // stuckEngagementResolver.ts.
  commitResponseTimeoutDays: integer("commit_response_timeout_days").notNull().default(7),
  activationFeeTimeoutDays: integer("activation_fee_timeout_days").notNull().default(7),
  otpStartTimeoutDays: integer("otp_start_timeout_days").notNull().default(7),
  otpEndTimeoutDays: integer("otp_end_timeout_days").notNull().default(7),
  // Direct-pay confirmation lazy-timeout (D3) — how long a professional may
  // leave a parent's "marked paid" unconfirmed before it's auto-treated as
  // confirmed. Same lazy-evaluation-on-read pattern as the timeouts above,
  // no cron. See paymentConfirmationResolver.ts.
  paymentConfirmationDefaultDays: integer("payment_confirmation_default_days").notNull().default(7),
  // Tutor/therapist trial-fee destination (Tutor/Therapist Pass 1). Default
  // false = platform revenue via Razorpay-collect (no compliance issue — the
  // platform keeps this fee, never remits it). Snapshotted onto
  // tutor_matches.trial_direct_pay / therapist_matches.trial_direct_pay at
  // request-trial-payment time — flipping this later never changes an
  // in-flight trial's payment mode. When true, collection moves to
  // direct-pay/verified-UPI-QR (same reasoning as shadow-teacher's
  // platformSalaryEnabled/trialDirectPayEnabled design): the platform must
  // never collect money that belongs to the professional.
  tutorTrialFeeGoesToProfessional: boolean("tutor_trial_fee_goes_to_professional").notNull().default(false),
  therapistTrialFeeGoesToProfessional: boolean("therapist_trial_fee_goes_to_professional").notNull().default(false),
  // Ongoing SESSION payment mode for tutor/therapist (separate from the
  // trial-fee toggle above, which only governs the one-time trial charge).
  // Default true = direct-pay: parent pays the professional's verified UPI
  // directly, platform never touches the money, no aggregation/compliance
  // exposure. Snapshotted onto tutor_engagements/therapist_engagements.
  // directPayEnabled at commit time — flipping this later never changes a
  // live engagement. Setting either of these to false routes ongoing
  // payments through Razorpay-collect-and-remit instead — see the loud
  // compliance comment on tutor.ts/therapist.ts's pay-month endpoints
  // before doing that: collecting many professionals' recurring session
  // fees through the platform recreates the exact salary-aggregation
  // exposure (TDS/GST/aggregation) that shadow-teacher's own
  // platformSalaryEnabled toggle exists to isolate.
  tutorDirectPayEnabled: boolean("tutor_direct_pay_enabled").notNull().default(true),
  therapistDirectPayEnabled: boolean("therapist_direct_pay_enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAdminSettingSchema = createInsertSchema(adminSettingsTable).omit({ id: true, updatedAt: true });
export type InsertAdminSetting = z.infer<typeof insertAdminSettingSchema>;
export type AdminSettings = typeof adminSettingsTable.$inferSelect;

export const DEFAULT_CONTACT_LIMIT = 5;

export const DEFAULT_TIERS = [
  { id: "budget", name: "Budget", description: "Basic qualifications, minimal experience", minSalaryInr: 12000, maxSalaryInr: 18000, minExperienceYears: 0, requiresAba: false, requiresBcba: false, englishFluency: "basic" },
  { id: "standard", name: "Standard", description: "Some special-needs experience", minSalaryInr: 18000, maxSalaryInr: 28000, minExperienceYears: 1, requiresAba: false, requiresBcba: false, englishFluency: "basic" },
  { id: "premium", name: "Premium", description: "Strong experience + good English fluency", minSalaryInr: 28000, maxSalaryInr: 45000, minExperienceYears: 3, requiresAba: false, requiresBcba: false, englishFluency: "conversational" },
  { id: "aba_specialist", name: "ABA Specialist", description: "ABA-trained shadow teacher", minSalaryInr: 45000, maxSalaryInr: 65000, minExperienceYears: 2, requiresAba: true, requiresBcba: false, englishFluency: "conversational" },
  { id: "bcba_specialist", name: "BCBA Specialist", description: "BCBA-certified shadow teacher", minSalaryInr: 65000, maxSalaryInr: 120000, minExperienceYears: 3, requiresAba: true, requiresBcba: true, englishFluency: "fluent" },
];
