export interface CommunityPostListItem {
  id: number;
  title: string;
  topicTag: string;
  isAnonymous: boolean;
  authorName: string | null;
  upvoteCount: number;
  answerCount: number;
  hasVoted: boolean;
  createdAt: string;
}

export interface CommunityAnswerItem {
  id: number;
  body: string;
  upvoteCount: number;
  hasVoted: boolean;
  isHidden: boolean;
  createdAt: string;
  professional: {
    id: number;
    fullName: string | null;
    specialty: string;
    isVerified: boolean;
  };
}

export interface CommunityPostDetail extends CommunityPostListItem {
  body: string;
  answers: CommunityAnswerItem[];
}

export interface CreatePostBody {
  title: string;
  body: string;
  topicTag: string;
  isAnonymous: boolean;
}

export interface CreateAnswerBody {
  body: string;
}

export interface ReportBody {
  reason: string;
}

export interface CommunityReportAdminItem {
  id: number;
  targetType: "post" | "answer";
  targetId: number;
  reason: string;
  status: "pending" | "resolved" | "dismissed";
  createdAt: string;
  reviewedAt: string | null;
  reporter: { id: number; fullName: string | null };
  targetPreview: string;
}

export interface ResourceItem {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  body: string | null;
  author: string;
  category: string;
  tag: string;
  readTimeMinutes: number;
  isPremium: boolean;
  isCourse: boolean;
  coursePricingInr: number | null;
  isPublished: boolean;
  publishedAt: string;
}

export interface PlusStatusResponse {
  isPlus: boolean;
  expiresAt: string | null;
}
