import { db, usersTable, professionalProfilesTable } from "@workspace/db";

async function seed() {
  console.log("Seeding SenseiLink professionals...");

  const profUsers = await db
    .insert(usersTable)
    .values([
      {
        clerkId: "seed_prof_001",
        email: "priya.sharma@example.com",
        phone: "+91 98765 43210",
        fullName: "Priya Sharma",
        role: "professional",
        city: "Mumbai",
        country: "India",
      },
      {
        clerkId: "seed_prof_002",
        email: "dr.arjun@example.com",
        phone: "+91 91234 56789",
        fullName: "Dr. Arjun Mehta",
        role: "professional",
        city: "Bangalore",
        country: "India",
      },
      {
        clerkId: "seed_prof_003",
        email: "sunita.rao@example.com",
        phone: "+91 99887 76655",
        fullName: "Sunita Rao",
        role: "professional",
        city: "Delhi",
        country: "India",
      },
      {
        clerkId: "seed_prof_004",
        email: "kavitha.iyer@example.com",
        phone: "+91 88776 54321",
        fullName: "Kavitha Iyer",
        role: "professional",
        city: "Chennai",
        country: "India",
      },
      {
        clerkId: "seed_prof_005",
        email: "rahul.verma@example.com",
        phone: "+91 77665 43219",
        fullName: "Rahul Verma",
        role: "professional",
        city: "Pune",
        country: "India",
      },
      {
        clerkId: "seed_prof_006",
        email: "dr.neha@example.com",
        phone: "+91 99001 12233",
        fullName: "Dr. Neha Gupta",
        role: "professional",
        city: "Hyderabad",
        country: "India",
      },
    ])
    .onConflictDoNothing()
    .returning();

  if (profUsers.length === 0) {
    console.log("Seed users already exist, skipping...");
    return;
  }

  await db
    .insert(professionalProfilesTable)
    .values([
      {
        userId: profUsers[0].id,
        fullName: "Priya Sharma",
        specialty: "shadow_teacher",
        bio: "Experienced shadow teacher specializing in children with autism spectrum disorder and ADHD. I work closely with schools to ensure inclusive education.",
        yearsExperience: 8,
        qualifications: "B.Ed Special Education, Diploma in ABA Therapy",
        city: "Mumbai",
        country: "India",
        latitude: 19.076,
        longitude: 72.8777,
        travelRadiusKm: 15,
        willingToTravel: true,
        isVerified: true,
        verificationStatus: "verified",
        averageRating: 4.8,
        totalRatings: 24,
        phone: "+91 98765 43210",
        email: "priya.sharma@example.com",
      },
      {
        userId: profUsers[1].id,
        fullName: "Dr. Arjun Mehta",
        specialty: "developmental_pediatrician",
        bio: "Developmental pediatrician with 12 years experience in early intervention. Specializes in developmental delays, autism, and learning disabilities.",
        yearsExperience: 12,
        qualifications: "MBBS, MD Pediatrics, Fellowship in Developmental Pediatrics",
        city: "Bangalore",
        country: "India",
        latitude: 12.9716,
        longitude: 77.5946,
        travelRadiusKm: 10,
        willingToTravel: false,
        isVerified: true,
        verificationStatus: "verified",
        averageRating: 4.9,
        totalRatings: 47,
        phone: "+91 91234 56789",
        email: "dr.arjun@example.com",
      },
      {
        userId: profUsers[2].id,
        fullName: "Sunita Rao",
        specialty: "speech_therapy",
        bio: "Certified speech-language pathologist helping children overcome communication challenges. Specialized in AAC (Augmentative and Alternative Communication).",
        yearsExperience: 6,
        qualifications: "M.Sc. Speech-Language Pathology, ASHA Certified",
        city: "Delhi",
        country: "India",
        latitude: 28.7041,
        longitude: 77.1025,
        travelRadiusKm: 20,
        willingToTravel: true,
        isVerified: true,
        verificationStatus: "verified",
        averageRating: 4.7,
        totalRatings: 31,
        phone: "+91 99887 76655",
        email: "sunita.rao@example.com",
      },
      {
        userId: profUsers[3].id,
        fullName: "Kavitha Iyer",
        specialty: "occupational_therapy",
        bio: "Pediatric OT focusing on sensory integration therapy, fine motor skills, and daily living skills for children with developmental challenges.",
        yearsExperience: 9,
        qualifications: "B.Sc. Occupational Therapy, Sensory Integration Certification",
        city: "Chennai",
        country: "India",
        latitude: 13.0827,
        longitude: 80.2707,
        travelRadiusKm: 10,
        willingToTravel: true,
        isVerified: false,
        verificationStatus: "pending",
        averageRating: 4.6,
        totalRatings: 18,
        phone: "+91 88776 54321",
        email: "kavitha.iyer@example.com",
      },
      {
        userId: profUsers[4].id,
        fullName: "Rahul Verma",
        specialty: "special_tutor",
        bio: "Special education tutor with expertise in dyslexia, dyscalculia, and learning differences. Uses evidence-based multi-sensory teaching methods.",
        yearsExperience: 5,
        qualifications: "B.Ed, Diploma in Special Education (LD), Orton-Gillingham Trained",
        city: "Pune",
        country: "India",
        latitude: 18.5204,
        longitude: 73.8567,
        travelRadiusKm: 25,
        willingToTravel: true,
        isVerified: false,
        verificationStatus: "unsubmitted",
        averageRating: 4.5,
        totalRatings: 12,
        phone: "+91 77665 43219",
        email: "rahul.verma@example.com",
      },
      {
        userId: profUsers[5].id,
        fullName: "Dr. Neha Gupta",
        specialty: "psychiatrist",
        bio: "Child and adolescent psychiatrist specializing in ADHD, anxiety disorders, and emotional regulation. Integrates CBT and mindfulness approaches.",
        yearsExperience: 15,
        qualifications: "MBBS, MD Psychiatry, DPM, Child Psychiatry Fellowship",
        city: "Hyderabad",
        country: "India",
        latitude: 17.385,
        longitude: 78.4867,
        travelRadiusKm: 5,
        willingToTravel: false,
        isVerified: true,
        verificationStatus: "verified",
        averageRating: 4.9,
        totalRatings: 62,
        phone: "+91 99001 12233",
        email: "dr.neha@example.com",
      },
    ])
    .onConflictDoNothing();

  console.log("Seeded successfully!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
