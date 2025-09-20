// backend/services/gateway/src/services/auditDispatch.ts

/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0015-edge-guardrails-stay-in-gateway-remove-from-shared.md
 *   - docs/adr/0021-gateway-core-internal-no-edge-guardrails.md
 *   - docs/adr/0022-standardize-shared-import-namespace-to-eff-shared.md
 *
 * Why:
 * - Dispatch audit batches to an internal worker using **internal resolution**
 *   (does not depend on `allowProxy`). Emits INFO/WARN so tests can assert.
 *
 * Behavior:
 * - Target URL: env override > svcconfig internal base + AUDIT_TARGET_PATH
 * - 2xx → ok; 4xx → non-retriable (drop); 5xx/other → retriable w/ backoff
 */
import type { AuditEvent } from "@eff/shared/src/contracts/auditEvent.contract";
import { putInternalJson } from "../utils/s2s/s2sClient";
import { resolveInternalBase, joinUrl } from "../utils/serviceResolver";
import { logger } from "@eff/shared/src/utils/logger";

type DispatchResult =
  | { ok: true; status: number }
  | { ok: false; status: number; retriable: boolean; message?: string };

const cfg = {
  slug: process.env.AUDIT_TARGET_SLUG || "event",
  path: process.env.AUDIT_TARGET_PATH || "/api/events",
  baseOverride: process.env.AUDIT_TARGET_BASEURL || "",
  maxRetryMs: num(process.env.WAL_MAX_RETRY_MS, 30000),
};

function num(v: string | undefined, d: number) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
}
function jittered(expMs: number) {
  const factor = 0.25 + Math.random() * 0.5;
  return Math.floor(expMs * factor);
}

/** Resolve final target URL from env + svcconfig. Throws if unavailable. */
export function resolveAuditUrl(): string {
  const path = cfg.path.startsWith("/") ? cfg.path : `/${cfg.path}`;
  if (cfg.baseOverride) return joinUrl(cfg.baseOverride, path);
  const base = resolveInternalBase(cfg.slug);
  if (!base)
    throw new Error(`[auditDispatch] target service '${cfg.slug}' unavailable`);
  return joinUrl(base, path);
}

export async function sendBatch(
  events: AuditEvent[],
  requestId?: string
): Promise<DispatchResult> {
  if (!Array.isArray(events) || events.length === 0) {
    return { ok: true, status: 204 };
  }
  const url = resolveAuditUrl();

  const res = await putInternalJson(
    url,
    events,
    requestId ? { "x-request-id": requestId } : undefined
  );
  const status = res.status;

  if (status >= 200 && status < 300) {
    logger.info({ url, status, count: events.length }, "[auditDispatch] sent");
    return { ok: true, status };
  }
  if (status >= 400 && status < 500) {
    logger.warn(
      { url, status, count: events.length },
      "[auditDispatch] non-retriable"
    );
    return {
      ok: false,
      status,
      retriable: false,
      message: `non-retriable ${status}`,
    };
  }

  logger.warn(
    { url, status, count: events.length },
    "[auditDispatch] retriable failure"
  );
  return { ok: false, status, retriable: true, message: `retriable ${status}` };
}

/** Backoff helper; cap by WAL_MAX_RETRY_MS. */
export function nextBackoffMs(attempt: number): number {
  const base = Math.min(
    cfg.maxRetryMs,
    Math.pow(2, Math.max(0, attempt)) * 100
  );
  return Math.min(cfg.maxRetryMs, jittered(base));
}
