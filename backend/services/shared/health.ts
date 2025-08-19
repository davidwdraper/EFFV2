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

/**
 * Exposes:
 *   GET /health   -> legacy/compat liveness
 *   GET /healthz  -> k8s-style liveness
 *   GET /readyz   -> readiness; may include upstream details
 */
export function createHealthRouter(opts: Options) {
  const router = express.Router();

  const base = {
    service: opts.service,
    env: opts.env ?? process.env.NODE_ENV,
    version: opts.version,
    gitSha: opts.gitSha,
  };

  // Legacy liveness (compat with older scripts/monitors)
  router.get("/health", (_req, res) => {
    res.json({ ...base, ok: true });
  });

  // Kubernetes liveness
  router.get("/healthz", (_req, res) => {
    res.json({ ...base, ok: true });
  });

  // Readiness (+ optional upstream checks)
  router.get("/readyz", async (req, res) => {
    try {
      const details = opts.readiness ? await opts.readiness(req) : {};
      res.json({ ...base, ok: true, ...details });
    } catch (err) {
      res.status(503).json({
        ...base,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return router;
}
