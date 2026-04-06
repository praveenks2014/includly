import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, ratingsTable, professionalProfilesTable, usersTable } from "@workspace/db";
import { requireAuth, requireRole, optionalAuth } from "../middlewares/requireAuth";
import {
  CreateRatingBody,
  GetRatingsForProfessionalParams,
} from "@workspace/api-zod";
import { notifyProfessionalOnReview } from "../lib/notificationService";

const router: IRouter = Router();

function anonymizeName(fullName: string | null | undefined): string {
  if (!fullName) return "Anonymous";
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!;
  const firstName = parts[0]!;
  const surnameInitial = parts[parts.length - 1]![0]?.toUpperCase() ?? "";
  return `${firstName} ${surnameInitial}.`;
}

async function recalcRating(professionalId: number): Promise<void> {
  const allRatings = await db
    .select({ score: ratingsTable.score })
    .from(ratingsTable)
    .where(eq(ratingsTable.professionalId, professionalId));

  const totalRatings = allRatings.length;
  const avgScore =
    totalRatings > 0
      ? allRatings.reduce((sum, r) => sum + r.score, 0) / totalRatings
      : null;

  const [profile] = await db
    .select()
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.id, professionalId))
    .limit(1);

  await db
    .update(professionalProfilesTable)
    .set({ averageRating: avgScore, totalRatings })
    .where(eq(professionalProfilesTable.id, professionalId));
}

router.post("/ratings", requireAuth, requireRole("parent", "admin"), async (req, res): Promise<void> => {
  const parsed = CreateRatingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { professionalId, score, comment } = parsed.data;

  if (score < 1 || score > 5) {
    res.status(400).json({ error: "Score must be between 1 and 5" });
    return;
  }

  const [existing] = await db
    .select()
    .from(ratingsTable)
    .where(
      and(
        eq(ratingsTable.parentId, req.userId!),
        eq(ratingsTable.professionalId, professionalId),
      ),
    )
    .limit(1);

  let rating;
  if (existing) {
    const [updated] = await db
      .update(ratingsTable)
      .set({ score, comment: comment ?? null })
      .where(eq(ratingsTable.id, existing.id))
      .returning();
    rating = updated;
  } else {
    const [created] = await db
      .insert(ratingsTable)
      .values({
        parentId: req.userId!,
        professionalId,
        score,
        comment: comment ?? null,
      })
      .returning();
    rating = created;
  }

  await recalcRating(professionalId);

  const [professional] = await db
    .select({ userId: professionalProfilesTable.userId })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.id, professionalId))
    .limit(1);
  if (professional) {
    void notifyProfessionalOnReview(professional.userId).catch(() => {});
  }

  const [reviewer] = await db
    .select({ fullName: usersTable.fullName })
    .from(usersTable)
    .where(eq(usersTable.id, req.userId!))
    .limit(1);

  res.status(201).json({
    ...rating,
    reviewerName: anonymizeName(reviewer?.fullName),
    createdAt: rating!.createdAt.toISOString(),
    updatedAt: rating!.updatedAt.toISOString(),
  });
});

router.get("/ratings/professional/:id", optionalAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetRatingsForProfessionalParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const ratings = await db
    .select({
      id: ratingsTable.id,
      parentId: ratingsTable.parentId,
      professionalId: ratingsTable.professionalId,
      score: ratingsTable.score,
      comment: ratingsTable.comment,
      createdAt: ratingsTable.createdAt,
      updatedAt: ratingsTable.updatedAt,
      reviewerFullName: usersTable.fullName,
    })
    .from(ratingsTable)
    .leftJoin(usersTable, eq(ratingsTable.parentId, usersTable.id))
    .where(eq(ratingsTable.professionalId, params.data.id))
    .orderBy(ratingsTable.createdAt);

  const result = ratings.map((r) => ({
    id: r.id,
    parentId: r.parentId,
    professionalId: r.professionalId,
    score: r.score,
    comment: r.comment ?? null,
    reviewerName: anonymizeName(r.reviewerFullName),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  res.json(result);
});

router.get("/ratings/my/:professionalId", requireAuth, requireRole("parent", "admin"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.professionalId) ? req.params.professionalId[0] : req.params.professionalId;
  const professionalId = parseInt(raw!, 10);
  if (isNaN(professionalId)) {
    res.status(400).json({ error: "Invalid professionalId" });
    return;
  }

  const [rating] = await db
    .select()
    .from(ratingsTable)
    .where(
      and(
        eq(ratingsTable.parentId, req.userId!),
        eq(ratingsTable.professionalId, professionalId),
      ),
    )
    .limit(1);

  const [reviewer] = await db
    .select({ fullName: usersTable.fullName })
    .from(usersTable)
    .where(eq(usersTable.id, req.userId!))
    .limit(1);

  res.json({
    rating: rating
      ? {
          ...rating,
          reviewerName: anonymizeName(reviewer?.fullName),
          createdAt: rating.createdAt.toISOString(),
          updatedAt: rating.updatedAt.toISOString(),
        }
      : null,
  });
});

export default router;
