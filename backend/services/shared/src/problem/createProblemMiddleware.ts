// backend/services/shared/src/problem/createProblemMiddleware.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0043 (Finalize mapping / failure propagation)
 *   - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *
 * Purpose:
 * - Express-only final error funnel.
 * - Preserves explicit { status, body } throws (ControllerBase.fail style).
 * - Emits RFC7807-ish JSON for unexpected errors (using ProblemFactory shape).
 *
 * Invariants:
 * - Express import allowed here (adapter).
 * - No process.env reads.
 * - No identity lying: serviceSlug/serviceVersion/envLabel are REQUIRED inputs.
 */

import type { ErrorRequestHandler } from "express";
import type { IBoundLogger } from "../logger/Logger";
import { ProblemFactory, type ProblemJson } from "./problem";

type HandlerResultLike = { status?: unknown; body?: unknown };

function isHandlerResultLike(x: unknown): x is HandlerResultLike {
  if (!x || typeof x !== "object") return false;
  return "status" in (x as any) || "body" in (x as any);
}

function toHttpStatus(x: unknown): number | null {
  const n = typeof x === "number" ? x : Number(x);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  if (i < 100 || i > 599) return null;
  return i;
}

export function createProblemMiddleware(opts: {
  log: IBoundLogger;
  serviceSlug: string;
  serviceVersion: number;
  envLabel: string;
}): ErrorRequestHandler {
  const { log, serviceSlug, serviceVersion, envLabel } = opts;

  const pf = new ProblemFactory({
    serviceSlug,
    serviceVersion,
    env: envLabel,
  });

  return (err, _req, res, _next) => {
    // 1) Preserve explicit {status, body} throws (controller/rails contract)
    if (isHandlerResultLike(err)) {
      const hr = err as HandlerResultLike;
      const status = toHttpStatus(hr.status) ?? 500;

      const body =
        hr.body ??
        ({
          type: "about:blank",
          title: status >= 500 ? "Internal Server Error" : "Request Failed",
          status,
        } as const);

      return res.status(status).json(body);
    }

    // 2) Unexpected errors -> generic response + log
    const e = err instanceof Error ? err : null;

    log.error(
      {
        service: serviceSlug,
        serviceVersion,
        env: envLabel,
        error: e ? { message: e.message, stack: e.stack } : err,
      },
      "unhandled error in request pipeline"
    );

    const p: ProblemJson = pf.internalError();
    return res.status(500).json(p);
  };
}
