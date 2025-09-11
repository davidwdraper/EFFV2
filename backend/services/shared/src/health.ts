// backend/services/shared/health.ts

/**
 * Docs:
 * - Design: docs/design/backend/health/OVERVIEW.md
 * - Architecture: docs/architecture/backend/HEALTH_READINESS.md
 * - ADRs:
 *   - docs/adr/0016-standard-health-and-readiness-endpoints.md
 *
 * Why:
 * - Liveness and readiness must be predictable across services and **public**.
 *   Ops and k8s need stable URLs and a compact, machine-friendly shape.
 * - Liveness answers “is the process up?” (cheap, no dependencies).
 * - Readiness answers “can this instance take traffic?” (fast, bounded checks).
 * - Every response should carry a `requestId` so failures correlate with logs.
 *
 * Notes:
 * - Do *not* block or call out to slow dependencies in liveness. Keep it local.
 * - Readiness accepts an optional async function for shallow/fast checks only.
 * - Endpoints are duplicated in both absolute and k8s-style forms for tooling.
 */

import express from "express";

export type ReadinessDetails = Record<string, any>;
export type ReadinessFn = (
  req: express.Request,
  ...args: any[]
) => Promise<ReadinessDetails> | ReadinessDetails;

type Options = {
  service: string;
  env?: string;
  version?: string;
  gitSha?: string;
  /** Optional, fast readiness checker. Keep bounded and dependency-aware. */
  readiness?: ReadinessFn;
};

function getReqId(req: express.Request) {
  const h =
    req.headers["x-request-id"] ||
    req.headers["x-correlation-id"] ||
    req.headers["x-amzn-trace-id"];
  return (Array.isArray(h) ? h[0] : h) || (req as any).id || undefined;
}

/**
 * Exposes:
 *   GET /health         -> legacy/compat liveness
 *   GET /health/live    -> explicit liveness
 *   GET /health/ready   -> explicit readiness
 *   GET /healthz        -> k8s-style liveness
 *   GET /readyz         -> k8s-style readiness
 *   GET /live           -> relative liveness (for smoke.sh convenience)
 *   GET /ready          -> relative readiness (for smoke.sh convenience)
 */
export function createHealthRouter(opts: Options) {
  const router = express.Router();

  const base = {
    service: opts.service,
    env: opts.env ?? process.env.NODE_ENV,
    version: opts.version,
    gitSha: opts.gitSha,
  };

  // WHY (liveness): process is up and serving HTTP. No external calls here.
  const liveness = (req: express.Request, res: express.Response) => {
    res.json({ ...base, ok: true, requestId: getReqId(req) });
  };

  // WHY (readiness): fast, bounded checks to decide if we can take traffic.
  const readiness = async (req: express.Request, res: express.Response) => {
    try {
      const details = opts.readiness ? await opts.readiness(req) : {};
      res.json({ ...base, ok: true, requestId: getReqId(req), ...details });
    } catch (err) {
      // WHY: 503 signals "not ready" to orchestrators; include safe error text.
      res.status(503).json({
        ...base,
        ok: false,
        requestId: getReqId(req),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // Routes
  router.get("/health", liveness); // legacy
  router.get("/health/live", liveness); // absolute
  router.get("/health/ready", readiness);
  router.get("/healthz", liveness); // k8s legacy
  router.get("/readyz", readiness); // k8s legacy
  router.get("/live", liveness); // relative
  router.get("/ready", readiness); // relative

  return router;
}
