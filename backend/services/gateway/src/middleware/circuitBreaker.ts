// backend/services/gateway/src/middleware/circuitBreaker.ts
/**
 * References:
 * - NowVibin Backend — New-Session SOP v4 (Amended)
 *   • Guardrails run before proxy; audit logs only after gates
 *   • Instrumentation everywhere; never block on logging
 * - This session’s design: Security telemetry vs billing-grade audit
 *   • Guardrail denials → SECURITY log (not WAL)
 *
 * Why:
 * Protect downstream services from cascading failures. This lightweight,
 * per-segment (first path segment) circuit breaker:
 *   1) Tracks consecutive 5xx responses per segment.
 *   2) Opens the circuit after `failureThreshold` consecutive failures.
 *   3) While open, immediately fails requests with 503 (fast-fail).
 *   4) After `halfOpenAfterMs`, allows a single probe window ("half-open").
 *   5) Success closes the circuit (resets counters); failure re-opens.
 *
 * We emit SECURITY logs only when we actively deny a request due to an open circuit.
 * That keeps the billing-grade audit stream clean, as per SOP.
 *
 * Notes:
 * - `minRttMs` is provided for future use (e.g., counting pathological latency
 *   as a "soft failure" to accelerate open). We record RTT and keep the hook,
 *   but we do not factor it into the breaker yet to avoid false positives.
 */

import type { RequestHandler } from "express";
import { performance } from "node:perf_hooks";
import { logSecurity } from "../utils/securityLog";

type Cfg = {
  /** How many consecutive 5xx responses before we open the circuit. */
  failureThreshold: number;
  /** How long to stay open before allowing half-open probes (ms). */
  halfOpenAfterMs: number;
  /** (Reserved) RTT threshold to consider a response "too slow" (ms). */
  minRttMs: number;
};

type State = {
  failures: number;
  openedAt?: number;
  halfOpen?: boolean;
};

const breakers = new Map<string, State>();

export function circuitBreakerMiddleware(cfg: Cfg): RequestHandler {
  // Defensive normalization — avoid NaNs/zeros causing odd behavior.
  const failureThreshold = Math.max(1, cfg.failureThreshold | 0);
  const halfOpenAfterMs = Math.max(100, cfg.halfOpenAfterMs | 0);
  const minRttMs = Math.max(0, cfg.minRttMs | 0); // currently observational only

  return (req, res, next) => {
    // Segment = first non-empty path token (e.g., "/api/user/..." → "api").
    // Why: simple blast radius segmentation without needing a routing table here.
    const seg = (
      req.path.split("/").filter(Boolean)[0] || "default"
    ).toLowerCase();
    const st = breakers.get(seg) || { failures: 0 };
    const now = Date.now();

    // If circuit is open and we are still within "open" window (not half-open), deny fast.
    if (st.openedAt && now - st.openedAt < halfOpenAfterMs && !st.halfOpen) {
      // SECURITY log: we are actively blocking due to open circuit.
      logSecurity(req, {
        kind: "circuit_open",
        reason: "upstream_unhealthy",
        decision: "blocked",
        status: 503,
        route: req.path,
        method: req.method,
        details: { seg, openedAt: st.openedAt, ageMs: now - st.openedAt },
      });
      return res.status(503).json({
        type: "about:blank",
        title: "Service Unavailable",
        status: 503,
        detail: `Circuit open for ${seg}`,
        instance: (req as any).id,
      });
    }

    // If open window elapsed, transition to half-open (allow probes).
    if (st.openedAt && now - st.openedAt >= halfOpenAfterMs && !st.halfOpen) {
      st.halfOpen = true; // allow requests through; outcome decides close/reopen
      breakers.set(seg, st);
    }

    // From this point, request is allowed to proceed (closed or half-open).
    const start = performance.now();

    res.on("finish", () => {
      const rtt = performance.now() - start;
      const failed = res.statusCode >= 500;
      // (Optional future use) const tooSlow = minRttMs > 0 && rtt >= minRttMs;

      // Half-open behavior:
      // - On first success after half-open: close circuit (reset).
      // - On failure after half-open: immediately re-open (no need to hit threshold).
      if (st.halfOpen) {
        if (!failed /* && !tooSlow */) {
          // Success closes the circuit and resets counters.
          st.failures = 0;
          st.openedAt = undefined;
          st.halfOpen = false;
        } else {
          // Failure in half-open: snap back to open.
          st.failures = failureThreshold; // record threshold level for visibility
          st.openedAt = Date.now();
          st.halfOpen = false;
        }
        breakers.set(seg, st);
        return;
      }

      // Closed behavior: count consecutive hard failures (5xx only).
      if (failed /* || tooSlow */) {
        st.failures += 1;
        // When crossing threshold from closed, open circuit.
        if (st.failures >= failureThreshold && !st.openedAt) {
          st.openedAt = Date.now();
          st.halfOpen = false;
        }
      } else {
        // Any success on closed circuit resets counters.
        st.failures = 0;
        st.openedAt = undefined;
        st.halfOpen = false;
      }

      breakers.set(seg, st);
    });

    next();
  };
}
