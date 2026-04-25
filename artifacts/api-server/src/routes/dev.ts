import { Router } from "express";

const router = Router();

const ALLOWED_TEST_EMAILS = new Set([
  "parent.test@includly.app",
  "specialist.test@includly.app",
  "centre.test@includly.app",
]);

router.get("/dev/signin", async (req, res) => {
  try {
    const email = String(req.query.email ?? "").toLowerCase().trim();

    if (!ALLOWED_TEST_EMAILS.has(email)) {
      res.status(403).send("Not a permitted test account.");
      return;
    }

    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) {
      res.status(500).send("CLERK_SECRET_KEY not configured.");
      return;
    }

    // 1. Find the user by email
    const usersRes = await fetch(
      `https://api.clerk.com/v1/users?email_address[]=${encodeURIComponent(email)}&limit=1`,
      { headers: { Authorization: `Bearer ${secretKey}` } }
    );
    const usersData = await usersRes.json() as any;
    const userId: string | undefined = usersData?.data?.[0]?.id ?? usersData?.[0]?.id;

    if (!userId) {
      res.status(404).send("User not found in Clerk.");
      return;
    }

    // 2. Create a short-lived sign-in token
    const tokenRes = await fetch("https://api.clerk.com/v1/sign_in_tokens", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ user_id: userId, expires_in_seconds: 300 }),
    });
    const tokenData = await tokenRes.json() as any;
    const clerkUrl: string | undefined = tokenData?.url;

    if (!clerkUrl) {
      res.status(500).send(`Failed to create sign-in token: ${JSON.stringify(tokenData)}`);
      return;
    }

    // 3. Extract just the __clerk_ticket value from the URL Clerk generated
    //    (Clerk may point to accounts.sproutly.replit.app which has no SSL —
    //     we redirect to our own /sign-in instead and let the <SignIn> component
    //     consume the ticket natively)
    const ticket = new URL(clerkUrl).searchParams.get("__clerk_ticket");
    if (!ticket) {
      res.status(500).send("Clerk did not return a ticket in the token URL.");
      return;
    }

    // 4. Build the app's sign-in URL from this request's origin
    const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
    const host = (req.headers["x-forwarded-host"] as string) || req.headers.host || "";
    const appOrigin = `${proto}://${host}`;
    const signInUrl = `${appOrigin}/sign-in?__clerk_ticket=${encodeURIComponent(ticket)}`;

    res.redirect(302, signInUrl);
  } catch (err: any) {
    res.status(500).send(`Unexpected error: ${err?.message}`);
  }
});

export default router;
