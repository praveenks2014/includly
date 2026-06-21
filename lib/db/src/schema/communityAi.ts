import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { communityPostsTable } from "./community";

export const communityPostSummariesTable = pgTable("community_post_summaries", {
  id: serial("id").primaryKey(),
  postId: integer("post_id").notNull().unique().references(() => communityPostsTable.id, { onDelete: "cascade" }),
  summary: text("summary").notNull(),
  answerCountAtGeneration: integer("answer_count_at_generation").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type CommunityPostSummary = typeof communityPostSummariesTable.$inferSelect;
