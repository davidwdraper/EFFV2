// backend/services/shared/src/base/controller/ControllerExpressBase.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Hydration + Failure Propagation)
 *   - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *
 * Purpose:
 * - Express-flavored controller base:
 *   - provides a public bound logger (`log`) for convenience
 *   - centralizes finalize-error logging policy (logFinalizeError)
 *
 * Hard contract:
 * - ctx["rt"] ALWAYS (seeded by ControllerBase.makeContext via controllerContext)
 * - ctx["svcEnv"] NEVER (deleted)
 *
 * Notes:
 * - makeContext/runPipeline live in ControllerBase (platform rails).
 * - This class must remain an adapter; do not move orchestration here again.
 */

import type { HandlerContext } from "../../http/handlers/HandlerContext";
import type { NvHandlerError } from "../../http/handlers/handlerBaseExt/errorHelpers";
import { ControllerBase } from "./ControllerBase";

export abstract class ControllerExpressBase extends ControllerBase {
  /**
   * Public bound logger for controllers (used by Json/Html finalize).
   */
  public readonly log =
    this.getLogger().bind?.({
      component: this.constructor.name,
    }) ?? this.getLogger();

  /**
   * Centralized finalize error logging policy.
   *
   * This is what ControllerJsonBase / ControllerHtmlBase call.
   */
  protected logFinalizeError(input: {
    ctx: HandlerContext;
    requestId: string;
    status: number;
    body: unknown;
    event: string;
  }): void {
    const body = input.body as any;

    const title =
      typeof body?.title === "string" && body.title.trim()
        ? body.title.trim()
        : "unknown_finalize_error";

    const detail =
      typeof body?.detail === "string" && body.detail.trim()
        ? body.detail.trim()
        : "Controller finalized error response.";

    this.log.error(
      {
        service: (this.getRuntime() as any)?.getServiceSlug?.() ?? "unknown",
        component:
          (this.getApp() as any)?.constructor?.name ?? this.constructor.name,
        event: input.event,
        requestId: input.requestId,
        status: input.status,
        title,
        detail,
      },
      "Controller finalize error"
    );

    const err = this.safeExtractNvHandlerError(input.body);
    if (err?.origin) {
      this.log.error(
        {
          event: "finalize_error_origin",
          requestId: input.requestId,
          origin: err.origin,
        },
        "Finalize error origin"
      );
    }
  }

  private safeExtractNvHandlerError(body: unknown): NvHandlerError | undefined {
    if (!body || typeof body !== "object") return undefined;
    const anyB = body as any;
    if (typeof anyB.title !== "string") return undefined;
    return anyB as NvHandlerError;
  }
}
