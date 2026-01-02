// backend/services/shared/src/base/app/appHealth.ts
/**
 * Docs:
 * - ADR-0013 (Versioned Health Envelope; versioned health routes)
 * - ADR-0039 (env-service centralized non-secret env; runtime reload endpoint)
 * - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *
 * Purpose:
 * - Shared helpers for health & env reload endpoints for AppBase.
 *
 * Invariants:
 * - EnvServiceDto is owned by SvcRuntime, not AppBase.
 * - Env reload MUST update rt via rt.setEnvDto().
 */

import type { Express, Request, Response } from "express";
import type { IBoundLogger } from "../../logger/Logger";
import type { EnvServiceDto } from "../../dto/env-service.dto";
import type { SvcRuntime } from "../../runtime/SvcRuntime";

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
  rt: SvcRuntime;

  /**
   * MUST return the fresh EnvServiceDto (primary).
   * The handler will set it into rt via rt.setEnvDto().
   */
  envReloader: () => Promise<EnvServiceDto>;
};

export function mountEnvReloadRoute(opts: EnvReloadOpts): void {
  const { app, base, log, envLabel, rt, envReloader } = opts;
  const path = `${base}/env/reload`;

  app.post(path, async (_req, res) => {
    const current = rt.getSvcEnvDto();
    const fromEnv = (current as any).env;
    const fromSlug = (current as any).slug;
    const fromVersion = (current as any).version;

    try {
      const fresh = await envReloader();
      rt.setEnvDto(fresh);

      return res.status(200).json({
        ok: true,
        reloadedAt: new Date().toISOString(),
        processEnv: envLabel,
        from: { env: fromEnv, slug: fromSlug, version: fromVersion },
        to: {
          env: (fresh as any).env,
          slug: (fresh as any).slug,
          version: (fresh as any).version,
        },
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
