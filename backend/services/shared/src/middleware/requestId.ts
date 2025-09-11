// backend/services/shared/middleware/requestId.ts

/**
 * Docs:
 * - Design: docs/design/backend/app/requestId.md
 * - Architecture: docs/architecture/backend/OBSERVABILITY.md
 * - ADRs:
 *   - docs/adr/0005-request-id-standardization.md
 *
 * Why:
 * - Every inbound request must carry a stable correlation key so that logs,
 *   guardrail denials, and audit WAL events can be tied together end-to-end.
 *   Without this, debugging and compliance auditing become guesswork.
 *
 * - By unifying on this shared middleware we eliminate drift:
 *   gateway, gateway-core, and all worker services now mint and propagate
 *   request IDs identically. This ensures a single trace ID spans every hop,
 *   which is essential when chasing distributed failures.
 *
 * Notes:
 * - Order matters. This must run **before** any logger, guardrail, or audit
 *   capture. Otherwise downstream log records will lack the request ID.
 * - Idempotent: never overwrite a caller-supplied ID. We only mint a UUID if
 *   the incoming request lacks all recognized headers.
 * - Headers honored: `x-request-id`, `x-correlation-id`, `x-amzn-trace-id`.
 *   We standardize on `x-request-id` for the response header and internal
 *   `req.id` field, but accept the others for interoperability.
 */

import type { RequestHandler } from "express";
import { randomUUID } from "crypto";

/**
 * Shared Request ID middleware.
 *
 * WHY this implementation:
 * - We deliberately avoid depending on any specific framework plugin so that
 *   we can control which headers are accepted and ensure the UUID is minted
 *   exactly once per request.
 * - Using Node's `crypto.randomUUID()` provides a standards-compliant,
 *   collision-resistant ID with negligible cost at our QPS.
 */
export function requestIdMiddleware(serviceName?: string): RequestHandler {
  return (req, res, next) => {
    // Accept common correlation headers; pick first if multiple supplied.
    const hdr =
      req.headers["x-request-id"] ||
      req.headers["x-correlation-id"] ||
      req.headers["x-amzn-trace-id"];

    // Generate UUID only if no acceptable header is present.
    const id = (Array.isArray(hdr) ? hdr[0] : hdr) || randomUUID();

    // Attach to request for in-process loggers, audit, and error reports.
    // Downstream code always uses `req.id` (string) as the canonical trace ID.
    (req as any).id = String(id);

    // Echo back so that callers and any intermediate proxies can correlate.
    // This is crucial for multi-hop tracing through gateway-core and workers.
    res.setHeader("x-request-id", String(id));

    // Optional: for structured logs, annotate with service for quicker grep.
    if (serviceName) {
      (req as any).service = serviceName;
    }

    next();
  };
}
