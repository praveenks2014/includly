import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc } from "drizzle-orm";
import {
  db,
  communityPostsTable,
  communityAnswersTable,
  communityPostSummariesTable,
  professionalProfilesTable,
} from "@workspace/db";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { requireAuth } from "../middlewares/requireAuth";
import { z } from "zod";

const router: IRouter = Router();

const MIN_ANSWERS_FOR_SUMMARY = 5;

// ── POST /community/ai/similar — check for similar existing threads ───────────
// Call this before posting a question; returns up to 3 semantically similar posts
const similarCheckSchema = z.object({
  title: z.string().min(5).max(200),
  body: z.string().max(5000).optional(),
});

router.post(
  "/community/ai/similar",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = similarCheckSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }

    const { title, body } = parsed.data;

    // Fetch the last 100 posts for context (titles only, to keep prompt small)
    const recentPosts = await db
      .select({
        id: communityPostsTable.id,
        title: communityPostsTable.title,
        topicTag: communityPostsTable.topicTag,
        answerCount: communityPostsTable.answerCount,
      })
      .from(communityPostsTable)
      .where(eq(communityPostsTable.isHidden, false))
      .orderBy(desc(communityPostsTable.createdAt))
      .limit(100);

    if (recentPosts.length === 0) {
      res.json({ similar: [] });
      return;
    }

    const postList = recentPosts
      .map((p) => `[${p.id}] ${p.title} (${p.answerCount} answers, topic: ${p.topicTag})`)
      .join("\n");

    const prompt = `You are helping a parent on a special needs support platform. They are about to post a question.

Their question: "${title}"
${body ? `Additional context: "${body.slice(0, 300)}"` : ""}

Here are recent forum threads:
${postList}

Return the IDs of up to 3 threads that are most similar or closely related to the parent's question. Only return IDs of threads that are genuinely similar. If none are similar, return an empty array.

Reply ONLY with a JSON array of integer IDs, e.g. [12, 45] or []. No explanation.`;

    try {
      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 256,
        messages: [{ role: "user", content: prompt }],
      });

      const block = message.content[0];
      const raw = block.type === "text" ? block.text.trim() : "[]";
      let ids: number[] = [];
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          ids = parsed.filter((x: unknown) => typeof x === "number").slice(0, 3);
        }
      } catch {
        ids = [];
      }

      const similar = recentPosts
        .filter((p) => ids.includes(p.id))
        .map((p) => ({ id: p.id, title: p.title, topicTag: p.topicTag, answerCount: p.answerCount }));

      res.json({ similar });
    } catch {
      res.json({ similar: [] });
    }
  },
);

// ── POST /community/ai/personalised-answer — AI answer for post author ────────
// Called right after a post is created; returns a personalised AI response
const personalisedAnswerSchema = z.object({
  postId: z.number().int().positive(),
});

router.post(
  "/community/ai/personalised-answer",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = personalisedAnswerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }

    const { postId } = parsed.data;
    const userId: number = res.locals["userId"];

    const postRows = await db
      .select({
        id: communityPostsTable.id,
        title: communityPostsTable.title,
        body: communityPostsTable.body,
        topicTag: communityPostsTable.topicTag,
        authorUserId: communityPostsTable.authorUserId,
        isHidden: communityPostsTable.isHidden,
      })
      .from(communityPostsTable)
      .where(eq(communityPostsTable.id, postId))
      .limit(1);

    if (postRows.length === 0 || postRows[0].isHidden) {
      res.status(404).json({ error: "Post not found" });
      return;
    }

    if (postRows[0].authorUserId !== userId) {
      res.status(403).json({ error: "Only the post author can request a personalised answer" });
      return;
    }

    const post = postRows[0];

    const prompt = `You are a warm, knowledgeable assistant on a platform that connects families of children with special needs to specialists in India.

A parent has just asked:
Title: "${post.title}"
Details: "${post.body || "(no additional details provided)"}"
Topic: ${post.topicTag}

Write a helpful, empathetic, personalised response. Focus on:
1. Directly addressing their specific question
2. Practical, actionable guidance a parent can use immediately
3. Suggesting the type of specialist they might consult (e.g. occupational therapist, speech therapist, shadow teacher)
4. Keeping the tone warm and supportive — not clinical

Keep your response under 300 words. Do not use bullet lists — write in natural flowing paragraphs. Do not start with "I" or phrases like "I understand" or "I can see".`;

    try {
      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }],
      });

      const block = message.content[0];
      const answer = block.type === "text" ? block.text.trim() : "";
      res.json({ answer });
    } catch {
      res.status(500).json({ error: "Failed to generate answer" });
    }
  },
);

