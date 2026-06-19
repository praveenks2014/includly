import { pgTable, text, varchar, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const pushSubscriptionsTable = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notificationPreferencesTable = pgTable("notification_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }).unique(),
  onUnlock: boolean("on_unlock").notNull().default(true),
  onReview: boolean("on_review").notNull().default(true),
  onProfileUpdate: boolean("on_profile_update").notNull().default(true),
  onSessionReminder: boolean("on_session_reminder").notNull().default(true),
  onLowCredits: boolean("on_low_credits").notNull().default(true),
  onCommunityReply: boolean("on_community_reply").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notificationsTable = pgTable("notifications", {
  id:          serial("id").primaryKey(),
  userId:      integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  type:        varchar("type", { length: 80 }).notNull(),
  title:       text("title").notNull(),
  body:        text("body").notNull(),
  isRead:      boolean("is_read").notNull().default(false),
  relatedId:   integer("related_id"),
  relatedType: varchar("related_type", { length: 50 }),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Notification = typeof notificationsTable.$inferSelect;

export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptionsTable).omit({ id: true, createdAt: true });
export type InsertPushSubscription = z.infer<typeof insertPushSubscriptionSchema>;
export type PushSubscription = typeof pushSubscriptionsTable.$inferSelect;

export const insertNotificationPreferencesSchema = createInsertSchema(notificationPreferencesTable).omit({ id: true, updatedAt: true });
export type InsertNotificationPreferences = z.infer<typeof insertNotificationPreferencesSchema>;
export type NotificationPreferences = typeof notificationPreferencesTable.$inferSelect;
