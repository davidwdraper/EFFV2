// backend/services/shared/src/base/app/appHealth.ts
/**
 * Docs:
 * - ADR-0013 (Versioned Health Envelope; versioned health routes)
 * - ADR-0039 (env-service centralized non-secret env; runtime reload endpoint)
 *
 * Purpose:
 * - Shared helpers for health & env reload endpoints for AppBase.
 */

import type { Express, Request, Response } from "express";
import type { IBoundLogger } from "@nv/shared/logger/Logger";
import type { EnvServiceDto } from "@nv/shared/dto/env-service.dto";

export function computeHealthBasePath(
  service: string | undefined,
  version: number
): string | null {
  const slug = service?.toLowerCase();
  if (!slug) return null;
  return `/api/${slug}/v${version}`;
}

type HealthOpts = {
  app: Express;
  base: string;
  service: string;
  version: number;
  envLabel: string;
  log: IBoundLogger;
  readyCheck?: () => Promise<boolean> | boolean;
};

export function mountVersionedHealthRoute(opts: HealthOpts): void {
  const { app, base, service, version, envLabel, log, readyCheck } = opts;
  const path = `${base}/health`;

  app.get(path, async (_req: Request, res: Response) => {
    try {
      const ready = readyCheck ? await readyCheck() : true;
      res.status(200).json({
        ok: true,
        service,
        version,
        env: envLabel,
        ready,
        ts: new Date().toISOString(),
      });
    } catch {
      res.status(200).json({
        ok: true,
        service,
        version,
        env: envLabel,
        ready: false,
        ts: new Date().toISOString(),
      });
    }
  });

  log.info({ path, env: envLabel }, "health mounted");
}

type EnvReloadOpts = {
  app: Express;
  base: string;
  log: IBoundLogger;
  envLabel: string;
  getEnvDto: () => EnvServiceDto;
  setEnvDto: (fresh: EnvServiceDto) => void;
  envReloader: () => Promise<EnvServiceDto>;
};

export function mountEnvReloadRoute(opts: EnvReloadOpts): void {
  const { app, base, log, envLabel, getEnvDto, setEnvDto, envReloader } = opts;
  const path = `${base}/env/reload`;

  app.post(path, async (_req, res) => {
    const current = getEnvDto();
    const fromEnv = current.env;
    const fromSlug = current.slug;
    const fromVersion = current.version;

    try {
      const fresh = await envReloader();
      setEnvDto(fresh);

      return res.status(200).json({
        ok: true,
        reloadedAt: new Date().toISOString(),
        processEnv: envLabel,
        from: { env: fromEnv, slug: fromSlug, version: fromVersion },
        to: { env: fresh.env, slug: fresh.slug, version: fresh.version },
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        type: "about:blank",
        title: "env_reload_failed",
        detail:
          (err as Error)?.message ??
          "Failed to reload environment. Ops: verify env-service configuration document and DB connectivity.",
      });
    }
  });

  log.info({ path, env: envLabel }, "env reload mounted");
}
