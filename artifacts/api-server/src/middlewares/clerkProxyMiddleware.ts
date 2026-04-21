/**
 * Clerk Frontend API Proxy Middleware
 *
 * Proxies Clerk Frontend API requests through your domain.
 *
 * NOTE: This proxy is only needed for Clerk PRODUCTION instances (pk_live_...).
 * Development instances (pk_test_...) support direct browser FAPI calls from
 * any origin — no proxy required. Using a proxy with dev keys causes 504 errors
 * in Replit's production environment because the target domain is unreachable
 * from the server side.
 */

import { createProxyMiddleware } from "http-proxy-middleware";
import type { RequestHandler } from "express";

export const CLERK_PROXY_PATH = "/api/__clerk";

export function clerkProxyMiddleware(): RequestHandler {
  const pk = process.env.CLERK_PUBLISHABLE_KEY || "";

  // Only proxy for Clerk PRODUCTION keys (pk_live_...).
  // Development keys (pk_test_...) allow direct browser FAPI calls — skip proxy.
  const isLiveKey = pk.startsWith("pk_live_");
  if (!isLiveKey) {
    return (_req, _res, next) => next();
  }

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    return (_req, _res, next) => next();
  }

  // For live keys, derive the FAPI domain from the publishable key
  let clerkFapi = "https://frontend-api.clerk.dev";
  try {
    const encoded = pk.replace(/^pk_live_/, "").replace(/\$$/, "");
    const domain = Buffer.from(encoded, "base64").toString("utf8").replace(/\0/g, "").replace(/\$$/, "");
    if (domain && domain.includes(".")) clerkFapi = `https://${domain}`;
  } catch {
    // fall through to default
  }

  return createProxyMiddleware({
    target: clerkFapi,
    changeOrigin: true,
    pathRewrite: (path: string) =>
      path.replace(new RegExp(`^${CLERK_PROXY_PATH}`), ""),
    on: {
      proxyReq: (proxyReq, req) => {
        const protocol = req.headers["x-forwarded-proto"] || "https";
        const host = req.headers.host || "";
        const proxyUrl = `${protocol}://${host}${CLERK_PROXY_PATH}`;

        proxyReq.setHeader("Clerk-Proxy-Url", proxyUrl);
        proxyReq.setHeader("Clerk-Secret-Key", secretKey);

        const xff = req.headers["x-forwarded-for"];
        const clientIp =
          (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim() ||
          req.socket?.remoteAddress ||
          "";
        if (clientIp) {
          proxyReq.setHeader("X-Forwarded-For", clientIp);
        }
      },
    },
  }) as RequestHandler;
}
