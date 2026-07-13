import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import webhooksRouter from "./routes/webhooks";
import { logger } from "./lib/logger";
import { SHOW_TUTOR_SEARCH, SHOW_THERAPIST_SEARCH } from "./lib/features";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Earliest possible checkpoint for the tutor/therapist feature flags —
// proactive defense-in-depth, ahead of Clerk entirely, so a disabled
// vertical returns 404 regardless of auth state or auth-mode quirks. The
// per-router gates in tutor.ts/therapist.ts still apply too; this is not a
// replacement for those, just the earliest of two redundant checks.
app.use((req, res, next) => {
  if (!SHOW_TUTOR_SEARCH && req.path.startsWith("/api/tutor")) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (!SHOW_THERAPIST_SEARCH && req.path.startsWith("/api/therapist")) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
});

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(cors({ credentials: true, origin: true }));

const WEBHOOK_PATHS = ["/api/webhooks/stripe", "/api/webhooks/razorpay", "/api/payments/razorpay/webhook"];

app.use(
  express.json({
    verify: (req: Request, _res: Response, buf: Buffer) => {
      if (WEBHOOK_PATHS.some((p) => req.path === p)) {
        (req as Request & { rawBody?: Buffer }).rawBody = buf;
      }
    },
  }),
);

app.use(express.urlencoded({ extended: true }));

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", webhooksRouter);
app.use("/api", router);

export default app;
