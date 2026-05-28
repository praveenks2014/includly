export interface ChildResponseType {
  id: number;
  parentId: number;
  name: string;
  dob: string | null;
  diagnosisTags: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectMessageResponseType {
  id: number;
  threadId: number;
  senderId: number;
  senderName: string | null;
  body: string;
  createdAt: string;
}

export interface EngagementResponseType {
  id: number;
  parentId: number;
  professionalId: number;
  childId: number | null;
  startDate: string;
  hoursPerWeek: number;
  monthlyFeeInr: number;
  status: "active" | "paused" | "ended";
  nextBillingDate: string | null;
  billedThroughDate: string | null;
  notes: string | null;
  createdAt: string;
  professionalName?: string | null;
  parentName?: string | null;
  childName?: string | null;
}

export interface WalletTransactionResponseType {
  id: number;
  userId: number;
  amountInr: number;
  type: "credit" | "debit";
  sourceType: "refund" | "topup" | "booking" | "engagement";
  referenceId: number | null;
  description: string | null;
  balanceAfter: number;
  createdAt: string;
}

export interface EngagementLogResponse {
  id: number;
  engagementId: number;
  weekStartDate: string;
  hoursLogged: number;
  notes: string | null;
  loggedBy: number;
  loggedByName?: string | null;
  createdAt: string;
}

export interface CommissionRateResponseType {
  id: number;
  bookingType: string;
  ratePct: number;
  isActive: boolean;
  notes: string | null;
  updatedAt: string;
}
