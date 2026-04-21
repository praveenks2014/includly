import { Router, type IRouter } from "express";
import { eq, count, gte, and } from "drizzle-orm";
import {
  db,
  usersTable,
  professionalProfilesTable,
  contactUnlocksTable,
  adminSettingsTable,
  identityVerificationsTable,
  professionalCertificationsTable,
  specialtyEnum,
} from "@workspace/db";

import { requireAuth, requireRole } from "../middlewares/requireAuth";
import {
  AdminListProfessionalsQueryParams,
  UpdateAdminSettingsBody,
} from "@workspace/api-zod";

type SpecialtyValue = (typeof specialtyEnum.enumValues)[number];

const router: IRouter = Router();

const adminGuard = [requireAuth, requireRole("admin")] as const;

router.get("/admin/professionals", ...adminGuard, async (req, res): Promise<void> => {
  const parsed = AdminListProfessionalsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { status, page, limit } = parsed.data;
  const offset = (page - 1) * limit;

  const conditions = status
    ? [eq(professionalProfilesTable.verificationStatus, status)]
    : [];

  const rows = await db
    .select({
      id: professionalProfilesTable.id,
      userId: professionalProfilesTable.userId,
      fullName: professionalProfilesTable.fullName,
      specialty: professionalProfilesTable.specialty,
      verificationStatus: professionalProfilesTable.verificationStatus,
      city: professionalProfilesTable.city,
      country: professionalProfilesTable.country,
      createdAt: professionalProfilesTable.createdAt,
      userEmail: usersTable.email,
      userName: usersTable.fullName,
    })
    .from(professionalProfilesTable)
    .leftJoin(usersTable, eq(professionalProfilesTable.userId, usersTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(professionalProfilesTable.createdAt)
    .offset(offset)
    .limit(limit);

  const [totalResult] = await db
    .select({ count: count() })
    .from(professionalProfilesTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  res.json({
    professionals: rows,
    total: Number(totalResult?.count ?? 0),
    page,
    limit,
  });
});

router.patch("/admin/professionals/:id/approve", ...adminGuard, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [profile] = await db
    .update(professionalProfilesTable)
    .set({ verificationStatus: "verified", isVerified: true })
    .where(eq(professionalProfilesTable.id, id))
    .returning();

  if (!profile) {
    res.status(404).json({ error: "Professional not found" });
    return;
  }

  res.json(profile);
});

router.patch("/admin/professionals/:id/reject", ...adminGuard, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : null;

  const [profile] = await db
    .update(professionalProfilesTable)
    .set({ verificationStatus: "rejected", isVerified: false, rejectionReason: reason || null })
    .where(eq(professionalProfilesTable.id, id))
    .returning();

  if (!profile) {
    res.status(404).json({ error: "Professional not found" });
    return;
  }

  res.json(profile);
});

router.get("/admin/stats", ...adminGuard, async (_req, res): Promise<void> => {
  const [totalUsersResult] = await db.select({ count: count() }).from(usersTable);
  const [totalProfessionalsResult] = await db.select({ count: count() }).from(professionalProfilesTable);
  const [totalParentsResult] = await db
    .select({ count: count() })
    .from(usersTable)
    .where(eq(usersTable.role, "parent"));

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const [totalUnlocksThisMonthResult] = await db
    .select({ count: count() })
    .from(contactUnlocksTable)
    .where(gte(contactUnlocksTable.unlockedAt, startOfMonth));

  const [pendingResult] = await db
    .select({ count: count() })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.verificationStatus, "pending"));

  const [verifiedResult] = await db
    .select({ count: count() })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.verificationStatus, "verified"));

  const [rejectedResult] = await db
    .select({ count: count() })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.verificationStatus, "rejected"));

  res.json({
    totalUsers: Number(totalUsersResult?.count ?? 0),
    totalProfessionals: Number(totalProfessionalsResult?.count ?? 0),
    totalParents: Number(totalParentsResult?.count ?? 0),
    totalUnlocksThisMonth: Number(totalUnlocksThisMonthResult?.count ?? 0),
    pendingProfessionals: Number(pendingResult?.count ?? 0),
    verifiedProfessionals: Number(verifiedResult?.count ?? 0),
    rejectedProfessionals: Number(rejectedResult?.count ?? 0),
  });
});

