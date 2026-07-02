import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Heart, ShieldCheck, Users } from "lucide-react";

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <Link href="/">
          <Button variant="ghost" size="sm" className="gap-1.5 mb-6 -ml-2">
            <ArrowLeft size={15} />
            Back
          </Button>
        </Link>

        <h1 className="text-3xl font-serif font-semibold text-foreground mb-2">About Includly</h1>
        <p className="text-muted-foreground mb-10">
          Building India's most trusted marketplace for special-needs support.
        </p>

        <div className="space-y-10">
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">Our mission</h2>
            <p className="text-muted-foreground leading-relaxed">
              Every child with special needs deserves access to the right support — regardless of where
              they live in India. Includly connects families with verified shadow teachers, occupational
              therapists, speech therapists, psychologists, and therapy centres, so that finding qualified
              help is no longer a matter of luck or location.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">What we do</h2>
            <p className="text-muted-foreground leading-relaxed">
              We operate a verified marketplace: specialists create profiles, submit identity documents
              and credentials for manual review, and receive a verified badge once approved. Parents and
              guardians search or get matched, then connect directly with professionals who fit their
              child's specific needs.
            </p>
            <p className="text-muted-foreground leading-relaxed mt-3">
              We are not a staffing agency or a therapy provider. We are a platform — we handle
              verification and matching so families don't have to start from scratch.
            </p>
          </section>

          <div className="grid sm:grid-cols-3 gap-5">
            {[
              {
                icon: <Heart size={20} className="text-teal-600" />,
                title: "Family-first",
                desc: "Everything we build is designed around the family's experience — not the platform's convenience.",
              },
              {
                icon: <ShieldCheck size={20} className="text-teal-600" />,
                title: "Verified professionals",
                desc: "Every specialist on Includly has had their identity and credentials manually reviewed before going live.",
              },
              {
                icon: <Users size={20} className="text-teal-600" />,
                title: "Built for India",
                desc: "Designed for Indian families navigating the SPED ecosystem, with payment and verification that work locally.",
              },
            ].map((item) => (
              <div key={item.title} className="bg-teal-50/60 border border-teal-100 rounded-2xl p-5">
                <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center mb-3 shadow-sm">
                  {item.icon}
                </div>
                <h3 className="font-semibold text-gray-900 text-sm mb-1.5">{item.title}</h3>
                <p className="text-xs text-gray-500 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">Contact us</h2>
            <p className="text-muted-foreground leading-relaxed">
              For support, verification questions, or general enquiries, email us at{" "}
              <a href="mailto:theglobalpitstop@gmail.com" className="text-primary underline">
                theglobalpitstop@gmail.com
              </a>
              . We respond within 1–2 business days.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
