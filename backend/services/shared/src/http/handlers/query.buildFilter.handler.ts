// backend/services/shared/src/http/handlers/query.buildFilter.handler.ts
/**
 * Docs:
 * - ADR-0041 (Per-route controllers; single-purpose handlers)
 * - ADR-0042 (HandlerContext Bus — KISS)
 * - ADR-0043 (Hydration + Failure Propagation)
 * - ADR-0058 (HandlerBase.getVar — Strict Env Accessor)
 * - ADR-0061 (svcconfig s2s-route — S2S target resolution)
 *
 * Purpose:
 * - Build a standard Mongo filter object dynamically from a declarative spec,
 *   then stash it into ctx["bag.query.filter"] for DbReader.readOneBag/readManyBag
 *   (and ctx["query.filter"] for introspection/logging if desired).
 *
 * Invariants:
 * - Handler itself knows nothing about svcconfig/env-service/etc.
 * - All field choices come from a constructor-provided spec.
 * - No DB calls; this is purely about shaping the filter + optional idKey.
 */

import type { HandlerContext } from "./HandlerContext";
import { HandlerBase } from "./HandlerBase";

export type FilterSourceType = "param" | "query" | "envVar" | "ctx" | "literal";

export type FilterFieldSpec =
  | {
      /** Target Mongo field name, e.g. "env", "slug", "version". */
      target: string;
      source: "param" | "query";
      /** Name of the param/query key; defaults to target if omitted. */
      key?: string;
      /** Required ⇒ 4xx on missing; optional ⇒ field simply omitted. */
      required?: boolean;
    }
  | {
      target: string;
      source: "envVar";
      /** Env var key inside svcEnv (NV_*) */
      key: string;
      required?: boolean;
    }
  | {
      target: string;
      source: "ctx";
      /** Context key to read from, e.g. "dtoType" or "op". */
      key: string;
      required?: boolean;
    }
  | {
      target: string;
      source: "literal";
      value: unknown;
    };

export type BuildFilterHandlerOptions = {
  fields: FilterFieldSpec[];
  /**
   * Optional: build a composite idKey string for logging/trace from a subset of
   * filter fields.
   */
  idKeyFields?: string[];
  idKeyJoinChar?: string;
};

export class QueryBuildFilterHandler extends HandlerBase {
  private readonly fields: FilterFieldSpec[];
  private readonly idKeyFields: string[];
  private readonly idKeyJoinChar: string;

  constructor(
    ctx: HandlerContext,
    controller: any,
    opts: BuildFilterHandlerOptions
  ) {
    super(ctx, controller);
    this.fields = opts.fields;
    this.idKeyFields = opts.idKeyFields ?? [];
    this.idKeyJoinChar = opts.idKeyJoinChar ?? "@";
  }

