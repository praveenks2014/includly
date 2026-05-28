import { z } from "zod/v4";

export const CreateChildBody = z.object({
  name: z.string().min(1).max(100),
  dob: z.string().optional(),
  diagnosisTags: z.string().optional(),
  notes: z.string().optional(),
});

export const UpdateChildBody = z.object({
  name: z.string().min(1).max(100).optional(),
  dob: z.string().optional(),
  diagnosisTags: z.string().optional(),
  notes: z.string().optional(),
});

export const ChildResponse = z.object({
  id: z.number(),
  parentId: z.number(),
  name: z.string(),
  dob: z.string().nullable(),
  diagnosisTags: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ChildResponseType = z.infer<typeof ChildResponse>;

export const ConnectMessageBody = z.object({
  body: z.string().min(1).max(2000),
});

export const ConnectMessageResponse = z.object({
  id: z.number(),
  threadId: z.number(),
  senderId: z.number(),
  senderName: z.string().nullable(),
  body: z.string(),
  createdAt: z.string(),
});
export type ConnectMessageResponseType = z.infer<typeof ConnectMessageResponse>;

export const ConnectThreadResponse = z.object({
  thread: z.object({
    id: z.number(),
    parentId: z.number(),
    professionalId: z.number(),
    createdAt: z.string(),
  }),
  messages: z.array(ConnectMessageResponse),
  professional: z.object({
    fullName: z.string().nullable(),
    specialty: z.string().nullable(),
  }).nullable(),
});

export const CreateEngagementBody = z.object({
  professionalId: z.number().int().positive(),
  childId: z.number().int().positive().optional(),
  startDate: z.string(),
  hoursPerWeek: z.number().int().min(1).max(40),
  monthlyFeeInr: z.number().int().min(0),
  notes: z.string().optional(),
});

export const EngagementResponse = z.object({
  id: z.number(),
  parentId: z.number(),
  professionalId: z.number(),
  childId: z.number().nullable(),
  startDate: z.string(),
  hoursPerWeek: z.number(),
  monthlyFeeInr: z.number(),
  status: z.enum(["active", "paused", "ended"]),
  nextBillingDate: z.string().nullable(),
  billedThroughDate: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  professionalName: z.string().nullable().optional(),
  parentName: z.string().nullable().optional(),
  childName: z.string().nullable().optional(),
});
export type EngagementResponseType = z.infer<typeof EngagementResponse>;

export const LogWeekBody = z.object({
  weekStartDate: z.string(),
  hoursLogged: z.number().int().min(0).max(100),
  notes: z.string().optional(),
});

export const EngagementLogResponse = z.object({
  id: z.number(),
  weekStartDate: z.string(),
  hoursLogged: z.number(),
  notes: z.string().nullable(),
  loggedByUserId: z.number(),
  loggedByName: z.string().nullable(),
  createdAt: z.string(),
});

export const WalletBalanceResponse = z.object({
  balanceInr: z.number(),
});

export const WalletTransactionResponse = z.object({
  id: z.number(),
  userId: z.number(),
  amountInr: z.number(),
  type: z.enum(["credit", "debit"]),
  sourceType: z.enum(["refund", "topup", "booking", "engagement"]),
  referenceId: z.number().nullable(),
  description: z.string().nullable(),
  balanceAfter: z.number(),
  createdAt: z.string(),
});
export type WalletTransactionResponseType = z.infer<typeof WalletTransactionResponse>;

export const WalletHistoryResponse = z.object({
  transactions: z.array(WalletTransactionResponse),
  total: z.number(),
});

export const CommissionRateResponse = z.object({
  id: z.number(),
  bookingType: z.string(),
  ratePct: z.number(),
  isActive: z.boolean(),
  notes: z.string().nullable(),
  updatedAt: z.string(),
});
export type CommissionRateResponseType = z.infer<typeof CommissionRateResponse>;

export const UpdateCommissionRateBody = z.object({
  ratePct: z.number().int().min(0).max(100),
  notes: z.string().optional(),
  isActive: z.boolean().optional(),
});

export const WalletTopupOrderBody = z.object({ amountInr: z.number().int().min(100).max(50000) });
export const WalletTopupVerifyBody = z.object({
  paymentId: z.number().int(),
  razorpayPaymentId: z.string(),
  razorpayOrderId: z.string(),
  razorpaySignature: z.string(),
});
