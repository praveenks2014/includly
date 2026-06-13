import { pgTable, serial, integer, real, text, timestamp, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { shadowTeacherMatchesTable } from "./shadowTeacher";
import { professionalProfilesTable } from "./professionals";
import { usersTable } from "./users";

export const shadowMatchCandidatesTable = pgTable(
  "shadow_match_candidates",
  {
    id: serial("id").primaryKey(),
    matchId: integer("match_id")
      .notNull()
      .references(() => shadowTeacherMatchesTable.id, { onDelete: "cascade" }),
    professionalId: integer("professional_id")
      .notNull()
      .references(() => professionalProfilesTable.id, { onDelete: "cascade" }),
    score: real("score"),
    rank: integer("rank").notNull(),
    addedBy: text("added_by").notNull().default("auto"),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedByUserId: integer("removed_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("shadow_match_candidates_match_id_idx").on(t.matchId),
    unique("shadow_match_candidates_match_pro_unique").on(t.matchId, t.professionalId),
  ],
);

export const insertShadowMatchCandidateSchema = createInsertSchema(
  shadowMatchCandidatesTable,
).omit({ id: true, createdAt: true });
export type InsertShadowMatchCandidate = z.infer<typeof insertShadowMatchCandidateSchema>;
export type ShadowMatchCandidate = typeof shadowMatchCandidatesTable.$inferSelect;
