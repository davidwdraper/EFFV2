// backend/services/gateway/src/middleware/audit/buildGatewayWal.ts
/**
 * DI-only WAL builder for Gateway — no registrars, no AUDIT_WRITER*.
 */
import { buildWal } from "@nv/shared/wal/WalBuilder";
import type { IWalEngine } from "@nv/shared/wal/IWalEngine";
import { HttpAuditWriter } from "@nv/shared/wal/writer/HttpAuditWriter";

type SvcClientLike = {
  callBySlug: <TReq, TRes>(
    slug: string,
    version: number,
    route: string,
    method: string,
    message: TReq,
    options?: { timeoutMs?: number }
  ) => Promise<TRes>;
};

export async function buildGatewayWal(opts: {
  walDir: string; // absolute path
  svcClient: SvcClientLike; // your shared client instance
  http?: {
    auditSlug?: string; // default "audit"
    auditVersion?: number; // default 1
    route?: string; // default "/entries"
    timeoutMs?: number; // default 5000
    retries?: number; // default 3
    backoffMs?: number; // default 250
  };
}): Promise<IWalEngine> {
  const http = opts.http ?? {};
  const writer = new HttpAuditWriter({
    svcClient: opts.svcClient,
    auditSlug: http.auditSlug ?? "audit",
    auditVersion: http.auditVersion ?? 1,
    route: http.route ?? "/entries",
    timeoutMs: http.timeoutMs ?? 5000,
    retries: Math.max(0, http.retries ?? 3),
    backoffMs: Math.max(0, http.backoffMs ?? 250),
  });

  return buildWal({
    journal: { dir: opts.walDir },
    writer: { instance: writer },
  });
}
