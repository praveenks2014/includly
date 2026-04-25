import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function apiLink(email: string) {
  return `${window.location.origin}${BASE}/api/dev/signin?email=${encodeURIComponent(email)}`;
}

const TEST_ACCOUNTS = [
  { label: "Parent", email: "parent.test@includly.app" },
  { label: "Specialist (Shadow Teacher)", email: "specialist.test@includly.app" },
  { label: "Therapy Centre", email: "centre.test@includly.app" },
];

export default function DevSignInPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-dashed border-orange-300 bg-orange-50">
        <CardHeader>
          <CardTitle className="text-orange-800">Developer Test Login</CardTitle>
          <CardDescription className="text-orange-700">
            Click a button below — you will be signed in automatically and
            redirected to the app. No password needed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {TEST_ACCOUNTS.map((acc) => (
            <Button
              key={acc.email}
              variant="outline"
              className="w-full justify-start text-left border-orange-300 hover:bg-orange-100"
              asChild
            >
              <a href={apiLink(acc.email)}>
                <span className="font-medium text-orange-900">{acc.label}</span>
                <span className="ml-2 text-orange-600 text-xs truncate">{acc.email}</span>
              </a>
            </Button>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
