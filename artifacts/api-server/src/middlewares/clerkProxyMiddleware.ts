/**
 * Clerk Frontend API Proxy Middleware
 *
 * Proxies Clerk Frontend API requests through your domain, enabling Clerk
 * authentication on custom domains and .replit.app deployments.
 *
 * Uses native fetch + stream piping instead of http-proxy-middleware so it
 * works correctly inside Replit's production container networking.
 *
 * Only active in production. Development uses Clerk test keys directly.
 *
 * Mount point: app.use(CLERK_PROXY_PATH, clerkProxyMiddleware())
 * Express strips the mount prefix before this handler runs, so req.path
 * is relative: e.g. /npm/... or /v1/... — NOT /api/__clerk/npm/...
 */

import type { RequestHandler } from "express";
import { Readable } from "stream";

// Derive the FAPI URL from the publishable key at server start-up.
// pk_live_Y2xlcmsuaW5jbHVkbHkuaW4k → base64-decode body → "clerk.includly.in$" → strip trailing "$"
function fapiFromKey(pk: string): string {
  const body = pk.replace(/^pk_(live|test)_/, "");
  const decoded = Buffer.from(body, "base64").toString("utf8");
  return "https://" + (decoded.endsWith("$") ? decoded.slice(0, -1) : decoded);
}

const CLERK_FAPI =
  process.env.CLERK_FAPI_URL ||
  (process.env.VITE_CLERK_PUBLISHABLE_KEY
    ? fapiFromKey(process.env.VITE_CLERK_PUBLISHABLE_KEY)
    : process.env.CLERK_PUBLISHABLE_KEY
    ? fapiFromKey(process.env.CLERK_PUBLISHABLE_KEY)
    : "https://clerk.includly.in");
// npm.clerk.dev is not resolvable from Replit's production servers (DNS blocked).
// clerk.includly.in also serves npm assets and is reachable.
const CLERK_NPM_CDN = CLERK_FAPI;
export const CLERK_PROXY_PATH = "/api/__clerk";

const SKIP_REQ_HEADERS = new Set(["host", "connection", "transfer-encoding"]);
const SKIP_RES_HEADERS = new Set(["connection", "transfer-encoding", "keep-alive"]);

async function fetchProxy(
  upstreamUrl: string,
  req: Parameters<RequestHandler>[0],
  res: Parameters<RequestHandler>[1],
  extraHeaders: Record<string, string> = {}
): Promise<void> {
  const upstreamHeaders: Record<string, string> = { ...extraHeaders };

  for (const [key, val] of Object.entries(req.headers)) {
    if (SKIP_REQ_HEADERS.has(key.toLowerCase())) continue;
    if (val == null) continue;
    upstreamHeaders[key] = Array.isArray(val) ? val.join(", ") : val;
  }

  const upstream = await fetch(upstreamUrl, {
    method: req.method,
    headers: upstreamHeaders,
    // @ts-expect-error — Node 18 fetch accepts a Readable body
    body: req.method !== "GET" && req.method !== "HEAD" ? req : undefined,
    redirect: "follow",
  });

  res.status(upstream.status);

  for (const [key, val] of upstream.headers.entries()) {
    if (SKIP_RES_HEADERS.has(key.toLowerCase())) continue;
    res.setHeader(key, val);
  }

  if (!upstream.body) {
    res.end();
    return;
  }

  // Pipe the upstream ReadableStream into the Express response
  Readable.fromWeb(upstream.body as import("stream/web").ReadableStream).pipe(res);
}

export function clerkProxyMiddleware(): RequestHandler {
  if (process.env.NODE_ENV !== "production") {
    return (_req, _res, next) => next();
  }

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    return (_req, _res, next) => next();
  }

  return (req, res, next) => {
    // /npm/* — Clerk's JS SDK assets (clerk.browser.js, etc.)
    if (req.path.startsWith("/npm")) {
      const cdnPath = req.path.replace(/^\/npm/, "") + (req.url.includes("?") ? `?${req.url.split("?")[1]}` : "");
      fetchProxy(`${CLERK_NPM_CDN}${cdnPath}`, req, res).catch(next);
      return;
    }

    // All other paths — Clerk Frontend API
    const protocol = (Array.isArray(req.headers["x-forwarded-proto"])
      ? req.headers["x-forwarded-proto"][0]
      : req.headers["x-forwarded-proto"]) || "https";
    const host = req.headers.host || "";
    const proxyUrl = `${protocol}://${host}${CLERK_PROXY_PATH}`;

    const xff = req.headers["x-forwarded-for"];
    const clientIp =
      (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      "";

    const extraHeaders: Record<string, string> = {
      "Clerk-Proxy-Url": proxyUrl,
      "Clerk-Secret-Key": secretKey,
    };
    if (clientIp) extraHeaders["X-Forwarded-For"] = clientIp;

    fetchProxy(`${CLERK_FAPI}${req.path}`, req, res, extraHeaders).catch(next);
  };
}
