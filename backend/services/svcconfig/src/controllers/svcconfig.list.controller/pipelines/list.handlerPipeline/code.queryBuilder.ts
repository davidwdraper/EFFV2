// backend/services/svcconfig/src/controllers/svcconfig.list.controller/pipelines/list.handlerPipeline/code.queryBuilder.ts
/**
 * Docs:
 * - ADR-0041/0042
 *
 * Status:
 * - SvcRuntime Refactored (ADR-0080)
 *
 * Purpose:
 * - Parse query params into a safe filter object for known fields only.
 *
 * Inputs (ctx):
 * - "query": Record<string, unknown> (seeded by ControllerBase)
 *
 * Outputs (ctx):
 * - "list.filter": Record<string, unknown>
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";

export class CodeQueryBuilder extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  /**
   * Handler naming convention:
   * - code.<primaryFunction>[.<sub>...]
   *
   * For this handler:
   * - Primary function: svcconfig.list.query-builder
   */
  public handlerName(): string {
    return "code.svcconfig.list.query-builder";
  }

  /**
   * One-sentence, ops-facing description of what this handler does.
   */
  protected handlerPurpose(): string {
    return "Parse svcconfig list query params into a safe list.filter object with known fields only.";
  }

  protected async execute(): Promise<void> {
    const requestId = this.getRequestId();

    try {
      const qRaw = this.ctx.get("query") as unknown;

      // If query is missing, treat as empty (no filters).
      if (qRaw === undefined || qRaw === null) {
        this.ctx.set("list.filter", {});
        this.ctx.set("handlerStatus", "ok");

        this.log.debug(
          {
            event: "query_missing",
            handler: this.handlerName(),
            requestId,
          },
          "CodeQueryBuilder.execute no query provided; using empty filter"
        );
        return;
      }

      // If query is present but not an object => 400 (bad client input).
      if (typeof qRaw !== "object") {
        this.failWithError({
          httpStatus: 400,
          title: "bad_request",
          detail:
            "Query payload must be an object with simple key/value pairs. Ops: inspect client usage of svcconfig list endpoint.",
          stage: "query_builder.input",
          requestId,
          origin: {
            method: "execute",
          },
          issues: [
            {
              key: "query",
              expected: "object",
              actualType: typeof qRaw,
            },
          ],
          logMessage:
            "CodeQueryBuilder.execute received non-object query payload; returning 400",
          logLevel: "warn",
        });
        return;
      }

      const q = qRaw as Record<string, unknown>;

      // Allow filtering on known fields only; ignore unknowns.
      const filter: Record<string, unknown> = {};

      if (typeof q.txtfield1 === "string" && q.txtfield1.trim()) {
        filter.txtfield1 = q.txtfield1.trim();
      }

      if (typeof q.txtfield2 === "string" && q.txtfield2.trim()) {
        filter.txtfield2 = q.txtfield2.trim();
      }

      if (q.numfield1 !== undefined) {
        const n =
          typeof q.numfield1 === "string"
            ? Number(q.numfield1)
            : (q.numfield1 as number);
        if (Number.isFinite(n)) {
          filter.numfield1 = Math.trunc(n);
        } else {
          this.log.warn(
            {
              event: "numfield1_not_numeric",
              handler: this.handlerName(),
              value: q.numfield1,
              requestId,
            },
            "CodeQueryBuilder.execute ignoring non-numeric numfield1"
          );
        }
      }

      if (q.numfield2 !== undefined) {
        const n =
          typeof q.numfield2 === "string"
            ? Number(q.numfield2)
            : (q.numfield2 as number);
        if (Number.isFinite(n)) {
          filter.numfield2 = Math.trunc(n);
        } else {
          this.log.warn(
            {
              event: "numfield2_not_numeric",
              handler: this.handlerName(),
              value: q.numfield2,
              requestId,
            },
            "CodeQueryBuilder.execute ignoring non-numeric numfield2"
          );
        }
      }

      this.ctx.set("list.filter", filter);
      this.ctx.set("handlerStatus", "ok");

      this.log.debug(
        {
          event: "query_parsed",
          handler: this.handlerName(),
          filterKeys: Object.keys(filter),
          requestId,
        },
        "CodeQueryBuilder.execute list query parsed"
      );
    } catch (rawError: any) {
      // Last line of defense: unexpected exception → structured 500.
      this.failWithError({
        httpStatus: 500,
        title: "query_builder_failed",
        detail:
          "Parsing svcconfig list query parameters failed unexpectedly. Ops: inspect logs for handler and requestId.",
        stage: "query_builder.unhandled",
        requestId,
        origin: {
          method: "execute",
        },
        issues: [
          {
            hint: "Check inbound query shape and svcconfig list.handlerPipeline wiring.",
          },
        ],
        rawError,
        logMessage:
          "CodeQueryBuilder.execute unhandled exception while building list.filter",
        logLevel: "error",
      });
    }
  }
}
