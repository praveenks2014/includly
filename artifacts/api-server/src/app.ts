import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { CLERK_PROXY_PATH, clerkProxyMiddleware } from "./middlewares/clerkProxyMiddleware";
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

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(cors({ credentials: true, origin: true }));

const WEBHOOK_PATHS = ["/api/webhooks/stripe", "/api/webhooks/razorpay"];

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

app.use(clerkMiddleware());

app.use("/api", webhooksRouter);
app.use("/api", router);

export default app;
