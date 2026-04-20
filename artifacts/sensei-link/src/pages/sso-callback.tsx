import { AuthenticateWithRedirectCallback } from "@clerk/react";
import { Loader2 } from "lucide-react";

export default function SsoCallbackPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="animate-spin text-primary" size={28} />
        <p className="text-sm text-muted-foreground">Completing sign-in…</p>
      </div>
      <AuthenticateWithRedirectCallback />
    </div>
  );
}
