// backend/services/gateway/src/middleware/auditCapture.ts
/**
 * References:
 * - NowVibin SOP v4 — “Billing-grade audit AFTER guardrails; requestId correlation; fire-and-forget”
 * - Canonical contract: @shared/contracts/auditEvent.contract (meta: Record<string,string>)
 *
 * Why:
 * Capture a canonical AuditEvent for requests that pass guardrails, matching the
 * shared contract exactly. Any extra breadcrumbs (callerIp, userId, component)
 * are serialized into `meta: Record<string,string>` to avoid type drift.
 *
 * Contract-aligned fields emitted:
 *   - Required: eventId, ts, durationMs, requestId, method, path, slug, status, billableUnits
 *   - Optional: tsStart, durationReliable, finalizeReason, meta (string map)
 *
 * Finalize reason mapping:
 *   res.finish      → "finish"
 *   res.close       → "client-abort" if not writableEnded, else "finish"
 *   res.error(504)  → "timeout"
 *   other error     → undefined (still audits, just no finalizeReason)
 */

import type { RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { logger } from "@shared/utils/logger";
import { walEnqueue } from "../services/auditWal";
import type { AuditEvent } from "@shared/src/contracts/auditEvent.contract";
import { ROUTE_ALIAS } from "../config";

// Exclude non-billable endpoints
function isAuditEligible(url: string): boolean {
  const u = (url || "").toLowerCase();
  return ![
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
  ].includes(u);
}

// Derive service slug from /api/<slug>/... (alias + naive singular), else "gateway"
function deriveSlug(originalUrl: string): string {
  const path = (originalUrl || "").split("?")[0];
  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "api" || !parts[1]) return "gateway";
  const seg = parts[1].toLowerCase();
  const aliased = (ROUTE_ALIAS as Record<string, string>)[seg] || seg;
  return aliased.endsWith("s") ? aliased.slice(0, -1) : aliased;
}

// Map runtime signals to contract finalizeReason
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

export function auditCapture(): RequestHandler {
  return (req, res, next) => {
    if (!isAuditEligible(req.path || "")) return next();

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

      // Extras → meta (STRICT string map per contract)
      const callerIpRaw = (
        (req.headers["x-forwarded-for"] as string) ||
        req.ip ||
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
        slug: deriveSlug(req.originalUrl || req.url || req.path || ""),
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
