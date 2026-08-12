import { pgTable, serial, integer, text, timestamp, boolean, real, pgEnum, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { childrenTable } from "./children";
import { professionalProfilesTable } from "./professionals";

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
  // Centre-admin credential gate — the admin/owner account must PERSONALLY
  // hold a verified Clinical Psychology (RCI) credential, reusing the exact
  // same professional_profiles/computeVerificationRequirements() machinery
  // individual professionals go through — not a separate "named
  // clinically-responsible person" model, and not a second verification
  // mechanism. PATCH /admin/centres/:id/verify's approve/verify/set_live
  // actions gate on this profile's verificationStatus, in addition to (not
  // instead of) the centre's own business-registration fields above.
  adminProfessionalProfileId: integer("admin_professional_profile_id").references(() => professionalProfilesTable.id, { onDelete: "set null" }),
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
  // Real sub-account architecture — this roster row stays the centre-facing
  // directory concept (display name/photo/bio the centre controls); once
  // linked, professionalProfileId points at the actual Clerk-authenticated,
  // individually-credentialed identity that slots/bookings/OTP-confirmation
  // columns key against. Nullable because a roster row can exist in
  // "invited, not yet accepted" state before the therapist completes their
  // own signup and credential submission — the admin never submits
  // credentials on a therapist's behalf; see accountStatus below.
  // Unique (nulls excepted, standard Postgres behavior) enforces one
  // therapist-to-centre at a time — deliberately not modeled as many-to-many
  // yet; multi-centre affiliation is deferred, cheap to lift later by
  // dropping this constraint, not something worth designing for now.
  professionalProfileId: integer("professional_profile_id").references(() => professionalProfilesTable.id, { onDelete: "set null" }),
  // Account-invite lifecycle, separate from isActive (which governs
  // roster/employment visibility, not login state). Plain text, not an enum
  // — this is a brand-new flow still likely to need iteration, same
  // reasoning as shadowMatchCandidatesTable.requestStatus's own comment.
  // Values: not_invited | invited | active | revoked.
  accountStatus: text("account_status").notNull().default("not_invited"),
  invitedEmail: text("invited_email"),
  invitedAt: timestamp("invited_at", { withTimezone: true }),
  inviteAcceptedAt: timestamp("invite_accepted_at", { withTimezone: true }),
  invitedByUserId: integer("invited_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("centre_therapists_centre_id_idx").on(t.centreId),
  unique("centre_therapists_professional_profile_unique").on(t.professionalProfileId),
]);

// centreTherapistSlotsTable (dropped) predated the real sub-account model
// below — every centre therapist now has a genuine professionalProfileId
// (centreTherapistsTable.professionalProfileId), so their bookable calendar
// is the exact same professionalAvailabilityTable/slotsTable/
// slotGeneration.ts mechanism every other professional uses. Confirmed
// dead before removal: whole-repo grep found only this table's own
// definition, its CRUD routes in centres.ts (no frontend caller anywhere),
// and the initial migration snapshot — zero real consumers.

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

export const packagePurchaseStatusEnum = pgEnum("package_purchase_status", [
  "pending_payment",
  "active",
  "exhausted",
  "cancelled",
]);

