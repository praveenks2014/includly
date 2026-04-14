import { useSignIn } from "@clerk/react";
import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const TEST_ACCOUNTS = [
  { label: "Parent", email: "parent.test@sproutly.app", password: "Emerald-09A" },
  { label: "Specialist (Shadow Teacher)", email: "specialist.test@sproutly.app", password: "Emerald-09A" },
  { label: "Therapy Centre", email: "centre.test@sproutly.app", password: "Emerald-09A" },
];

export default function DevSignInPage() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSignIn = async (e?: React.FormEvent, overrideEmail?: string, overridePassword?: string) => {
    e?.preventDefault();
    if (!isLoaded || !signIn) {
      setError("Auth not ready yet — please wait a moment and try again.");
      return;
    }

    const ident = overrideEmail ?? email;
    const pass = overridePassword ?? password;

    setLoading(true);
    setError("");

    try {
      const result = await signIn.create({
        strategy: "password",
        identifier: ident,
        password: pass,
      });

      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
        setLocation(`${basePath}/dashboard`);
      } else {
        setError(`Unexpected status: ${result.status}`);
      }
    } catch (err: any) {
      const msg = err?.errors?.[0]?.longMessage || err?.errors?.[0]?.message || err?.message || "Sign-in failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">
        <Card className="border-dashed border-orange-300 bg-orange-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-orange-800 text-base">Developer Test Login</CardTitle>
            <CardDescription className="text-orange-700">
              Quick sign-in for testing — bypasses email verification. Not visible in production navigation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {TEST_ACCOUNTS.map((acc) => (
              <Button
                key={acc.email}
                variant="outline"
                className="w-full justify-start text-left border-orange-300 hover:bg-orange-100"
                disabled={loading}
                onClick={() => {
                  setEmail(acc.email);
                  setPassword(acc.password);
                  handleSignIn(undefined, acc.email, acc.password);
                }}
              >
                <span className="font-medium text-orange-900">{acc.label}</span>
                <span className="ml-2 text-orange-600 text-xs truncate">{acc.email}</span>
              </Button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sign in with any account</CardTitle>
            <CardDescription>Enter email and password directly</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSignIn} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  required
                />
              </div>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Signing in…" : "Sign In"}
              </Button>
              {!isLoaded && !loading && (
                <p className="text-xs text-center text-muted-foreground">Initialising auth…</p>
              )}
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
