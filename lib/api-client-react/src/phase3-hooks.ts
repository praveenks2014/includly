import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseMutationOptions, UseQueryOptions } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
import type {
  ChildResponseType,
  ConnectMessageResponseType,
  EngagementResponseType,
  EngagementLogResponse,
  WalletTransactionResponseType,
  CommissionRateResponseType,
  CareNotesType,
  ExistingTherapyType,
} from "./phase3-types";

// ─── Children ──────────────────────────────────────────────────────────────────

export type CreateChildPayload = {
  name: string;
  dob?: string;
  gender?: string;
  city?: string;
  area?: string;
  notes?: string;
  diagnosisStatus?: string;
  conditions?: string[];
  languages?: string[];
  schoolType?: string;
  grade?: string;
  existingTherapies?: ExistingTherapyType[];
  goalsAreas?: string[];
  availableTimeWindows?: string[];
  preferredModes?: string[];
  budgetMinInr?: number | null;
  budgetMaxInr?: number | null;
  careNotes?: CareNotesType;
  consent: { intakeShare: boolean; media: boolean; reports: boolean };
};

export type UpdateChildPayload = {
  id: number;
  data: Partial<Omit<CreateChildPayload, "consent">> & {
    consent?: { intakeShare: boolean; media: boolean; reports: boolean };
  };
};

export const getGetMyChildrenQueryKey = () => ["/children"] as const;

export function useGetMyChildren(options?: { query?: Omit<UseQueryOptions<ChildResponseType[]>, "queryKey" | "queryFn"> }) {
  return useQuery<ChildResponseType[]>({
    queryKey: getGetMyChildrenQueryKey(),
    queryFn: () => customFetch<ChildResponseType[]>("/api/children"),
    ...options?.query,
  });
}

export const getGetChildQueryKey = (id: number) => [`/children/${id}`] as const;

export function useGetChild(id: number, options?: { query?: Omit<UseQueryOptions<ChildResponseType>, "queryKey" | "queryFn"> }) {
  return useQuery<ChildResponseType>({
    queryKey: getGetChildQueryKey(id),
    queryFn: () => customFetch<ChildResponseType>(`/api/children/${id}`),
    enabled: !!id,
    ...options?.query,
  });
}

export function useCreateChild(options?: UseMutationOptions<ChildResponseType, Error, CreateChildPayload>) {
  return useMutation<ChildResponseType, Error, CreateChildPayload>({
    mutationFn: (data) =>
      customFetch<ChildResponseType>("/api/children", {
        method: "POST",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
      }),
    ...options,
  });
}

export function useUpdateChild(options?: UseMutationOptions<ChildResponseType, Error, UpdateChildPayload>) {
  return useMutation<ChildResponseType, Error, UpdateChildPayload>({
    mutationFn: ({ id, data }) =>
      customFetch<ChildResponseType>(`/api/children/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
      }),
    ...options,
  });
}

export function useDeleteChild(options?: UseMutationOptions<{ success: boolean }, Error, number>) {
  return useMutation<{ success: boolean }, Error, number>({
    mutationFn: (id) => customFetch<{ success: boolean }>(`/api/children/${id}`, { method: "DELETE" }),
    ...options,
  });
}

// ─── Connect threads ───────────────────────────────────────────────────────────

export const getConnectThreadQueryKey = (professionalId: number) => [`/connect/${professionalId}/thread`] as const;

export function useGetConnectThread(professionalId: number, options?: { query?: UseQueryOptions<any> }) {
  return useQuery<any>({
    queryKey: getConnectThreadQueryKey(professionalId),
    queryFn: () => customFetch<any>(`/api/connect/${professionalId}/thread`),
    enabled: !!professionalId,
    ...options?.query,
  });
}

export function useSendConnectMessage(options?: UseMutationOptions<ConnectMessageResponseType, Error, { professionalId: number; body: string }>) {
  return useMutation<ConnectMessageResponseType, Error, { professionalId: number; body: string }>({
    mutationFn: ({ professionalId, body }) =>
      customFetch<ConnectMessageResponseType>(`/api/connect/${professionalId}/messages`, {
        method: "POST",
        body: JSON.stringify({ body }),
        headers: { "Content-Type": "application/json" },
      }),
    ...options,
  });
}

export function useGetConnectInbox(options?: { query?: UseQueryOptions<any[]> }) {
  return useQuery<any[]>({
    queryKey: ["/connect/inbox"],
    queryFn: () => customFetch<any[]>("/api/connect/inbox"),
    ...options?.query,
  });
}

// ─── Engagements ───────────────────────────────────────────────────────────────

export const getGetEngagementsQueryKey = () => ["/engagements"] as const;

export function useGetEngagements(options?: { query?: UseQueryOptions<EngagementResponseType[]> }) {
  return useQuery<EngagementResponseType[]>({
    queryKey: getGetEngagementsQueryKey(),
    queryFn: () => customFetch<EngagementResponseType[]>("/api/engagements"),
    ...options?.query,
  });
}

export function useCreateEngagement(options?: UseMutationOptions<EngagementResponseType, Error, any>) {
  return useMutation<EngagementResponseType, Error, any>({
    mutationFn: (data) => customFetch<EngagementResponseType>("/api/engagements", { method: "POST", body: JSON.stringify(data), headers: { "Content-Type": "application/json" } }),
    ...options,
  });
}

export function useUpdateEngagementStatus(options?: UseMutationOptions<EngagementResponseType, Error, { id: number; status: "active" | "paused" | "ended" }>) {
  return useMutation<EngagementResponseType, Error, { id: number; status: "active" | "paused" | "ended" }>({
    mutationFn: ({ id, status }) => customFetch<EngagementResponseType>(`/api/engagements/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }), headers: { "Content-Type": "application/json" } }),
    ...options,
  });
}

