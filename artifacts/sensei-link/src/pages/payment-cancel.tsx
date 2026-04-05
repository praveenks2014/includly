import { Link } from "wouter";
import { XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function PaymentCancelPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6">
          <XCircle size={40} className="text-red-400" />
        </div>
        <h1 className="text-2xl font-serif font-bold text-foreground mb-3">Payment cancelled</h1>
        <p className="text-muted-foreground mb-8">
          No charge was made. You can try again whenever you're ready.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/pricing">
            <Button className="w-full sm:w-auto" data-testid="try-again-btn">Try again</Button>
          </Link>
          <Link href="/dashboard">
            <Button variant="outline" className="w-full sm:w-auto">Go to dashboard</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
