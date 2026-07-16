import { pgTable, text, serial, timestamp, integer, boolean, pgEnum, real, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const userRoleEnum = pgEnum("user_role", ["parent", "professional", "centre_admin", "admin"]);

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  clerkId: text("clerk_id").notNull().unique(),
  email: text("email"),
  phone: text("phone"),
  fullName: text("full_name"),
  avatarUrl: text("avatar_url"),
  role: userRoleEnum("role").notNull().default("parent"),
  // True only once the user has explicitly completed the role picker (see
  // PATCH /users/me/role) — never set at row-creation time. requireAuth
  // defaults every new row to role='parent' before onboarding ever runs,
  // so `role` alone can't distinguish "genuinely chose parent" from
  // "not onboarded yet" — this flag is what the post-login routing gates
  // on instead of trusting role directly.
  onboardingComplete: boolean("onboarding_complete").notNull().default(false),
  city: text("city"),
  country: text("country"),
  location: text("location"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  shareHomeLocation: boolean("share_home_location").notNull().default(false),
  supportTypes: text("support_types").array().notNull().default([]),
  childCount: integer("child_count"),
  sessionCredits: integer("session_credits").notNull().default(0),
  walletBalanceInr: integer("wallet_balance_inr").notNull().default(0),
  referralCode: text("referral_code").unique(),
  referredByCode: text("referred_by_code"),
  lastWinbackNudgeAt: timestamp("last_winback_nudge_at", { withTimezone: true }),
  lastLowCreditNudgeAt: timestamp("last_low_credit_nudge_at", { withTimezone: true }),
  deletionScheduledAt: timestamp("deletion_scheduled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
