import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <Link href="/">
          <Button variant="ghost" size="sm" className="gap-1.5 mb-6 -ml-2">
            <ArrowLeft size={15} />
            Back
          </Button>
        </Link>

        <div className="prose prose-slate max-w-none">
          <h1 className="font-serif text-3xl font-semibold text-foreground mb-2">Terms of Service</h1>
          <p className="text-muted-foreground text-sm mb-8">Last updated: April 2026</p>

          <Section title="1. Acceptance of Terms">
            <p>By accessing or using Sproutly ("the Platform"), you agree to be bound by these Terms of Service and our Privacy Policy. If you do not agree to these terms, please do not use the Platform.</p>
          </Section>

          <Section title="2. Description of Service">
            <p>Sproutly is an online marketplace that connects parents and guardians ("Parents") with special education professionals and medical specialists ("Professionals"). We provide a platform for discovery and contact — we are not a party to any direct service agreement between Parents and Professionals.</p>
          </Section>

          <Section title="3. Account Registration">
            <ul>
              <li>You must be at least 18 years old to create an account.</li>
              <li>You must provide accurate and complete information during registration.</li>
              <li>You are responsible for maintaining the security of your account.</li>
              <li>Each phone number may be associated with only one account.</li>
            </ul>
          </Section>

          <Section title="4. Contact Unlock — Refund Policy">
            <p><strong>No refunds will be issued once a contact has been unlocked.</strong> When you pay to unlock a professional's contact details, the transaction is final and non-refundable, as the service (revealing the contact information) has been delivered immediately upon payment.</p>
            <p>Subscription fees are non-refundable once the subscription period has begun. If you believe you were charged in error, please contact our support team within 7 days at <a href="mailto:support@senseilink.in">support@senseilink.in</a>.</p>
          </Section>

          <Section title="5. Professional Responsibility Disclaimer">
            <p>Sproutly acts solely as a marketplace platform. We do not employ, endorse, guarantee, or assume responsibility for any Professional listed on the Platform. Parents are solely responsible for:</p>
            <ul>
              <li>Verifying a Professional's credentials independently before engaging their services.</li>
              <li>Negotiating and agreeing on service terms, fees, and schedules directly with Professionals.</li>
              <li>Any outcomes resulting from engaging with a Professional found through the Platform.</li>
            </ul>
            <p>Our verification badge indicates that we have reviewed submitted documents — it does not constitute an endorsement of a Professional's competence or suitability for any particular child.</p>
          </Section>

          <Section title="6. Professional Obligations">
            <p>If you register as a Professional, you agree to:</p>
            <ul>
              <li>Provide accurate information about your qualifications, experience, and credentials.</li>
              <li>Submit valid identity and credential documents for verification when requested.</li>
              <li>Maintain updated contact information.</li>
              <li>Respond to parent inquiries in a timely and professional manner.</li>
              <li>Not misrepresent your qualifications or area of expertise.</li>
            </ul>
          </Section>

          <Section title="7. Prohibited Uses">
            <p>You agree not to:</p>
            <ul>
              <li>Use the Platform for any unlawful purpose.</li>
              <li>Scrape, harvest, or collect data from the Platform without written consent.</li>
              <li>Post false, misleading, or fraudulent information.</li>
              <li>Harass, threaten, or abuse other users.</li>
              <li>Use another person's account or identity.</li>
              <li>Circumvent our contact-unlock system by sharing unlocked contact details with third parties.</li>
              <li>Post reviews that are fabricated, incentivized, or relate to a Professional you have not engaged with.</li>
            </ul>
          </Section>

          <Section title="8. Account Suspension and Termination">
            <p>We reserve the right to suspend or terminate your account at our discretion if you:</p>
            <ul>
              <li>Violate these Terms of Service.</li>
              <li>Provide false information during registration or verification.</li>
              <li>Engage in fraudulent payment activity.</li>
              <li>Receive multiple reports of abusive behavior from other users.</li>
            </ul>
            <p>Suspended accounts are not eligible for refunds of any remaining subscription period.</p>
          </Section>

          <Section title="9. Intellectual Property">
            <p>All content on the Platform, including the Sproutly name, logo, design, and software, is owned by Sproutly and protected by intellectual property laws. You may not reproduce or distribute our content without written permission.</p>
          </Section>

          <Section title="10. Limitation of Liability">
            <p>To the maximum extent permitted by applicable law, Sproutly shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the Platform or any services obtained through it.</p>
          </Section>

          <Section title="11. Governing Law">
            <p>These Terms are governed by the laws of India. Any disputes shall be subject to the exclusive jurisdiction of the courts of Mumbai, Maharashtra, India.</p>
          </Section>

          <Section title="12. Changes to Terms">
            <p>We may update these Terms at any time. Continued use of the Platform after changes constitutes acceptance of the new terms.</p>
          </Section>

          <Section title="13. Contact">
            <p><strong>Sproutly</strong><br />Email: <a href="mailto:legal@senseilink.in">legal@senseilink.in</a></p>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="font-serif text-xl font-semibold text-foreground mb-3">{title}</h2>
      <div className="space-y-3 text-foreground/80 text-sm leading-relaxed [&_h3]:font-semibold [&_h3]:text-foreground [&_h3]:mt-4 [&_h3]:mb-2 [&_a]:text-primary [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1">
        {children}
      </div>
    </section>
  );
}
