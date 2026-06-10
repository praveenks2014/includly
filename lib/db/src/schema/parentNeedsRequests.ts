import { pgTable, serial, integer, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { childrenTable } from "./children";

export const parentNeedsStatusEnum = pgEnum("parent_needs_status", ["draft", "submitted"]);

export const parentNeedsRequestsTable = pgTable("parent_needs_requests", {
  id: serial("id").primaryKey(),
  parentId: integer("parent_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  childId: integer("child_id").references(() => childrenTable.id, { onDelete: "set null" }),
  supportTypes: text("support_types").notNull().default("[]"),
  status: parentNeedsStatusEnum("status").notNull().default("draft"),
  payload: text("payload").default("{}"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertParentNeedsRequestSchema = createInsertSchema(parentNeedsRequestsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertParentNeedsRequest = z.infer<typeof insertParentNeedsRequestSchema>;
export type ParentNeedsRequest = typeof parentNeedsRequestsTable.$inferSelect;
