// backend/services/shared/health.ts

import { Router, Request, Response } from "express";

type Check = { ok: boolean; detail?: string };
type ReadinessFn = () => Promise<Record<string, Check>>;

const START = Date.now();

export function createHealthRouter(opts: {
  service: string;
  env?: string;
  version?: string;
  gitSha?: string;
  readiness?: ReadinessFn;
}) {
  const {
    service,
    env = process.env.NODE_ENV || "development",
    version = process.env.BUILD_VERSION || "dev",
    gitSha = process.env.GIT_SHA || "dev",
    readiness,
  } = opts;

  const r = Router();

  r.get("/health", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      status: "ok",
      service,
      env,
      version,
      gitSha,
      uptimeSec: Number(((Date.now() - START) / 1000).toFixed(2)),
      time: new Date().toISOString(),
    });
  });

  r.get("/ready", async (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    let checks: Record<string, Check> = {};
    try {
      checks = (await readiness?.()) ?? {};
    } catch (e: any) {
      checks._readiness = {
        ok: false,
        detail: e?.message || "readiness threw",
      };
    }
    const allOk = Object.values(checks).every((c) => c.ok !== false);
    res.status(allOk ? 200 : 503).json({
      status: allOk ? "ok" : "degraded",
      service,
      checks: Object.keys(checks).length ? checks : { self: { ok: true } },
    });
  });

  return r;
}