// ── GET /community/posts/:id/summary — get or generate AI key-takeaways ───────
// Returns cached summary if available, or generates one on demand.
// Requires 5+ answers.
router.get(
  "/community/posts/:id/summary",
  async (req: Request, res: Response): Promise<void> => {
    const postId = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(postId)) { res.status(400).json({ error: "Invalid id" }); return; }

    const postRows = await db
      .select({
        id: communityPostsTable.id,
        title: communityPostsTable.title,
        body: communityPostsTable.body,
        topicTag: communityPostsTable.topicTag,
        answerCount: communityPostsTable.answerCount,
        isHidden: communityPostsTable.isHidden,
      })
      .from(communityPostsTable)
      .where(eq(communityPostsTable.id, postId))
      .limit(1);

    if (postRows.length === 0 || postRows[0].isHidden) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const post = postRows[0];

    if (post.answerCount < MIN_ANSWERS_FOR_SUMMARY) {
      res.status(422).json({
        error: "Not enough answers",
        answerCount: post.answerCount,
        required: MIN_ANSWERS_FOR_SUMMARY,
      });
      return;
    }

    // Return cached summary if it exists and was generated with the same or more answers
    const existing = await db
      .select()
      .from(communityPostSummariesTable)
      .where(eq(communityPostSummariesTable.postId, postId))
      .limit(1);

    if (existing.length > 0 && existing[0].answerCountAtGeneration >= post.answerCount) {
      res.json({ summary: existing[0].summary, cached: true });
      return;
    }

    // Fetch visible answers for summarisation
    const answerRows = await db
      .select({
        id: communityAnswersTable.id,
        body: communityAnswersTable.body,
        upvoteCount: communityAnswersTable.upvoteCount,
        professionalName: professionalProfilesTable.fullName,
        specialty: professionalProfilesTable.specialty,
        isVerified: professionalProfilesTable.isVerified,
      })
      .from(communityAnswersTable)
      .leftJoin(professionalProfilesTable, eq(communityAnswersTable.authorProfessionalId, professionalProfilesTable.id))
      .where(and(
        eq(communityAnswersTable.postId, postId),
        eq(communityAnswersTable.isHidden, false),
      ))
      .orderBy(desc(communityAnswersTable.upvoteCount), communityAnswersTable.createdAt);

    const answersText = answerRows
      .map((a, i) =>
        `Answer ${i + 1} by ${a.professionalName ?? "Expert"} (${a.specialty ?? "Specialist"}${a.isVerified ? ", Verified" : ""}):
${a.body}`
      )
      .join("\n\n");

    const prompt = `You are summarising expert answers on a special needs support forum for parents in India.

The parent asked: "${post.title}"
${post.body ? `Their context: "${post.body.slice(0, 400)}"` : ""}

Expert answers:
${answersText}

Write a concise "Key Takeaways" summary (under 200 words) that:
1. Extracts the most actionable and agreed-upon points from the expert answers
2. Highlights any specialist recommendations
3. Uses bullet points (3–5 bullets max) starting with "•"
4. Is written for a parent — warm, clear, and jargon-free

Start directly with the bullets. Do not include a heading or preamble.`;

    try {
      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }],
      });

      const block = message.content[0];
      const summary = block.type === "text" ? block.text.trim() : "";

      // Upsert the cached summary
      if (existing.length > 0) {
        await db
          .update(communityPostSummariesTable)
          .set({ summary, answerCountAtGeneration: post.answerCount })
          .where(eq(communityPostSummariesTable.postId, postId));
      } else {
        await db
          .insert(communityPostSummariesTable)
          .values({ postId, summary, answerCountAtGeneration: post.answerCount });
      }

      res.json({ summary, cached: false });
    } catch {
      res.status(500).json({ error: "Failed to generate summary" });
    }
  },
);

export default router;
