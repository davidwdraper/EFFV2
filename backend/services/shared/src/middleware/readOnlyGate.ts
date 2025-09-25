// backend/services/shared/middleware/readOnlyGate.ts

/**
 * Docs:
 * - Design: docs/design/backend/guardrails/read-only-mode.md
 * - Architecture: docs/architecture/backend/GUARDRAILS.md
 * - ADRs:
 *   - docs/adr/0019-read-only-mode-guardrail.md
 *
 * Why:
 * - During incidents/maintenance we may need to **halt all mutations** quickly
 *   without redeploying. A shared read-only gate lets ops flip one env var and
 *   get consistent behavior across gateway and services.
 * - Denials are **SECURITY telemetry** (not billable). We return RFC7807
 *   Problem+JSON with a clear, short message and the requestId for correlation.
 *
 * Order:
 * - Gateway (edge): with other guardrails, **before** audit/proxy.
 * - Services (S2S): after health and **after verifyS2S**, **before** routes.
 *
 * Notes:
 * - Exemptions allow critical paths to keep working (e.g., `/health`, `/ready`,
 *   or specific GET-like maintenance endpoints) via READ_ONLY_EXEMPT_PREFIXES.
 * - We re-read process.env on each request so ops can flip the mode without restart.
 */

import type { Request, Response, NextFunction } from "express";
import { logSecurity } from "@eff/shared/src/utils/securityLog";

export type ReadOnlyGateOptions = {
  /** Override env-based enablement for tests/special cases. */
  enabled?: boolean;
  /** HTTP methods considered mutating. Default: POST, PUT, PATCH, DELETE. */
  methods?: string[];
  /**
   * Extra exempt prefixes in addition to env READ_ONLY_EXEMPT_PREFIXES.
   * Example: ["/health", "/healthz", "/readyz"]
   */
  exemptPrefixes?: string[];
};

/** Parse comma-separated prefixes from env, trimming blanks. */
function envPrefixes(): string[] {
  const raw = process.env.READ_ONLY_EXEMPT_PREFIXES || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isMutationMethod(method: string, methods: string[]): boolean {
  const m = method.toUpperCase();
  return methods.includes(m);
}

function isExempt(path: string, extra: string[]): boolean {
  const list = [...envPrefixes(), ...extra];
  return list.some((p) => p && (path === p || path.startsWith(p)));
}

/** Return boolean from env with tolerant parsing. */
function envFlag(name: string, def = false): boolean {
  const v = String(process.env[name] ?? "")
    .trim()
    .toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return def;
}

/**
 * Shared read-only guardrail.
 * - When enabled, blocks mutating methods unless path is exempt.
 * - Logs SECURITY on deny; optionally logs a "bypass" on exempt mutation attempts.
 */
export function readOnlyGate(opts: ReadOnlyGateOptions = {}) {
  const defaultMethods = ["POST", "PUT", "PATCH", "DELETE"];
  const cfgMethods = (opts.methods || defaultMethods).map((m) =>
    m.toUpperCase()
  );
  const extraExempt = opts.exemptPrefixes || [];

  return (req: Request, res: Response, next: NextFunction) => {
    // Re-evaluate on every request so ops can flip mode via env without a restart.
    const enabled = opts.enabled ?? envFlag("READ_ONLY_MODE", false);

    if (!enabled) return next();

    // Non-mutating methods (GET/HEAD/OPTIONS) pass through.
    if (!isMutationMethod(req.method, cfgMethods)) return next();

    // Exempt prefixes (env + opts) pass through; log selective "bypass".
    if (isExempt(req.path, extraExempt)) {
      // Optional selective allow visibility (not noisy for GETs since we only check mutators)
      logSecurity(req, {
        kind: "read_only",
        reason: "exempt_prefix",
        decision: "bypass",
        status: 200,
        route: req.path,
        method: req.method,
        details: { prefixList: [...envPrefixes(), ...extraExempt] },
      });
      return next();
    }

    // Deny mutation in read-only mode.
    logSecurity(req, {
      kind: "read_only",
      reason: "read_only_mode",
      decision: "blocked",
      status: 503,
      route: req.path,
      method: req.method,
    });

    return res
      .status(503)
      .type("application/problem+json")
      .json({
        type: "about:blank",
        title: "Service Unavailable",
        status: 503,
        detail: "Read-only mode is active; mutating operations are disabled.",
        requestId: (req as any).id,
        instance: req.originalUrl || req.url,
      });
  };
}
