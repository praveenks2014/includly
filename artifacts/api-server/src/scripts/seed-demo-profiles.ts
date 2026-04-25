import { db, usersTable, professionalProfilesTable } from "@workspace/db";

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY!;
const PASSWORD = "Emerald-09A";

interface ProfileData {
  email: string;
  firstName: string;
  lastName: string;
  specialty: string;
  fullName: string;
  bio: string;
  city: string;
  country: string;
  clinicAddress: string;
  displayArea: string;
  yearsExperience: number;
  pricingMinINR: number;
  pricingMaxINR: number;
  qualifications: string;
  offersHomeVisits: boolean;
  travelRadiusKm: number;
}

const PROFILES: ProfileData[] = [
  // shadow_teacher (2)
  {
    email: "priya.sharma@includly.app",
    firstName: "Priya",
    lastName: "Sharma",
    specialty: "shadow_teacher",
    fullName: "Priya Sharma",
    bio: "Experienced shadow teacher specialising in inclusion support for children with autism and ADHD. I work closely with school staff to build confidence and independence in learners.",
    city: "Mumbai",
    country: "India",
    clinicAddress: "12 Bandra West, Mumbai 400050",
    displayArea: "Bandra West, Mumbai",
    yearsExperience: 8,
    
    pricingMinINR: 1200, pricingMaxINR: 1200,
    qualifications: "B.Ed Special Education, Certified ABA Therapist",
    offersHomeVisits: true,
    travelRadiusKm: 10,
  },
  {
    email: "arjun.mehta@includly.app",
    firstName: "Arjun",
    lastName: "Mehta",
    specialty: "shadow_teacher",
    fullName: "Arjun Mehta",
    bio: "Dedicated shadow teacher with a focus on helping children with learning disabilities thrive in mainstream classrooms. I use structured routines and positive reinforcement.",
    city: "Pune",
    country: "India",
    clinicAddress: "45 Koregaon Park, Pune 411001",
    displayArea: "Koregaon Park, Pune",
    yearsExperience: 5,
    
    pricingMinINR: 1000, pricingMaxINR: 1000,
    qualifications: "M.A. Psychology, Special Education Diploma",
    offersHomeVisits: true,
    travelRadiusKm: 8,
  },

  // special_tutor (2)
  {
    email: "kavya.reddy@includly.app",
    firstName: "Kavya",
    lastName: "Reddy",
    specialty: "special_tutor",
    fullName: "Kavya Reddy",
    bio: "Special educator and remedial tutor helping children with dyslexia, dyscalculia and slow-learner profiles. My sessions focus on building core literacy and numeracy through multisensory methods.",
    city: "Hyderabad",
    country: "India",
    clinicAddress: "8 Jubilee Hills, Hyderabad 500033",
    displayArea: "Jubilee Hills, Hyderabad",
    yearsExperience: 7,
    
    pricingMinINR: 900, pricingMaxINR: 900,
    qualifications: "B.Ed, Diploma in Special Education (Learning Disabilities)",
    offersHomeVisits: false,
    travelRadiusKm: 0,
  },
  {
    email: "rohit.nair@includly.app",
    firstName: "Rohit",
    lastName: "Nair",
    specialty: "special_tutor",
    fullName: "Rohit Nair",
    bio: "Passionate special tutor with expertise in supporting children on the autism spectrum and with intellectual disabilities. I design individualised learning goals aligned to the child's IEP.",
    city: "Bengaluru",
    country: "India",
    clinicAddress: "22 Indiranagar, Bengaluru 560038",
    displayArea: "Indiranagar, Bengaluru",
    yearsExperience: 6,
    
    pricingMinINR: 1100, pricingMaxINR: 1100,
    qualifications: "M.Ed Special Education, RCI Certified",
    offersHomeVisits: true,
    travelRadiusKm: 12,
  },

  // occupational_therapy (2)
  {
    email: "deepa.krishnan@includly.app",
    firstName: "Deepa",
    lastName: "Krishnan",
    specialty: "occupational_therapy",
    fullName: "Deepa Krishnan",
    bio: "Paediatric occupational therapist specialising in sensory integration, fine motor skill development and activities of daily living for children with neurodevelopmental conditions.",
    city: "Chennai",
    country: "India",
    clinicAddress: "34 Anna Nagar, Chennai 600040",
    displayArea: "Anna Nagar, Chennai",
    yearsExperience: 9,
    
    pricingMinINR: 1500, pricingMaxINR: 1500,
    qualifications: "B.O.T., Certified Sensory Integration Practitioner",
    offersHomeVisits: true,
    travelRadiusKm: 10,
  },
  {
    email: "vikram.joshi@includly.app",
    firstName: "Vikram",
    lastName: "Joshi",
    specialty: "occupational_therapy",
    fullName: "Vikram Joshi",
    bio: "Experienced OT focusing on handwriting, visual-motor integration and school readiness. I work with children aged 3–16 across a range of neurodevelopmental diagnoses.",
    city: "Mumbai",
    country: "India",
    clinicAddress: "7 Andheri East, Mumbai 400069",
    displayArea: "Andheri East, Mumbai",
    yearsExperience: 11,
    
    pricingMinINR: 1800, pricingMaxINR: 1800,
    qualifications: "M.O.T., NDT Certified",
    offersHomeVisits: false,
    travelRadiusKm: 0,
  },

  // speech_therapy (2)
  {
    email: "ananya.das@includly.app",
    firstName: "Ananya",
    lastName: "Das",
    specialty: "speech_therapy",
    fullName: "Ananya Das",
    bio: "Speech-language pathologist with expertise in AAC, language delay, stuttering and articulation disorders in children. I make therapy fun, functional and family-centred.",
    city: "Kolkata",
    country: "India",
    clinicAddress: "19 Salt Lake, Kolkata 700064",
    displayArea: "Salt Lake, Kolkata",
    yearsExperience: 6,
    
    pricingMinINR: 1200, pricingMaxINR: 1200,
    qualifications: "M.Sc. Speech-Language Pathology, RCI Certified",
    offersHomeVisits: true,
    travelRadiusKm: 8,
  },
  {
    email: "suresh.pillai@includly.app",
    firstName: "Suresh",
    lastName: "Pillai",
    specialty: "speech_therapy",
    fullName: "Suresh Pillai",
    bio: "Paediatric speech therapist focused on autism, apraxia and feeding difficulties. My sessions blend PROMPT, PECS and play-based techniques for lasting progress.",
    city: "Kochi",
    country: "India",
    clinicAddress: "5 Palarivattom, Kochi 682025",
    displayArea: "Palarivattom, Kochi",
    yearsExperience: 8,
    
    pricingMinINR: 1300, pricingMaxINR: 1300,
    qualifications: "B.Sc. SLP, PROMPT Trained, RCI Certified",
    offersHomeVisits: false,
    travelRadiusKm: 0,
  },

  // psychiatrist (2)
  {
    email: "meera.iyer@includly.app",
    firstName: "Meera",
    lastName: "Iyer",
    specialty: "psychiatrist",
    fullName: "Dr. Meera Iyer",
    bio: "Child and adolescent psychiatrist with 15 years of experience in ADHD, anxiety, mood disorders and autism spectrum presentations. I provide comprehensive assessment and medication management.",
    city: "Bengaluru",
    country: "India",
    clinicAddress: "101 Whitefield, Bengaluru 560066",
    displayArea: "Whitefield, Bengaluru",
    yearsExperience: 15,
    
    pricingMinINR: 2500, pricingMaxINR: 2500,
    qualifications: "MD Psychiatry, DPM, Fellow Child & Adolescent Psychiatry",
    offersHomeVisits: false,
    travelRadiusKm: 0,
  },
  {
    email: "amit.sinha@includly.app",
    firstName: "Amit",
    lastName: "Sinha",
    specialty: "psychiatrist",
    fullName: "Dr. Amit Sinha",
    bio: "Consultant child psychiatrist specialising in neurodevelopmental disorders, conduct problems and early-onset psychosis. I work collaboratively with families and schools to build robust support plans.",
    city: "Delhi",
    country: "India",
    clinicAddress: "55 Vasant Vihar, New Delhi 110057",
    displayArea: "Vasant Vihar, Delhi",
    yearsExperience: 12,
    
    pricingMinINR: 3000, pricingMaxINR: 3000,
    qualifications: "MD Psychiatry, MRCPsych (UK), Child Psychiatry Fellowship",
    offersHomeVisits: false,
    travelRadiusKm: 0,
  },

  // developmental_pediatrician (2)
  {
    email: "sunita.rao@includly.app",
    firstName: "Sunita",
    lastName: "Rao",
    specialty: "developmental_pediatrician",
    fullName: "Dr. Sunita Rao",
    bio: "Developmental paediatrician offering comprehensive developmental assessments, IEP guidance and management plans for autism, ADHD and global developmental delay.",
    city: "Hyderabad",
    country: "India",
    clinicAddress: "28 Banjara Hills, Hyderabad 500034",
    displayArea: "Banjara Hills, Hyderabad",
    yearsExperience: 14,
    
    pricingMinINR: 2000, pricingMaxINR: 2000,
    qualifications: "MD Paediatrics, Fellowship in Developmental Paediatrics",
    offersHomeVisits: false,
    travelRadiusKm: 0,
  },
  {
    email: "prakash.kumar@includly.app",
    firstName: "Prakash",
    lastName: "Kumar",
    specialty: "developmental_pediatrician",
    fullName: "Dr. Prakash Kumar",
    bio: "Experienced developmental paediatrician helping families navigate early diagnosis, intervention planning and school advocacy for children with complex needs.",
    city: "Mumbai",
    country: "India",
    clinicAddress: "3 Matunga, Mumbai 400019",
    displayArea: "Matunga, Mumbai",
    yearsExperience: 10,
    
    pricingMinINR: 1800, pricingMaxINR: 1800,
    qualifications: "MD Paediatrics, DCH, Developmental Paediatrics Training (NIMHANS)",
    offersHomeVisits: false,
    travelRadiusKm: 0,
  },

  // neurologist (2)
  {
    email: "lalita.verma@includly.app",
    firstName: "Lalita",
    lastName: "Verma",
    specialty: "neurologist",
    fullName: "Dr. Lalita Verma",
    bio: "Paediatric neurologist with expertise in epilepsy, cerebral palsy, genetic disorders and neurodevelopmental conditions. I provide evidence-based diagnosis and long-term management.",
    city: "Delhi",
    country: "India",
    clinicAddress: "14 Dwarka Sector 12, New Delhi 110075",
    displayArea: "Dwarka, Delhi",
    yearsExperience: 16,
    
    pricingMinINR: 2800, pricingMaxINR: 2800,
    qualifications: "DM Neurology, Fellowship Paediatric Neurology, MD Paediatrics",
    offersHomeVisits: false,
    travelRadiusKm: 0,
  },
  {
    email: "sanjay.patel@includly.app",
    firstName: "Sanjay",
    lastName: "Patel",
    specialty: "neurologist",
    fullName: "Dr. Sanjay Patel",
    bio: "Senior paediatric neurologist specialising in movement disorders, epilepsy monitoring and complex neurodevelopmental profiles. Available for second opinions and ongoing care.",
    city: "Ahmedabad",
    country: "India",
    clinicAddress: "7 Satellite Road, Ahmedabad 380015",
    displayArea: "Satellite, Ahmedabad",
    yearsExperience: 18,
    
    pricingMinINR: 3200, pricingMaxINR: 3200,
    qualifications: "DM Neurology, FRCP (Edinburgh), Paediatric Neurology Fellowship (UK)",
    offersHomeVisits: false,
    travelRadiusKm: 0,
  },

  // therapy_centre (2)
  {
    email: "centre.mumbai@includly.app",
    firstName: "Bloom",
    lastName: "Centre Mumbai",
    specialty: "therapy_centre",
    fullName: "Bloom Child Development Centre",
    bio: "A multidisciplinary therapy centre in Mumbai offering OT, speech therapy, ABA, special education and counselling under one roof. Our team of 20+ specialists supports children from diagnosis to independence.",
    city: "Mumbai",
    country: "India",
    clinicAddress: "Block 4, Hiranandani Gardens, Powai, Mumbai 400076",
    displayArea: "Powai, Mumbai",
    yearsExperience: 12,
    
    pricingMinINR: 2000, pricingMaxINR: 2000,
    qualifications: "NABH Accredited, ISO 9001:2015, Team of 20+ RCI Certified Therapists",
    offersHomeVisits: false,
    travelRadiusKm: 0,
  },
  {
    email: "centre.delhi@includly.app",
    firstName: "Sprout",
    lastName: "Centre Delhi",
    specialty: "therapy_centre",
    fullName: "Sprout Learning & Therapy Centre",
    bio: "Delhi's leading early intervention and therapy centre for children with autism, ADHD and developmental delays. We offer structured programmes, parent training and school liaison services.",
    city: "Delhi",
    country: "India",
    clinicAddress: "C-12 Green Park Extension, New Delhi 110016",
    displayArea: "Green Park, Delhi",
    yearsExperience: 9,
    
    pricingMinINR: 1800, pricingMaxINR: 1800,
    qualifications: "ISO Certified, RCI Approved Training Centre, Team of 15 Specialists",
    offersHomeVisits: false,
    travelRadiusKm: 0,
  },
];

