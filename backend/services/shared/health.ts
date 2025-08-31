// backend/services/shared/health.ts
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

  // Liveness helpers
  const liveness = (req: express.Request, res: express.Response) => {
    res.json({ ...base, ok: true, instance: getReqId(req) });
  };

  // Readiness helpers
  const readiness = async (req: express.Request, res: express.Response) => {
    try {
      const details = opts.readiness ? await opts.readiness(req) : {};
      res.json({ ...base, ok: true, instance: getReqId(req), ...details });
    } catch (err) {
      res.status(503).json({
        ...base,
        ok: false,
        instance: getReqId(req),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // Routes
  router.get("/health", liveness); // legacy
  router.get("/health/live", liveness); // new absolute
  router.get("/health/ready", readiness); // new absolute
  router.get("/healthz", liveness); // k8s legacy
  router.get("/readyz", readiness); // k8s legacy
  router.get("/live", liveness); // relative
  router.get("/ready", readiness); // relative

  return router;
}
