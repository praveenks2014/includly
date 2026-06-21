import { useState, useRef, useEffect } from "react";
import { useAuth } from "@clerk/react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { BookingWidget } from "@/components/BookingWidget";
import {
  MessageCircle, ThumbsUp, ShieldCheck, Plus, Flag, Send, Loader2,
  Users, Sparkles, ArrowLeft, Bot, AlertCircle, ChevronRight,
} from "lucide-react";
import {
  useGetCommunityPosts,
  useGetCommunityPostDetail,
  useCreatePost,
  useUpvotePost,
  useCreateAnswer,
  useUpvoteAnswer,
  useReportPost,
  useReportAnswer,
  useGetMe,
  getCommunityPostDetailQueryKey,
  type CommunityPostListItem,
} from "@workspace/api-client-react";
import { fetchWithAuth, getApiBase } from "@/lib/api";

const TOPICS = [
  { id: "all", label: "All Topics" },
  { id: "autism", label: "Autism" },
  { id: "adhd", label: "ADHD" },
  { id: "speech", label: "Speech" },
  { id: "sensory", label: "Sensory" },
  { id: "iep", label: "IEP" },
  { id: "behaviour", label: "Behaviour" },
  { id: "therapy", label: "Therapy" },
  { id: "diagnosis", label: "Diagnosis" },
  { id: "general", label: "General" },
];

const TOPIC_COLORS: Record<string, string> = {
  autism:    "bg-blue-50 text-blue-700 border-blue-200",
  adhd:      "bg-orange-50 text-orange-700 border-orange-200",
  speech:    "bg-emerald-50 text-emerald-700 border-emerald-200",
  sensory:   "bg-violet-50 text-violet-700 border-violet-200",
  iep:       "bg-yellow-50 text-yellow-700 border-yellow-200",
  behaviour: "bg-red-50 text-red-700 border-red-200",
  therapy:   "bg-rose-50 text-rose-700 border-rose-200",
  diagnosis: "bg-sky-50 text-sky-700 border-sky-200",
  general:   "bg-gray-50 text-gray-600 border-gray-200",
};

function topicColor(tag: string) {
  return TOPIC_COLORS[tag] ?? TOPIC_COLORS["general"];
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-IN", { month: "short", day: "numeric" });
}

