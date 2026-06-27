import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
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

// Redirect www → apex so Clerk loads from clerk.includly.in (the domain
// the publishable key is configured for) without any proxy needed.
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.hostname === "www.includly.in") {
    const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ?? "https";
    return res.redirect(301, `${proto}://includly.in${req.url}`);
  }
  next();
});

app.use("/api", webhooksRouter);
app.use("/api", router);

export default app;
