import { pgTable, serial, integer, text, timestamp, real, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const childrenTable = pgTable("children", {
  id: serial("id").primaryKey(),
  parentId: integer("parent_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  dob: text("dob"),
  notes: text("notes"),
  city: text("city"),
  area: text("area"),
  lat: real("lat"),
  lng: real("lng"),
  documentsJson: text("documents_json"),
  // V2 additions — text[] for filterable arrays, jsonb for structured objects
  gender: text("gender"),
  diagnosisStatus: text("diagnosis_status"),
  conditions: text("conditions").array(),
  languages: text("languages").array(),
  schoolType: text("school_type"),
  grade: text("grade"),
  existingTherapies: jsonb("existing_therapies"),
  goalsAreas: text("goals_areas").array(),
  availableTimeWindows: text("available_time_windows").array(),
  preferredModes: text("preferred_modes").array(),
  budgetMinInr: integer("budget_min_inr"),
  budgetMaxInr: integer("budget_max_inr"),
  careNotes: jsonb("care_notes"),
  consent: jsonb("consent"),
  schoolStartTime: text("school_start_time"),
  schoolEndTime:   text("school_end_time"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Child = typeof childrenTable.$inferSelect;
export type InsertChild = typeof childrenTable.$inferInsert;
