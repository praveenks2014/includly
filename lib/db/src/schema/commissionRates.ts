import { pgTable, serial, integer, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const commissionRatesTable = pgTable("commission_rates", {
  id: serial("id").primaryKey(),
  bookingType: text("booking_type").notNull().unique(),
  ratePct: integer("rate_pct").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCommissionRateSchema = createInsertSchema(commissionRatesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCommissionRate = z.infer<typeof insertCommissionRateSchema>;
export type CommissionRate = typeof commissionRatesTable.$inferSelect;
