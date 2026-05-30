import { useMutation, useQuery } from "@tanstack/react-query";
import type { UseMutationOptions, UseQueryOptions } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
import type {
  AssessmentOfferingType,
  AssessmentReportType,
  AssessmentBookingType,
  AssessmentMatchType,
} from "./assessment-types";

// ── Offerings ─────────────────────────────────────────────────────────────────

export const getAssessmentOfferingsQueryKey = (professionalId: number) =>
  [`/professionals/${professionalId}/assessments`] as const;

export function useGetAssessmentOfferings(
  professionalId: number,
  options?: { query?: Partial<UseQueryOptions<AssessmentOfferingType[]>> },
) {
  return useQuery<AssessmentOfferingType[]>({
    queryKey: getAssessmentOfferingsQueryKey(professionalId),
    queryFn: () => customFetch<AssessmentOfferingType[]>(`/api/professionals/${professionalId}/assessments`),
    enabled: !!professionalId,
    ...options?.query,
  });
}

export const getMyAssessmentOfferingsQueryKey = () => ["/assessments/offerings/mine"] as const;

export function useGetMyAssessmentOfferings(
  options?: { query?: Partial<UseQueryOptions<AssessmentOfferingType[]>> },
) {
  return useQuery<AssessmentOfferingType[]>({
    queryKey: getMyAssessmentOfferingsQueryKey(),
    queryFn: () => customFetch<AssessmentOfferingType[]>("/api/assessments/offerings/mine"),
    ...options?.query,
  });
}

type CreateOfferingVars = {
  title: string;
  assessmentType: string;
  description?: string;
  durationMinutes?: number;
  priceInr: number;
  whatIsIncluded?: string;
};

export function useCreateAssessmentOffering(
  options?: UseMutationOptions<AssessmentOfferingType, Error, CreateOfferingVars>,
) {
  return useMutation<AssessmentOfferingType, Error, CreateOfferingVars>({
    mutationFn: (data) =>
      customFetch<AssessmentOfferingType>("/api/assessments/offerings", {
        method: "POST",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
      }),
    ...options,
  });
}

type UpdateOfferingVars = {
  id: number;
  data: Partial<{
    title: string;
    assessmentType: string;
    description: string;
    durationMinutes: number;
    priceInr: number;
    whatIsIncluded: string;
    isActive: boolean;
  }>;
};

export function useUpdateAssessmentOffering(
  options?: UseMutationOptions<AssessmentOfferingType, Error, UpdateOfferingVars>,
) {
  return useMutation<AssessmentOfferingType, Error, UpdateOfferingVars>({
    mutationFn: ({ id, data }) =>
      customFetch<AssessmentOfferingType>(`/api/assessments/offerings/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
      }),
    ...options,
  });
}

export function useDeleteAssessmentOffering(
  options?: UseMutationOptions<{ success: boolean }, Error, number>,
) {
  return useMutation<{ success: boolean }, Error, number>({
    mutationFn: (id) =>
      customFetch<{ success: boolean }>(`/api/assessments/offerings/${id}`, { method: "DELETE" }),
    ...options,
  });
}

// ── Bookings ──────────────────────────────────────────────────────────────────

export const getMyAssessmentsQueryKey = () => ["/assessments"] as const;

export function useGetMyAssessments(
  options?: { query?: Partial<UseQueryOptions<AssessmentBookingType[]>> },
) {
  return useQuery<AssessmentBookingType[]>({
    queryKey: getMyAssessmentsQueryKey(),
    queryFn: () => customFetch<AssessmentBookingType[]>("/api/assessments"),
    ...options?.query,
  });
}

type BookAssessmentVars = {
  professionalId: number;
  offeringId: number;
  bookedDate: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  childId?: number;
  notes?: string;
};

type BookAssessmentResult = {
  assessmentId: number;
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
  offeringTitle: string;
};

export function useBookAssessment(
  options?: UseMutationOptions<BookAssessmentResult, Error, BookAssessmentVars>,
) {
  return useMutation<BookAssessmentResult, Error, BookAssessmentVars>({
    mutationFn: (data) =>
      customFetch<BookAssessmentResult>("/api/assessments/book", {
        method: "POST",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
      }),
    ...options,
  });
}

type VerifyPaymentVars = {
  assessmentId: number;
  razorpayPaymentId: string;
  razorpayOrderId: string;
  razorpaySignature: string;
};

export function useVerifyAssessmentPayment(
  options?: UseMutationOptions<{ success: boolean; assessmentId: number }, Error, VerifyPaymentVars>,
) {
  return useMutation<{ success: boolean; assessmentId: number }, Error, VerifyPaymentVars>({
    mutationFn: (data) =>
      customFetch<{ success: boolean; assessmentId: number }>("/api/assessments/verify-payment", {
        method: "POST",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
      }),
    ...options,
  });
}

type UpdateStatusVars = {
  bookingId: number;
  status: "completed" | "cancelled_by_parent" | "cancelled_by_professional";
};

export function useUpdateAssessmentStatus(
  options?: UseMutationOptions<AssessmentBookingType, Error, UpdateStatusVars>,
) {
  return useMutation<AssessmentBookingType, Error, UpdateStatusVars>({
    mutationFn: ({ bookingId, status }) =>
      customFetch<AssessmentBookingType>(`/api/assessments/${bookingId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
        headers: { "Content-Type": "application/json" },
      }),
    ...options,
  });
}

