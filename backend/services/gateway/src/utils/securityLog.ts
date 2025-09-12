// backend/services/gateway/src/utils/securityLog.ts

/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 *
 * Why:
 * - Guardrail denials and anomalous edge decisions belong to SECURITY telemetry,
 *   not the billing-grade audit WAL.
 */
import type { Request } from "express";
import { logger } from "@eff/shared/src/utils/logger";

type SecurityKind =
  | "rate_limit"
  | "auth_failed"
  | "forbidden"
  | "circuit_open"
  | "timeout"
  | "input_validation"
  | "bot_detected";

export interface SecurityEvent {
  kind: SecurityKind;
  reason: string;
  decision: "blocked" | "allowed";
  status?: number;
  route?: string;
  method?: string;
  ip?: string;
  details?: Record<string, unknown>;
}

const secLogger = logger.child({ channel: "security" });

export function logSecurity(req: Request, ev: SecurityEvent) {
  try {
    const requestId =
      (req.headers["x-request-id"] as string) || (req as any).id || undefined;

    secLogger.warn(
      {
        ...ev,
        requestId,
        path: req.originalUrl || req.url,
      },
      "[SECURITY] %s %s → %s (%s)",
      ev.method || req.method,
      ev.route || "",
      ev.decision,
      ev.reason
    );
  } catch {
    /* never break request path due to logging */
  }
}
