// backend/services/gateway/src/app.ts
/**
 * References:
 * - NowVibin Backend — New-Session SOP v4 (Amended)
 *   • “No logic in routes; controllers thin; instrumentation everywhere”
 *   • “Only gateway is public; S2S to workers; Route convention /api/<slug>/<rest>”
 *   • “Global error middleware. All errors flow through problem.ts + error sink.”
 *   • “Audit-ready: WAL after guardrails; security telemetry separate from billing”
 * - This session’s design decisions:
 *   • Guardrails (rate limit, sensitive limiter, timeouts, circuit breaker, auth) log to SECURITY
 *   • Billing-grade audit (`auditCapture` + WAL) only **after** guardrails
 *   • `injectUpstreamIdentity` mints fresh S2S + user assertion before proxy
 *   • `loggingMiddleware` centralizes pino-http wiring (instead of inline app code)
 *
 * Why:
 * App assembly must reflect the pipeline ordering guarantees in SOP:
 *   1) HTTPS/CORS/request-id/logging/problem-json/early 5xx tracing
 *   2) Health (no auth, no audit)
 *   3) Guardrails FIRST (deny paths emit SECURITY logs; never hit audit)
 *   4) Billing-grade audit capture (WAL) for passed requests
 *   5) Identity injection and proxy plane (transport only)
 *   6) Tail parsing for non-proxied routes, then 404 + global error handler
 *
 * The file intentionally contains only assembly/glue — no business logic — and
 * heavy “why” comments so future maintainers understand ordering invariants.
 */

import express from "express";
import cors from "cors";
import axios from "axios";
import helmet from "helmet";
import { createHealthRouter, ReadinessFn } from "@shared/health";
import { logger } from "@shared/utils/logger";

import {
  serviceName,
  rateLimitCfg,
  timeoutCfg,
  breakerCfg,
  ROUTE_ALIAS,
} from "./config";

import { requestIdMiddleware } from "./middleware/requestId";
import {
  problemJsonMiddleware,
  notFoundHandler,
  errorHandler,
} from "./middleware/problemJson";
import { loggingMiddleware } from "./middleware/logging";
import { rateLimitMiddleware } from "./middleware/rateLimit";
import { timeoutsMiddleware } from "./middleware/timeouts";
import { circuitBreakerMiddleware } from "./middleware/circuitBreaker";
import { authGate } from "./middleware/authGate";
import { sensitiveLimiter } from "./middleware/sensitiveLimiter";
import { httpsOnly } from "./middleware/httpsOnly";
import { serviceProxy } from "./middleware/serviceProxy";
import { trace5xx } from "./middleware/trace5xx";
import { injectUpstreamIdentity } from "./middleware/injectUpstreamIdentity";

// Shared svcconfig mirror (source of truth for upstreams)
import {
  startSvcconfigMirror,
  getSvcconfigSnapshot,
} from "@shared/svcconfig/client";
import type { ServiceConfig } from "@shared/contracts/svcconfig.contract";

// ▶ Billing-grade Audit (after guards)
import { initWalFromEnv } from "./services/auditWal";
import { auditCapture } from "./middleware/auditCapture";

// Kick off svcconfig mirror (ETag-aware; polling/redis handled in shared)
// WHY: do this early so readiness can query it.
void startSvcconfigMirror();

// ──────────────────────────────────────────────────────────────────────────────
// Helpers confined to app assembly (avoid barrels)

function sanitizeUrl(u: string): string {
  // WHY: keep pino logs free of PII; redact known email-like path segments.
  try {
    const [path, qs] = u.split("?", 2);
    const p = path
      .replace(/(\/users\/email\/)[^/]+/i, "$1<redacted>")
      .replace(/(\/users\/private\/email\/)[^/]+/i, "$1<redacted>");
    return qs ? `${p}?${qs}` : p;
  } catch {
    return u;
  }
}

function resolveSlug(seg: string): string {
  // WHY: alias + naive singularization to canonical slug (matches gateway convention).
  const lower = String(seg || "").toLowerCase();
  const aliased = (ROUTE_ALIAS as Record<string, string>)[lower] || lower;
  return aliased.endsWith("s") ? aliased.slice(0, -1) : aliased;
}

function getServiceBySegment(seg: string): ServiceConfig | undefined {
  // WHY: health passthroughs only if upstream opted-in (enabled + allowProxy).
  const snap = getSvcconfigSnapshot();
  if (!snap) return undefined;
  const slug = resolveSlug(seg);
  const cfg = snap.services[slug];
  if (!cfg) return undefined;
  if (!cfg.enabled) return undefined;
  if (!cfg.allowProxy) return undefined;
  return cfg;
}

function healthUrlFor(seg: string, kind: "live" | "ready"): string | null {
  const cfg = getServiceBySegment(seg);
  if (!cfg || cfg.exposeHealth === false) return null;
  const healthRoot = (cfg.healthPath || "/health").replace(/\/+$/, "");
  return `${cfg.baseUrl.replace(/\/+$/, "")}${healthRoot}/${kind}`;
}

// ──────────────────────────────────────────────────────────────────────────────
// App
export const app = express();

app.disable("x-powered-by");
app.set("trust proxy", true); // WHY: respect X-Forwarded-* from LB/ingress

// HTTPS policy (prod/stage): redirect HTTP → HTTPS; dev/local opt-out via FORCE_HTTPS=false
app.use(httpsOnly());
if (process.env.FORCE_HTTPS === "true") {
  // WHY: HSTS only when HTTPS enforced
  app.use(helmet.hsts({ maxAge: 15552000, includeSubDomains: true }));
}

// CORS early; does not consume body
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD", "PATCH"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-request-id",
      "x-correlation-id",
      "x-amzn-trace-id",
      // Allow internal user assertion header through preflight
      "x-nv-user-assertion",
    ],
  })
);