function specialtyLabel(s: string) {
  const MAP: Record<string, string> = {
    shadow_teacher: "Shadow Teacher",
    special_tutor: "Special Educator",
    occupational_therapy: "Occupational Therapist",
    speech_therapy: "Speech Therapist",
    psychiatrist: "Psychiatrist",
    developmental_pediatrician: "Developmental Paediatrician",
    neurologist: "Neurologist",
    therapy_centre: "Therapy Centre",
  };
  return MAP[s] ?? s;
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface SimilarPost {
  id: number;
  title: string;
  topicTag: string;
  answerCount: number;
}

// ─── Report Modal ─────────────────────────────────────────────────────────────
function ReportModal({
  open,
  onClose,
  onSubmit,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
  loading: boolean;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Report this content</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-gray-500">Help us keep Includly safe. Tell us why this content is inappropriate.</p>
          <Textarea
            placeholder="e.g. Misleading advice, inappropriate content..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="resize-none focus-visible:ring-[#2EC4A5]"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            disabled={!reason.trim() || loading}
            className="bg-[#FF6B6B] hover:bg-[#ff5252] text-white border-0"
            onClick={() => onSubmit(reason)}
          >
            {loading ? <Loader2 size={13} className="animate-spin mr-1" /> : null}
            Submit Report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Similar Threads Banner ───────────────────────────────────────────────────
function SimilarThreadsBanner({
  posts,
  onSelect,
  onDismiss,
}: {
  posts: SimilarPost[];
  onSelect: (id: number) => void;
  onDismiss: () => void;
}) {
  if (posts.length === 0) return null;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 mb-4">
      <div className="flex items-start gap-2.5 mb-3">
        <AlertCircle size={16} className="text-amber-600 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-amber-800">Similar questions already exist</p>
          <p className="text-xs text-amber-600 mt-0.5">Your question may already have answers. Check these threads first:</p>
        </div>
      </div>
      <div className="space-y-2">
        {posts.map((p) => (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            className="w-full text-left flex items-center justify-between gap-2 rounded-lg bg-white border border-amber-200 px-3 py-2 hover:border-amber-400 transition-colors"
          >
            <span className="text-xs text-gray-700 font-medium line-clamp-1 flex-1">{p.title}</span>
            <span className="text-xs text-gray-400 shrink-0">{p.answerCount} answer{p.answerCount !== 1 ? "s" : ""}</span>
            <ChevronRight size={13} className="text-gray-400 shrink-0" />
          </button>
        ))}
      </div>
      <button
        onClick={onDismiss}
        className="mt-3 text-xs text-amber-700 hover:text-amber-900 underline underline-offset-2"
      >
        My question is different — post anyway
      </button>
    </div>
  );
}

// ─── Ask Question Modal ───────────────────────────────────────────────────────
function AskModal({
  open,
  onClose,
  onPostCreated,
}: {
  open: boolean;
  onClose: () => void;
  onPostCreated: (postId: number) => void;
}) {
  const { toast } = useToast();
  const { mutateAsync, isPending } = useCreatePost();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [topicTag, setTopicTag] = useState("general");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [similarPosts, setSimilarPosts] = useState<SimilarPost[]>([]);
  const [similarDismissed, setSimilarDismissed] = useState(false);
  const [checkingsimilar, setCheckingSimilar] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function reset() {
    setTitle(""); setBody(""); setTopicTag("general"); setIsAnonymous(false);
    setSimilarPosts([]); setSimilarDismissed(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function checkSimilar(t: string, b: string) {
    if (t.trim().length < 10) return;
    setCheckingSimilar(true);
    try {
      const res = await fetchWithAuth(`${getApiBase()}/community/ai/similar`, {
        method: "POST",
        body: JSON.stringify({ title: t.trim(), body: b.trim() }),
      });
      if (res.ok) {
        const data = await res.json() as { similar: SimilarPost[] };
        setSimilarPosts(data.similar ?? []);
      }
    } catch {
    } finally {
      setCheckingSimilar(false);
    }
  }

  function handleTitleChange(v: string) {
    setTitle(v);
    setSimilarDismissed(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => checkSimilar(v, body), 900);
  }

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim().length < 5) {
      toast({ title: "Title is too short", variant: "destructive" }); return;
    }
    if (body.trim().length < 10) {
      toast({ title: "Please add more detail to your question", variant: "destructive" }); return;
    }
    try {
      const post = await mutateAsync({ title: title.trim(), body: body.trim(), topicTag, isAnonymous });
      toast({ title: "Question posted!", description: "Experts will be notified." });
      reset();
      onClose();
      onPostCreated((post as { id: number }).id);
    } catch {
      toast({ title: "Failed to post question", variant: "destructive" });
    }
  }

  const showSimilar = similarPosts.length > 0 && !similarDismissed;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif">Ask a question</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {showSimilar && (
            <SimilarThreadsBanner
              posts={similarPosts}
              onSelect={(id) => { handleClose(); onPostCreated(-1); setTimeout(() => onPostCreated(id), 0); }}
              onDismiss={() => setSimilarDismissed(true)}
            />
          )}
          <div>
            <Label className="text-xs text-gray-500 font-medium">Your question *</Label>
            <div className="relative mt-1">
              <Input
                placeholder="e.g. How do I help my son focus during OT sessions?"
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
                className="focus-visible:ring-[#2EC4A5] pr-8"
                maxLength={200}
              />
              {checkingsimilar && (
                <Loader2 size={13} className="animate-spin absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              )}
            </div>
          </div>
          <div>
            <Label className="text-xs text-gray-500 font-medium">Add context (optional but helpful) *</Label>
            <Textarea
              placeholder="Share relevant details — diagnosis, age, what you've already tried..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              className="mt-1 resize-none focus-visible:ring-[#2EC4A5]"
              maxLength={5000}
            />
          </div>
          <div className="flex gap-4">
            <div className="flex-1">
              <Label className="text-xs text-gray-500 font-medium">Topic</Label>
              <select
                value={topicTag}
                onChange={(e) => setTopicTag(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2EC4A5]"
              >
                {TOPICS.filter((t) => t.id !== "all").map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end pb-0.5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isAnonymous}
                  onChange={(e) => setIsAnonymous(e.target.checked)}
                  className="w-4 h-4 rounded accent-[#2EC4A5]"
                />
                <span className="text-sm text-gray-600">Post anonymously</span>
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={handleClose}>Cancel</Button>
            <Button
              type="submit"
              disabled={isPending}
              className="bg-[#2EC4A5] hover:bg-[#26a88d] text-white border-0 gap-1"
            >
              {isPending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              Post Question
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Answer Form ──────────────────────────────────────────────────────────────
function AnswerForm({ postId, onDone }: { postId: number; onDone: () => void }) {
  const { toast } = useToast();
  const { mutateAsync, isPending } = useCreateAnswer();
  const [body, setBody] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (body.trim().length < 10) {
      toast({ title: "Answer is too short", variant: "destructive" }); return;
    }
    try {
      await mutateAsync({ postId, body: { body: body.trim() } });
      toast({ title: "Answer posted!" });
      setBody("");
      onDone();
    } catch {
      toast({ title: "Failed to post answer", variant: "destructive" });
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-3">
      <Textarea
        placeholder="Share your professional expertise..."
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        className="resize-none focus-visible:ring-[#2EC4A5]"
        maxLength={5000}
      />
      <div className="flex justify-end">
        <Button type="submit" disabled={isPending} size="sm" className="bg-[#2EC4A5] hover:bg-[#26a88d] text-white border-0 gap-1">
          {isPending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          Post Answer
        </Button>
      </div>
    </form>
  );
}

// ─── AI Key Takeaways Block ───────────────────────────────────────────────────
function AiSummaryBlock({ postId, answerCount }: { postId: number; answerCount: number }) {
  const MIN_ANSWERS = 5;
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);

  if (answerCount < MIN_ANSWERS) return null;

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${getApiBase()}/community/posts/${postId}/summary`);
      if (!res.ok) {
        setError("Couldn't generate summary right now. Try again.");
        return;
      }
      const data = await res.json() as { summary: string };
      setSummary(data.summary);
      setRevealed(true);
    } catch {
      setError("Couldn't generate summary right now. Try again.");
    } finally {
      setLoading(false);
    }
  }

  if (revealed && summary) {
    const bullets = summary.split("\n").filter((l) => l.trim().length > 0);
    return (
      <div className="bg-gradient-to-br from-[#1A2340]/5 to-[#2EC4A5]/5 rounded-xl border border-[#2EC4A5]/20 p-5 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-lg bg-[#2EC4A5]/15 flex items-center justify-center">
            <Sparkles size={14} className="text-[#2EC4A5]" />
          </div>
          <span className="font-semibold text-sm text-[#1A2340]">AI Key Takeaways</span>
          <span className="text-xs text-gray-400 ml-auto">Generated from expert answers</span>
        </div>
        <div className="space-y-2">
          {bullets.map((line, i) => (
            <p key={i} className="text-sm text-gray-700 leading-relaxed">{line}</p>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-3 pt-3 border-t border-[#2EC4A5]/10">
          AI-generated summary — always consult a qualified specialist for medical decisions.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-[#2EC4A5]/20 p-4 mb-6 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-[#2EC4A5]/10 flex items-center justify-center shrink-0">
          <Sparkles size={15} className="text-[#2EC4A5]" />
        </div>
        <div>
          <p className="text-sm font-semibold text-[#1A2340]">AI Key Takeaways available</p>
          <p className="text-xs text-gray-500">Summarise {answerCount} expert answers in seconds</p>
        </div>
      </div>
      <div className="shrink-0">
        {error ? (
          <div className="text-right">
            <p className="text-xs text-red-500 mb-1">{error}</p>
            <Button size="sm" variant="outline" className="border-[#2EC4A5] text-[#2EC4A5] text-xs" onClick={handleGenerate}>
              Retry
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            disabled={loading}
            className="bg-[#2EC4A5] hover:bg-[#26a88d] text-white border-0 gap-1.5 text-xs"
            onClick={handleGenerate}
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {loading ? "Generating…" : "Get Summary"}
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── AI Personalised Answer Block ─────────────────────────────────────────────
function AiPersonalisedAnswer({ postId }: { postId: number }) {
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function fetch_() {
      try {
        const res = await fetchWithAuth(`${getApiBase()}/community/ai/personalised-answer`, {
          method: "POST",
          body: JSON.stringify({ postId }),
        });
        if (res.ok && !cancelled) {
          const data = await res.json() as { answer: string };
          setAnswer(data.answer);
        }
      } catch {
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void fetch_();
    return () => { cancelled = true; };
  }, [postId]);

  if (dismissed) return null;

  return (
    <div className="bg-gradient-to-br from-[#1A2340] to-[#2a3660] rounded-xl p-5 mb-6 text-white">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-7 h-7 rounded-lg bg-white/15 flex items-center justify-center">
          <Bot size={14} className="text-[#2EC4A5]" />
        </div>
        <span className="font-semibold text-sm">Includly AI — just for you</span>
        <button
          onClick={() => setDismissed(true)}
          className="ml-auto text-white/40 hover:text-white/70 text-xs transition-colors"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
      {loading ? (
        <div className="space-y-2">
          <div className="h-3.5 bg-white/10 rounded animate-pulse w-full" />
          <div className="h-3.5 bg-white/10 rounded animate-pulse w-5/6" />
          <div className="h-3.5 bg-white/10 rounded animate-pulse w-4/6" />
        </div>
      ) : answer ? (
        <>
          <p className="text-sm text-white/85 leading-relaxed whitespace-pre-wrap">{answer}</p>
          <p className="text-xs text-white/35 mt-3 pt-3 border-t border-white/10">
            AI-generated — not a substitute for professional advice. Experts will answer below.
          </p>
        </>
      ) : (
        <p className="text-sm text-white/60">Experts will answer your question below. Check back soon!</p>
      )}
    </div>
  );
}

// ─── Post Detail (expanded inline) ───────────────────────────────────────────
function PostDetail({
  postId,
  onBack,
}: {
  postId: number;
  onBack: () => void;
}) {
  const { isSignedIn } = useAuth();
  const { data: me } = useGetMe();
  const { toast } = useToast();
  const { data: post, isLoading } = useGetCommunityPostDetail(postId);
  const { mutate: upvotePost, isPending: upvotingPost } = useUpvotePost();
  const { mutate: upvoteAnswer } = useUpvoteAnswer();
  const { mutateAsync: reportPost, isPending: reportingPost } = useReportPost();
  const { mutateAsync: reportAnswer, isPending: reportingAnswer } = useReportAnswer();

  const [showAnswerForm, setShowAnswerForm] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ type: "post" | "answer"; id: number } | null>(null);
  const [bookingProfessional, setBookingProfessional] = useState<{
    id: number; name: string | null; specialty: string;
  } | null>(null);

  const isProfessional = me?.role === "professional";
  const isAuthor = !!(me && post && me.id === (post as { authorUserId?: number }).authorUserId);

  async function handleReport(reason: string) {
    if (!reportTarget) return;
    try {
      if (reportTarget.type === "post") {
        await reportPost({ postId: reportTarget.id, body: { reason } });
      } else {
        await reportAnswer({ answerId: reportTarget.id, body: { reason } });
      }
      toast({ title: "Report submitted. Thank you for keeping our community safe." });
      setReportTarget(null);
    } catch {
      toast({ title: "Failed to submit report", variant: "destructive" });
    }
  }

  if (isLoading) return (
    <div className="space-y-4">
      <div className="h-8 w-3/4 bg-gray-200 rounded animate-pulse" />
      <div className="h-24 bg-gray-100 rounded animate-pulse" />
    </div>
  );
  if (!post) return null;

  return (
    <div>
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#2EC4A5] mb-6 transition-colors"
        aria-label="Back to questions"
      >
        <ArrowLeft size={14} />
        Back to questions
      </button>

      {/* Post */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-[0_4px_24px_rgba(26,35,64,0.08)] mb-6">
        <div className="flex items-start justify-between gap-3 mb-3">
          <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full border ${topicColor(post.topicTag)}`}>
            {TOPICS.find((t) => t.id === post.topicTag)?.label ?? post.topicTag}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">{timeAgo(post.createdAt as unknown as string)}</span>
            {isSignedIn && (
              <button
                onClick={() => setReportTarget({ type: "post", id: post.id })}
                className="p-1 text-gray-300 hover:text-[#FF6B6B] transition-colors"
                aria-label="Report this question"
                title="Report"
              >
                <Flag size={13} />
              </button>
            )}
          </div>
        </div>
        <h2 className="font-serif text-xl font-bold text-[#1A2340] mb-3">{post.title}</h2>
        <p className="text-gray-700 leading-relaxed whitespace-pre-wrap text-sm">{post.body}</p>
        <div className="flex items-center justify-between mt-5 pt-4 border-t border-gray-50">
          <span className="text-xs text-gray-400">{post.isAnonymous ? "Anonymous parent" : (post.authorName ?? "Parent")}</span>
          <button
            onClick={() => isSignedIn ? upvotePost(post.id) : void 0}
            disabled={upvotingPost || !isSignedIn}
            className={`flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg transition-colors ${
              post.hasVoted
                ? "bg-[#2EC4A5]/15 text-[#2EC4A5]"
                : "text-gray-500 hover:bg-gray-50"
            } disabled:opacity-50`}
            aria-label="Upvote question"
          >
            <ThumbsUp size={14} />
            {post.upvoteCount}
          </button>
        </div>
      </div>

      {/* AI Personalised Answer — only shown to the post author */}
      {isAuthor && <AiPersonalisedAnswer postId={post.id} />}

      {/* AI Key Takeaways — on-demand for other viewers, shown when 5+ answers */}
      {!isAuthor && <AiSummaryBlock postId={post.id} answerCount={post.answerCount} />}

      {/* Answers */}
      <div className="mb-6">
        <h3 className="font-serif text-lg font-bold text-[#1A2340] mb-4">
          {post.answers.length} Expert {post.answers.length === 1 ? "Answer" : "Answers"}
        </h3>

        {post.answers.length === 0 && !isProfessional && (
          <div className="bg-white rounded-xl border border-dashed border-gray-200 p-8 text-center">
            <Sparkles size={28} className="text-[#2EC4A5] mx-auto mb-3 opacity-60" />
            <p className="text-gray-500 text-sm">No expert answers yet.</p>
            <p className="text-gray-400 text-xs mt-1">Verified professionals can answer below.</p>
          </div>
        )}

        <div className="space-y-4">
          {post.answers.map((answer) => (
            <div
              key={answer.id}
              className="bg-white rounded-xl border border-gray-100 p-5 shadow-[0_2px_12px_rgba(26,35,64,0.06)]"
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm text-[#1A2340]">
                    {answer.professional.fullName ?? "Expert"}
                  </span>
                  <span className="text-xs text-gray-500">
                    {specialtyLabel(answer.professional.specialty)}
                  </span>
                  {answer.professional.isVerified && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-[#2EC4A5]/10 text-[#2EC4A5] border border-[#2EC4A5]/20">
                      <ShieldCheck size={11} />
                      Verified Expert
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-xs text-gray-400">{timeAgo(answer.createdAt as unknown as string)}</span>
                  {isSignedIn && (
                    <button
                      onClick={() => setReportTarget({ type: "answer", id: answer.id })}
                      className="p-1 text-gray-300 hover:text-[#FF6B6B] transition-colors"
                      aria-label="Report this answer"
                      title="Report"
                    >
                      <Flag size={12} />
                    </button>
                  )}
                </div>
              </div>

              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{answer.body}</p>

              <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-50">
                <button
                  onClick={() => isSignedIn ? upvoteAnswer({ answerId: answer.id, postId: post.id }) : void 0}
                  disabled={!isSignedIn}
                  className={`flex items-center gap-1.5 text-sm font-medium px-2.5 py-1 rounded-lg transition-colors ${
                    answer.hasVoted
                      ? "bg-[#2EC4A5]/15 text-[#2EC4A5]"
                      : "text-gray-400 hover:bg-gray-50"
                  } disabled:opacity-50`}
                  aria-label="Upvote answer"
                >
                  <ThumbsUp size={13} />
                  {answer.upvoteCount}
                </button>

                <Button
                  size="sm"
                  className="text-xs bg-[#FF6B6B] hover:bg-[#ff5252] text-white border-0 gap-1.5"
                  onClick={() =>
                    setBookingProfessional({
                      id: answer.professional.id,
                      name: answer.professional.fullName,
                      specialty: answer.professional.specialty,
                    })
                  }
                  aria-label={`Book ${answer.professional.fullName ?? "this expert"}`}
                >
                  Book this expert →
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Answer form for professionals */}
      {isProfessional && isSignedIn && (
        <div className="bg-white rounded-xl border border-[#2EC4A5]/20 p-5 shadow-[0_2px_12px_rgba(26,35,64,0.06)]">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck size={16} className="text-[#2EC4A5]" />
            <span className="font-semibold text-sm text-[#1A2340]">Answer as a verified expert</span>
          </div>
          {showAnswerForm ? (
            <AnswerForm postId={post.id} onDone={() => setShowAnswerForm(false)} />
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="border-[#2EC4A5] text-[#2EC4A5] hover:bg-[#2EC4A5]/5"
              onClick={() => setShowAnswerForm(true)}
            >
              Write an answer
            </Button>
          )}
        </div>
      )}

      {!isSignedIn && (
        <div className="bg-[#F5F7FA] rounded-xl border border-gray-200 p-5 text-center">
          <p className="text-sm text-gray-600 mb-3">Sign in to upvote answers and book experts.</p>
          <a href="/sign-in">
            <Button size="sm" className="bg-[#2EC4A5] hover:bg-[#26a88d] text-white border-0">Sign In</Button>
          </a>
        </div>
      )}

      {/* Booking dialog */}
      <Dialog open={!!bookingProfessional} onOpenChange={(v) => !v && setBookingProfessional(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-serif">
              Book {bookingProfessional?.name ?? "Expert"}
            </DialogTitle>
          </DialogHeader>
          {bookingProfessional && (
            <BookingWidget
              professionalId={bookingProfessional.id}
              professionalName={bookingProfessional.name}
              specialty={bookingProfessional.specialty}
              offersHomeVisits={false}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Report modal */}
      <ReportModal
        open={!!reportTarget}
        onClose={() => setReportTarget(null)}
        onSubmit={handleReport}
        loading={reportingPost || reportingAnswer}
      />
    </div>
  );
}

// ─── Post List Item ───────────────────────────────────────────────────────────
function PostCard({
  post,
  onSelect,
}: {
  post: CommunityPostListItem;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className="w-full text-left bg-white rounded-xl border border-gray-100 p-5 shadow-[0_2px_12px_rgba(26,35,64,0.06)] hover:shadow-[0_4px_24px_rgba(26,35,64,0.10)] transition-shadow focus-visible:ring-2 focus-visible:ring-[#2EC4A5]"
      aria-label={`View question: ${post.title}`}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <span className={`inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full border ${topicColor(post.topicTag)}`}>
          {TOPICS.find((t) => t.id === post.topicTag)?.label ?? post.topicTag}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          {post.answerCount >= 5 && (
            <span className="inline-flex items-center gap-1 text-xs text-[#2EC4A5] font-medium">
              <Sparkles size={10} />
              AI Summary
            </span>
          )}
          <span className="text-xs text-gray-400">{timeAgo(post.createdAt as unknown as string)}</span>
        </div>
      </div>
      <h3 className="font-semibold text-[#1A2340] text-sm leading-snug mb-3">{post.title}</h3>
      <div className="flex items-center gap-4 text-xs text-gray-400">
        <span className="flex items-center gap-1">
          <ThumbsUp size={11} />
          {post.upvoteCount}
        </span>
        <span className="flex items-center gap-1">
          <MessageCircle size={11} />
          {post.answerCount} {post.answerCount === 1 ? "answer" : "answers"}
        </span>
        <span>
          {post.isAnonymous ? "Anonymous" : (post.authorName ?? "Parent")}
        </span>
      </div>
    </button>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ForumPage() {
  const { isSignedIn } = useAuth();
  const [, setLocation] = useLocation();
  const [activeTopic, setActiveTopic] = useState("all");
  const [selectedPostId, setSelectedPostId] = useState<number | null>(null);
  const [showAskModal, setShowAskModal] = useState(false);

  const { data, isLoading } = useGetCommunityPosts(activeTopic === "all" ? undefined : activeTopic);
  const posts = data?.posts ?? [];

  function handleAsk() {
    if (!isSignedIn) {
      setLocation("/sign-in?redirect_url=/forum");
      return;
    }
    setShowAskModal(true);
  }

  function handlePostCreated(postId: number) {
    if (postId > 0) {
      setSelectedPostId(postId);
    }
  }

  function handleSelectPost(postId: number) {
    setSelectedPostId(postId);
  }

  function handleBack() {
    setSelectedPostId(null);
  }

  return (
    <div className="min-h-screen bg-[#F5F7FA]">
      {/* Hero */}
      <div className="bg-gradient-to-br from-[#1A2340] to-[#2a3660] text-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-14 sm:py-18">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6">
            <div>
              <span className="inline-flex items-center gap-1.5 text-[#2EC4A5] text-sm font-semibold mb-3 uppercase tracking-widest">
                <Users size={14} />
                Community Q&amp;A
              </span>
              <h1 className="font-serif text-3xl sm:text-4xl font-bold leading-tight mb-2">
                Ask. Share. Get expert answers.
              </h1>
              <p className="text-white/60 text-sm leading-relaxed max-w-lg">
                Post questions — verified professionals answer with their badge. Turn great answers into booked sessions.
              </p>
            </div>
            <Button
              onClick={handleAsk}
              className="shrink-0 bg-[#2EC4A5] hover:bg-[#26a88d] text-white border-0 gap-2 h-11 px-6 font-semibold"
              aria-label="Ask a question"
            >
              <Plus size={16} />
              Ask a Question
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        {selectedPostId ? (
          <PostDetail
            postId={selectedPostId}
            onBack={handleBack}
          />
        ) : (
          <>
            {/* Topic filters */}
            <div className="flex gap-2 overflow-x-auto pb-3 mb-6 -mx-4 px-4 scrollbar-none">
              {TOPICS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveTopic(t.id)}
                  aria-label={`Filter by ${t.label}`}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-all focus-visible:ring-2 focus-visible:ring-[#2EC4A5] ${
                    activeTopic === t.id
                      ? "bg-[#2EC4A5] text-white border-[#2EC4A5]"
                      : "bg-white text-gray-600 border-gray-200 hover:border-[#2EC4A5]/40"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Posts */}
            {isLoading ? (
              <div className="space-y-3">
                {[1,2,3,4].map((i) => (
                  <div key={i} className="bg-white rounded-xl border border-gray-100 p-5 animate-pulse">
                    <div className="h-4 w-20 bg-gray-200 rounded-full mb-3" />
                    <div className="h-5 w-3/4 bg-gray-100 rounded mb-2" />
                    <div className="h-3 w-32 bg-gray-100 rounded" />
                  </div>
                ))}
              </div>
            ) : posts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-16 h-16 bg-[#2EC4A5]/10 rounded-full flex items-center justify-center mb-4">
                  <MessageCircle size={28} className="text-[#2EC4A5]" />
                </div>
                <p className="font-serif text-xl font-semibold text-[#1A2340] mb-2">No questions yet</p>
                <p className="text-gray-500 text-sm mb-6">Be the first to ask this community!</p>
                <Button onClick={handleAsk} className="bg-[#2EC4A5] hover:bg-[#26a88d] text-white border-0 gap-1">
                  <Plus size={14} /> Ask a Question
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {posts.map((post) => (
                  <PostCard key={post.id} post={post} onSelect={() => handleSelectPost(post.id)} />
                ))}
              </div>
            )}

            {/* Plus perk note */}
            <div className="mt-10 bg-white rounded-xl border border-gray-100 p-5 shadow-[0_2px_12px_rgba(26,35,64,0.06)] flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-[#FFB830]/10 flex items-center justify-center shrink-0">
                <Sparkles size={18} className="text-[#FFB830]" />
              </div>
              <div>
                <p className="font-semibold text-sm text-[#1A2340] mb-0.5">Includly Plus members get priority expert replies</p>
                <p className="text-xs text-gray-500">Posting is free for everyone. Plus members are notified first when a verified expert answers their question.</p>
              </div>
            </div>
          </>
        )}
      </div>

      <AskModal
        open={showAskModal}
        onClose={() => setShowAskModal(false)}
        onPostCreated={handlePostCreated}
      />
    </div>
  );
}