async function createClerkUser(profile: ProfileData): Promise<string> {
  const res = await fetch("https://api.clerk.com/v1/users", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CLERK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email_address: [profile.email],
      password: PASSWORD,
      first_name: profile.firstName,
      last_name: profile.lastName,
      public_metadata: { role: "professional" },
      skip_password_checks: true,
      skip_password_requirement: false,
    }),
  });

  if (!res.ok) {
    const err = await res.json() as any;
    // If already exists, fetch by email
    if (err?.errors?.[0]?.code === "form_identifier_exists") {
      console.log(`  ⚠ Already exists in Clerk: ${profile.email} — fetching existing`);
      const findRes = await fetch(
        `https://api.clerk.com/v1/users?email_address[]=${encodeURIComponent(profile.email)}&limit=1`,
        { headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` } }
      );
      const findData = await findRes.json() as any;
      const existing = findData?.data?.[0] ?? findData?.[0];
      if (!existing?.id) throw new Error(`Could not find existing user: ${profile.email}`);
      return existing.id;
    }
    throw new Error(`Clerk create failed for ${profile.email}: ${JSON.stringify(err)}`);
  }

  const data = await res.json() as any;
  return data.id as string;
}

async function run() {
  console.log(`\n🌱 Seeding ${PROFILES.length} demo professional profiles...\n`);

  const results: { email: string; password: string; specialty: string; name: string }[] = [];

  for (const profile of PROFILES) {
    try {
      process.stdout.write(`  → ${profile.email} (${profile.specialty})... `);

      // 1. Create Clerk user
      const clerkId = await createClerkUser(profile);

      // 2. Upsert DB user record
      const [user] = await db
        .insert(usersTable)
        .values({
          clerkId,
          email: profile.email,
          fullName: profile.fullName,
          role: "professional",
          city: profile.city,
          country: profile.country,
        })
        .onConflictDoUpdate({
          target: usersTable.clerkId,
          set: {
            email: profile.email,
            fullName: profile.fullName,
            role: "professional",
            city: profile.city,
            country: profile.country,
          },
        })
        .returning();

      // 3. Upsert professional profile (verified + payment activated)
      const profileValues = {
        fullName: profile.fullName,
        specialty: profile.specialty as any,
        bio: profile.bio,
        city: profile.city,
        country: profile.country,
        clinicAddress: profile.clinicAddress,
        displayArea: profile.displayArea,
        yearsExperience: profile.yearsExperience,
        pricingMinINR: profile.pricingMinINR,
        pricingMaxINR: profile.pricingMaxINR,
        qualifications: profile.qualifications,
        offersHomeVisits: profile.offersHomeVisits,
        travelRadiusKm: profile.travelRadiusKm,
        isVerified: true,
        verificationStatus: "verified" as const,
        paymentActivated: true,
      };
      await db
        .insert(professionalProfilesTable)
        .values({ userId: user.id, ...profileValues })
        .onConflictDoUpdate({
          target: professionalProfilesTable.userId,
          set: profileValues,
        });

      console.log("✓");
      results.push({ email: profile.email, password: PASSWORD, specialty: profile.specialty, name: profile.fullName });
    } catch (err: any) {
      const msg = err?.cause?.message ?? err?.message ?? String(err);
      console.log(`✗ ${msg.split("\n")[0]}`);
    }
  }

  console.log("\n✅ Done! Summary:\n");
  console.log("┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐");
  console.log("│  Email                                │  Password    │  Specialty                    │  Name           │");
  console.log("├────────────────────────────────────────────────────────────────────────────────────────────────────────┤");
  for (const r of results) {
    const email = r.email.padEnd(38);
    const pass = r.password.padEnd(13);
    const spec = r.specialty.padEnd(30);
    const name = r.name.substring(0, 28);
    console.log(`│  ${email}│  ${pass}│  ${spec}│  ${name}`);
  }
  console.log("└────────────────────────────────────────────────────────────────────────────────────────────────────────┘");

  process.exit(0);
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
