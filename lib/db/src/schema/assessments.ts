import { pgTable, serial, integer, text, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { professionalProfilesTable } from "./professionals";
import { sessionBookingsTable } from "./sessions";
import { childrenTable } from "./children";
import { usersTable } from "./users";

export const assessmentOfferingsTable = pgTable("assessment_offerings", {
  id: serial("id").primaryKey(),
  professionalId: integer("professional_id").notNull().references(() => professionalProfilesTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  assessmentType: text("assessment_type").notNull(),
  description: text("description"),
  durationMinutes: integer("duration_minutes").notNull().default(60),
  priceInr: integer("price_inr").notNull(),
  whatIsIncluded: text("what_is_included"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const assessmentReportsTable = pgTable(
  "assessment_reports",
  {
    id: serial("id").primaryKey(),
    bookingId: integer("booking_id").notNull().references(() => sessionBookingsTable.id, { onDelete: "cascade" }),
    childId: integer("child_id").references(() => childrenTable.id, { onDelete: "set null" }),
    professionalId: integer("professional_id").notNull().references(() => professionalProfilesTable.id, { onDelete: "cascade" }),
    parentId: integer("parent_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    reportType: text("report_type").notNull().default("assessment"),
    summary: text("summary"),
    observationNotes: text("observation_notes"),
    recommendations: text("recommendations"),
    diagnosisTags: text("diagnosis_tags").array().notNull().default([]),
    reportFileKey: text("report_file_key"),
    templateData: text("template_data"),
    status: text("status").notNull().default("draft"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("assessment_reports_child_id_idx").on(t.childId),
    index("assessment_reports_booking_id_idx").on(t.bookingId),
  ],
);

export type AssessmentOffering = typeof assessmentOfferingsTable.$inferSelect;
export type AssessmentReport = typeof assessmentReportsTable.$inferSelect;
