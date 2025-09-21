/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0028-deprecate-gateway-core-centralize-s2s-in-shared.md
 *   - docs/adr/0029-versioned-slug-routing-and-svcconfig.md
 *
 * Why:
 * - Dispatch audit batches via the **shared S2S client** (callBySlug) using svcconfig.
 * - Avoid resolver/proxy drift and never hardcode base URLs/ports.
 *
 * Behavior:
 * - 2xx → ok; 4xx → non-retriable (drop); 5xx/timeout/0 → retriable w/ backoff.
 * - Path is **service-local** (NO `/api`), because httpClientBySlug adds outboundApiPrefix.
 */

import { callBySlug } from "@eff/shared/src/utils/s2s/callBySlug";
import type { AuditEvent } from "@eff/shared/src/contracts/auditEvent.contract";
import { logger } from "@eff/shared/src/utils/logger";

type DispatchResult =
  | { ok: true; status: number }
  | { ok: false; status: number; retriable: boolean; message?: string };

const cfg = {
  // IMPORTANT: default to 'audit' (matches svcconfig). Can override via env.
  slug: process.env.AUDIT_TARGET_SLUG || "audit",
  // Accept V1/v1/1 — callBySlug normalizes to "V#".
  version: process.env.AUDIT_TARGET_VERSION || "V1",
  // Service-local path (NO /api prefix).
  path: sanitizePath(process.env.AUDIT_TARGET_PATH || "/events"),
  timeoutMs: num(process.env.WAL_DISPATCH_TIMEOUT_MS, 3000),
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
function ensureLeading(p: string) {
  return p.startsWith("/") ? p : `/${p}`;
}
function sanitizePath(p: string) {
  // If someone passes "/api/events", strip the extra "/api" so we don’t get "/api/api/events".
  const s = p.trim();
  if (!s) return "/events";
  return s.startsWith("/api/") ? s.slice(4) : ensureLeading(s);
}

/** Send one batch to the audit service via shared S2S. */
export async function sendBatch(
  events: AuditEvent[],
  requestId?: string
): Promise<DispatchResult> {
  if (!Array.isArray(events) || events.length === 0) {
    return { ok: true, status: 204 };
  }

  try {
    const resp = await callBySlug<any>(cfg.slug, cfg.version, {
      method: "PUT",
      path: cfg.path, // service-local
      timeoutMs: cfg.timeoutMs,
      headers: {
        "content-type": "application/json",
        ...(requestId ? { "x-request-id": requestId } : {}),
      },
      body: events,
    });

    const status = Number(resp?.status || 0);

    if (status >= 200 && status < 300) {
      logger.info(
        {
          slug: cfg.slug,
          version: cfg.version,
          path: cfg.path,
          status,
          count: events.length,
        },
        "[auditDispatch] sent"
      );
      return { ok: true, status };
    }

    if (status >= 400 && status < 500) {
      logger.warn(
        {
          slug: cfg.slug,
          version: cfg.version,
          path: cfg.path,
          status,
          count: events.length,
        },
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
      {
        slug: cfg.slug,
        version: cfg.version,
        path: cfg.path,
        status,
        count: events.length,
      },
      "[auditDispatch] retriable failure"
    );
    return {
      ok: false,
      status,
      retriable: true,
      message: `retriable ${status}`,
    };
  } catch (err: any) {
    // callBySlug returns status 0 on network/timeout; treat as retriable
    logger.warn(
      {
        slug: cfg.slug,
        version: cfg.version,
        path: cfg.path,
        err: err?.message || String(err),
      },
      "[auditDispatch] call failed"
    );
    return {
      ok: false,
      status: 0,
      retriable: true,
      message: err?.message || "call failed",
    };
  }
}

/** Backoff helper; cap by WAL_MAX_RETRY_MS. */
export function nextBackoffMs(attempt: number): number {
  const base = Math.min(
    cfg.maxRetryMs,
    Math.pow(2, Math.max(0, attempt)) * 100
  );
  return Math.min(cfg.maxRetryMs, jittered(base));
}
