// backend/services/shared/middleware/circuitBreaker.ts

/**
 * Docs:
 * - Design: docs/design/backend/guardrails/circuit-breaker.md
 * - Architecture: docs/architecture/backend/GUARDRAILS.md
 * - ADRs:
 *   - docs/adr/0013-segmented-circuit-breaker.md
 *
 * Why:
 * - Protect downstreams from cascades: when a segment (first path token) starts
 *   failing with consecutive 5xx, **open the circuit** to shed load quickly.
 * - Keep guardrail denials out of the billing stream: denials log to SECURITY,
 *   not to the audit WAL (per SOP).
 *
 * Order:
 * - Mount after timeouts and before audit/proxy. If open, we fail fast with 503.
 *
 * Notes:
 * - Segmentation by first path token gives a pragmatic blast radius without
 *   coupling to service routing tables.
 * - `minRttMs` is reserved for future “soft failure” signals (slow = bad).
 * - Fail-open on internal errors — availability beats protection here.
 */

import type { RequestHandler } from "express";
import { performance } from "node:perf_hooks";
import { logSecurity } from "../utils/securityLog";

export type BreakerCfg = {
  /** How many consecutive 5xx responses before we open the circuit. */
  failureThreshold: number;
  /** How long to stay open before allowing half-open probes (ms). */
  halfOpenAfterMs: number;
  /** (Reserved) RTT threshold to treat as soft failure (ms). */
  minRttMs: number;
};

/** WHY: In-memory default store. Swap to distributed if you need cross-instance state. */
type State = { failures: number; openedAt?: number; halfOpen?: boolean };
const breakers = new Map<string, State>();

/** Env contract (per SOP Config Contracts): BREAKER_* */
function loadCfgFromEnv(): BreakerCfg {
  const ft = Number(process.env.BREAKER_FAILURE_THRESHOLD ?? 5);
  const ho = Number(process.env.BREAKER_HALF_OPEN_AFTER_MS ?? 10_000);
  const mr = Number(process.env.BREAKER_MIN_RTT_MS ?? 0);
  return {
    failureThreshold: Number.isFinite(ft) && ft > 0 ? ft : 5,
    halfOpenAfterMs: Number.isFinite(ho) && ho > 0 ? ho : 10_000,
    minRttMs: Number.isFinite(mr) && mr >= 0 ? mr : 0,
  };
}

/** WHY: Simple segmentation by first non-empty path token keeps blast radius sane. */
function segmentOf(path: string) {
  return (path.split("/").filter(Boolean)[0] || "default").toLowerCase();
}

export function circuitBreakerMiddleware(cfg?: BreakerCfg): RequestHandler {
  // Defensive normalization — avoid NaNs/zeros causing odd behavior.
  const env = loadCfgFromEnv();
  const failureThreshold = Math.max(
    1,
    (cfg?.failureThreshold ?? env.failureThreshold) | 0
  );
  const halfOpenAfterMs = Math.max(
    100,
    (cfg?.halfOpenAfterMs ?? env.halfOpenAfterMs) | 0
  );
  const minRttMs = Math.max(0, (cfg?.minRttMs ?? env.minRttMs) | 0); // reserved

  return (req, res, next) => {
    try {
      const seg = segmentOf(req.path);
      const st = breakers.get(seg) || { failures: 0 };
      const now = Date.now();

      // If circuit is open and still within open window (not half-open), deny fast.
      if (st.openedAt && now - st.openedAt < halfOpenAfterMs && !st.halfOpen) {
        logSecurity(req, {
          kind: "circuit_open",
          reason: "upstream_unhealthy",
          decision: "blocked",
          status: 503,
          route: req.path,
          method: req.method,
          details: { seg, openedAt: st.openedAt, ageMs: now - st.openedAt },
        });

        const requestId = (req as any).id;
        return res
          .status(503)
          .type("application/problem+json")
          .json({
            type: "about:blank",
            title: "Service Unavailable",
            status: 503,
            detail: `Circuit open for ${seg}`,
            instance: req.originalUrl || req.url,
            requestId,
          });
      }

      // If open window elapsed, transition to half-open (allow probes).
      if (st.openedAt && now - st.openedAt >= halfOpenAfterMs && !st.halfOpen) {
        st.halfOpen = true; // allow requests through; success closes, failure re-opens
        breakers.set(seg, st);
      }

      // Allowed (closed or half-open): measure RTT and update state on finish.
      const start = performance.now();

      res.on("finish", () => {
        const rtt = performance.now() - start;
        const failed = res.statusCode >= 500;
        // const tooSlow = minRttMs > 0 && rtt >= minRttMs; // reserved for future tuning

        if (st.halfOpen) {
          if (!failed /* && !tooSlow */) {
            // Success closes the circuit.
            st.failures = 0;
            st.openedAt = undefined;
            st.halfOpen = false;
          } else {
            // Failure in half-open: snap back to open immediately.
            st.failures = failureThreshold;
            st.openedAt = Date.now();
            st.halfOpen = false;
          }
          breakers.set(seg, st);
          return;
        }

        // Closed: count consecutive hard failures (5xx only).
        if (failed /* || tooSlow */) {
          st.failures += 1;
          if (st.failures >= failureThreshold && !st.openedAt) {
            st.openedAt = Date.now();
            st.halfOpen = false;
          }
        } else {
          // Any success resets counters.
          st.failures = 0;
          st.openedAt = undefined;
          st.halfOpen = false;
        }

        breakers.set(seg, st);
      });

      next();
    } catch {
      // Fail-open: breaker must never take down request processing.
      next();
    }
  };
}
