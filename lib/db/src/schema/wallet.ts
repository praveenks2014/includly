import { pgTable, serial, integer, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const walletTxTypeEnum = pgEnum("wallet_tx_type", ["credit", "debit"]);
export const walletSourceTypeEnum = pgEnum("wallet_source_type", ["refund", "topup", "booking", "engagement"]);

export const walletTransactionsTable = pgTable("wallet_transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  amountInr: integer("amount_inr").notNull(),
  type: walletTxTypeEnum("type").notNull(),
  sourceType: walletSourceTypeEnum("source_type").notNull(),
  referenceId: integer("reference_id"),
  description: text("description"),
  balanceAfter: integer("balance_after").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWalletTransactionSchema = createInsertSchema(walletTransactionsTable).omit({ id: true, createdAt: true });
export type InsertWalletTransaction = z.infer<typeof insertWalletTransactionSchema>;
export type WalletTransaction = typeof walletTransactionsTable.$inferSelect;
