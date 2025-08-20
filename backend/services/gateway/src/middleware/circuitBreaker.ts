// backend/services/gateway/src/middleware/circuitBreaker.ts
import type { RequestHandler } from "express";
import { performance } from "node:perf_hooks";

type Cfg = {
  failureThreshold: number;
  halfOpenAfterMs: number;
  minRttMs: number;
};
type State = { failures: number; openedAt?: number; halfOpen?: boolean };

const breakers = new Map<string, State>();

export function circuitBreakerMiddleware(cfg: Cfg): RequestHandler {
  return (req, res, next) => {
    const seg = (
      req.path.split("/").filter(Boolean)[0] || "default"
    ).toLowerCase();
    const st = breakers.get(seg) || { failures: 0 };
    const now = Date.now();

    if (
      st.openedAt &&
      now - st.openedAt < cfg.halfOpenAfterMs &&
      !st.halfOpen
    ) {
      return res.status(503).json({
        type: "about:blank",
        title: "Service Unavailable",
        status: 503,
        detail: `Circuit open for ${seg}`,
        instance: (req as any).id,
      });
    }
    if (st.openedAt && now - st.openedAt >= cfg.halfOpenAfterMs) {
      st.halfOpen = true;
      breakers.set(seg, st);
    }

    const start = performance.now();
    res.on("finish", () => {
      const rtt = performance.now() - start;
      const failed = res.statusCode >= 500;
      if (failed) {
        st.failures += 1;
        if (st.failures >= cfg.failureThreshold && !st.openedAt) {
          st.openedAt = Date.now();
          st.halfOpen = false;
        }
      } else {
        st.failures = 0;
        st.openedAt = undefined;
        st.halfOpen = false;
      }
      // (Optional) observe rtt if you want to log slow paths vs failures.
      breakers.set(seg, st);
    });

    next();
  };
}
