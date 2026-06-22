import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  db,
  communityPostsTable,
  communityAnswersTable,
  communityPostVotesTable,
  communityAnswerVotesTable,
  communityReportsTable,
  professionalProfilesTable,
  usersTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { notifyCommunityReply } from "../lib/notificationService";
import { z } from "zod";

const router: IRouter = Router();

const TOPICS = ["general", "autism", "adhd", "speech", "sensory", "iep", "behaviour", "therapy", "diagnosis"];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getVotedPostIds(userId: number, postIds: number[]): Promise<Set<number>> {
  if (postIds.length === 0) return new Set();
  const votes = await db
    .select({ postId: communityPostVotesTable.postId })
    .from(communityPostVotesTable)
    .where(
      and(
        eq(communityPostVotesTable.userId, userId),
        sql`${communityPostVotesTable.postId} = ANY(ARRAY[${sql.join(postIds.map((id) => sql`${id}`), sql`, `)}])`,
      ),
    );
  return new Set(votes.map((v) => v.postId));
}

async function getVotedAnswerIds(userId: number, answerIds: number[]): Promise<Set<number>> {
  if (answerIds.length === 0) return new Set();
  const votes = await db
    .select({ answerId: communityAnswerVotesTable.answerId })
    .from(communityAnswerVotesTable)
    .where(
      and(
        eq(communityAnswerVotesTable.userId, userId),
        sql`${communityAnswerVotesTable.answerId} = ANY(ARRAY[${sql.join(answerIds.map((id) => sql`${id}`), sql`, `)}])`,
      ),
    );
  return new Set(votes.map((v) => v.answerId));
}

// ── Public / Auth-optional routes ─────────────────────────────────────────────

// GET /community/topics
router.get("/community/topics", (_req: Request, res: Response): void => {
  res.json(TOPICS);
});

// GET /community/posts
router.get("/community/posts", async (req: Request, res: Response): Promise<void> => {
  const topic = req.query["topic"] as string | undefined;
  const page = Math.max(1, parseInt(String(req.query["page"] ?? "1"), 10));
  const limit = 20;
  const offset = (page - 1) * limit;
  const userId: number | undefined = res.locals["userId"];

  const rows = await db
    .select({
      id: communityPostsTable.id,
      title: communityPostsTable.title,
      topicTag: communityPostsTable.topicTag,
      isAnonymous: communityPostsTable.isAnonymous,
      authorUserId: communityPostsTable.authorUserId,
      authorName: usersTable.fullName,
      upvoteCount: communityPostsTable.upvoteCount,
      answerCount: communityPostsTable.answerCount,
      createdAt: communityPostsTable.createdAt,
    })
    .from(communityPostsTable)
    .leftJoin(usersTable, eq(communityPostsTable.authorUserId, usersTable.id))
    .where(
      and(
        eq(communityPostsTable.isHidden, false),
        ...(topic && topic !== "all" ? [eq(communityPostsTable.topicTag, topic)] : []),
      ),
    )
    .orderBy(desc(communityPostsTable.createdAt))
    .limit(limit)
    .offset(offset);

  const votedIds = userId ? await getVotedPostIds(userId, rows.map((r) => r.id)) : new Set<number>();

  const posts = rows.map((r) => ({
    id: r.id,
    title: r.title,
    topicTag: r.topicTag,
    isAnonymous: r.isAnonymous,
    authorName: r.isAnonymous ? null : r.authorName,
    upvoteCount: r.upvoteCount,
    answerCount: r.answerCount,
    hasVoted: votedIds.has(r.id),
    createdAt: r.createdAt,
  }));

  res.json({ posts, page, hasMore: rows.length === limit });
});

