export interface AssessmentOfferingType {
  id: number;
  professionalId: number;
  title: string;
  assessmentType: string;
  description: string | null;
  durationMinutes: number;
  priceInr: number;
  whatIsIncluded: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AssessmentReportType {
  id: number;
  bookingId: number;
  childId: number | null;
  professionalId: number;
  parentId: number;
  reportType: string;
  summary: string | null;
  observationNotes: string | null;
  recommendations: string | null;
  diagnosisTags: string[];
  reportFileKey: string | null;
  templateData: string | null;
  status: "draft" | "submitted";
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
  professionalName?: string | null;
}

export interface AssessmentBookingType {
  id: number;
  professionalId: number;
  parentId: number;
  bookedDate: string;
  startTime: string;
  durationMinutes: number;
  amountInr: number;
  status: string;
  childId: number | null;
  notes: string | null;
  assessmentOfferingId: number | null;
  createdAt: string;
  professionalName?: string | null;
  parentName?: string | null;
}

export interface AssessmentMatchType {
  id: number;
  fullName: string | null;
  specialty: string;
  city: string | null;
  averageRating: number | null;
  totalRatings: number;
  isVerified: boolean;
  pricingMinINR: number | null;
  pricingMaxINR: number | null;
  assessments: AssessmentOfferingType[];
}
