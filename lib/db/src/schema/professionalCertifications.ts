import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { professionalProfilesTable } from "./professionals";

export const professionalCertificationsTable = pgTable("professional_certifications", {
  id: serial("id").primaryKey(),
  professionalId: integer("professional_id")
    .notNull()
    .references(() => professionalProfilesTable.id, { onDelete: "cascade" }),
  documentType: text("document_type").notNull(),
  fileKey: text("file_key").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});
