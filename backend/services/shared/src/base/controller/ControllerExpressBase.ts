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
 *
 * Logging policy (rails):
 * - Expected-negative test errors MUST NOT log at ERROR.
 * - Non-test 5xx finalize errors log at ERROR.
 * - Non-test 4xx finalize errors log at WARN (client/validation noise).
 */

import type { HandlerContext } from "../../http/handlers/HandlerContext";
import type { NvHandlerError } from "../../http/handlers/handlerBaseExt/errorHelpers";
import { ControllerBase } from "./ControllerBase";
import { isExpectedErrorContext } from "../../http/requestScope";

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

    const expected = this.isExpectedError(input.ctx);

    // Rails logging levels:
    // - expected negative-test: INFO (never ERROR)
    // - non-test: 5xx => ERROR, 4xx => WARN
    const level: "info" | "warn" | "error" = expected
      ? "info"
      : input.status >= 500
      ? "error"
      : "warn";

    const payload = {
      service: (this.getRuntime() as any)?.getServiceSlug?.() ?? "unknown",
      component:
        (this.getApp() as any)?.constructor?.name ?? this.constructor.name,
      event: input.event,
      requestId: input.requestId,
      status: input.status,
      title,
      detail,
      expectedError: expected,
    };

    if (level === "info") {
      this.log.info(payload, "Controller finalize error");
    } else if (level === "warn") {
      this.log.warn(payload, "Controller finalize error");
    } else {
      this.log.error(payload, "Controller finalize error");
    }

    const err = this.safeExtractNvHandlerError(input.body);
    if (err?.origin) {
      const originPayload = {
        event: "finalize_error_origin",
        requestId: input.requestId,
        origin: err.origin,
        expectedError: expected,
      };

      if (level === "info") {
        this.log.info(originPayload, "Finalize error origin");
      } else if (level === "warn") {
        this.log.warn(originPayload, "Finalize error origin");
      } else {
        this.log.error(originPayload, "Finalize error origin");
      }
    }
  }

  private isExpectedError(ctx: HandlerContext): boolean {
    // Primary: ALS requestScope (works for S2S propagation + handler logs)
    if (isExpectedErrorContext()) return true;

    // Secondary: ctx flag (some tests may seed ctx but not ALS in weird cases)
    try {
      return ctx.get<boolean | undefined>("expectErrors") === true;
    } catch {
      return false;
    }
  }

  private safeExtractNvHandlerError(body: unknown): NvHandlerError | undefined {
    if (!body || typeof body !== "object") return undefined;
    const anyB = body as any;
    if (typeof anyB.title !== "string") return undefined;
    return anyB as NvHandlerError;
  }
}