// GET /community/posts/:id — post detail with answers
router.get("/community/posts/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const userId: number | undefined = res.locals["userId"];

  const postRows = await db
    .select({
      id: communityPostsTable.id,
      title: communityPostsTable.title,
      body: communityPostsTable.body,
      topicTag: communityPostsTable.topicTag,
      isAnonymous: communityPostsTable.isAnonymous,
      authorUserId: communityPostsTable.authorUserId,
      authorName: usersTable.fullName,
      upvoteCount: communityPostsTable.upvoteCount,
      answerCount: communityPostsTable.answerCount,
      isHidden: communityPostsTable.isHidden,
      createdAt: communityPostsTable.createdAt,
    })
    .from(communityPostsTable)
    .leftJoin(usersTable, eq(communityPostsTable.authorUserId, usersTable.id))
    .where(eq(communityPostsTable.id, id))
    .limit(1);

  if (postRows.length === 0) { res.status(404).json({ error: "Not found" }); return; }
  const post = postRows[0];
  if (post.isHidden) { res.status(404).json({ error: "Not found" }); return; }

  // Use a table alias so we can join users twice (post author + answer author)
  const answerAuthorAlias = usersTable;
  const answerRows = await db
    .select({
      id: communityAnswersTable.id,
      body: communityAnswersTable.body,
      upvoteCount: communityAnswersTable.upvoteCount,
      isHidden: communityAnswersTable.isHidden,
      createdAt: communityAnswersTable.createdAt,
      authorUserId: communityAnswersTable.authorUserId,
      authorUserName: answerAuthorAlias.fullName,
      professionalId: professionalProfilesTable.id,
      professionalName: professionalProfilesTable.fullName,
      specialty: professionalProfilesTable.specialty,
      isVerified: professionalProfilesTable.isVerified,
    })
    .from(communityAnswersTable)
    .leftJoin(professionalProfilesTable, eq(communityAnswersTable.authorProfessionalId, professionalProfilesTable.id))
    .leftJoin(answerAuthorAlias, eq(communityAnswersTable.authorUserId, answerAuthorAlias.id))
    .where(and(
      eq(communityAnswersTable.postId, id),
      eq(communityAnswersTable.isHidden, false),
    ))
    .orderBy(desc(communityAnswersTable.upvoteCount), communityAnswersTable.createdAt);

  const votedPostIds = userId ? await getVotedPostIds(userId, [id]) : new Set<number>();
  const votedAnswerIds = userId ? await getVotedAnswerIds(userId, answerRows.map((a) => a.id)) : new Set<number>();

  const answers = answerRows.map((a) => ({
    id: a.id,
    body: a.body,
    upvoteCount: a.upvoteCount,
    hasVoted: votedAnswerIds.has(a.id),
    isHidden: a.isHidden,
    createdAt: a.createdAt,
    authorName: a.professionalId ? (a.professionalName ?? null) : (a.authorUserName ?? null),
    professional: a.professionalId ? {
      id: a.professionalId,
      fullName: a.professionalName,
      specialty: a.specialty,
      isVerified: a.isVerified ?? false,
    } : null,
  }));

  res.json({
    id: post.id,
    title: post.title,
    body: post.body,
    topicTag: post.topicTag,
    isAnonymous: post.isAnonymous,
    authorName: post.isAnonymous ? null : post.authorName,
    isAuthor: userId != null && post.authorUserId === userId,
    upvoteCount: post.upvoteCount,
    answerCount: post.answerCount,
    hasVoted: votedPostIds.has(id),
    createdAt: post.createdAt,
    answers,
  });
});

// ── Auth-required routes ───────────────────────────────────────────────────────

const createPostSchema = z.object({
  title: z.string().min(5).max(200),
  body: z.string().min(10).max(5000),
  topicTag: z.string().default("general"),
  isAnonymous: z.boolean().default(false),
});

// POST /community/posts
router.post("/community/posts", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.userId!;
  const parsed = createPostSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() }); return; }

  const { title, body, topicTag, isAnonymous } = parsed.data;
  const [post] = await db
    .insert(communityPostsTable)
    .values({ authorUserId: userId, title, body, topicTag, isAnonymous })
    .returning();

  res.status(201).json(post);
});

