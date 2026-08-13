import { Router, type IRouter } from "express";
import healthRouter from "./health";
import devRouter from "./dev";
import usersRouter from "./users";
import professionalsRouter from "./professionals";
import professionalOfferingsRouter from "./professionalOfferings";
import ratingsRouter from "./ratings";
import unlocksRouter from "./unlocks";
import dashboardRouter from "./dashboard";
import complianceRouter from "./compliance";
import paymentsRouter from "./payments";
import adminRouter from "./admin";
import notificationsRouter from "./notifications";
import storageRouter from "./storage";
import verificationsRouter from "./verifications";
import accountRouter from "./account";
import sessionsRouter from "./sessions";
import childrenRouter from "./children";
import connectRouter from "./connect";
import engagementsRouter from "./engagements";
import walletRouter from "./wallet";
import assessmentsRouter from "./assessments";
import communityRouter from "./community";
import communityAiRouter from "./communityAi";
import resourcesRouter from "./resources";
import referralsRouter from "./referrals";
import shadowTeacherRouter from "./shadowTeacher";
import tutorRouter from "./tutor";
import therapistRouter from "./therapist";
import { sessionsV2Router } from "./sessionsV2";
import lifecycleRouter from "./lifecycleRequests";
import dailyLogsRouter from "./dailyLogs";
import salaryPaymentsRouter from "./salaryPayments";
import parentNeedsRouter from "./parentNeeds";
import centresRouter from "./centres";
import therapyBookingsRouter from "./therapyBookings";
import goalsRouter from "./goals";
import behaviorLogsRouter from "./behaviorLogs";
import platformDuesRouter from "./platformDues";

const router: IRouter = Router();

router.use(healthRouter);
// Mounted early, ahead of any router that applies an unconditional
// `router.use(requireAuth)` (e.g. behaviorLogs.ts) — those intercept every
// unmatched request that reaches them, so a later mount position would make
// this route unreachable regardless of its own auth logic.
router.use(devRouter);
router.use(usersRouter);
router.use(professionalsRouter);
router.use(professionalOfferingsRouter);
router.use(ratingsRouter);
router.use(unlocksRouter);
router.use(dashboardRouter);
router.use(complianceRouter);
router.use(paymentsRouter);
router.use(adminRouter);
router.use(notificationsRouter);
router.use(storageRouter);
router.use(verificationsRouter);
router.use(accountRouter);
router.use(sessionsRouter);
router.use(childrenRouter);
router.use(connectRouter);
router.use(engagementsRouter);
router.use(walletRouter);
router.use(assessmentsRouter);
router.use(communityRouter);
router.use(communityAiRouter);
router.use(resourcesRouter);
router.use(referralsRouter);
router.use(shadowTeacherRouter);
// Mount order here no longer matters for feature-flag/role gating:
// tutorRouter/therapistRouter/behaviorLogsRouter's own internal gates are
// now scoped with router.use("/path", ...) instead of an unconditional
// router.use(...), so they only ever intercept requests actually bound
// for their own routes (see the comments in tutor.ts/therapist.ts/
// behaviorLogs.ts). Previously an unscoped gate in any of those files
// would 404/403 every request reaching it regardless of destination,
// silently blocking every later-mounted router whenever a flag was off
// or the caller wasn't a parent — that's the actual defect the Aug 12
// "count: 1" / therapy-bookings incident traced back to. This ordering
// is kept as-is for readability, not because it's load-bearing anymore.
router.use(centresRouter);
router.use(therapyBookingsRouter);
router.use(tutorRouter);
router.use(therapistRouter);
router.use(sessionsV2Router);
router.use(lifecycleRouter);
router.use(dailyLogsRouter);
router.use(salaryPaymentsRouter);
router.use(parentNeedsRouter);
router.use(goalsRouter);
router.use(behaviorLogsRouter);
router.use(platformDuesRouter);
router.use(devRouter);

export default router;
