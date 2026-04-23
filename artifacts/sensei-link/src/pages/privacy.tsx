import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function PrivacyPage() {
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
          <h1 className="font-serif text-3xl font-semibold text-foreground mb-2">Privacy Policy</h1>
          <p className="text-muted-foreground text-sm mb-8">Last updated: April 2026</p>

          <Section title="1. Introduction">
            <p>Includly ("we", "us", or "our") operates the Includly platform, which connects parents and guardians with special education professionals and medical specialists. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our service.</p>
            <p>By using Includly, you agree to the collection and use of information in accordance with this policy.</p>
          </Section>

          <Section title="2. Information We Collect">
            <h3>2.1 Personal Information</h3>
            <ul>
              <li><strong>Phone numbers:</strong> Used as your primary identifier for authentication via OTP.</li>
              <li><strong>Email address:</strong> Collected from professionals for contact purposes, shared with parents only upon contact unlock.</li>
              <li><strong>Full name and location:</strong> City and country for profile display and search functionality.</li>
              <li><strong>Role information:</strong> Whether you are a parent or a professional.</li>
            </ul>

            <h3>2.2 Professional Information</h3>
            <ul>
              <li>Specialty, qualifications, and years of experience.</li>
              <li>Bio and professional credentials.</li>
              <li>Identity documents submitted for verification (Aadhaar/ID): stored securely and not shared publicly.</li>
              <li>Geographic location and travel availability.</li>
            </ul>

            <h3>2.3 Usage Data</h3>
            <p>We collect information such as profile views, contact unlocks, ratings, and platform interactions to improve our services and provide analytics to professionals.</p>

            <h3>2.4 Payment Information</h3>
            <p>Payment data is processed by our third-party payment providers (Stripe and Razorpay). We do not store your full card number or payment credentials. Transaction records (amount, timestamp, purpose) are retained for accounting purposes.</p>
          </Section>

          <Section title="3. How We Use Your Information">
            <ul>
              <li>To create and manage your account.</li>
              <li>To display professional profiles in search results.</li>
              <li>To facilitate contact unlocks between parents and professionals.</li>
              <li>To process payments and subscriptions.</li>
              <li>To verify professional credentials.</li>
              <li>To provide analytics and insights to professionals about their profile performance.</li>
              <li>To send service-related communications (not marketing unless consented).</li>
            </ul>
          </Section>

          <Section title="4. How Contact Data Is Shared">
            <p>Professional contact details (phone number and email) are blurred by default in all search results and public profile views. A parent may unlock contact details for a specific professional by paying a contact-unlock fee or using their subscription plan. Once unlocked, the real phone number and email address become visible to that parent only.</p>
            <p>Professionals are informed about unlocks in their dashboard analytics.</p>
          </Section>

          <Section title="5. Data Retention">
            <p>We retain your personal data for as long as your account is active. If you request account deletion, we will delete your personal data within 30 days, except for data we are required to retain for legal, regulatory, or audit purposes (e.g., payment transaction records for 7 years).</p>
          </Section>

          <Section title="6. Your Rights">
            <h3>6.1 GDPR Rights (EU/EEA users)</h3>
            <ul>
              <li>Right to access your personal data.</li>
              <li>Right to rectification of inaccurate data.</li>
              <li>Right to erasure ("right to be forgotten").</li>
              <li>Right to data portability.</li>
              <li>Right to object to processing.</li>
            </ul>

            <h3>6.2 DPDP Rights (Indian users)</h3>
            <p>Under India's Digital Personal Data Protection Act (DPDP Act), 2023, you have the right to access information, correct inaccurate data, and seek grievance redressal. You may withdraw your consent for processing of your personal data at any time by contacting us.</p>

            <p>To exercise any of these rights, please contact us at <a href="mailto:privacy@senseilink.in">privacy@senseilink.in</a>.</p>
          </Section>

          <Section title="7. Cookies and Tracking">
            <p>We use session cookies necessary for authentication. We do not use third-party advertising cookies. You may disable cookies in your browser settings, but this may affect your ability to use the platform.</p>
          </Section>

          <Section title="8. Data Security">
            <p>We implement industry-standard security measures including HTTPS encryption, secure credential storage, and regular security audits. However, no method of transmission over the Internet is 100% secure.</p>
          </Section>

          <Section title="9. Changes to This Policy">
            <p>We may update this Privacy Policy periodically. We will notify you of significant changes by posting the new policy on this page with an updated date.</p>
          </Section>

          <Section title="10. Contact Us">
            <p>For privacy-related queries, contact us at:</p>
            <p><strong>Includly</strong><br />Email: <a href="mailto:privacy@includly.in">privacy@includly.in</a></p>
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
