import { Router, type IRouter } from "express";
import healthRouter from "./health";
import usersRouter from "./users";
import professionalsRouter from "./professionals";
import ratingsRouter from "./ratings";
import unlocksRouter from "./unlocks";
import dashboardRouter from "./dashboard";
import complianceRouter from "./compliance";
import paymentsRouter from "./payments";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(usersRouter);
router.use(professionalsRouter);
router.use(ratingsRouter);
router.use(unlocksRouter);
router.use(dashboardRouter);
router.use(complianceRouter);
router.use(paymentsRouter);
router.use(adminRouter);

export default router;
