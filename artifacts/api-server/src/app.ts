import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import webhooksRouter from "./routes/webhooks";
import { logger } from "./lib/logger";
import { clerkProxyMiddleware, CLERK_PROXY_PATH } from "./middlewares/clerkProxyMiddleware";

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

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use("/api", webhooksRouter);
app.use("/api", router);

export default app;
