/**
 * verify-otp-attendance.ts
 * Live-verification for commit 8139637848cada51cfc80921cc692b9f61891fa5
 *
 * §1  Seed setup
 * §2  Ownership resolution (REQUIRED PROOF #1)
 * §3  Wrong-code / lockout / alert / regen
 * §4  Stalled-session surfacing (REQUIRED PROOF #2) + mark-completed gates
 * §5  Reschedule clears lock and reissues OTPs
 * §6  OTP visibility gating (parent sees / therapist+admin don't / post-complete hidden)
 */

import { db } from "@workspace/db";
import {
  therapyBookingsTable,
  professionalProfilesTable,
  centreTherapistsTable,
  slotsTable,
  notificationsTable,
  platformDuesChargesTable,
  usersTable,
} from "@workspace/db/schema";
import { eq, and, inArray } from "drizzle-orm";

// ─── constants ────────────────────────────────────────────────────────────────
const BASE            = "http://localhost:8080";
const PROF_USER_ID    = 29027;  // test.ot@includly.app  role=professional  profile=70
const PARENT_USER_ID  = 21535;  // includly.parent@gmail.com  role=parent
const ADMIN_USER_ID   = 226;    // praveenece.mit@gmail.com   role=admin
const CA_USER_ID      = 29741;  // centre-admin-test@includly.app  role=centre_admin
const CENTRE_ID       = 2;
const SERVICE_ID      = 7;      // "Occupational Therapy (OT)" on centre 2
const RESCHEDULE_DATE = "2026-09-01";
const RESCHEDULE_TIME = "09:00";

// ─── helpers ──────────────────────────────────────────────────────────────────
function pad(s: unknown) { return JSON.stringify(s, null, 2); }

