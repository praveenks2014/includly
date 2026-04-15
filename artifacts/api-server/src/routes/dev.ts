import { Router } from "express";

const router = Router();

const ALLOWED_TEST_EMAILS = new Set([
  "parent.test@sproutly.app",
  "specialist.test@sproutly.app",
  "centre.test@sproutly.app",
]);

router.get("/dev/signin", async (req, res) => {
  try {
    const email = String(req.query.email ?? "").toLowerCase().trim();

    if (!ALLOWED_TEST_EMAILS.has(email)) {
      res.status(403).json({ error: "Not a permitted test account." });
      return;
    }

    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) {
      res.status(500).json({ error: "CLERK_SECRET_KEY not configured." });
      return;
    }

    const usersRes = await fetch(
      `https://api.clerk.com/v1/users?email_address[]=${encodeURIComponent(email)}&limit=1`,
      { headers: { Authorization: `Bearer ${secretKey}` } }
    );
    const usersData = await usersRes.json() as any;
    const userId: string | undefined = usersData?.data?.[0]?.id ?? usersData?.[0]?.id;

    if (!userId) {
      res.status(404).json({ error: "User not found in Clerk." });
      return;
    }

    const tokenRes = await fetch("https://api.clerk.com/v1/sign_in_tokens", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ user_id: userId, expires_in_seconds: 300 }),
    });
    const tokenData = await tokenRes.json() as any;
    const url: string | undefined = tokenData?.url;

    if (!url) {
      res.status(500).json({ error: "Failed to create sign-in token.", detail: tokenData });
      return;
    }

    res.redirect(302, url);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Unexpected error." });
  }
});

export default router;
