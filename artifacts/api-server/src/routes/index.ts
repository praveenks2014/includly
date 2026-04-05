import { Router, type IRouter } from "express";
import healthRouter from "./health";
import usersRouter from "./users";
import professionalsRouter from "./professionals";
import ratingsRouter from "./ratings";
import unlocksRouter from "./unlocks";
import dashboardRouter from "./dashboard";
import complianceRouter from "./compliance";

const router: IRouter = Router();

router.use(healthRouter);
router.use(usersRouter);
router.use(professionalsRouter);
router.use(ratingsRouter);
router.use(unlocksRouter);
router.use(dashboardRouter);
router.use(complianceRouter);

export default router;
