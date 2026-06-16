import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { childrenTable } from "./children";
import { usersTable } from "./users";
import { shadowTeacherEngagementsTable } from "./engagements";

export const childGoalsTable = pgTable("child_goals", {
  id: serial("id").primaryKey(),
  childId: integer("child_id").notNull().references(() => childrenTable.id, { onDelete: "cascade" }),
  engagementId: integer("engagement_id").references(() => shadowTeacherEngagementsTable.id, { onDelete: "set null" }),
  createdByUserId: integer("created_by_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  category: text("category"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type ChildGoal = typeof childGoalsTable.$inferSelect;
