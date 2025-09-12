// backend/services/gateway/src/readiness.ts

/**
 * Docs:
 * - Design: docs/design/backend/gateway/app.md
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0024-extract-readiness-from-app-assembly-for-separation-of-concerns.md
 *
 * Why:
 * - Keep app assembly clean. Readiness concerns live here.
 * - Probes upstream `/health/ready` for required services (env-tunable).
 */

import type { ReadinessFn } from "@eff/shared/src/health";
import { getSvcconfigSnapshot } from "@eff/shared/src/svcconfig/client";
import type { ServiceConfig } from "@eff/shared/src/contracts/svcconfig.contract";
import { s2sGet } from "./utils/s2sClient";

function healthUrlFor(cfg: ServiceConfig | undefined, kind: "ready" | "live") {
  if (!cfg || cfg.exposeHealth === false) return null;
  const healthRoot = (cfg.healthPath || "/health").replace(/\/+$/, "");
  const base = cfg.baseUrl.replace(/\/+$/, "");
  return `${base}${healthRoot}/${kind}`;
}

export const readiness: ReadinessFn = async (_req) => {
  const snap = getSvcconfigSnapshot();
  const mustEnv = (process.env.GATEWAY_READY_UPSTREAMS || "user,act")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const upstreams: Record<
    string,
    { ok: boolean; url?: string; status?: number }
  > = {};

  await Promise.all(
    mustEnv.map(async (slug) => {
      try {
        const cfg = snap?.services?.[slug];
        const url = healthUrlFor(cfg, "ready");
        if (!cfg || !cfg.enabled || !url) {
          upstreams[slug] = { ok: false };
          return;
        }
        const r = await s2sGet(url, {
          timeout: 1500,
          validateStatus: () => true,
        } as any);
        upstreams[slug] = { ok: r.status === 200, url, status: r.status };
      } catch {
        upstreams[slug] = { ok: false };
      }
    })
  );

  return { upstreams };
};
