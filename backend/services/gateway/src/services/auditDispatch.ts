#!/usr/bin/env ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0028-deprecate-gateway-core-centralize-s2s-in-shared.md
 *   - docs/adr/0029-versioned-slug-routing-and-svcconfig.md
 *   - docs/adr/0036-single-s2s-client-kms-only-callBySlug.md   // NEW
 *
 * Why:
 * - Dispatch audit batches via the shared KMS-only S2S client (callBySlug) using svcconfig.
 * - Prefer NDJSON streaming to match audit ingest and avoid large arrays.
 */

import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { callBySlug } from "@eff/shared/src/utils/s2s/callBySlug";
import type { AuditEvent } from "@eff/shared/src/contracts/auditEvent.contract";
import { logger } from "@eff/shared/src/utils/logger";

type DispatchResult =
  | { ok: true; status: number }
  | { ok: false; status: number; retriable: boolean; message?: string };

const cfg = {
  slug: process.env.AUDIT_TARGET_SLUG || "audit",
  version: process.env.AUDIT_TARGET_VERSION || "V1",
  path: sanitizePath(process.env.AUDIT_TARGET_PATH || "/events"),
  timeoutMs: num(process.env.WAL_DISPATCH_TIMEOUT_MS, 5000),
  maxRetryMs: num(process.env.WAL_MAX_RETRY_MS, 30000),
  ndjson: (process.env.AUDIT_NDJSON ?? "1") !== "0",
};

function num(v: string | undefined, d: number) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
}
function ensureLeading(p: string) {
  return p.startsWith("/") ? p : `/${p}`;
}
function sanitizePath(p: string) {
  const s = p.trim();
  if (!s) return "/events";
  return s.startsWith("/api/") ? s.slice(4) : ensureLeading(s);
}

/** Send one batch to the audit service via shared S2S. */
export async function sendBatch(
  events: AuditEvent[],
  requestId?: string
): Promise<DispatchResult> {
  if (!Array.isArray(events) || events.length === 0)
    return { ok: true, status: 204 };

  try {
    const headers: Record<string, string> = {
      // Disable 100-continue; stream-friendly
      expect: "",
      ...(requestId ? { "x-request-id": requestId } : {}),
    };

    let body: string | Readable;
    if (cfg.ndjson) {
      headers["content-type"] = "application/x-ndjson";
      const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
      body = Readable.from(lines, { encoding: "utf8" });
    } else {
      headers["content-type"] = "application/json";
      body = JSON.stringify(events);
    }

    const resp = await callBySlug<any>(cfg.slug, cfg.version, {
      method: "PUT",
      path: cfg.path, // service-local (httpClientBySlug adds outboundApiPrefix)
      timeoutMs: cfg.timeoutMs,
      headers,
      body,
      s2s: {
        // Extra S2S claim: audit can require this for /events ingest.
        extra: { nv: { purpose: "audit_wal_drain" } },
      },
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
          body: trim(resp?.data),
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
        body: trim(resp?.data),
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

function trim(b: unknown) {
  const s = typeof b === "string" ? b : b ? JSON.stringify(b) : "";
  return s.length > 256 ? `${s.slice(0, 256)}…` : s;
}
