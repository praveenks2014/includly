import { pgTable, serial, integer, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const certificationStatusEnum = pgEnum("certification_status", [
  "pending",
  "approved",
  "rejected",
]);

export const userCertificationsTable = pgTable("user_certifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  documentType: text("document_type").notNull(),
  documentUrl: text("document_url").notNull(),
  notes: text("notes"),
  status: certificationStatusEnum("status").notNull().default("pending"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
