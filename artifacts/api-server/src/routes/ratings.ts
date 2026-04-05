import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, ratingsTable, professionalProfilesTable } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import {
  CreateRatingBody,
  GetRatingsForProfessionalParams,
  GetRatingsForProfessionalResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

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

  const [rating] = await db
    .insert(ratingsTable)
    .values({
      parentId: req.userId!,
      professionalId,
      score,
      comment: comment ?? null,
    })
    .returning();

  const allRatings = await db
    .select({ score: ratingsTable.score })
    .from(ratingsTable)
    .where(eq(ratingsTable.professionalId, professionalId));

  const totalRatings = allRatings.length;
  const avgScore =
    totalRatings > 0
      ? allRatings.reduce((sum, r) => sum + r.score, 0) / totalRatings
      : null;

  await db
    .update(professionalProfilesTable)
    .set({ averageRating: avgScore, totalRatings })
    .where(eq(professionalProfilesTable.id, professionalId));

  res.status(201).json(rating);
});

router.get("/ratings/professional/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetRatingsForProfessionalParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const ratings = await db
    .select()
    .from(ratingsTable)
    .where(eq(ratingsTable.professionalId, params.data.id));

  res.json(GetRatingsForProfessionalResponse.parse(ratings));
});

export default router;
