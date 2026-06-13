export interface ChildConsentType {
  intakeShare: boolean;
  media: boolean;
  reports: boolean;
  consentedAt: string;
}

export interface CareNotesType {
  calming: string;
  triggers: string;
  communicationMode: string;
  favorites: string;
}

export interface ExistingTherapyType {
  type: string;
  frequency: string;
}

export interface ChildResponseType {
  id: number;
  parentId: number;
  name: string;
  dob: string | null;
  notes: string | null;
  city: string | null;
  area: string | null;
  lat: number | null;
  lng: number | null;
  gender: string | null;
  diagnosisStatus: string | null;
  conditions: string[] | null;
  languages: string[] | null;
  schoolType: string | null;
  grade: string | null;
  existingTherapies: ExistingTherapyType[] | null;
  goalsAreas: string[] | null;
  availableTimeWindows: string[] | null;
  preferredModes: string[] | null;
  budgetMinInr: number | null;
  budgetMaxInr: number | null;
  careNotes: CareNotesType | null;
  consent: ChildConsentType | null;
  completionPct?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChildIntakeCardType {
  id: number;
  name: string;
  ageMonths: number | null;
  conditions: string[] | null;
  diagnosisStatus: string | null;
  goalsAreas: string[] | null;
  languages: string[] | null;
  careNotes: CareNotesType | null;
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
