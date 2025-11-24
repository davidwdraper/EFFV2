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

  protected async execute(): Promise<void> {
    const params: any = this.ctx.get("params") ?? {};
    const query: any = this.ctx.get("query") ?? {};

    const filter: Record<string, unknown> = {};
    const idKeyParts: string[] = [];

    for (const spec of this.fields) {
      switch (spec.source) {
        case "param": {
          const key = spec.key ?? spec.target;
          const raw = typeof params[key] === "string" ? params[key].trim() : "";
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
              this.ctx.set("handlerStatus", "error");
              this.ctx.set("status", 500);
              this.ctx.set("error", {
                code: "ENV_VAR_MISSING",
                title: "Internal Error",
                detail: `Missing required environment variable '${spec.key}' to build filter field '${spec.target}'.`,
                hint: "Ops: ensure env-service is populated correctly for this service/env/slug/version.",
              });
              this.log.error(
                {
                  event: "filter_env_missing",
                  envKey: spec.key,
                  target: spec.target,
                },
                "QueryBuildFilterHandler — required envVar missing"
              );
              return;
            }
          } else {
            filter[spec.target] = val;
          }
          break;
        }

        case "ctx": {
          const val = this.ctx.get<any>(spec.key);
          if (val === undefined || val === null || val === "") {
            if (spec.required) {
              this.ctx.set("handlerStatus", "error");
              this.ctx.set("status", 500);
              this.ctx.set("error", {
                code: "CTX_VALUE_MISSING",
                title: "Internal Error",
                detail: `Missing required context key '${spec.key}' to build filter field '${spec.target}'.`,
                hint: "Dev: ensure controller/pipeline seeds the context key before this handler runs.",
              });
              this.log.error(
                {
                  event: "filter_ctx_missing",
                  ctxKey: spec.key,
                  target: spec.target,
                },
                "QueryBuildFilterHandler — required ctx value missing"
              );
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
            { event: "filter_spec_unknown_source", spec },
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

    this.log.debug(
      {
        event: "filter_built",
        filter,
        idKey:
          idKeyParts.length > 0
            ? idKeyParts.join(this.idKeyJoinChar)
            : undefined,
      },
      "QueryBuildFilterHandler — built dynamic Mongo filter"
    );
  }

  private markMissing(
    key: string,
    target: string,
    kind: "path parameter" | "query parameter"
  ): void {
    this.ctx.set("handlerStatus", "error");
    this.ctx.set("status", 400);
    this.ctx.set("error", {
      code: "BAD_REQUEST",
      title: "Bad Request",
      detail: `Missing required ${kind} '${key}' for filter field '${target}'.`,
      hint: `Ensure the route/query string includes '${key}' with a non-empty value.`,
    });
    this.log.warn(
      {
        event: "filter_missing_input",
        key,
        target,
        kind,
      },
      "QueryBuildFilterHandler — required input missing"
    );
  }
}
