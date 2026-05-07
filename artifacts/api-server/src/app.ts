import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import router from "./routes";
import webhooksRouter from "./routes/webhooks";
import { logger } from "./lib/logger";

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

// Explicitly pass the correct publishable key so clerkMiddleware fetches
// JWKS from clerk.includly.in — not from CLERK_PUBLISHABLE_KEY which is set
// to an invalid instance (clerk.www.includly.in) in the Replit secrets.
app.use(clerkMiddleware({
  publishableKey: process.env.VITE_CLERK_PK ?? process.env.CLERK_PUBLISHABLE_KEY,
}));

app.use("/api", webhooksRouter);
app.use("/api", router);

export default app;
