// backend/services/shared/contracts/http.ts
import type { Response } from "express";
import type { ZodError } from "zod";

type Problem = {
  code: string; // e.g. "BAD_REQUEST"
  message: string; // human readable summary
  status: number; // HTTP status
  requestId?: string; // x-request-id passthrough
  details?: unknown; // structured extras (e.g. zod issues)
};

/**
 * Canonical JSON responder. Always use this so responses are uniform & testable.
 */
export function respond<T>(res: Response, status: number, body: T): void {
  res.status(status).json(body);
}

/**
 * Zod → 400 Problem response.
 * - Uses ZodError.issues (correct property) and flatten() for deterministic tests.
 */
export function zodBadRequest(
  res: Response,
  err: ZodError,
  requestId?: string
): void {
  const p: Problem = {
    code: "BAD_REQUEST",
    message: "Invalid request body or parameters.",
    status: 400,
    requestId,
    details: {
      issues: err.issues, // <-- correct for Zod v3
      flatten: err.flatten?.(), // { fieldErrors, formErrors }
    },
  };
  respond(res, 400, p);
}