// POST /community/posts/:id/upvote — toggle upvote
router.post("/community/posts/:id/upvote", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const postId = parseInt(String(req.params["id"] ?? ""), 10);
  const userId = req.userId!;
  if (isNaN(postId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const existing = await db
    .select()
    .from(communityPostVotesTable)
    .where(and(eq(communityPostVotesTable.postId, postId), eq(communityPostVotesTable.userId, userId)))
    .limit(1);

  if (existing.length > 0) {
    await db.delete(communityPostVotesTable).where(
      and(eq(communityPostVotesTable.postId, postId), eq(communityPostVotesTable.userId, userId)),
    );
    await db
      .update(communityPostsTable)
      .set({ upvoteCount: sql`${communityPostsTable.upvoteCount} - 1` })
      .where(eq(communityPostsTable.id, postId));
    res.json({ voted: false });
  } else {
    await db.insert(communityPostVotesTable).values({ postId, userId });
    await db
      .update(communityPostsTable)
      .set({ upvoteCount: sql`${communityPostsTable.upvoteCount} + 1` })
      .where(eq(communityPostsTable.id, postId));
    res.json({ voted: true });
  }
});

// POST /community/posts/:id/report
router.post("/community/posts/:id/report", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const targetId = parseInt(String(req.params["id"] ?? ""), 10);
  const reporterUserId = req.userId!;
  const reason = (req.body as { reason?: string }).reason?.trim() ?? "";
  if (!reason) { res.status(400).json({ error: "Reason required" }); return; }

  const post = await db
    .select({ id: communityPostsTable.id })
    .from(communityPostsTable)
    .where(eq(communityPostsTable.id, targetId))
    .limit(1);
  if (post.length === 0) { res.status(404).json({ error: "Not found" }); return; }

  await db.insert(communityReportsTable).values({ targetType: "post", targetId, reporterUserId, reason });
  res.status(201).json({ ok: true });
});

// POST /community/answers/:id/upvote — toggle upvote
router.post("/community/answers/:id/upvote", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const answerId = parseInt(String(req.params["id"] ?? ""), 10);
  const userId = req.userId!;
  if (isNaN(answerId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const existing = await db
    .select()
    .from(communityAnswerVotesTable)
    .where(and(eq(communityAnswerVotesTable.answerId, answerId), eq(communityAnswerVotesTable.userId, userId)))
    .limit(1);

  if (existing.length > 0) {
    await db.delete(communityAnswerVotesTable).where(
      and(eq(communityAnswerVotesTable.answerId, answerId), eq(communityAnswerVotesTable.userId, userId)),
    );
    await db
      .update(communityAnswersTable)
      .set({ upvoteCount: sql`${communityAnswersTable.upvoteCount} - 1` })
      .where(eq(communityAnswersTable.id, answerId));
    res.json({ voted: false });
  } else {
    await db.insert(communityAnswerVotesTable).values({ answerId, userId });
    await db
      .update(communityAnswersTable)
      .set({ upvoteCount: sql`${communityAnswersTable.upvoteCount} + 1` })
      .where(eq(communityAnswersTable.id, answerId));
    res.json({ voted: true });
  }
});

// POST /community/answers/:id/report
router.post("/community/answers/:id/report", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const targetId = parseInt(String(req.params["id"] ?? ""), 10);
  const reporterUserId = req.userId!;
  const reason = (req.body as { reason?: string }).reason?.trim() ?? "";
  if (!reason) { res.status(400).json({ error: "Reason required" }); return; }

  const answer = await db
    .select({ id: communityAnswersTable.id })
    .from(communityAnswersTable)
    .where(eq(communityAnswersTable.id, targetId))
    .limit(1);
  if (answer.length === 0) { res.status(404).json({ error: "Not found" }); return; }

  await db.insert(communityReportsTable).values({ targetType: "answer", targetId, reporterUserId, reason });
  res.status(201).json({ ok: true });
});

// ── Professional-only ──────────────────────────────────────────────────────────

const createAnswerSchema = z.object({ body: z.string().min(10).max(5000) });

