import { pgTable, serial, integer, timestamp, boolean, real, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const adminSettingsTable = pgTable("admin_settings", {
  id: serial("id").primaryKey(),
  contactLimitPerParent: integer("contact_limit_per_parent").notNull().default(5),
  contactUnlockPriceInr: integer("contact_unlock_price_inr").notNull().default(0),
  platformCommissionPct: integer("platform_commission_pct").notNull().default(0),
  monetisationEnabled: boolean("monetisation_enabled").notNull().default(false),
  // Flow A — Shadow Teacher matching fee
  matchingFeeInr: integer("matching_fee_inr").notNull().default(500),
  matchingFeeRefundable: boolean("matching_fee_refundable").notNull().default(true),
  // Flow B — per-session escrow markup (percentage OR flat; percentage takes precedence if non-zero)
  markupPct: real("markup_pct").notNull().default(10),
  markupFlatInr: integer("markup_flat_inr").notNull().default(0),
  // Tax configuration (rates admin-configurable; consult CA before enabling TCS/TDS)
  gstRatePct: real("gst_rate_pct").notNull().default(18),
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
