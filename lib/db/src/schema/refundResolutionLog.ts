import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

// Admin-visible record of every lazy-timeout auto-cancellation refund.
// razorpayFeeAbsorbed=true flags rows where the source-refund path was used
// (Razorpay doesn't return its original transaction fee on refund — we eat
// it); admin can total these up for an aggregate estimate. Exact per-
// transaction fee still requires Razorpay's own dashboard/report — this
// table doesn't attempt to compute it precisely.
export const refundResolutionLogTable = pgTable("refund_resolution_log", {
  id: serial("id").primaryKey(),
  reason: text("reason").notNull(), // 'commit_response_timeout' | 'activation_fee_timeout' | 'otp_start_timeout' | 'trial_pending_timeout'
  matchId: integer("match_id"),
  engagementId: integer("engagement_id"),
  refundedToUserId: integer("refunded_to_user_id").notNull().references(() => usersTable.id),
  amountInr: integer("amount_inr").notNull(),
  method: text("method").notNull(), // 'razorpay_source' | 'wallet_fallback'
  razorpayFeeAbsorbed: boolean("razorpay_fee_absorbed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertRefundResolutionLogSchema = createInsertSchema(refundResolutionLogTable).omit({ id: true, createdAt: true });
export type InsertRefundResolutionLog = z.infer<typeof insertRefundResolutionLogSchema>;
export type RefundResolutionLog = typeof refundResolutionLogTable.$inferSelect;
