import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const resourcesTable = pgTable("resources", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  excerpt: text("excerpt").notNull(),
  body: text("body"),
  author: text("author").notNull(),
  category: text("category").notNull().default("general"),
  tag: text("tag").notNull(),
  readTimeMinutes: integer("read_time_minutes").notNull().default(5),
  isPremium: boolean("is_premium").notNull().default(false),
  isCourse: boolean("is_course").notNull().default(false),
  coursePricingInr: integer("course_pricing_inr"),
  courseExpertUserId: integer("course_expert_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  isPublished: boolean("is_published").notNull().default(true),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Resource = typeof resourcesTable.$inferSelect;