// ❗ No body parsers before proxy — keep raw stream intact.

// Request ID must be *first* so every log/error/audit has a correlation key.
app.use(requestIdMiddleware());

// Centralized HTTP telemetry (pino-http) — lightweight, never blocking
app.use(loggingMiddleware());

// Problem+JSON envelope (adds res.problem helper)
app.use(problemJsonMiddleware());

// Trace where any 5xx is first set (observe-only)
app.use(trace5xx("early"));

// ──────────────────────────────────────────────────────────────────────────────
// Health / Readiness — BEFORE guardrails (public, no auth, no audit)
const readiness: ReadinessFn = async (_req) => {
  const must = ["user", "act"]; // adjust per deployment
  const upstreams: Record<string, { ok: boolean; url?: string }> = {};

  await Promise.all(
    must.map(async (slug) => {
      try {
        const h = healthUrlFor(slug, "ready");
        if (!h) {
          upstreams[slug] = { ok: false };
          return;
        }
        const r = await axios.get(h, {
          timeout: 1500,
          validateStatus: () => true,
        });
        upstreams[slug] = { ok: r.status === 200, url: h };
      } catch {
        upstreams[slug] = { ok: false };
      }
    })
  );

  return { upstreams };
};

app.use(
  "/",
  createHealthRouter({
    service: serviceName,
    readiness,
  })
);

// Public dynamic health passthroughs (NO /api, NO auth, NO Authorization)
// WHY: convenience endpoints to check worker health via gateway.
app.get("/:svc/health/:kind(live|ready)", async (req, res) => {
  try {
    delete req.headers.authorization; // never forward client auth to health
    const url = healthUrlFor(
      String(req.params.svc || ""),
      req.params.kind as "live" | "ready"
    );
    if (!url) {
      return res.status(404).json({
        code: "NOT_FOUND",
        status: 404,
        message: "Service not found or health not exposed",
      });
    }
    const r = await axios.get(url, {
      timeout: 1500,
      validateStatus: () => true,
      headers: { "x-request-id": String((req as any).id || "") },
    });
    return res.status(r.status).set(r.headers).send(r.data);
  } catch {
    return res.status(502).json({
      code: "BAD_GATEWAY",
      status: 502,
      message: "Upstream health unavailable",
    });
  }
});

// 👀 DEBUG: introspection endpoints (non-billable)
app.get("/__core", (_req, res) => {
  res.json({
    NODE_ENV: process.env.NODE_ENV,
    ENV_FILE: process.env.ENV_FILE,
  });
});
app.get("/__auth", (_req, res) => {
  res.json({
    NODE_ENV: process.env.NODE_ENV,
    CLIENT_AUTH_REQUIRE: process.env.CLIENT_AUTH_REQUIRE ?? null,
    CLIENT_AUTH_BYPASS: process.env.CLIENT_AUTH_BYPASS ?? null,
    CLIENT_AUTH_JWKS_URL: process.env.CLIENT_AUTH_JWKS_URL || null,
    CLIENT_AUTH_ISSUERS: process.env.CLIENT_AUTH_ISSUERS || null,
    CLIENT_AUTH_AUDIENCE: process.env.CLIENT_AUTH_AUDIENCE || null,
    CLIENT_AUTH_CLOCK_SKEW_SEC: process.env.CLIENT_AUTH_CLOCK_SKEW_SEC || null,
    S2S_SECRET_PRESENT: !!(
      process.env.S2S_SECRET && process.env.S2S_SECRET.length > 0
    ),
    S2S_ISSUER: process.env.S2S_ISSUER || null,
    S2S_AUDIENCE: process.env.S2S_AUDIENCE || null,
    INBOUND_STRIP_SEGMENTS: process.env.INBOUND_STRIP_SEGMENTS ?? null,
    OUTBOUND_API_PREFIX: process.env.OUTBOUND_API_PREFIX ?? null,
    USER_ASSERTION_SECRET_PRESENT: !!(
      process.env.USER_ASSERTION_SECRET &&
      process.env.USER_ASSERTION_SECRET.length > 0
    ),
    USER_ASSERTION_AUDIENCE: process.env.USER_ASSERTION_AUDIENCE || null,
    USER_ASSERTION_TTL_SEC: process.env.USER_ASSERTION_TTL_SEC || null,
    USER_ASSERTION_CLOCK_SKEW_SEC:
      process.env.USER_ASSERTION_CLOCK_SKEW_SEC || null,
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Guardrails FIRST — denials log to SECURITY (not WAL)
app.use(rateLimitMiddleware(rateLimitCfg));
app.use(sensitiveLimiter());
app.use(timeoutsMiddleware(timeoutCfg)); // cfg shape: { gatewayMs: number }
app.use(circuitBreakerMiddleware(breakerCfg));
app.use(authGate());

// ▶ BILLING-GRADE AUDIT — only after guards; before proxy
// WHY: WAL must contain only legitimate, passed requests (billable).
initWalFromEnv(); // idempotent init; boot-time replay runs here (non-blocking)
app.use(auditCapture());

// Lightweight public root
app.get("/", (_req, res) => res.type("text/plain").send("gateway is up"));

// ──────────────────────────────────────────────────────────────────────────────
// Proxy plane — transport only, no business logic
// WHY: ensure all proxied calls carry S2S + user assertion.
app.use("/api", injectUpstreamIdentity());
app.use("/api", serviceProxy());

// ──────────────────────────────────────────────────────────────────────────────
// Body parsers ONLY for non-proxied routes after proxy
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// Tail: 404 + global error handler (Problem+JSON)
app.use(notFoundHandler());
app.use(errorHandler());

export default app;
