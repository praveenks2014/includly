import { pgTable, text, serial, timestamp, integer, boolean, real, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const specialtyEnum = pgEnum("specialty", [
  "shadow_teacher",
  "special_tutor",
  "occupational_therapy",
  "speech_therapy",
  "psychiatrist",
  "developmental_pediatrician",
  "neurologist",
  "therapy_centre",
  "coaching",
]);

export const coachingSubTypeEnum = pgEnum("coaching_sub_type", [
  "swimming",
  "dance",
  "music",
  "sports",
  "singing",
  "fitness",
  "art",
  "yoga",
]);

export const verificationStatusEnum = pgEnum("verification_status", [
  "unsubmitted",
  "pending",
  "verified",
  "rejected",
]);

export const professionalProfilesTable = pgTable("professional_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  fullName: text("full_name"),
  specialty: specialtyEnum("specialty").notNull(),
  bio: text("bio"),
  yearsExperience: integer("years_experience").notNull().default(0),
  qualifications: text("qualifications").notNull(),
  city: text("city"),
  country: text("country"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  travelRadiusKm: integer("travel_radius_km").notNull().default(10),
  willingToTravel: boolean("willing_to_travel").notNull().default(false),
  isVerified: boolean("is_verified").notNull().default(false),
  verificationStatus: verificationStatusEnum("verification_status").notNull().default("unsubmitted"),
  averageRating: real("average_rating"),
  totalRatings: integer("total_ratings").notNull().default(0),
  totalViews: integer("total_views").notNull().default(0),
  totalUnlocks: integer("total_unlocks").notNull().default(0),
  phone: text("phone"),
  email: text("email"),
  pricingMinINR: integer("pricing_min_inr"),
  pricingMaxINR: integer("pricing_max_inr"),
  rejectionReason: text("rejection_reason"),
  upiId: text("upi_id"),
  upiVpa: text("upi_vpa"),
  paymentActivated: boolean("payment_activated").notNull().default(false),
  isPremium: boolean("is_premium").notNull().default(false),
  specializationTags: text("specialization_tags").array().notNull().default([]),
  displayArea: text("display_area"),
  clinicAddress: text("clinic_address"),
  offersHomeVisits: boolean("offers_home_visits").notNull().default(false),
  coachingSubType: coachingSubTypeEnum("coaching_sub_type"),
  inclusiveExperience: boolean("inclusive_experience").notNull().default(false),
  languages: text("languages").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProfessionalProfileSchema = createInsertSchema(professionalProfilesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  averageRating: true,
  totalRatings: true,
  totalViews: true,
  totalUnlocks: true,
  isVerified: true,
  verificationStatus: true,
  paymentActivated: true,
});
export type InsertProfessionalProfile = z.infer<typeof insertProfessionalProfileSchema>;
export type ProfessionalProfile = typeof professionalProfilesTable.$inferSelect;
