/**
 * Clerk Frontend API Proxy Middleware
 *
 * Proxies Clerk Frontend API requests through your domain, enabling Clerk
 * authentication on custom domains and .replit.app deployments.
 *
 * Only active in production. Production Clerk setup is managed by Replit's
 * Clerk integration — this middleware should not need any code changes.
 *
 * Mount point: app.use(CLERK_PROXY_PATH, clerkProxyMiddleware())
 * Express strips the mount prefix before this handler runs, so req.path
 * is relative: e.g. /npm/... or /v1/... — NOT /api/__clerk/npm/...
 */

import { createProxyMiddleware } from "http-proxy-middleware";
import type { RequestHandler } from "express";

const CLERK_FAPI = "https://frontend-api.clerk.dev";
const CLERK_NPM_CDN = "https://npm.clerk.dev";
export const CLERK_PROXY_PATH = "/api/__clerk";

export function clerkProxyMiddleware(): RequestHandler {
  if (process.env.NODE_ENV !== "production") {
    return (_req, _res, next) => next();
  }

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    return (_req, _res, next) => next();
  }

  const fapiProxy = createProxyMiddleware({
    target: CLERK_FAPI,
    changeOrigin: true,
    pathRewrite: (path: string) => path,
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

  // Transparent proxy for Clerk's npm CDN — clerk.browser.js and related assets.
  // Previously this was a 302 redirect which broke Clerk's script loader
  // (it validates the origin of the script response). Now we pipe the content
  // through our own domain so no cross-origin redirect occurs.
  const cdnProxy = createProxyMiddleware({
    target: CLERK_NPM_CDN,
    changeOrigin: true,
    pathRewrite: (path: string) => path.replace(/^\/npm/, ""),
  }) as RequestHandler;

  return (req, res, next) => {
    if (req.path.startsWith("/npm")) {
      return cdnProxy(req, res, next);
    }
    return fapiProxy(req, res, next);
  };
}