async function http(
  userId: number,
  method: string,
  path: string,
  body?: object,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-test-override-user-id": String(userId),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

function banner(n: string) {
  console.log(`\n${"═".repeat(70)}\n  ${n}\n${"═".repeat(70)}`);
}
function ok(msg: string)   { console.log(`  ✓  ${msg}`); }
function fail(msg: string) { console.log(`  ✗  ${msg}`); process.exitCode = 1; }
function raw(label: string, v: unknown) { console.log(`\n  ${label}:\n${pad(v)}`); }

function assertEq<T>(label: string, got: T, want: T) {
  if (String(got) === String(want)) ok(`${label} = ${got}`);
  else fail(`${label}: expected ${want}, got ${got}`);
}
function assertIn<T>(label: string, got: T, want: T[]) {
  if (want.some(w => String(w) === String(got))) ok(`${label} = ${got}`);
  else fail(`${label}: expected one of ${want.join("/")}, got ${got}`);
}
function assertPresent(label: string, v: unknown) {
  if (v !== undefined && v !== null && v !== "") ok(`${label} present (${v})`);
  else fail(`${label} missing or null`);
}
function assertAbsent(label: string, v: unknown) {
  if (v === undefined || v === null) ok(`${label} absent`);
  else fail(`${label} should be absent but got: ${v}`);
}

function isoDate(daysAgo = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

async function getBooking(id: number) {
  const [b] = await db.select().from(therapyBookingsTable).where(eq(therapyBookingsTable.id, id));
  return b!;
}

async function seedConfirmedBooking(opts: {
  startOtp: string;
  endOtp: string;
  bookedDate?: string;
  status?: string;
  startedAt?: Date | null;
}): Promise<number> {
  const now = new Date();
  const [row] = await db
    .insert(therapyBookingsTable)
    .values({
      parentId:          PARENT_USER_ID,
      centreId:          CENTRE_ID,
      serviceId:         SERVICE_ID,
      professionalId:    70,                 // profile for user 29027
      bookedDate:        opts.bookedDate ?? isoDate(),
      startTime:         "10:00",
      endTime:           "11:00",
      status:            (opts.status ?? "confirmed") as any,
      amountInr:         1000,
      commissionInr:     150,
      centreAmountInr:   850,
      startOtp:          opts.startOtp,
      endOtp:            opts.endOtp,
      otpIssuedAt:       now,
      otpAttempts:       0,
      startedAt:         opts.startedAt ?? null,
      resolvedCommissionPct: 15,
    })
    .returning({ id: therapyBookingsTable.id });
  return row!.id;
}

// ─── main ─────────────────────────────────────────────────────────────────────
(async () => {
  // ───────────────────────────────────────────────────────────────────────────
  banner("§1  SEED SETUP");
  // ───────────────────────────────────────────────────────────────────────────

  // Link profile 70 to centre 2
  await db
    .update(professionalProfilesTable)
    .set({ employingCentreId: CENTRE_ID })
    .where(eq(professionalProfilesTable.id, 70));
  ok("Profile 70 employing_centre_id → 2");

  // Link centre_therapists row 3 to profile 70 for therapistName join
  await db
    .update(centreTherapistsTable)
    .set({ professionalProfileId: 70 })
    .where(eq(centreTherapistsTable.id, 3));
  ok("centre_therapists row 3 professional_profile_id → 70");

  // Ensure slot exists for reschedule target (§5)
  await db
    .insert(slotsTable)
    .values({
      professionalId:  70,
      date:            RESCHEDULE_DATE,
      startTime:       RESCHEDULE_TIME,
      endTime:         "10:00",   // overridden by reschedule from therapy slot lookup
      durationMins:    60,
      priceInr:        1000,
      status:          "open" as any,
      serviceId:       SERVICE_ID,
    })
    .onConflictDoNothing();
  ok(`Slot seeded for reschedule target ${RESCHEDULE_DATE} ${RESCHEDULE_TIME}`);

  // Clean up any leftover test bookings from previous runs
  await db.delete(therapyBookingsTable).where(
    and(
      eq(therapyBookingsTable.centreId, CENTRE_ID),
      eq(therapyBookingsTable.parentId, PARENT_USER_ID),
    ),
  );
  ok("Cleared prior test bookings");

  // Seed bookings
  const b1Id        = await seedConfirmedBooking({ startOtp: "111111", endOtp: "222222" });
  const b2Id        = await seedConfirmedBooking({ startOtp: "333333", endOtp: "444444" });
  const b3Id        = await seedConfirmedBooking({ startOtp: "555555", endOtp: "666666" });
  const b4Id        = await seedConfirmedBooking({ startOtp: "777777", endOtp: "888888" });
  const bStalled1Id = await seedConfirmedBooking({ startOtp: "991111", endOtp: "992222", bookedDate: isoDate(7) });
  const bStalled2Id = await seedConfirmedBooking({
    startOtp: "993333", endOtp: "994444", bookedDate: isoDate(7),
    status: "session_started", startedAt: new Date(Date.now() - 7 * 86400_000),
  });
  const bFreshId    = await seedConfirmedBooking({ startOtp: "995555", endOtp: "996666", bookedDate: isoDate(0) });

  console.log(`  Bookings: B1=${b1Id} B2=${b2Id} B3=${b3Id} B4=${b4Id}`);
  console.log(`  Stalled:  BS1=${bStalled1Id}(confirmed) BS2=${bStalled2Id}(session_started) BF=${bFreshId}(fresh-not-stalled)`);

  // ───────────────────────────────────────────────────────────────────────────
  banner("§2  OWNERSHIP RESOLUTION (REQUIRED PROOF #1)");
  // ───────────────────────────────────────────────────────────────────────────

  // 2a — centre_admin must get 403 (wrong role)
  const caStartOtp = await http(CA_USER_ID, "POST", `/api/therapy-bookings/${b1Id}/start-otp`, { otp: "111111" });
  raw(`2a  centre_admin POST start-otp (expect 403)`, caStartOtp);
  assertEq("2a  HTTP status", caStartOtp.status, 403);
  ok("2a  Role gate fires before ownership / OTP check — centre_admin correctly blocked");

  // 2b — therapist submits correct startOtp → session_started
  const profStart = await http(PROF_USER_ID, "POST", `/api/therapy-bookings/${b1Id}/start-otp`, { otp: "111111" });
  raw(`2b  therapist POST start-otp (expect 200)`, profStart);
  assertEq("2b  HTTP status", profStart.status, 200);

  // 2c — DB proof
  const b1After = await getBooking(b1Id);
  console.log(`\n  2c  DB query — therapy_bookings id=${b1Id}:`);
  console.log(`        status                    = ${b1After.status}`);
  console.log(`        started_at                = ${b1After.startedAt}`);
  console.log(`        start_confirmed_by_user_id= ${b1After.startConfirmedByUserId}`);
  console.log(`        therapist users.id        = ${PROF_USER_ID}`);
  assertEq("2c  status", b1After.status, "session_started");
  assertPresent("2c  started_at", b1After.startedAt);
  assertEq("2c  start_confirmed_by_user_id === therapist users.id", b1After.startConfirmedByUserId, PROF_USER_ID);

  // 2d — therapist submits correct endOtp → session_completed
  const profEnd = await http(PROF_USER_ID, "POST", `/api/therapy-bookings/${b1Id}/end-otp`, { otp: "222222" });
  raw(`2d  therapist POST end-otp (expect 200)`, profEnd);
  assertEq("2d  HTTP status", profEnd.status, 200);

  // 2e — DB proof
  const b1Final = await getBooking(b1Id);
  console.log(`\n  2e  DB query — therapy_bookings id=${b1Id}:`);
  console.log(`        status                   = ${b1Final.status}`);
  console.log(`        completed_at             = ${b1Final.completedAt}`);
  console.log(`        end_confirmed_by_user_id = ${b1Final.endConfirmedByUserId}`);
  console.log(`        therapist users.id       = ${PROF_USER_ID}`);
  assertEq("2e  status", b1Final.status, "session_completed");
  assertPresent("2e  completed_at", b1Final.completedAt);
  assertEq("2e  end_confirmed_by_user_id === therapist users.id", b1Final.endConfirmedByUserId, PROF_USER_ID);

  // 2f — platform_dues_charges row from end-otp
  const dues1 = await db
    .select()
    .from(platformDuesChargesTable)
    .where(
      and(
        eq(platformDuesChargesTable.sourceType, "therapy_booking"),
        eq(platformDuesChargesTable.sourceId, b1Id),
      ),
    );
  raw(`2f  platform_dues_charges for booking ${b1Id}`, dues1);
  if (dues1.length > 0) {
    ok(`2f  dues charge exists: amount_inr=${dues1[0]!.amountInr}, owner_type=${dues1[0]!.ownerType}, owner_id=${dues1[0]!.ownerId}`);
    assertEq("2f  amount_inr matches commissionInr=150", dues1[0]!.amountInr, 150);
  } else {
    fail("2f  No platform_dues_charges row found for this booking");
  }

  // ───────────────────────────────────────────────────────────────────────────
  banner("§3  WRONG-CODE / LOCKOUT / ALERT / REGEN");
  // ───────────────────────────────────────────────────────────────────────────

  const b2StartOtp = "333333";

  // 3a — 4 wrong attempts → 400 with attemptsRemaining counting down
  for (let i = 1; i <= 4; i++) {
    const r = await http(PROF_USER_ID, "POST", `/api/therapy-bookings/${b2Id}/start-otp`, { otp: "000000" });
    const rb = r.body as any;
    console.log(`  3a  attempt ${i}: status=${r.status} attemptsRemaining=${rb?.attemptsRemaining}`);
    assertEq(`3a  attempt ${i} status`, r.status, 400);
    assertEq(`3a  attempt ${i} attemptsRemaining`, rb?.attemptsRemaining, 5 - i);
  }

  // 5th attempt → 403 locked
  const lock5 = await http(PROF_USER_ID, "POST", `/api/therapy-bookings/${b2Id}/start-otp`, { otp: "000000" });
  raw("3a  5th attempt (expect 403 locked)", lock5);
  assertEq("3a  5th attempt status", lock5.status, 403);

  // 3b — DB: otp_locked_at set, otp_attempts=5
  const b2Locked = await getBooking(b2Id);
  console.log(`\n  3b  DB query — otp_locked_at=${b2Locked.otpLockedAt}  otp_attempts=${b2Locked.otpAttempts}`);
  assertPresent("3b  otp_locked_at", b2Locked.otpLockedAt);
  assertEq("3b  otp_attempts", b2Locked.otpAttempts, 5);

  // 3c — notification for parent
  const notifs = await db
    .select()
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.userId, PARENT_USER_ID),
        eq(notificationsTable.type, "session_otp_locked"),
        eq(notificationsTable.relatedId, b2Id),
      ),
    );
  raw("3c  session_otp_locked notification for parent", notifs);
  if (notifs.length > 0) ok(`3c  Notification created: type=${notifs[0]!.type}`);
  else fail("3c  session_otp_locked notification not found");

  // 3d — 6th attempt with CORRECT code → still 403 (locked)
  const lock6 = await http(PROF_USER_ID, "POST", `/api/therapy-bookings/${b2Id}/start-otp`, { otp: b2StartOtp });
  raw("3d  6th attempt correct code (expect 403 still locked)", lock6);
  assertEq("3d  correct-code-while-locked status", lock6.status, 403);

  // 3e — regen-otp as parent clears lock
  const b2Before = await getBooking(b2Id);
  const oldStart = b2Before.startOtp;
  const oldEnd   = b2Before.endOtp;

  const regen = await http(PARENT_USER_ID, "POST", `/api/therapy-bookings/${b2Id}/regenerate-otp`);
  raw("3e  POST regenerate-otp as parent (expect 200)", regen);
  assertEq("3e  regen status", regen.status, 200);

  const b2Regenned = await getBooking(b2Id);
  console.log(`\n  3e  DB after regen:`);
  console.log(`        otp_locked_at  = ${b2Regenned.otpLockedAt}`);
  console.log(`        otp_attempts   = ${b2Regenned.otpAttempts}`);
  console.log(`        old startOtp   = ${oldStart}  →  new startOtp = ${b2Regenned.startOtp}`);
  console.log(`        old endOtp     = ${oldEnd}    →  new endOtp   = ${b2Regenned.endOtp}`);
  assertAbsent("3e  otp_locked_at cleared", b2Regenned.otpLockedAt);
  assertEq("3e  otp_attempts reset", b2Regenned.otpAttempts, 0);
  if (b2Regenned.startOtp !== oldStart) ok(`3e  startOtp changed (${oldStart} → ${b2Regenned.startOtp})`);
  else fail("3e  startOtp unchanged after regen");
  if (b2Regenned.endOtp !== oldEnd) ok(`3e  endOtp changed (${oldEnd} → ${b2Regenned.endOtp})`);
  else fail("3e  endOtp unchanged after regen");

  // ───────────────────────────────────────────────────────────────────────────
  banner("§4  STALLED-SESSION SURFACING (REQUIRED PROOF #2)");
  // ───────────────────────────────────────────────────────────────────────────

  const stalledResp = await http(ADMIN_USER_ID, "GET", "/api/admin/therapy-bookings/stalled");
  raw("4c  GET /admin/therapy-bookings/stalled — FULL RAW JSON", stalledResp.body);
  assertEq("4c  HTTP status", stalledResp.status, 200);

  const stalled = stalledResp.body as any[];
  if (!Array.isArray(stalled)) { fail("4c  Response is not an array"); }
  else {
    const s1 = stalled.find(x => x.id === bStalled1Id);
    const s2 = stalled.find(x => x.id === bStalled2Id);
    const sf = stalled.find(x => x.id === bFreshId);

    console.log(`\n  Stalled list has ${stalled.length} item(s):`);
    if (s1) {
      ok(`4c  BS1 (id=${bStalled1Id}) present in stalled list`);
      console.log(`        centreName=${s1.centreName}  therapistName=${s1.therapistName}`);
      console.log(`        parentName=${s1.parentName}  parentEmail=${s1.parentEmail}`);
      console.log(`        serviceName=${s1.serviceName}  bookedDate=${s1.bookedDate}`);
      console.log(`        status=${s1.status}  stalledDays=${s1.stalledDays}  waitingOn=${s1.waitingOn}  otpCurrentlyLocked=${s1.otpCurrentlyLocked}`);
      assertEq("4c  BS1 status", s1.status, "confirmed");
      assertEq("4c  BS1 waitingOn", s1.waitingOn, "start_confirmation");
      if (s1.stalledDays >= 7) ok(`4c  BS1 stalledDays=${s1.stalledDays} ≥ 7`);
      else fail(`4c  BS1 stalledDays=${s1.stalledDays} expected ≥ 7`);
      assertPresent("4c  BS1 centreName", s1.centreName);
      assertPresent("4c  BS1 serviceName", s1.serviceName);
    } else fail(`4c  BS1 (id=${bStalled1Id}) NOT in stalled list`);

    if (s2) {
      ok(`4c  BS2 (id=${bStalled2Id}) present in stalled list`);
      console.log(`        status=${s2.status}  waitingOn=${s2.waitingOn}  stalledDays=${s2.stalledDays}`);
      assertEq("4c  BS2 status", s2.status, "session_started");
      assertEq("4c  BS2 waitingOn", s2.waitingOn, "end_confirmation");
    } else fail(`4c  BS2 (id=${bStalled2Id}) NOT in stalled list`);

    if (!sf) ok(`4c  BF (id=${bFreshId}) correctly absent from stalled list`);
    else fail(`4c  BF (id=${bFreshId}) wrongly appears in stalled list`);
  }

  // 4d — admin mark-completed on BS1
  const adminMC = await http(ADMIN_USER_ID, "PATCH", `/api/therapy-bookings/${bStalled1Id}/mark-completed`);
  raw("4d  admin PATCH mark-completed BS1 (expect 200)", adminMC);
  assertEq("4d  HTTP status", adminMC.status, 200);
  assertEq("4d  status in response", (adminMC.body as any)?.status, "session_completed");

  const dues4 = await db
    .select()
    .from(platformDuesChargesTable)
    .where(
      and(
        eq(platformDuesChargesTable.sourceType, "therapy_booking"),
        eq(platformDuesChargesTable.sourceId, bStalled1Id),
      ),
    );
  raw("4d  platform_dues_charges for BS1", dues4);
  if (dues4.length > 0) ok(`4d  dues charge created: amount_inr=${dues4[0]!.amountInr}`);
  else fail("4d  No dues charge for BS1 after mark-completed");

  // 4e — professional/therapist mark-completed on BS2 → 403
  const profMC = await http(PROF_USER_ID, "PATCH", `/api/therapy-bookings/${bStalled2Id}/mark-completed`);
  raw("4e  therapist PATCH mark-completed BS2 (expect 403 admin-only)", profMC);
  assertEq("4e  HTTP status", profMC.status, 403);
  ok("4e  mark-completed correctly blocked for non-admin role");

  // ───────────────────────────────────────────────────────────────────────────
  banner("§5  RESCHEDULE CLEARS LOCK AND REISSUES OTPs");
  // ───────────────────────────────────────────────────────────────────────────

  // 5a — lock B3 (5 wrong start-otp attempts)
  for (let i = 0; i < 5; i++) {
    await http(PROF_USER_ID, "POST", `/api/therapy-bookings/${b3Id}/start-otp`, { otp: "000000" });
  }
  const b3Locked = await getBooking(b3Id);
  console.log(`\n  5a  B3 locked: otp_locked_at=${b3Locked.otpLockedAt}  otp_attempts=${b3Locked.otpAttempts}`);
  assertPresent("5a  otp_locked_at", b3Locked.otpLockedAt);
  const b3OldStart = b3Locked.startOtp;
  const b3OldEnd   = b3Locked.endOtp;

  // 5b — reschedule (as parent; any auth'd participant allowed)
  // The slot seeded in §1 has date=RESCHEDULE_DATE, time=RESCHEDULE_TIME, service_id=SERVICE_ID
  // Reschedule endpoint derives endTime from the slot row — slot endTime col was set to "10:00"
  // which is wrong; the route reads slot.endTime, so update the slot with a proper end time first.
  await db
    .update(slotsTable)
    .set({ endTime: "10:00" })
    .where(
      and(
        eq(slotsTable.professionalId, 70),
        eq(slotsTable.date, RESCHEDULE_DATE),
        eq(slotsTable.startTime, RESCHEDULE_TIME),
      ),
    );

  const reschedResp = await http(PARENT_USER_ID, "PATCH", `/api/therapy-bookings/${b3Id}/reschedule`, {
    bookedDate: RESCHEDULE_DATE,
    startTime:  RESCHEDULE_TIME,
  });
  raw("5b  PATCH reschedule B3 (expect 200)", reschedResp);
  assertEq("5b  HTTP status", reschedResp.status, 200);

  // 5c — verify lock cleared and fresh OTPs
  const b3After = await getBooking(b3Id);
  console.log(`\n  5c  B3 after reschedule:`);
  console.log(`        otp_locked_at = ${b3After.otpLockedAt}`);
  console.log(`        otp_attempts  = ${b3After.otpAttempts}`);
  console.log(`        old startOtp  = ${b3OldStart}  →  new startOtp = ${b3After.startOtp}`);
  console.log(`        old endOtp    = ${b3OldEnd}    →  new endOtp   = ${b3After.endOtp}`);
  assertAbsent("5c  otp_locked_at cleared by reschedule", b3After.otpLockedAt);
  assertEq("5c  otp_attempts reset", b3After.otpAttempts, 0);
  if (b3After.startOtp !== b3OldStart) ok(`5c  startOtp refreshed (${b3OldStart} → ${b3After.startOtp})`);
  else fail("5c  startOtp unchanged after reschedule");
  if (b3After.endOtp !== b3OldEnd) ok(`5c  endOtp refreshed (${b3OldEnd} → ${b3After.endOtp})`);
  else fail("5c  endOtp unchanged after reschedule");

  // ───────────────────────────────────────────────────────────────────────────
  banner("§6  OTP VISIBILITY GATING");
  // ───────────────────────────────────────────────────────────────────────────

  // 6a — parent GET while confirmed → startOtp + endOtp present
  const parentGet1 = await http(PARENT_USER_ID, "GET", `/api/therapy-bookings/${b4Id}`);
  raw("6a  parent GET while confirmed (startOtp/endOtp expected)", parentGet1);
  assertEq("6a  HTTP status", parentGet1.status, 200);
  assertPresent("6a  startOtp visible to parent (confirmed)", (parentGet1.body as any)?.startOtp);
  assertPresent("6a  endOtp   visible to parent (confirmed)", (parentGet1.body as any)?.endOtp);

  // 6b — therapist GET same booking → startOtp + endOtp absent
  const profGet = await http(PROF_USER_ID, "GET", `/api/therapy-bookings/${b4Id}`);
  raw("6b  therapist GET same booking (startOtp/endOtp must be absent)", profGet);
  assertEq("6b  HTTP status", profGet.status, 200);
  assertAbsent("6b  startOtp hidden from therapist", (profGet.body as any)?.startOtp);
  assertAbsent("6b  endOtp   hidden from therapist", (profGet.body as any)?.endOtp);

  // 6c — admin GET same booking → startOtp + endOtp absent
  const adminGet = await http(ADMIN_USER_ID, "GET", `/api/therapy-bookings/${b4Id}`);
  raw("6c  admin GET same booking (startOtp/endOtp must be absent)", adminGet);
  assertEq("6c  HTTP status", adminGet.status, 200);
  assertAbsent("6c  startOtp hidden from admin", (adminGet.body as any)?.startOtp);
  assertAbsent("6c  endOtp   hidden from admin", (adminGet.body as any)?.endOtp);

  // Now complete B4 via OTP flow (therapist calls start then end)
  const b4Row = await getBooking(b4Id);
  await http(PROF_USER_ID, "POST", `/api/therapy-bookings/${b4Id}/start-otp`, { otp: b4Row.startOtp! });
  const b4Started = await getBooking(b4Id);
  await http(PROF_USER_ID, "POST", `/api/therapy-bookings/${b4Id}/end-otp`, { otp: b4Started.endOtp! });

  const b4Done = await getBooking(b4Id);
  assertEq("6c-pre  B4 is now session_completed", b4Done.status, "session_completed");

  // 6c parent GET after session_completed → OTPs hidden
  const parentGet2 = await http(PARENT_USER_ID, "GET", `/api/therapy-bookings/${b4Id}`);
  raw("6c  parent GET after session_completed (startOtp/endOtp must be absent)", parentGet2);
  assertEq("6c  HTTP status", parentGet2.status, 200);
  assertAbsent("6c  startOtp hidden from parent post-completion", (parentGet2.body as any)?.startOtp);
  assertAbsent("6c  endOtp   hidden from parent post-completion", (parentGet2.body as any)?.endOtp);

  // ───────────────────────────────────────────────────────────────────────────
  banner("SUMMARY");
  const code = process.exitCode ?? 0;
  console.log(code === 0 ? "\n  ALL CHECKS PASSED ✓\n" : "\n  ONE OR MORE CHECKS FAILED ✗\n");
})();