export const getGetEngagementLogsQueryKey = (id: number) => [`/engagements/${id}/logs`] as const;

export function useGetEngagementLogs(id: number, options?: { query?: UseQueryOptions<any[]> }) {
  return useQuery<any[]>({
    queryKey: getGetEngagementLogsQueryKey(id),
    queryFn: () => customFetch<any[]>(`/api/engagements/${id}/logs`),
    enabled: !!id,
    ...options?.query,
  });
}

export function useLogEngagementWeek(options?: UseMutationOptions<any, Error, { id: number; weekStartDate: string; hoursLogged: number; notes?: string }>) {
  return useMutation<any, Error, { id: number; weekStartDate: string; hoursLogged: number; notes?: string }>({
    mutationFn: ({ id, ...data }) => customFetch<any>(`/api/engagements/${id}/logs`, { method: "POST", body: JSON.stringify(data), headers: { "Content-Type": "application/json" } }),
    ...options,
  });
}

// ─── Wallet ────────────────────────────────────────────────────────────────────

export const getWalletBalanceQueryKey = () => ["/wallet/balance"] as const;

export function useGetWalletBalance(options?: { query?: UseQueryOptions<{ balanceInr: number }> }) {
  return useQuery<{ balanceInr: number }>({
    queryKey: getWalletBalanceQueryKey(),
    queryFn: () => customFetch<{ balanceInr: number }>("/api/wallet/balance"),
    ...options?.query,
  });
}

export const getWalletHistoryQueryKey = () => ["/wallet/history"] as const;

export function useGetWalletHistory(options?: { query?: UseQueryOptions<{ transactions: WalletTransactionResponseType[]; total: number }> }) {
  return useQuery<{ transactions: WalletTransactionResponseType[]; total: number }>({
    queryKey: getWalletHistoryQueryKey(),
    queryFn: () => customFetch<{ transactions: WalletTransactionResponseType[]; total: number }>("/api/wallet/history"),
    ...options?.query,
  });
}

export function useWalletTopupOrder(options?: UseMutationOptions<any, Error, { amountInr: number }>) {
  return useMutation<any, Error, { amountInr: number }>({
    mutationFn: (data) => customFetch<any>("/api/wallet/topup/order", { method: "POST", body: JSON.stringify(data), headers: { "Content-Type": "application/json" } }),
    ...options,
  });
}

export function useWalletTopupVerify(options?: UseMutationOptions<{ success: boolean; balanceInr: number }, Error, any>) {
  return useMutation<{ success: boolean; balanceInr: number }, Error, any>({
    mutationFn: (data) => customFetch<any>("/api/wallet/topup/verify", { method: "POST", body: JSON.stringify(data), headers: { "Content-Type": "application/json" } }),
    ...options,
  });
}

// ─── Commission rates ──────────────────────────────────────────────────────────

export const getCommissionRatesQueryKey = () => ["/admin/commission-rates"] as const;

export function useGetCommissionRates(options?: { query?: UseQueryOptions<CommissionRateResponseType[]> }) {
  return useQuery<CommissionRateResponseType[]>({
    queryKey: getCommissionRatesQueryKey(),
    queryFn: () => customFetch<CommissionRateResponseType[]>("/api/admin/commission-rates"),
    ...options?.query,
  });
}

export function useUpdateCommissionRate(options?: UseMutationOptions<CommissionRateResponseType, Error, { bookingType: string; ratePct: number; notes?: string; isActive?: boolean }>) {
  return useMutation<CommissionRateResponseType, Error, { bookingType: string; ratePct: number; notes?: string; isActive?: boolean }>({
    mutationFn: ({ bookingType, ...data }) =>
      customFetch<CommissionRateResponseType>(`/api/admin/commission-rates/${bookingType}`, { method: "PATCH", body: JSON.stringify(data), headers: { "Content-Type": "application/json" } }),
    ...options,
  });
}
