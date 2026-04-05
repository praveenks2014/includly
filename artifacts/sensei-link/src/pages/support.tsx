import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ArrowLeft, Mail, CheckCircle2 } from "lucide-react";

const FAQ = [
  {
    q: "How do I unlock a professional's contact details?",
    a: "Visit a professional's profile page and click the 'Unlock contact' button. You can unlock contacts individually (Pay-per-contact) or with a subscription plan that gives you unlimited unlocks for 30 days.",
  },
  {
    q: "Can I get a refund after unlocking a contact?",
    a: "No. Once a contact is unlocked, the transaction is final and non-refundable. The professional's contact information is immediately visible to you after payment. If you believe there was a payment error, contact us within 7 days.",
  },
  {
    q: "How are professionals verified?",
    a: "Professionals submit identity documents (Aadhaar or equivalent) and credential certificates. Our team reviews these manually before awarding a verification badge. A verified badge means we have reviewed their documents — it does not guarantee outcomes.",
  },
  {
    q: "I'm a professional — how do I get my profile verified?",
    a: "Create or edit your profile via the 'Edit profile' section, and ensure all credentials are filled in. Then submit your verification documents via email to verify@senseilink.in with your registered phone number and profession details. Our team will review within 3-5 business days.",
  },
];

export default function SupportPage() {
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", message: "" });

  function set(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <Link href="/">
          <Button variant="ghost" size="sm" className="gap-1.5 mb-6 -ml-2">
            <ArrowLeft size={15} />
            Back
          </Button>
        </Link>

        <h1 className="text-3xl font-serif font-semibold text-foreground mb-2">Support</h1>
        <p className="text-muted-foreground mb-10">
          We're here to help. Reach us at{" "}
          <a href="mailto:support@senseilink.in" className="text-primary underline">
            support@senseilink.in
          </a>{" "}
          or use the form below.
        </p>

        <div className="grid sm:grid-cols-2 gap-8">
          {/* Contact form */}
          <div>
            <h2 className="text-lg font-semibold mb-4">Send us a message</h2>
            {submitted ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <CheckCircle2 size={40} className="text-primary" />
                <p className="font-semibold">Message sent!</p>
                <p className="text-sm text-muted-foreground">We'll get back to you within 1-2 business days.</p>
                <Button variant="outline" size="sm" onClick={() => setSubmitted(false)} className="mt-2">
                  Send another message
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="name">Your name</Label>
                  <Input
                    id="name"
                    value={form.name}
                    onChange={(e) => set("name", e.target.value)}
                    placeholder="Priya Sharma"
                    className="mt-1"
                    data-testid="support-name"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="email">Email address</Label>
                  <Input
                    id="email"
                    type="email"
                    value={form.email}
                    onChange={(e) => set("email", e.target.value)}
                    placeholder="you@example.com"
                    className="mt-1"
                    data-testid="support-email"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="message">Message</Label>
                  <Textarea
                    id="message"
                    value={form.message}
                    onChange={(e) => set("message", e.target.value)}
                    placeholder="Describe your issue or question..."
                    className="mt-1 min-h-[120px]"
                    data-testid="support-message"
                    required
                  />
                </div>
                <Button type="submit" className="w-full gap-2" data-testid="support-submit">
                  <Mail size={15} />
                  Send message
                </Button>
              </form>
            )}
          </div>

          {/* FAQ */}
          <div>
            <h2 className="text-lg font-semibold mb-4">Frequently asked questions</h2>
            <Accordion type="single" collapsible className="space-y-1">
              {FAQ.map((faq, i) => (
                <AccordionItem key={i} value={`faq-${i}`} className="border border-border rounded-lg px-4">
                  <AccordionTrigger className="text-sm font-medium text-left py-3">{faq.q}</AccordionTrigger>
                  <AccordionContent className="text-sm text-muted-foreground pb-3">{faq.a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </div>
      </div>
    </div>
  );
}
