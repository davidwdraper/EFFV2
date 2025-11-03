// backend/services/shared/src/http/HandlerBase.ts
/**
 * Docs:
 * - ADR-0041 (Controller & Handler Architecture)
 * - ADR-0042 (HandlerContext Bus)
 * - ADR-0043 (Hydration + Failure Propagation)
 *
 * Purpose:
 * - Abstract base for handlers:
 *   • DI of HandlerContext
 *   • Short-circuit on prior failure
 *   • Standardized instrumentation via bound logger
 *   • Seeds a bound logger back into HandlerContext under key "log"
 */

import { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { getLogger, type IBoundLogger } from "@nv/shared/logger/Logger";

export abstract class HandlerBase {
  protected readonly ctx: HandlerContext;
  protected readonly log: IBoundLogger;

  constructor(ctx: HandlerContext) {
    this.ctx = ctx;

    // Prefer service App logger if available; fall back to shared root
    const App = this.ctx.get<any>("App");
    const appLog: IBoundLogger | undefined = App?.log;

    const base =
      appLog?.bind?.({
        component: "HandlerBase",
        handler: this.constructor.name,
      }) ??
      getLogger({
        service: "shared",
        component: "HandlerBase",
        handler: this.constructor.name,
      });

    this.log = base;

    // Expose a request-scoped logger to downstream handlers/services via context
    this.ctx.set("log", this.log);

    this.log.debug(
      {
        event: "construct",
        handlerStatus: this.ctx.get<string>("handlerStatus") ?? "ok",
      },
      "HandlerBase ctor"
    );
  }

  /** Framework entrypoint called by controllers */
  public async run(): Promise<void> {
    const status = this.ctx.get<number>("status");
    const handlerStatus = this.ctx.get<string>("handlerStatus");

    // Short-circuit if prior handler failed
    if ((status && status >= 400) || handlerStatus === "error") {
      this.log.debug(
        { event: "short_circuit", reason: "prior_failure" },
        "No-op after failure"
      );
      return;
    }

    this.log.debug({ event: "execute_start" }, "Handler execute() start");

    try {
      await this.execute(); // Derived handler’s one job
    } catch (err) {
      this.log.debug(
        {
          event: "execute_catch",
          error: (err as Error)?.message ?? String(err),
        },
        "Handler threw"
      );
      // Standardize error mapping for finalize(ctx)
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 400);
      this.ctx.set("error", {
        code: "HANDLER_ERROR",
        message: (err as Error)?.message ?? "Unhandled handler error",
      });
    }

    this.log.debug({ event: "execute_end" }, "Handler execute() end");
  }

  /** Implement in derived class — the actual handler logic */
  protected abstract execute(): Promise<void>;
}
