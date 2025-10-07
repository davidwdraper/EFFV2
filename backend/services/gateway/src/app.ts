// backend/services/gateway/src/app.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0001 (Gateway-Embedded SvcConfig mirror)
 *   - ADR-0003 (Gateway pulls svc map from svcfacilitator)
 *   - ADR-0006 (Gateway Edge Logging — pre-audit, toggleable)
 *   - ADR-0013 (Versioned Health — local, never proxied)
 *   - ADR-0014 (Base Hierarchy — ServiceEntrypoint → AppBase → ServiceBase)
 *
 * Purpose:
 * - GatewayApp extends AppBase (OO parity).
 * - Local, versioned health at /api/gateway/v1/health/{live,ready}.
 * - Readiness ties to svcconfig mirror count.
 * - All NON-gateway /api/<slug>/v<major>/... are proxied via SvcConfig mirror.
 */

import type { Request, Response, NextFunction } from "express";
import { AppBase } from "@nv/shared/base/AppBase";
import { makeProxy } from "./routes/proxy";
import { edgeHitLogger } from "./middleware/edge.hit.logger";
import { responseErrorLogger } from "@nv/shared/middleware/response.error.logger";
import { getSvcConfig } from "./services/svcconfig/SvcConfig";
import type { SvcConfig } from "./services/svcconfig/SvcConfig";

const SERVICE = "gateway";

export class GatewayApp extends AppBase {
  // IMPORTANT: don’t initialize here; AppBase calls configure() in its ctor.
  // Field initializers haven’t run yet at that time.
  private svcConfig?: SvcConfig;

  constructor() {
    super({ service: SERVICE });
  }

  protected configure(): void {
    // Lazily acquire the singleton the first time configure() runs.
    const sc = (this.svcConfig ??= getSvcConfig());

    // Fire-and-forget warm load; readiness will stay false until entries > 0
    void sc.ensureLoaded().catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error("[gateway] svcconfig warm-load failed:", String(err));
    });

    // 1) Local, versioned health (never proxied)
    this.mountVersionedHealth("/api/gateway/v1", {
      readyCheck: () => {
        try {
          return sc.count() > 0;
        } catch {
          return false;
        }
      },
    });

    // 2) Edge hit logging (pre-audit)
    this.app.use(edgeHitLogger());

    // 3) Error logger (one line on 4xx/5xx)
    this.app.use(responseErrorLogger(SERVICE));

    // 4) Proxy LAST — origin swap only, path/query unchanged
    this.app.use("/api", makeProxy(sc));

    // 5) Final JSON error handler (jq-safe)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    this.app.use(
      (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
        // eslint-disable-next-line no-console
        console.error("[gateway:error]", err);
        res
          .status(500)
          .json({ type: "about:blank", title: "Internal Server Error" });
      }
    );
  }
}
