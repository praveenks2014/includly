import { useQuery, useMutation, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
import type {
  CommunityPostListItem,
  CommunityPostDetail,
  CreatePostBody,
  CreateAnswerBody,
  ReportBody,
  CommunityReportAdminItem,
  ResourceItem,
  PlusStatusResponse,
} from "./community-types";

// ─── Query keys ───────────────────────────────────────────────────────────────

export const getCommunityPostsQueryKey = (topic?: string, page?: number) =>
  ["community", "posts", topic ?? "all", page ?? 1] as const;

export const getCommunityPostDetailQueryKey = (id: number) =>
  ["community", "posts", id] as const;

export const getCommunityAdminReportsQueryKey = (status?: string) =>
  ["community", "admin", "reports", status ?? "pending"] as const;

export const getResourcesQueryKey = (category?: string) =>
  ["resources", category ?? "all"] as const;

export const getPlusStatusQueryKey = () =>
  ["resources", "plus-status"] as const;

// ─── Resources hooks ──────────────────────────────────────────────────────────

export function useGetResources(
  category?: string,
  options?: Omit<UseQueryOptions<ResourceItem[], unknown, ResourceItem[], readonly unknown[]>, "queryKey" | "queryFn">,
) {
  return useQuery<ResourceItem[], unknown, ResourceItem[], readonly unknown[]>({
    queryKey: getResourcesQueryKey(category),
    queryFn: () => customFetch<ResourceItem[]>(`/api/resources${category && category !== "all" ? `?category=${category}` : ""}`),
    ...options,
  });
}

export function useGetPlusStatus(
  options?: Omit<UseQueryOptions<PlusStatusResponse, unknown, PlusStatusResponse, readonly unknown[]>, "queryKey" | "queryFn">,
) {
  return useQuery<PlusStatusResponse, unknown, PlusStatusResponse, readonly unknown[]>({
    queryKey: getPlusStatusQueryKey(),
    queryFn: () => customFetch<PlusStatusResponse>("/api/resources/plus-status"),
    ...options,
  });
}

// ─── Community hooks ──────────────────────────────────────────────────────────

export function useGetCommunityPosts(
  topic?: string,
  page?: number,
  options?: Omit<UseQueryOptions<{ posts: CommunityPostListItem[]; page: number; hasMore: boolean }, unknown, { posts: CommunityPostListItem[]; page: number; hasMore: boolean }, readonly unknown[]>, "queryKey" | "queryFn">,
) {
  return useQuery({
    queryKey: getCommunityPostsQueryKey(topic, page),
    queryFn: () => {
      const params = new URLSearchParams();
      if (topic && topic !== "all") params.set("topic", topic);
      if (page && page > 1) params.set("page", String(page));
      const qs = params.toString();
      return customFetch<{ posts: CommunityPostListItem[]; page: number; hasMore: boolean }>(
        `/api/community/posts${qs ? `?${qs}` : ""}`,
      );
    },
    ...options,
  });
}

export function useGetCommunityPostDetail(
  id: number,
  options?: Omit<UseQueryOptions<CommunityPostDetail, unknown, CommunityPostDetail, readonly unknown[]>, "queryKey" | "queryFn">,
) {
  return useQuery<CommunityPostDetail, unknown, CommunityPostDetail, readonly unknown[]>({
    queryKey: getCommunityPostDetailQueryKey(id),
    queryFn: () => customFetch<CommunityPostDetail>(`/api/community/posts/${id}`),
    enabled: id > 0,
    ...options,
  });
}

export function useCreatePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePostBody) =>
      customFetch<{ id: number }>("/api/community/posts", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["community", "posts"] });
    },
  });
}

export function useUpvotePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (postId: number) =>
      customFetch<{ voted: boolean }>(`/api/community/posts/${postId}/upvote`, { method: "POST" }),
    onSuccess: (_data, postId) => {
      qc.invalidateQueries({ queryKey: ["community", "posts"] });
      qc.invalidateQueries({ queryKey: getCommunityPostDetailQueryKey(postId) });
    },
  });
}

export function useCreateAnswer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ postId, body }: { postId: number; body: CreateAnswerBody }) =>
      customFetch<{ id: number }>(`/api/community/posts/${postId}/answers`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (_data, { postId }) => {
      qc.invalidateQueries({ queryKey: getCommunityPostDetailQueryKey(postId) });
      qc.invalidateQueries({ queryKey: ["community", "posts"] });
    },
  });
}

export function useUpvoteAnswer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ answerId, postId }: { answerId: number; postId: number }) =>
      customFetch<{ voted: boolean }>(`/api/community/answers/${answerId}/upvote`, { method: "POST" }),
    onSuccess: (_data, { postId }) => {
      qc.invalidateQueries({ queryKey: getCommunityPostDetailQueryKey(postId) });
    },
  });
}

export function useReportPost() {
  return useMutation({
    mutationFn: ({ postId, body }: { postId: number; body: ReportBody }) =>
      customFetch<{ ok: boolean }>(`/api/community/posts/${postId}/report`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
  });
}

export function useReportAnswer() {
  return useMutation({
    mutationFn: ({ answerId, body }: { answerId: number; body: ReportBody }) =>
      customFetch<{ ok: boolean }>(`/api/community/answers/${answerId}/report`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
  });
}

// ─── Admin moderation hooks ───────────────────────────────────────────────────

export function useGetCommunityAdminReports(
  status?: string,
  options?: Omit<UseQueryOptions<CommunityReportAdminItem[], unknown, CommunityReportAdminItem[], readonly unknown[]>, "queryKey" | "queryFn">,
) {
  return useQuery<CommunityReportAdminItem[], unknown, CommunityReportAdminItem[], readonly unknown[]>({
    queryKey: getCommunityAdminReportsQueryKey(status),
    queryFn: () =>
      customFetch<CommunityReportAdminItem[]>(`/api/community/admin/reports${status ? `?status=${status}` : ""}`),
    ...options,
  });
}

export function useResolveReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: number; action: "resolve" | "dismiss" }) =>
      customFetch<{ ok: boolean }>(`/api/community/admin/reports/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["community", "admin", "reports"] });
    },
  });
}

export function useSetPostVisibility() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, hidden }: { id: number; hidden: boolean }) =>
      customFetch<{ ok: boolean }>(`/api/community/admin/posts/${id}/visibility`, {
        method: "PATCH",
        body: JSON.stringify({ hidden }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["community"] });
    },
  });
}

export function useSetAnswerVisibility() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, hidden }: { id: number; hidden: boolean }) =>
      customFetch<{ ok: boolean }>(`/api/community/admin/answers/${id}/visibility`, {
        method: "PATCH",
        body: JSON.stringify({ hidden }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["community"] });
    },
  });
}
