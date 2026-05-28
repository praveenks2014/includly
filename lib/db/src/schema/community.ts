import { pgTable, serial, text, integer, boolean, timestamp, pgEnum, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { professionalProfilesTable } from "./professionals";

export const communityReportStatusEnum = pgEnum("community_report_status", ["pending", "resolved", "dismissed"]);
export const communityReportTargetEnum = pgEnum("community_report_target", ["post", "answer"]);

export const communityPostsTable = pgTable("community_posts", {
  id: serial("id").primaryKey(),
  authorUserId: integer("author_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  topicTag: text("topic_tag").notNull().default("general"),
  isAnonymous: boolean("is_anonymous").notNull().default(false),
  isHidden: boolean("is_hidden").notNull().default(false),
  upvoteCount: integer("upvote_count").notNull().default(0),
  answerCount: integer("answer_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const communityAnswersTable = pgTable("community_answers", {
  id: serial("id").primaryKey(),
  postId: integer("post_id").notNull().references(() => communityPostsTable.id, { onDelete: "cascade" }),
  authorProfessionalId: integer("author_professional_id").notNull().references(() => professionalProfilesTable.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  upvoteCount: integer("upvote_count").notNull().default(0),
  isHidden: boolean("is_hidden").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const communityPostVotesTable = pgTable("community_post_votes", {
  id: serial("id").primaryKey(),
  postId: integer("post_id").notNull().references(() => communityPostsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.postId, t.userId)]);

export const communityAnswerVotesTable = pgTable("community_answer_votes", {
  id: serial("id").primaryKey(),
  answerId: integer("answer_id").notNull().references(() => communityAnswersTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.answerId, t.userId)]);

export const communityReportsTable = pgTable("community_reports", {
  id: serial("id").primaryKey(),
  targetType: communityReportTargetEnum("target_type").notNull(),
  targetId: integer("target_id").notNull(),
  reporterUserId: integer("reporter_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  status: communityReportStatusEnum("status").notNull().default("pending"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CommunityPost = typeof communityPostsTable.$inferSelect;
export type CommunityAnswer = typeof communityAnswersTable.$inferSelect;
export type CommunityReport = typeof communityReportsTable.$inferSelect;
