import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/compliance/privacy", (_req, res): void => {
  res.json({
    title: "Privacy Policy",
    lastUpdated: "2025-01-01",
    content:
      "SenseiLink collects personal information to connect parents with qualified professionals. " +
      "We use your data to match you with suitable educators and therapists. " +
      "Your data is stored securely and never sold to third parties. " +
      "Contact information of professionals is only shared after explicit unlock. " +
      "You may request deletion of your data at any time by contacting support.",
  });
});

router.get("/compliance/terms", (_req, res): void => {
  res.json({
    title: "Terms of Service",
    lastUpdated: "2025-01-01",
    content:
      "By using SenseiLink, you agree to use the platform for legitimate purposes only. " +
      "Parents may search for and contact professionals listed on our marketplace. " +
      "Professionals are responsible for the accuracy of their listed information. " +
      "SenseiLink is a marketplace platform and does not directly provide educational or medical services. " +
      "Unlocked contact details must not be shared, resold, or used for spam. " +
      "We reserve the right to suspend accounts that violate these terms.",
  });
});

router.get("/compliance/support", (_req, res): void => {
  res.json({
    title: "Support",
    lastUpdated: "2025-01-01",
    content:
      "For help with your account, billing, or finding the right professional, email support@senseilink.in. " +
      "Our team responds within 24 hours on business days. " +
      "For urgent issues, use the in-app chat. " +
      "To report a professional, use the 'Report' button on their profile page.",
  });
});

export default router;
