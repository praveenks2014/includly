import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

export const waitlistTable = pgTable("waitlist", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  category: text("category").notNull().default("parent"),
  name: text("name"),
  source: text("source").notNull().default("hero_form"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