// POST /community/posts/:id/answers — any signed-in user can respond
router.post(
  "/community/posts/:id/answers",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const postId = parseInt(String(req.params["id"] ?? ""), 10);
    const userId = req.userId!;
    const role = req.userRole!;
    if (isNaN(postId)) { res.status(400).json({ error: "Invalid id" }); return; }

    const parsed = createAnswerSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

    const post = await db
      .select({ id: communityPostsTable.id, authorUserId: communityPostsTable.authorUserId })
      .from(communityPostsTable)
      .where(and(eq(communityPostsTable.id, postId), eq(communityPostsTable.isHidden, false)))
      .limit(1);
    if (post.length === 0) { res.status(404).json({ error: "Post not found" }); return; }

    // Resolve professional profile (if any)
    const prof = (role === "professional" || role === "admin")
      ? await db
          .select({ id: professionalProfilesTable.id, isVerified: professionalProfilesTable.isVerified })
          .from(professionalProfilesTable)
          .where(eq(professionalProfilesTable.userId, userId))
          .limit(1)
      : [];

    const [answer] = await db
      .insert(communityAnswersTable)
      .values({
        postId,
        authorProfessionalId: prof.length > 0 ? prof[0].id : null,
        authorUserId: prof.length === 0 ? userId : null,
        body: parsed.data.body,
      })
      .returning();

    await db
      .update(communityPostsTable)
      .set({ answerCount: sql`${communityPostsTable.answerCount} + 1` })
      .where(eq(communityPostsTable.id, postId));

    // Notify the question author (fire-and-forget)
    const [authorUser] = await db
      .select({ fullName: usersTable.fullName })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (post[0].authorUserId !== userId) {
      void notifyCommunityReply(post[0].authorUserId, authorUser?.fullName).catch(() => {});
    }

    res.status(201).json({
      ...answer,
      authorName: authorUser?.fullName ?? null,
      professional: prof.length > 0 ? prof[0] : null,
    });
  },
);

// ── Admin moderation ───────────────────────────────────────────────────────────

// GET /community/admin/reports
router.get(
  "/community/admin/reports",
  requireAuth,
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const status = (req.query["status"] as string) ?? "pending";

    const rows = await db
      .select({
        id: communityReportsTable.id,
        targetType: communityReportsTable.targetType,
        targetId: communityReportsTable.targetId,
        reason: communityReportsTable.reason,
        status: communityReportsTable.status,
        createdAt: communityReportsTable.createdAt,
        reviewedAt: communityReportsTable.reviewedAt,
        reporterName: usersTable.fullName,
        reporterId: usersTable.id,
      })
      .from(communityReportsTable)
      .leftJoin(usersTable, eq(communityReportsTable.reporterUserId, usersTable.id))
      .where(eq(communityReportsTable.status, status as "pending" | "resolved" | "dismissed"))
      .orderBy(desc(communityReportsTable.createdAt))
      .limit(100);

    const enriched = await Promise.all(
      rows.map(async (r) => {
        let targetPreview = "";
        if (r.targetType === "post") {
          const p = await db
            .select({ title: communityPostsTable.title })
            .from(communityPostsTable)
            .where(eq(communityPostsTable.id, r.targetId))
            .limit(1);
          targetPreview = p[0]?.title ?? "(deleted)";
        } else {
          const a = await db
            .select({ body: communityAnswersTable.body })
            .from(communityAnswersTable)
            .where(eq(communityAnswersTable.id, r.targetId))
            .limit(1);
          targetPreview = (a[0]?.body ?? "(deleted)").slice(0, 120);
        }
        return {
          id: r.id,
          targetType: r.targetType,
          targetId: r.targetId,
          reason: r.reason,
          status: r.status,
          createdAt: r.createdAt,
          reviewedAt: r.reviewedAt,
          reporter: { id: r.reporterId, fullName: r.reporterName },
          targetPreview,
        };
      }),
    );

    res.json(enriched);
  },
);

// PATCH /community/admin/reports/:id
router.patch(
  "/community/admin/reports/:id",
  requireAuth,
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    const { action } = req.body as { action: "resolve" | "dismiss" };
    if (!["resolve", "dismiss"].includes(action)) {
      res.status(400).json({ error: "action must be resolve or dismiss" }); return;
    }
    await db
      .update(communityReportsTable)
      .set({
        status: action === "resolve" ? "resolved" : "dismissed",
        reviewedAt: new Date(),
      })
      .where(eq(communityReportsTable.id, id));
    res.json({ ok: true });
  },
);

// PATCH /community/admin/posts/:id/visibility
router.patch(
  "/community/admin/posts/:id/visibility",
  requireAuth,
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    const { hidden } = req.body as { hidden: boolean };
    await db
      .update(communityPostsTable)
      .set({ isHidden: hidden })
      .where(eq(communityPostsTable.id, id));
    res.json({ ok: true });
  },
);

// PATCH /community/admin/answers/:id/visibility
router.patch(
  "/community/admin/answers/:id/visibility",
  requireAuth,
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    const { hidden } = req.body as { hidden: boolean };
    await db
      .update(communityAnswersTable)
      .set({ isHidden: hidden })
      .where(eq(communityAnswersTable.id, id));
    res.json({ ok: true });
  },
);

export default router;