router.get("/admin/settings", ...adminGuard, async (_req, res): Promise<void> => {
  let [settings] = await db.select().from(adminSettingsTable).limit(1);

  if (!settings) {
    [settings] = await db.insert(adminSettingsTable).values({}).returning();
  }

  res.json(settings);
});

router.patch("/admin/settings", ...adminGuard, async (req, res): Promise<void> => {
  const parsed = UpdateAdminSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let [settings] = await db.select().from(adminSettingsTable).limit(1);
  if (!settings) {
    [settings] = await db.insert(adminSettingsTable).values({}).returning();
  }

  const [updated] = await db
    .update(adminSettingsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(adminSettingsTable.id, settings.id))
    .returning();

  res.json(updated);
});

router.get("/admin/professionals/:id/documents", ...adminGuard, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [identity] = await db
    .select()
    .from(identityVerificationsTable)
    .where(eq(identityVerificationsTable.professionalId, id));

  const certifications = await db
    .select()
    .from(professionalCertificationsTable)
    .where(eq(professionalCertificationsTable.professionalId, id));

  res.json({
    identity: identity
      ? {
          id: identity.id,
          documentType: identity.documentType,
          fileKey: identity.fileKey,
          status: identity.status,
          submittedAt: identity.submittedAt.toISOString(),
        }
      : null,
    certifications: certifications.map((c) => ({
      id: c.id,
      documentType: c.documentType,
      fileKey: c.fileKey,
      uploadedAt: c.uploadedAt.toISOString(),
    })),
  });
});

