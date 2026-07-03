// Best-effort lookup of a Clerk user's primary (verified) email address.
// Reuses the same lightweight REST call pattern as requireAuth's login-time sync,
// so the professional-profile email routes have a single source of truth for
// "the email the professional actually logs in with".
export async function getClerkPrimaryEmail(clerkId: string): Promise<string | null> {
  const clerkSecret = process.env["CLERK_SECRET_KEY"];
  if (!clerkSecret) return null;

  try {
    const res = await fetch(`https://api.clerk.com/v1/users/${clerkId}`, {
      headers: { Authorization: `Bearer ${clerkSecret}` },
    });
    if (!res.ok) return null;

    const cu = (await res.json()) as {
      email_addresses?: { email_address: string; verification?: { status: string } }[];
    };

    return (
      cu.email_addresses?.find((e) => e.verification?.status === "verified")?.email_address ??
      cu.email_addresses?.[0]?.email_address ??
      null
    );
  } catch {
    return null;
  }
}
