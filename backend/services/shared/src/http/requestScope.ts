// backend/services/shared/src/http/requestScope.ts
/**
 * Docs:
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 * - ADR-0042 (HandlerContext Bus — KISS)
 *
 * Purpose:
 * - Request-scoped metadata via AsyncLocalStorage.
 * - Allows SvcClient + logging to know whether the current request is a test run
 *   and whether failures are expected (negative tests).
 *
 * Invariants:
 * - No process.env reads.
 * - Pure runtime scope only (seeded at inbound controller boundary).
 */

import type { Request } from "express";
import { AsyncLocalStorage } from "node:async_hooks";

export type NvRequestScope = {
  requestId: string;
  /**
   * Optional test-run identifier propagated via inbound headers.
   * When present, downstream services can correlate logs to a test run.
   */
  testRunId?: string;
  /**
   * When true, negative-test failures are expected and should not page humans.
   * (Used to downgrade ERROR logs to WARN/INFO where appropriate.)
   */
  expectErrors?: boolean;
};

const ALS = new AsyncLocalStorage<NvRequestScope>();

function normalizeBool(v: unknown): boolean | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim().toLowerCase();
  if (!s) return undefined;
  if (s === "1" || s === "true" || s === "yes" || s === "y") return true;
  if (s === "0" || s === "false" || s === "no" || s === "n") return false;
  return undefined;
}

function header(req: Request, name: string): string | undefined {
  const raw = (req.headers as any)?.[name] as unknown;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0];
  return undefined;
}

/**
 * Seed request scope from inbound Express Request.
 * Uses ALS.enterWith so the scope applies to the rest of the async call chain.
 */
export function enterRequestScopeFromInbound(input: {
  req: Request;
  requestId: string;
}): NvRequestScope {
  const { req, requestId } = input;

  const testRunId = header(req, "x-nv-test-run-id")?.trim() || undefined;

  const expectErrors =
    normalizeBool(header(req, "x-nv-test-expect-errors")) ?? undefined;

  const scope: NvRequestScope = {
    requestId,
    testRunId,
    expectErrors,
  };

  ALS.enterWith(scope);
  return scope;
}

/** Best-effort getter (never throws). */
export function getRequestScope(): NvRequestScope | undefined {
  return ALS.getStore();
}

/**
 * Headers to automatically propagate on S2S calls.
 * (SvcClient will eventually merge these in.)
 */
export function getS2SPropagationHeaders(): Record<string, string> {
  const scope = ALS.getStore();
  if (!scope) return {};

  const h: Record<string, string> = {
    "x-request-id": scope.requestId,
  };

  if (scope.testRunId) h["x-nv-test-run-id"] = scope.testRunId;
  if (scope.expectErrors === true) h["x-nv-test-expect-errors"] = "true";

  return h;
}

/** Convenience: are we in an "expected error" test context right now? */
export function isExpectedErrorContext(): boolean {
  const scope = ALS.getStore();
  return !!scope?.testRunId && scope?.expectErrors === true;
}
