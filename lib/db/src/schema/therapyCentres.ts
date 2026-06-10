import { pgTable, serial, integer, text, timestamp, boolean, real, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { childrenTable } from "./children";

export const centreStatusEnum = pgEnum("centre_status", [
  "draft",
  "submitted",
  "verified",
  "live",
  "rejected",
  "suspended",
]);

export const therapyCentresTable = pgTable("therapy_centres", {
  id: serial("id").primaryKey(),
  ownerUserId: integer("owner_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  pincode: text("pincode"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  phone: text("phone"),
  email: text("email"),
  website: text("website"),
  photos: text("photos"),
  languagesSpoken: text("languages_spoken"),
  therapyTypesOffered: text("therapy_types_offered"),
  operatingHoursJson: text("operating_hours_json"),
  registrationNumbers: text("registration_numbers"),
  certificatesJson: text("certificates_json"),
  yearsInOperation: integer("years_in_operation"),
  status: centreStatusEnum("status").notNull().default("draft"),
  verificationNotes: text("verification_notes"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  verifiedBy: integer("verified_by"),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  rejectedBy: integer("rejected_by"),
  rejectedReason: text("rejected_reason"),
  commissionPctOverride: real("commission_pct_override"),
  platformDefaultCommissionPct: real("platform_default_commission_pct").notNull().default(15),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const centreTherapistsTable = pgTable("centre_therapists", {
  id: serial("id").primaryKey(),
  centreId: integer("centre_id").notNull().references(() => therapyCentresTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  photoUrl: text("photo_url"),
  specializations: text("specializations"),
  qualifications: text("qualifications"),
  yearsExperience: integer("years_experience").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [index("centre_therapists_centre_id_idx").on(t.centreId)]);

export const centreTherapistSlotsTable = pgTable("centre_therapist_slots", {
  id: serial("id").primaryKey(),
  therapistId: integer("therapist_id").notNull().references(() => centreTherapistsTable.id, { onDelete: "cascade" }),
  centreId: integer("centre_id").notNull().references(() => therapyCentresTable.id, { onDelete: "cascade" }),
  dayOfWeek: integer("day_of_week").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  slotDurationMinutes: integer("slot_duration_minutes").notNull().default(60),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("centre_therapist_slots_therapist_idx").on(t.therapistId)]);

export const centreServiceModeEnum = pgEnum("centre_service_mode", ["in_centre", "home_visit", "online"]);

export const centreServicesTable = pgTable("centre_services", {
  id: serial("id").primaryKey(),
  centreId: integer("centre_id").notNull().references(() => therapyCentresTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  serviceType: text("service_type").notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(60),
  mode: centreServiceModeEnum("mode").notNull().default("in_centre"),
  description: text("description"),
  assessmentRequired: boolean("assessment_required").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [index("centre_services_centre_id_idx").on(t.centreId)]);

export const centreServicePricesTable = pgTable("centre_service_prices", {
  id: serial("id").primaryKey(),
  serviceId: integer("service_id").notNull().references(() => centreServicesTable.id, { onDelete: "cascade" }),
  centreId: integer("centre_id").notNull().references(() => therapyCentresTable.id, { onDelete: "cascade" }),
  priceInr: integer("price_inr").notNull(),
  commissionPctOverride: real("commission_pct_override"),
  effectiveFrom: text("effective_from").notNull(),
  setByAdminId: integer("set_by_admin_id").notNull().references(() => usersTable.id),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("centre_service_prices_service_id_idx").on(t.serviceId)]);

export const centreServicePackagesTable = pgTable("centre_service_packages", {
  id: serial("id").primaryKey(),
  serviceId: integer("service_id").notNull().references(() => centreServicesTable.id, { onDelete: "cascade" }),
  centreId: integer("centre_id").notNull().references(() => therapyCentresTable.id, { onDelete: "cascade" }),
  sessionCount: integer("session_count").notNull().default(1),
  priceInr: integer("price_inr").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [index("centre_service_packages_service_id_idx").on(t.serviceId)]);

export const priceChangeRequestStatusEnum = pgEnum("price_change_request_status", [
  "pending",
  "approved",
  "rejected",
]);

export const priceChangeRequestsTable = pgTable("price_change_requests", {
  id: serial("id").primaryKey(),
  centreId: integer("centre_id").notNull().references(() => therapyCentresTable.id, { onDelete: "cascade" }),
  serviceId: integer("service_id").notNull().references(() => centreServicesTable.id, { onDelete: "cascade" }),
  requestedPriceInr: integer("requested_price_inr").notNull(),
  justification: text("justification"),
  status: priceChangeRequestStatusEnum("status").notNull().default("pending"),
  decidedBy: integer("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: text("decision_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const centreCancellationPoliciesTable = pgTable("centre_cancellation_policies", {
  id: serial("id").primaryKey(),
  centreId: integer("centre_id").notNull().references(() => therapyCentresTable.id, { onDelete: "cascade" }).unique(),
  window1Hours: integer("window1_hours").notNull().default(24),
  window1RefundPct: integer("window1_refund_pct").notNull().default(100),
  window2Hours: integer("window2_hours").notNull().default(2),
  window2RefundPct: integer("window2_refund_pct").notNull().default(50),
  insideWindow2RefundPct: integer("inside_window2_refund_pct").notNull().default(0),
  noShowRefundPct: integer("no_show_refund_pct").notNull().default(0),
  centreNoShowRefundPct: integer("centre_no_show_refund_pct").notNull().default(100),
  offerCompensationSlot: boolean("offer_compensation_slot").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const therapyBookingStatusEnum = pgEnum("therapy_booking_status", [
  "pending_payment",
  "paid_held",
  "confirmed",
  "session_started",
  "session_completed",
  "releasable",
  "released",
  "cancelled_by_parent",
  "cancelled_by_centre",
  "refunded",
  "no_show_parent",
  "no_show_centre",
  "rescheduled",
]);

export const therapyBookingsTable = pgTable("therapy_bookings", {
  id: serial("id").primaryKey(),
  parentId: integer("parent_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  centreId: integer("centre_id").notNull().references(() => therapyCentresTable.id, { onDelete: "cascade" }),
  serviceId: integer("service_id").notNull().references(() => centreServicesTable.id),
  packageId: integer("package_id").references(() => centreServicePackagesTable.id),
  therapistId: integer("therapist_id").references(() => centreTherapistsTable.id),
  childId: integer("child_id").references(() => childrenTable.id, { onDelete: "set null" }),
  bookedDate: text("booked_date").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  status: therapyBookingStatusEnum("status").notNull().default("pending_payment"),
  amountInr: integer("amount_inr").notNull(),
  commissionInr: integer("commission_inr").notNull().default(0),
  centreAmountInr: integer("centre_amount_inr").notNull().default(0),
  providerOrderId: text("provider_order_id"),
  providerPaymentId: text("provider_payment_id"),
  startOtp: text("start_otp"),
  endOtp: text("end_otp"),
  otpIssuedAt: timestamp("otp_issued_at", { withTimezone: true }),
  otpAttempts: integer("otp_attempts").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  sessionNote: text("session_note"),
  sharedConcernIds: text("shared_concern_ids"),
  consentSharedProfile: boolean("consent_shared_profile").notNull().default(false),
  cancellationReason: text("cancellation_reason"),
  compensationSlotOffered: boolean("compensation_slot_offered").notNull().default(false),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  releasedBy: integer("released_by"),
  priceSnapshotJson: text("price_snapshot_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("therapy_bookings_parent_id_idx").on(t.parentId),
  index("therapy_bookings_centre_id_idx").on(t.centreId),
]);

export const insertTherapyCentreSchema = createInsertSchema(therapyCentresTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTherapyCentre = z.infer<typeof insertTherapyCentreSchema>;
export type TherapyCentre = typeof therapyCentresTable.$inferSelect;

export const insertCentreTherapistSchema = createInsertSchema(centreTherapistsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCentreTherapist = z.infer<typeof insertCentreTherapistSchema>;
export type CentreTherapist = typeof centreTherapistsTable.$inferSelect;

export const insertCentreServiceSchema = createInsertSchema(centreServicesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCentreService = z.infer<typeof insertCentreServiceSchema>;
export type CentreService = typeof centreServicesTable.$inferSelect;

export const insertTherapyBookingSchema = createInsertSchema(therapyBookingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTherapyBooking = z.infer<typeof insertTherapyBookingSchema>;
export type TherapyBooking = typeof therapyBookingsTable.$inferSelect;