// ── Reports ───────────────────────────────────────────────────────────────────

type SubmitReportVars = {
  bookingId: number;
  childId?: number;
  summary?: string;
  observationNotes?: string;
  recommendations?: string;
  diagnosisTags?: string[];
  reportFileKey?: string;
  templateData?: string;
  status?: "draft" | "submitted";
};

export function useSubmitAssessmentReport(
  options?: UseMutationOptions<AssessmentReportType, Error, SubmitReportVars>,
) {
  return useMutation<AssessmentReportType, Error, SubmitReportVars>({
    mutationFn: ({ bookingId, ...data }) =>
      customFetch<AssessmentReportType>(`/api/assessments/${bookingId}/report`, {
        method: "POST",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
      }),
    ...options,
  });
}

type UpdateReportVars = Omit<SubmitReportVars, "childId">;

export function useUpdateAssessmentReport(
  options?: UseMutationOptions<AssessmentReportType, Error, UpdateReportVars>,
) {
  return useMutation<AssessmentReportType, Error, UpdateReportVars>({
    mutationFn: ({ bookingId, ...data }) =>
      customFetch<AssessmentReportType>(`/api/assessments/${bookingId}/report`, {
        method: "PATCH",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
      }),
    ...options,
  });
}

export const getChildReportsQueryKey = (childId: number) =>
  [`/children/${childId}/reports`] as const;

export function useGetChildReports(
  childId: number,
  options?: { query?: Partial<UseQueryOptions<AssessmentReportType[]>> },
) {
  return useQuery<AssessmentReportType[]>({
    queryKey: getChildReportsQueryKey(childId),
    queryFn: () => customFetch<AssessmentReportType[]>(`/api/children/${childId}/reports`),
    enabled: !!childId,
    ...options?.query,
  });
}

export const getAssessmentMatchesQueryKey = (childId: number) =>
  [`/assessments/matches/${childId}`] as const;

export function useGetAssessmentMatches(
  childId: number,
  options?: { query?: Partial<UseQueryOptions<AssessmentMatchType[]>> },
) {
  return useQuery<AssessmentMatchType[]>({
    queryKey: getAssessmentMatchesQueryKey(childId),
    queryFn: () => customFetch<AssessmentMatchType[]>(`/api/assessments/matches/${childId}`),
    enabled: !!childId,
    ...options?.query,
  });
}
