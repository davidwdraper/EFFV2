// backend/services/shared/src/middleware/problem.ts
/**
 * Docs:
 * - SOP: Reduced, Clean
 * - Purpose: Final error handler that preserves status codes from
 *   ControllerBase.fail(...) (which throws { status, body } objects),
 *   and emits RFC7807-like JSON. No silent 500 overrides for 4xx.
 */

import type { ErrorRequestHandler } from "express";

type HandlerResultLike = { status?: number; body?: unknown };

export const problem: ErrorRequestHandler = (err, _req, res, _next) => {
  // If a controller threw a HandlerResult-like object, honor it.
  if (
    err &&
    typeof err === "object" &&
    "status" in (err as any) &&
    "body" in (err as any)
  ) {
    const hr = err as HandlerResultLike;
    const status =
      typeof hr.status === "number" && hr.status >= 400 && hr.status < 600
        ? hr.status
        : 500;
    return res
      .status(status)
      .json(hr.body ?? { ok: false, error: "unknown_error" });
  }

  // Otherwise, send generic 500 problem
  // eslint-disable-next-line no-console
  console.error("[problem:error]", err);
  res.status(500).json({ type: "about:blank", title: "Internal Server Error" });
};
