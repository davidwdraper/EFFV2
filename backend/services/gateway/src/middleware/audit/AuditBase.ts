// backend/services/gateway/src/middleware/audit/AuditBase.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0022 — Shared WAL & DB Base (generic, shippable)
 *   - ADR-0024 — WAL Durability (FS journal, fsync cadence)
 *   - ADR-0025 — Writer Injection (DI-first; no registries at runtime)
 *   - ADR-0027 — SvcClient/SvcReceiver S2S Contract (baseline, pre-auth)
 *
 * Purpose:
 * - Gateway-side audit bootstrap (DI-only):
 *   - Lazily ensures a single WAL instance on app.locals.
 *   - Consumes a slug-aware SvcClient from app.locals (no env URLs).
 *   - DI-injects HttpAuditWriter (no registrars, no AUDIT_WRITER*).
 */

import type { Request } from "express";
import type { IWalEngine } from "../../../../shared/src/wal/IWalEngine";
import { buildWal } from "../../../../shared/src/wal/WalBuilder";
import { HttpAuditWriter } from "../../../../shared/src/wal/writer/HttpAuditWriter";
import * as path from "node:path";

// Locals keys
const APP_WAL_LOCALS_KEY = "gatewayWal";
const APP_SVCCLIENT_KEY = "svcClient";
const REQ_AUDIT_RID_KEY = "__auditRequestId";

// Audit service identifier only; URL is resolved by injected SvcClient.
const AUDIT_SLUG = "audit";
const AUDIT_VERSION = 1;
const AUDIT_ROUTE = "/entries";

// Duck-typed SvcClient dependency matching your posted SvcClient.call(opts)
type SvcClientLike = {
  call<T = unknown>(opts: {
    slug: string;
    version?: number;
    path: string;
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    headers?: Record<string, string | undefined>;
    query?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
    timeoutMs?: number;
    requestId?: string;
  }): Promise<{
    ok: boolean;
    status: number;
    headers: Record<string, string>;
    data?: T;
    error?: { code: string; message: string };
    requestId: string;
  }>;
};

export class AuditBase {
  static async ensureWal(req: Request): Promise<IWalEngine> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyApp = req.app as any;

    // Reuse if already constructed
    const existing = anyApp?.locals?.[APP_WAL_LOCALS_KEY] as
      | IWalEngine
      | undefined;
    if (existing) return existing;

    // Strict env: require absolute WAL dir
    const walDir = (process.env.NV_GATEWAY_WAL_DIR ?? "").trim();
    if (!walDir) throw new Error("[gateway] NV_GATEWAY_WAL_DIR is required");
    if (!path.isAbsolute(walDir)) {
      throw new Error(
        `[gateway] NV_GATEWAY_WAL_DIR must be absolute, got "${walDir}"`
      );
    }

    // Consume the single slug-aware SvcClient the app published earlier.
    const svcClient = anyApp?.locals?.[APP_SVCCLIENT_KEY] as
      | SvcClientLike
      | undefined;
    if (!svcClient || typeof svcClient.call !== "function") {
      throw new Error(
        "[gateway] app.locals.svcClient missing/invalid. Publish a slug-aware SvcClient " +
          "(with .call(opts)) before audit middleware."
      );
    }

    // DI: construct the writer explicitly — no registrars, no name lookups
    const writer = new HttpAuditWriter({
      svcClient,
      auditSlug: AUDIT_SLUG,
      auditVersion: AUDIT_VERSION,
      route: AUDIT_ROUTE,
      // keep defaults for timeout/retry unless env-configured
    });

    const wal = await buildWal({
      journal: { dir: walDir },
      writer: { instance: writer },
    });

    anyApp.locals ??= {};
    anyApp.locals[APP_WAL_LOCALS_KEY] = wal;
    return wal;
  }

  static getWal(req: Request): IWalEngine {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyApp = req.app as any;
    const wal = anyApp?.locals?.[APP_WAL_LOCALS_KEY] as IWalEngine | undefined;
    if (!wal) {
      throw new Error(
        "[gateway] WAL not initialized (audit.begin must run first)"
      );
    }
    return wal;
  }

  static getOrCreateRequestId(req: Request): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyReq = req as any;
    if (typeof anyReq[REQ_AUDIT_RID_KEY] === "string")
      return anyReq[REQ_AUDIT_RID_KEY];

    const rid =
      (req.headers["x-request-id"] as string) ||
      (anyReq.id as string | undefined) ||
      AuditBase.randomId();

    anyReq[REQ_AUDIT_RID_KEY] = rid;
    return rid;
  }

  static peekRequestId(req: Request): string | undefined {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (req as any)[REQ_AUDIT_RID_KEY] as string | undefined;
  }

  private static randomId(): string {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { randomUUID } = require("crypto");
      return randomUUID();
    } catch {
      return `rid_${Math.random().toString(36).slice(2)}`;
    }
  }
}