// Admin-only demo seed endpoint — creates/verifies 16 demo professional profiles
router.post("/admin/seed-demos", ...adminGuard, async (req, res): Promise<void> => {

  const DEMOS: {
    clerkId: string; fullName: string; specialty: string; bio: string;
    city: string; country: string; clinicAddress: string; displayArea: string;
    yearsExperience: number; pricingMinINR: number; pricingMaxINR: number;
    qualifications: string; offersHomeVisits: boolean; travelRadiusKm: number;
    willingToTravel: boolean;
  }[] = [
    { clerkId:"user_3CaKGfAip2eQalndKbc8xrvjaqY", fullName:"Priya Sharma", specialty:"shadow_teacher", bio:"Experienced shadow teacher specialising in inclusion support for children with autism and ADHD. I work closely with school staff to build confidence and independence in learners.", city:"Mumbai", country:"India", clinicAddress:"12 Bandra West, Mumbai 400050", displayArea:"Bandra West, Mumbai", yearsExperience:8, pricingMinINR:1200, pricingMaxINR:1200, qualifications:"B.Ed Special Education, Certified ABA Therapist", offersHomeVisits:true, travelRadiusKm:10, willingToTravel:true },
    { clerkId:"user_3CaKGopjb3odd7pEdF73hfvTJkt", fullName:"Arjun Mehta", specialty:"shadow_teacher", bio:"Dedicated shadow teacher with a focus on helping children with learning disabilities thrive in mainstream classrooms. I use structured routines and positive reinforcement.", city:"Pune", country:"India", clinicAddress:"45 Koregaon Park, Pune 411001", displayArea:"Koregaon Park, Pune", yearsExperience:5, pricingMinINR:1000, pricingMaxINR:1000, qualifications:"M.A. Psychology, Special Education Diploma", offersHomeVisits:true, travelRadiusKm:8, willingToTravel:true },
    { clerkId:"user_3CaKGp8LIR6H0UzaQyIWovePSHJ", fullName:"Kavya Reddy", specialty:"special_tutor", bio:"Special educator and remedial tutor helping children with dyslexia, dyscalculia and slow-learner profiles. My sessions focus on building core literacy and numeracy through multisensory methods.", city:"Hyderabad", country:"India", clinicAddress:"8 Jubilee Hills, Hyderabad 500033", displayArea:"Jubilee Hills, Hyderabad", yearsExperience:7, pricingMinINR:900, pricingMaxINR:900, qualifications:"B.Ed, Diploma in Special Education (Learning Disabilities)", offersHomeVisits:false, travelRadiusKm:0, willingToTravel:false },
    { clerkId:"user_3CaKGltAVlt5vjLXMLZYaiWJB2M", fullName:"Rohit Nair", specialty:"special_tutor", bio:"Passionate special tutor with expertise in supporting children on the autism spectrum and with intellectual disabilities. I design individualised learning goals aligned to the child's IEP.", city:"Bengaluru", country:"India", clinicAddress:"22 Indiranagar, Bengaluru 560038", displayArea:"Indiranagar, Bengaluru", yearsExperience:6, pricingMinINR:1100, pricingMaxINR:1100, qualifications:"M.Ed Special Education, RCI Certified", offersHomeVisits:true, travelRadiusKm:12, willingToTravel:true },
    { clerkId:"user_3CaKGtp8L5hk7h7FHkuRrMNfRQa", fullName:"Deepa Krishnan", specialty:"occupational_therapy", bio:"Paediatric occupational therapist specialising in sensory integration, fine motor skill development and activities of daily living for children with neurodevelopmental conditions.", city:"Chennai", country:"India", clinicAddress:"34 Anna Nagar, Chennai 600040", displayArea:"Anna Nagar, Chennai", yearsExperience:9, pricingMinINR:1500, pricingMaxINR:1500, qualifications:"B.O.T., Certified Sensory Integration Practitioner", offersHomeVisits:true, travelRadiusKm:10, willingToTravel:true },
    { clerkId:"user_3CaKGyHqExpd45pnirdg4GlWjyz", fullName:"Vikram Joshi", specialty:"occupational_therapy", bio:"Experienced OT focusing on handwriting, visual-motor integration and school readiness. I work with children aged 3-16 across a range of neurodevelopmental diagnoses.", city:"Mumbai", country:"India", clinicAddress:"7 Andheri East, Mumbai 400069", displayArea:"Andheri East, Mumbai", yearsExperience:11, pricingMinINR:1800, pricingMaxINR:1800, qualifications:"M.O.T., NDT Certified", offersHomeVisits:false, travelRadiusKm:0, willingToTravel:false },
    { clerkId:"user_3CaKGzR8eF6vWkx96UNgvhhZ7UN", fullName:"Ananya Das", specialty:"speech_therapy", bio:"Speech-language pathologist with expertise in AAC, language delay, stuttering and articulation disorders in children. I make therapy fun, functional and family-centred.", city:"Kolkata", country:"India", clinicAddress:"19 Salt Lake, Kolkata 700064", displayArea:"Salt Lake, Kolkata", yearsExperience:6, pricingMinINR:1200, pricingMaxINR:1200, qualifications:"M.Sc. Speech-Language Pathology, RCI Certified", offersHomeVisits:true, travelRadiusKm:8, willingToTravel:true },
    { clerkId:"user_3CaKGwvhbQwudMcWIcGA141BJDN", fullName:"Suresh Pillai", specialty:"speech_therapy", bio:"Paediatric speech therapist focused on autism, apraxia and feeding difficulties. My sessions blend PROMPT, PECS and play-based techniques for lasting progress.", city:"Kochi", country:"India", clinicAddress:"5 Palarivattom, Kochi 682025", displayArea:"Palarivattom, Kochi", yearsExperience:8, pricingMinINR:1300, pricingMaxINR:1300, qualifications:"B.Sc. SLP, PROMPT Trained, RCI Certified", offersHomeVisits:false, travelRadiusKm:0, willingToTravel:false },
    { clerkId:"user_3CaKGwfuFJzCMWKG33JNu1TErYp", fullName:"Dr. Meera Iyer", specialty:"psychiatrist", bio:"Child and adolescent psychiatrist with 15 years of experience in ADHD, anxiety, mood disorders and autism spectrum presentations. I provide comprehensive assessment and medication management.", city:"Bengaluru", country:"India", clinicAddress:"101 Whitefield, Bengaluru 560066", displayArea:"Whitefield, Bengaluru", yearsExperience:15, pricingMinINR:2500, pricingMaxINR:2500, qualifications:"MD Psychiatry, DPM, Fellow Child & Adolescent Psychiatry", offersHomeVisits:false, travelRadiusKm:0, willingToTravel:false },
    { clerkId:"user_3CaKH35cYVTYGOrW6jsw0ddkKhv", fullName:"Dr. Amit Sinha", specialty:"psychiatrist", bio:"Consultant child psychiatrist specialising in neurodevelopmental disorders, conduct problems and early-onset psychosis. I work collaboratively with families and schools to build robust support plans.", city:"Delhi", country:"India", clinicAddress:"55 Vasant Vihar, New Delhi 110057", displayArea:"Vasant Vihar, Delhi", yearsExperience:12, pricingMinINR:3000, pricingMaxINR:3000, qualifications:"MD Psychiatry, MRCPsych (UK), Child Psychiatry Fellowship", offersHomeVisits:false, travelRadiusKm:0, willingToTravel:false },
    { clerkId:"user_3CaKH6WM9KgZCvJb2hzLMvYxXG9", fullName:"Dr. Sunita Rao", specialty:"developmental_pediatrician", bio:"Developmental paediatrician offering comprehensive developmental assessments, IEP guidance and management plans for autism, ADHD and global developmental delay.", city:"Hyderabad", country:"India", clinicAddress:"28 Banjara Hills, Hyderabad 500034", displayArea:"Banjara Hills, Hyderabad", yearsExperience:14, pricingMinINR:2000, pricingMaxINR:2000, qualifications:"MD Paediatrics, Fellowship in Developmental Paediatrics", offersHomeVisits:false, travelRadiusKm:0, willingToTravel:false },
    { clerkId:"user_3CaKH5FI15muzQrRy6X6LQyuXHp", fullName:"Dr. Prakash Kumar", specialty:"developmental_pediatrician", bio:"Experienced developmental paediatrician helping families navigate early diagnosis, intervention planning and school advocacy for children with complex needs.", city:"Mumbai", country:"India", clinicAddress:"3 Matunga, Mumbai 400019", displayArea:"Matunga, Mumbai", yearsExperience:10, pricingMinINR:1800, pricingMaxINR:1800, qualifications:"MD Paediatrics, DCH, Developmental Paediatrics Training (NIMHANS)", offersHomeVisits:false, travelRadiusKm:0, willingToTravel:false },
    { clerkId:"user_3CaKH5xbymi9G04d8oeowEOA5xP", fullName:"Dr. Lalita Verma", specialty:"neurologist", bio:"Paediatric neurologist with expertise in epilepsy, cerebral palsy, genetic disorders and neurodevelopmental conditions. I provide evidence-based diagnosis and long-term management.", city:"Delhi", country:"India", clinicAddress:"14 Dwarka Sector 12, New Delhi 110075", displayArea:"Dwarka, Delhi", yearsExperience:16, pricingMinINR:2800, pricingMaxINR:2800, qualifications:"DM Neurology, Fellowship Paediatric Neurology, MD Paediatrics", offersHomeVisits:false, travelRadiusKm:0, willingToTravel:false },
    { clerkId:"user_3CaKHGsKgrRGzfBEGJssTWjfgg4", fullName:"Dr. Sanjay Patel", specialty:"neurologist", bio:"Senior paediatric neurologist specialising in movement disorders, epilepsy monitoring and complex neurodevelopmental profiles. Available for second opinions and ongoing care.", city:"Ahmedabad", country:"India", clinicAddress:"7 Satellite Road, Ahmedabad 380015", displayArea:"Satellite, Ahmedabad", yearsExperience:18, pricingMinINR:3200, pricingMaxINR:3200, qualifications:"DM Neurology, FRCP (Edinburgh), Paediatric Neurology Fellowship (UK)", offersHomeVisits:false, travelRadiusKm:0, willingToTravel:false },
    { clerkId:"user_3CaKHGc8FS9d5xfzjCxoaWBF9p7", fullName:"Bloom Child Development Centre", specialty:"therapy_centre", bio:"A multidisciplinary therapy centre in Mumbai offering OT, speech therapy, ABA, special education and counselling under one roof. Our team of 20+ specialists supports children from diagnosis to independence.", city:"Mumbai", country:"India", clinicAddress:"Block 4, Hiranandani Gardens, Powai, Mumbai 400076", displayArea:"Powai, Mumbai", yearsExperience:12, pricingMinINR:2000, pricingMaxINR:2000, qualifications:"NABH Accredited, ISO 9001:2015, Team of 20+ RCI Certified Therapists", offersHomeVisits:false, travelRadiusKm:0, willingToTravel:false },
    { clerkId:"user_3CaKH9oPCuaSbotVj1djr1jhk1l", fullName:"Sprout Learning & Therapy Centre", specialty:"therapy_centre", bio:"Delhi's leading early intervention and therapy centre for children with autism, ADHD and developmental delays. We offer structured programmes, parent training and school liaison services.", city:"Delhi", country:"India", clinicAddress:"C-12 Green Park Extension, New Delhi 110016", displayArea:"Green Park, Delhi", yearsExperience:9, pricingMinINR:1800, pricingMaxINR:1800, qualifications:"ISO Certified, RCI Approved Training Centre, Team of 15 Specialists", offersHomeVisits:false, travelRadiusKm:0, willingToTravel:false },
    // Admin user
    { clerkId:"user_3CXc6CPumc3S3dET3JMSCxzi3Xy", fullName:"Admin", specialty:"", bio:"", city:"", country:"", clinicAddress:"", displayArea:"", yearsExperience:0, pricingMinINR:0, pricingMaxINR:0, qualifications:"", offersHomeVisits:false, travelRadiusKm:0, willingToTravel:false },
  ];

  let usersCreated = 0;
  let profilesCreated = 0;
  let skipped = 0;

  for (const demo of DEMOS) {
    const isAdmin = demo.clerkId === "user_3CXc6CPumc3S3dET3JMSCxzi3Xy";
    const role = isAdmin ? "admin" : "professional";

    // Upsert user
    const [user] = await db
      .insert(usersTable)
      .values({ clerkId: demo.clerkId, role: role as "admin" | "professional" })
      .onConflictDoUpdate({ target: usersTable.clerkId, set: { role: role as "admin" | "professional" } })
      .returning();

    if (!user) { skipped++; continue; }
    usersCreated++;

    if (isAdmin) continue; // No profile for admin

    // Check if profile already exists
    const [existing] = await db
      .select({ id: professionalProfilesTable.id })
      .from(professionalProfilesTable)
      .where(eq(professionalProfilesTable.userId, user.id));

    if (existing) { skipped++; continue; }

    await db.insert(professionalProfilesTable).values({
      userId: user.id,
      fullName: demo.fullName,
      specialty: demo.specialty as SpecialtyValue,
      bio: demo.bio,
      city: demo.city,
      country: demo.country,
      clinicAddress: demo.clinicAddress,
      displayArea: demo.displayArea,
      yearsExperience: demo.yearsExperience,
      pricingMinINR: demo.pricingMinINR,
      pricingMaxINR: demo.pricingMaxINR,
      qualifications: demo.qualifications,
      offersHomeVisits: demo.offersHomeVisits,
      travelRadiusKm: demo.travelRadiusKm,
      willingToTravel: demo.willingToTravel,
      isVerified: true,
      verificationStatus: "verified",
      paymentActivated: true,
    });
    profilesCreated++;
  }

  res.json({ usersCreated, profilesCreated, skipped, total: DEMOS.length });
});

export default router;
