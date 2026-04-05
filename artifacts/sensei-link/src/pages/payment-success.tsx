import { Link, useSearch } from "wouter";
import { CheckCircle2, ArrowRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function PaymentSuccessPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const plan = params.get("plan") ?? "";

  const isSubscription = plan === "plan_a_subscription";
  const isContact = plan === "plan_b_per_contact";
  const isFeatured = plan === "plan_c_featured";

  let title = "Payment successful!";
  let message = "Thank you for your purchase.";

  if (isSubscription) {
    title = "Premium activated!";
    message = "You now have 30 days of unlimited contact access. Start searching for specialists right away.";
  } else if (isContact) {
    title = "Contact unlocked!";
    message = "You can now view the full contact details of the specialist. Head to their profile to get in touch.";
  } else if (isFeatured) {
    title = "You're now featured!";
    message = "Your profile will appear at the top of search results for the next 30 days.";
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 size={40} className="text-green-600" />
        </div>
        <h1 className="text-2xl font-serif font-bold text-foreground mb-3">{title}</h1>
        <p className="text-muted-foreground mb-8">{message}</p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          {isSubscription || isContact ? (
            <Link href="/search">
              <Button className="gap-2 w-full sm:w-auto" data-testid="go-search-btn">
                <Search size={16} />
                Find specialists
              </Button>
            </Link>
          ) : null}
          {isFeatured ? (
            <Link href="/dashboard">
              <Button className="gap-2 w-full sm:w-auto" data-testid="go-dashboard-btn">
                <ArrowRight size={16} />
                View dashboard
              </Button>
            </Link>
          ) : null}
          <Link href="/dashboard">
            <Button variant="outline" className="w-full sm:w-auto">Go to dashboard</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
