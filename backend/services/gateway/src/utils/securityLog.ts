// backend/services/gateway/src/utils/securityLog.ts
/**
 * References:
 * - NowVibin Backend — New-Session SOP (Template-style + Shared Test Harness) — v4 (Amended)
 * - Gateway Audit WAL Handoff (this session): “Split security telemetry from billing-grade audit”
 *
 * Why:
 * Security/attack attempts can be noisy and untrusted. We DO want to observe them,
 * but we DO NOT want them polluting the billing-grade WAL. This helper creates a dedicated
 * “security” logging channel, emitting structured, non-PII events that operators can route,
 * alert on, and analyze separately from audit/billing.
 *
 * Usage:
 * Call logSecurity() in the deny branches of guardrails (rate limit, auth, breaker, timeouts, validation).
 */
import type { Request } from "express";
import { logger } from "@shared/utils/logger";

// Restrict to a curated set so dashboards/alerts are predictable.
type SecurityKind =
  | "rate_limit"
  | "auth_failed"
  | "forbidden"
  | "circuit_open"
  | "timeout"
  | "input_validation"
  | "bot_detected";

export interface SecurityEvent {
  kind: SecurityKind; // what class of control tripped
  reason: string; // short code/message; never secrets
  decision: "blocked" | "allowed"; // what we decided
  status?: number; // HTTP returned
  route?: string; // normalized route if available
  method?: string; // HTTP method
  ip?: string; // best-effort caller ip
  details?: Record<string, unknown>; // non-PII crumbs: counters, rule ids, etc.
}

// Dedicated channel so ops can route/alert without regexing message text.
const secLogger = logger.child({ channel: "security" });

export function logSecurity(req: Request, ev: SecurityEvent) {
  try {
    const requestId =
      (req.headers["x-request-id"] as string) || (req as any).id || undefined;

    // Intentionally compact; no bodies, no tokens, no personal data.
    secLogger.warn(
      {
        ...ev,
        requestId,
        path: req.originalUrl || req.url,
      },
      // Message helps humans skimming logs; structure is for machines.
      "[SECURITY] %s %s → %s (%s)",
      ev.method || req.method,
      ev.route || "",
      ev.decision,
      ev.reason
    );
  } catch {
    // Never break the request path due to logging
  }
}