// A parent's actual purchase of a package offering — centreServicePackagesTable
// is just the offering (sessionCount/priceInr a centre defines); this is the
// real "who bought one, how many sessions are left" record individual
// therapy_bookings rows consume against one at a time. sessionsTotal/
// amountPaidInr are snapshotted from the offering AT PURCHASE TIME — same
// discipline as every other fee/rate snapshot in this project — so a later
// change to the offering's own sessionCount/priceInr never retroactively
// alters a purchase already made.
export const centreServicePackagePurchasesTable = pgTable("centre_service_package_purchases", {
  id: serial("id").primaryKey(),
  packageId: integer("package_id").notNull().references(() => centreServicePackagesTable.id, { onDelete: "cascade" }),
  centreId: integer("centre_id").notNull().references(() => therapyCentresTable.id, { onDelete: "cascade" }),
  serviceId: integer("service_id").notNull().references(() => centreServicesTable.id, { onDelete: "cascade" }),
  parentId: integer("parent_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  sessionsTotal: integer("sessions_total").notNull(),
  sessionsConsumed: integer("sessions_consumed").notNull().default(0),
  amountPaidInr: integer("amount_paid_inr").notNull(),
  status: packagePurchaseStatusEnum("status").notNull().default("pending_payment"),
  providerOrderId: text("provider_order_id"),
  providerPaymentId: text("provider_payment_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [index("centre_service_package_purchases_parent_id_idx").on(t.parentId)]);

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
  // Denormalized from centreTherapistsTable.professionalProfileId at booking
  // time — this is what the shared professionalAvailabilityTable/slotsTable/
  // bookingSlotLockSql mechanism actually keys on, so conflict-checks and
  // locks match the same identity slot generation used, without a join to
  // centre_therapists on every hot-path query. therapistId (below) stays for
  // centre-facing display of the roster row.
  professionalId: integer("professional_id").notNull().references(() => professionalProfilesTable.id, { onDelete: "cascade" }),
  packageId: integer("package_id").references(() => centreServicePackagesTable.id),
  // Set only when this booking was consumed against a real package purchase
  // (centreServicePackagePurchasesTable) rather than paid for directly —
  // Step 3's invoice logic reads completed bookings either way, but this is
  // what lets it distinguish "already paid via package" from "paid per
  // session" when reconciling a centre's dues.
  packagePurchaseId: integer("package_purchase_id").references(() => centreServicePackagePurchasesTable.id, { onDelete: "set null" }),
  therapistId: integer("therapist_id").references(() => centreTherapistsTable.id),
  childId: integer("child_id").references(() => childrenTable.id, { onDelete: "set null" }),
  bookedDate: text("booked_date").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  status: therapyBookingStatusEnum("status").notNull().default("pending_payment"),
  amountInr: integer("amount_inr").notNull(),
  commissionInr: integer("commission_inr").notNull().default(0),
  centreAmountInr: integer("centre_amount_inr").notNull().default(0),
  // Snapshot of the % rate actually used to compute commissionInr — same
  // three-tier resolution and "never retroactively reinterpret an
  // already-placed booking" discipline as sessionBookingsTable's own
  // resolvedCommissionPct.
  resolvedCommissionPct: real("resolved_commission_pct"),
  providerOrderId: text("provider_order_id"),
  providerPaymentId: text("provider_payment_id"),
  startOtp: text("start_otp"),
  endOtp: text("end_otp"),
  otpIssuedAt: timestamp("otp_issued_at", { withTimezone: true }),
  otpAttempts: integer("otp_attempts").notNull().default(0),
  // Locked after OTP_MAX_ATTEMPTS wrong tries — same mechanism as
  // sessionBookingsTable's own otpLockedAt (see sessionsV2.ts's start-otp/
  // end-otp), ported here rather than reused directly since this is a
  // different table.
  otpLockedAt: timestamp("otp_locked_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  // Set only on a SUCCESSFUL start-otp/end-otp submission, to the
  // submitting professional's own userId — never client-supplied, always
  // req.userId from inside a requireRole("professional") + ownership-
  // checked handler, so this can never resolve to a centre admin's
  // account. This is the actual record a real attendance dispute leans
  // on: who confirmed the session started/ended, not just that it did.
  startConfirmedByUserId: integer("start_confirmed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  endConfirmedByUserId: integer("end_confirmed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
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

export const insertCentreServicePackagePurchaseSchema = createInsertSchema(centreServicePackagePurchasesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCentreServicePackagePurchase = z.infer<typeof insertCentreServicePackagePurchaseSchema>;
export type CentreServicePackagePurchase = typeof centreServicePackagePurchasesTable.$inferSelect;
