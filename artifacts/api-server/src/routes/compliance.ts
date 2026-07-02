import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/compliance/privacy", (_req, res): void => {
  res.json({
    title: "Privacy Policy",
    lastUpdated: "2025-01-01",
    content:
      "SenseiLink Privacy Policy\n\n" +
      "1. DATA COLLECTION: We collect your name, phone number, email address, and city to operate the platform. " +
      "Professionals additionally provide qualifications, specialty, and contact details. " +
      "We may collect Aadhaar card details for identity verification of professionals; this information is processed " +
      "solely for verification purposes and stored with encryption per applicable Indian law.\n\n" +
      "2. DATA USE: Your data is used to match parents with qualified professionals and to operate, improve, and " +
      "secure the SenseiLink platform. We do not sell your personal data to third parties.\n\n" +
      "3. CONTACT DISCLOSURE: Professional contact information (phone, email) is only revealed to parents who have " +
      "explicitly unlocked the contact via a paid transaction. Blurred previews do not constitute disclosure.\n\n" +
      "4. DATA PROCESSING CONSENT: By registering on SenseiLink, you consent to the collection and processing of " +
      "your personal data as described in this policy, including for the purposes of identity verification, " +
      "communications, and marketplace operations.\n\n" +
      "5. RETENTION & DELETION: Data is retained for the duration of your account. You may request deletion " +
      "of your account and data at any time by writing to theglobalpitstop@gmail.com. We will process deletion " +
      "requests within 30 days.\n\n" +
      "6. SECURITY: Data is stored on encrypted servers. Access to personal data is restricted to authorized " +
      "personnel only.\n\n" +
      "7. CONTACT: For privacy questions, email theglobalpitstop@gmail.com.",
  });
});

router.get("/compliance/terms", (_req, res): void => {
  res.json({
    title: "Terms of Service",
    lastUpdated: "2025-01-01",
    content:
      "SenseiLink Terms of Service\n\n" +
      "1. ACCEPTANCE: By using SenseiLink, you agree to be bound by these Terms of Service and our Privacy Policy.\n\n" +
      "2. PLATFORM NATURE: SenseiLink is a marketplace that connects parents with shadow teachers, special educators, " +
      "and medical specialists. SenseiLink does not directly provide educational, therapeutic, or medical services.\n\n" +
      "3. PARENT OBLIGATIONS: Parents may use the platform to search for and contact listed professionals. " +
      "Unlocked contact details must not be shared, resold, or used for spam or any purpose other than directly " +
      "engaging the professional.\n\n" +
      "4. PROFESSIONAL OBLIGATIONS: Professionals are responsible for the accuracy of their listed information, " +
      "qualifications, and availability. SenseiLink does not verify professional credentials independently; " +
      "verification badges are based on documents submitted by professionals.\n\n" +
      "5. PAYMENTS & SUBSCRIPTIONS: Plan A (30-day premium subscription) grants unlimited contact unlocks for the " +
      "subscription period. Plan B (pay-per-contact) charges per individual unlock. All payments are final.\n\n" +
      "6. REFUND POLICY: Subscription fees are non-refundable once the subscription period begins. " +
      "Pay-per-contact unlock fees are non-refundable once the contact has been revealed. " +
      "In case of a technical error (contact not revealed due to platform failure), contact theglobalpitstop@gmail.com " +
      "within 7 days for a review.\n\n" +
      "7. PROHIBITED CONDUCT: Users must not impersonate professionals, submit false credentials, " +
      "scrape contact information, or use the platform for harassment.\n\n" +
      "8. TERMINATION: SenseiLink reserves the right to suspend or terminate accounts that violate these terms " +
      "without refund.\n\n" +
      "9. GOVERNING LAW: These terms are governed by the laws of India. Disputes are subject to the jurisdiction " +
      "of courts in Mumbai, Maharashtra.",
  });
});

router.get("/compliance/support", (_req, res): void => {
  res.json({
    title: "Support",
    lastUpdated: "2025-01-01",
    content:
      "SenseiLink Support\n\n" +
      "CONTACT US\n" +
      "Email: theglobalpitstop@gmail.com\n" +
      "Response time: Within 24 hours on business days (Monday–Friday, 9am–6pm IST)\n\n" +
      "COMMON TOPICS\n" +
      "• Account issues (login, profile editing): Email support with your registered phone number\n" +
      "• Payment or subscription queries: Email support with your transaction ID\n" +
      "• Refund requests: See our refund policy in Terms of Service. Email support within 7 days of the transaction\n" +
      "• Reporting a professional: Email support with the professional's profile link and a description of the issue\n" +
      "• Data deletion requests: Email theglobalpitstop@gmail.com with your registered phone number\n\n" +
      "PROFESSIONAL VERIFICATION\n" +
      "If you are a professional awaiting verification, please email theglobalpitstop@gmail.com with your registered " +
      "email and document reference. Verification typically takes 2–3 business days.\n\n" +
      "TECHNICAL ISSUES\n" +
      "For technical bugs or app issues, please email theglobalpitstop@gmail.com with a screenshot and description " +
      "of the problem.",
  });
});

export default router;