  /**
   * One-sentence, ops-facing description of what this handler does.
   */
  protected handlerPurpose(): string {
    return "Build a dynamic Mongo filter from params/query/env/ctx and stash it on ctx['bag.query.filter'].";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    this.log.debug(
      {
        event: "execute_enter",
        handler: this.constructor.name,
        requestId,
      },
      "QueryBuildFilterHandler — execute enter"
    );

    const params: any = this.safeCtxGet<any>("params") ?? {};
    const query: any = this.safeCtxGet<any>("query") ?? {};

    const filter: Record<string, unknown> = {};
    const idKeyParts: string[] = [];

    try {
      for (const spec of this.fields) {
        switch (spec.source) {
          case "param": {
            const key = spec.key ?? spec.target;
            const raw =
              typeof params[key] === "string" ? params[key].trim() : "";
            if (!raw) {
              if (spec.required) {
                this.markMissing(`:${key}`, spec.target, "path parameter");
                return;
              }
              // optional; skip
            } else {
              filter[spec.target] = raw;
            }
            break;
          }

          case "query": {
            const key = spec.key ?? spec.target;
            const raw = typeof query[key] === "string" ? query[key].trim() : "";
            if (!raw) {
              if (spec.required) {
                this.markMissing(key, spec.target, "query parameter");
                return;
              }
            } else {
              filter[spec.target] = raw;
            }
            break;
          }

          case "envVar": {
            const val = this.getVar(spec.key);
            if (!val) {
              if (spec.required) {
                this.failWithError({
                  httpStatus: 500,
                  title: "env_var_missing",
                  detail: `Missing required environment variable '${spec.key}' to build filter field '${spec.target}'. Ops: ensure env-service is populated correctly for this service/env/slug/version.`,
                  stage: "buildFilter.envVar",
                  requestId,
                  origin: {
                    file: __filename,
                    method: "execute",
                  },
                  issues: [
                    {
                      envKey: spec.key,
                      target: spec.target,
                    },
                  ],
                  logMessage:
                    "QueryBuildFilterHandler — required envVar missing while building filter.",
                  logLevel: "error",
                });
                return;
              }
            } else {
              filter[spec.target] = val;
            }
            break;
          }

          case "ctx": {
            const val = this.safeCtxGet<any>(spec.key);
            if (val === undefined || val === null || val === "") {
              if (spec.required) {
                this.failWithError({
                  httpStatus: 500,
                  title: "ctx_value_missing",
                  detail: `Missing required context key '${spec.key}' to build filter field '${spec.target}'. Dev: ensure controller/pipeline seeds the context key before this handler runs.`,
                  stage: "buildFilter.ctx",
                  requestId,
                  origin: {
                    file: __filename,
                    method: "execute",
                  },
                  issues: [
                    {
                      ctxKey: spec.key,
                      target: spec.target,
                    },
                  ],
                  logMessage:
                    "QueryBuildFilterHandler — required ctx value missing while building filter.",
                  logLevel: "error",
                });
                return;
              }
            } else {
              filter[spec.target] = val;
            }
            break;
          }

          case "literal": {
            filter[spec.target] = spec.value;
            break;
          }

          default: {
            // Should never happen; defensive only.
            this.log.error(
              { event: "filter_spec_unknown_source", spec, requestId },
              "QueryBuildFilterHandler — unknown filter source"
            );
          }
        }
      }

      // Optional idKey for logging/trace: join selected filter fields.
      if (this.idKeyFields.length > 0) {
        for (const f of this.idKeyFields) {
          const v = filter[f];
          if (typeof v === "string" && v.trim() !== "") {
            idKeyParts.push(v.trim());
          }
        }
        if (idKeyParts.length > 0) {
          const idKey = idKeyParts.join(this.idKeyJoinChar);
          this.ctx.set("idKey", idKey);
        }
      }

      // Primary output for query-based bag population:
      // - bag.populate.query.handler reads ctx["bag.query.filter"].
      this.ctx.set("bag.query.filter", filter);

      // Secondary (optional) output for introspection/logging or legacy code:
      this.ctx.set("query.filter", filter);

      this.ctx.set("handlerStatus", "ok");

      this.log.debug(
        {
          event: "filter_built",
          filter,
          idKey:
            idKeyParts.length > 0
              ? idKeyParts.join(this.idKeyJoinChar)
              : undefined,
          requestId,
        },
        "QueryBuildFilterHandler — built dynamic Mongo filter"
      );
    } catch (err) {
      this.failWithError({
        httpStatus: 500,
        title: "query_build_filter_failed",
        detail:
          "Dynamic filter construction failed unexpectedly. Ops: inspect handler fields spec and upstream ctx/query/params values.",
        stage: "buildFilter.unhandled",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            fieldsLength: this.fields.length,
            idKeyFields: this.idKeyFields,
          },
        ],
        rawError: err,
        logMessage:
          "QueryBuildFilterHandler — unhandled exception while building dynamic Mongo filter.",
        logLevel: "error",
      });
    }
  }

  private markMissing(
    key: string,
    target: string,
    kind: "path parameter" | "query parameter"
  ): void {
    const requestId = this.safeCtxGet<string>("requestId");
    this.failWithError({
      httpStatus: 400,
      title: "bad_request",
      detail: `Missing required ${kind} '${key}' for filter field '${target}'.`,
      stage: "buildFilter.input",
      requestId,
      origin: {
        file: __filename,
        method: "markMissing",
      },
      issues: [
        {
          key,
          target,
          kind,
        },
      ],
      logMessage:
        "QueryBuildFilterHandler — required input missing while building filter.",
      logLevel: "warn",
    });
  }
}
