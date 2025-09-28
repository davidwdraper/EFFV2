/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - Design: docs/design/backend/audit/WAL.md
 * - ADRs:
 *   - docs/adr/0010-5xx-first-assignment-tracing.md
 *   - docs/adr/0016-standard-health-and-readiness-endpoints.md
 *   - docs/adr/0029-versioned-slug-routing-and-svcconfig.md
 *   - docs/adr/0032-route-policy-via-svcconfig-and-ctx-hop-tokens.md
 *
 * Why:
 * - Capture canonical AuditEvent AFTER guardrails for any billable request.
 * - Correlate via requestId; enqueue to WAL (fire-and-forget).
 *
 * Emits (contract-aligned):
 *   required: eventId, ts, durationMs, requestId, method, path, slug, status, billableUnits
 *   optional: tsStart, durationReliable, finalizeReason, meta (string map)
 */

import type { RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { logger } from "@eff/shared/src/utils/logger";
import { walEnqueue } from "../services/auditWal";
import type { AuditEvent } from "@eff/shared/src/contracts/auditEvent.contract";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Treat health/infra paths as non-billable. Covers direct and /api/:slug/health/* */
function isAuditEligible(url: string): boolean {
  const path = (url || "").toLowerCase().split("?")[0];

  // Exact infra paths
  const infra = new Set([
    "/health",
    "/health/live",
    "/health/ready",
    "/healthz",
    "/readyz",
    "/live",
    "/ready",
    "/favicon.ico",
    "/__core",
    "/__auth",
    "/__audit",
  ]);
  if (infra.has(path)) return false;

  // Any /api/<slug>/health/(live|ready)
  if (/^\/api\/[^/]+\/health\/(live|ready)\b/.test(path)) return false;

  return true;
}

/** Prefer parsedApiRoute injected by the API/health routers; fallback to path parse. */
function deriveSlug(
  originalUrl: string,
  parsedApiRoute?: { slug?: string }
): string {
  const slugFromCtx = String(parsedApiRoute?.slug || "")
    .trim()
    .toLowerCase();
  if (slugFromCtx) return slugFromCtx;

  const path = (originalUrl || "").split("?")[0];
  const parts = path.split("/").filter(Boolean);

  // Expect /api/<slug>/... for unversioned health or /api/<slug>.<Vx>/... for versioned
  if (parts[0] === "api" && parts[1]) {
    // Handle either "<slug>" or "<slug>.<Vx>"
    const seg = parts[1].toLowerCase();
    const m = seg.match(/^([a-z0-9-]+)(?:\.[vV]?\d+)?$/);
    const slug = m ? m[1] : seg;
    // naive singular (kept from prior behavior)
    return slug.endsWith("s") ? slug.slice(0, -1) : slug;
  }

  return "gateway";
}

function mapFinalizeReason(
  kind: "finish" | "close" | "error",
  statusCode: number,
  writableEnded: boolean
): AuditEvent["finalizeReason"] {
  if (kind === "finish") return "finish";
  if (kind === "close") return writableEnded ? "finish" : "client-abort";
  if (kind === "error" && statusCode === 504) return "timeout";
  return undefined;
}

// ── Middleware ───────────────────────────────────────────────────────────────

export function auditCapture(): RequestHandler {
  return (req, res, next) => {
    if (!isAuditEligible(req.originalUrl || req.url || req.path || "")) {
      return next();
    }

    const tsStartMs = Date.now();
    const t0 = process.hrtime.bigint();

    const finalize = (kind: "finish" | "close" | "error") => {
      const durationMs = Number((process.hrtime.bigint() - t0) / 1_000_000n);
      const finalizeReason = mapFinalizeReason(
        kind,
        res.statusCode || 0,
        res.writableEnded
      );
      const durationReliable = finalizeReason === "finish";

      // STRICT string map per contract
      const callerIpRaw = (
        (req.headers["x-forwarded-for"] as string) ||
        (req.ip as string) ||
        ""
      )
        .split(",")[0]
        .trim();
      const userIdRaw = (req as any)?.user?.id as string | undefined;

      const meta: Record<string, string> = {};
      if (callerIpRaw) meta.callerIp = String(callerIpRaw);
      if (userIdRaw) meta.userId = String(userIdRaw);
      meta.s2sCaller = "gateway";

      const ev: AuditEvent = {
        eventId: randomUUID(),
        ts: new Date().toISOString(),
        tsStart: new Date(tsStartMs).toISOString(),
        durationMs,
        durationReliable,
        requestId: (req as any).id || "",
        method: req.method,
        path: req.originalUrl || req.url || req.path || "",
        slug: deriveSlug(
          req.originalUrl || req.url || req.path || "",
          (req as any).parsedApiRoute
        ),
        status: res.statusCode || 0,
        billableUnits: 1,
        finalizeReason,
        meta: Object.keys(meta).length ? meta : undefined,
      };

      logger.debug(
        {
          rid: ev.requestId,
          eid: ev.eventId,
          status: ev.status,
          method: ev.method,
          path: ev.path,
          slug: ev.slug,
          dur: ev.durationMs,
          reason: ev.finalizeReason,
        },
        "[auditCapture] enqueue"
      );

      walEnqueue(ev);
    };

    res.on("finish", () => finalize("finish"));
    res.on("close", () => finalize("close"));
    res.on("error", () => finalize("error"));

    next();
  };
}
