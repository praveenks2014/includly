import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const pendingUploadsTable = pgTable("pending_uploads", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  objectPath: text("object_path").notNull().unique(),
  contentType: text("content_type").notNull(),
  fileSizeBytes: integer("file_size_bytes").notNull(),
  consumed: boolean("consumed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
