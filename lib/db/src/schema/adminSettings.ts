import { pgTable, serial, integer, timestamp, boolean, real } from "drizzle-orm/pg-core";
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
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAdminSettingSchema = createInsertSchema(adminSettingsTable).omit({ id: true, updatedAt: true });
export type InsertAdminSetting = z.infer<typeof insertAdminSettingSchema>;
export type AdminSettings = typeof adminSettingsTable.$inferSelect;

export const DEFAULT_CONTACT_LIMIT = 5;
