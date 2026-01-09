// backend/services/shared/src/base/controller/controllerContext.ts
/**
 * Docs:
 * - ADR-0041 (Controller & Handler Architecture)
 * - ADR-0042 (HandlerContext Bus)
 * - ADR-0043 (DTO Hydration & Failure Propagation)
 * - ADR-0059 (dtoType and dbCollectionName addition to handler ctx)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 * - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *
 * Purpose:
 * - Shared helpers for seeding HandlerContext, DTO/operation metadata,
 *   preflight checks, and pipeline execution.
 *
 * Hard contract:
 * - ctx["rt"] ALWAYS (required)
 * - ctx["svcEnv"] NEVER (deleted)
 */

import type { Request, Response } from "express";
import { HandlerContext } from "../../http/handlers/HandlerContext";
import type { HandlerBase } from "../../http/handlers/HandlerBase";
import type { ControllerRuntimeDeps } from "./controllerTypes";
import { enterRequestScopeFromInbound } from "../../http/requestScope";

export function seedHydratorIntoContext(
  controller: ControllerRuntimeDeps,
  ctx: HandlerContext,
  dtoType: string,
  opts?: { validate?: boolean }
): void {
  const reg = controller.getDtoRegistry();
  const hydrate = (reg as any).hydratorFor(dtoType, {
    validate: !!opts?.validate,
  });
  ctx.set("hydrate.fromBody", hydrate);

  controller
    .getLogger()
    .debug(
      { event: "seed_hydrator", dtoType, validate: !!opts?.validate },
      "ControllerBase.seedHydrator"
    );
}

/**
 * Seed a basic HandlerContext with request/response + rails + runtime.
 *
 * Seeds:
 * - req/res
 * - requestId
 * - headers/params/query/body
 * - rt (SvcRuntime)  ✅ ALWAYS
 * - svc.env (convenience only; sourced from rt)
 */
export function makeHandlerContext(
  controller: ControllerRuntimeDeps,
  req: Request,
  res: Response
): HandlerContext {
  const ctx = new HandlerContext();

  const headerRid =
    (req.headers["x-request-id"] as string | undefined) ??
    (req.headers["X-Request-Id"] as unknown as string | undefined);

  const requestId =
    typeof headerRid === "string" && headerRid.trim()
      ? headerRid.trim()
      : createRequestId();

  // ───────────────────────────────────────────
  // Seed request-scope (AsyncLocalStorage)
  // ───────────────────────────────────────────
  const scope = enterRequestScopeFromInbound({ req, requestId });

  ctx.set("req", req);
  ctx.set("res", res);

  ctx.set("requestId", requestId);
  ctx.set("headers", req.headers);
  ctx.set("params", req.params);
  ctx.set("query", req.query);
  ctx.set("body", req.body);

  // Rails defaults
  ctx.set("status", 200);
  ctx.set("handlerStatus", "ok");

  // Optional convenience keys for handlers/tests (not a source of truth).
  if (scope.testRunId) ctx.set("test.runId", scope.testRunId);
  if (scope.expectErrors === true) ctx.set("test.expectErrors", true);

  // Runtime is authoritative (ADR-0080)
  const rt = controller.getRuntime();
  ctx.set("rt", rt);

  // Convenience env label (not a truth source; derived from rt)
  try {
    const env = (rt as any)?.getEnv?.();
    if (typeof env === "string" && env.trim()) {
      ctx.set("svc.env", env.trim());
    }
  } catch {
    // ignore
  }

  controller.getLogger().debug(
    {
      event: "make_context",
      requestId,
      hasRt: true,
      testRunId: scope.testRunId,
      expectErrors: scope.expectErrors,
    },
    "ControllerBase.makeContext"
  );

  return ctx;
}

/** Seed a HandlerContext plus dtoType/op and optional collection name. */
export function makeDtoOpHandlerContext(
  controller: ControllerRuntimeDeps,
  req: Request,
  res: Response,
  op: string,
  opts?: { resolveCollectionName?: boolean }
): HandlerContext {
  const ctx = makeHandlerContext(controller, req, res);
  const params: any = req.params ?? {};
  const dtoType = typeof params.dtoType === "string" ? params.dtoType : "";
  const requestId = ctx.get<string>("requestId") ?? "unknown";

  const log = controller.getLogger();

  if (!dtoType || !dtoType.trim()) {
    ctx.set("handlerStatus", "error");
    ctx.set("response.status", 400);
    ctx.set("response.body", {
      code: "BAD_REQUEST",
      title: "Bad Request",
      detail: "Missing required path parameter ':dtoType'.",
      hint: "Routes must be shaped as /api/:slug/v:version/:dtoType/<op>[/:id]",
      requestId,
    });

    log.warn(
      { event: "bad_request", reason: "no_dtoType", op, requestId },
      "ControllerBase.makeDtoOpContext — missing :dtoType"
    );
    return ctx;
  }

  ctx.set("dtoKey", dtoType);
  ctx.set("op", op);

  if (opts?.resolveCollectionName) {
    try {
      const reg = controller.getDtoRegistry();
      const coll = (reg as any).dbCollectionNameByType?.(dtoType) as
        | string
        | undefined;

      if (!coll || !coll.trim()) {
        throw new Error(`No collection mapped for dtoType="${dtoType}"`);
      }

      ctx.set("db.collectionName", coll);
    } catch (e: any) {
      ctx.set("handlerStatus", "error");
      ctx.set("response.status", 400);
      ctx.set("response.body", {
        code: "UNKNOWN_DTO_TYPE",
        title: "Bad Request",
        detail:
          e?.message ??
          `Unable to resolve collection for dtoType "${dtoType}".`,
        hint: "Verify the DtoRegistry contains this dtoType and exposes a collection name.",
        requestId,
      });

      log.warn(
        {
          event: "dto_type_resolve_failed",
          dtoType,
          op,
          err: e?.message,
          requestId,
        },
        "ControllerBase.makeDtoOpContext — failed to resolve collection"
      );
      return ctx;
    }
  }

  log.debug(
    {
      event: "pipeline_select",
      op,
      dtoType,
      requestId,
    },
    "ControllerBase.makeDtoOpContext — selecting pipeline"
  );

  return ctx;
}

/** Preflight rails + optional registry checks, setting error response on failure. */
export function preflightContext(
  controller: ControllerRuntimeDeps,
  ctx: HandlerContext,
  opts?: { requireRegistry?: boolean }
): void {
  const requireRegistry =
    opts?.requireRegistry ?? controller.needsRegistry() ?? true;

  const requestId = ctx.get<string>("requestId") ?? "unknown";
  const log = controller.getLogger();

  const rt = ctx.get<unknown>("rt");
  if (!rt) {
    ctx.set("handlerStatus", "error");
    ctx.set("response.status", 500);
    ctx.set("response.body", {
      code: "RUNTIME_MISSING",
      title: "Internal Error",
      detail:
        "SvcRuntime missing in context. Dev/Ops: controller must seed ctx['rt'] for every request (ADR-0080).",
      requestId,
    });
    return;
  }

  if (requireRegistry) {
    try {
      void controller.getDtoRegistry();
    } catch (_e) {
      ctx.set("handlerStatus", "error");
      ctx.set("response.status", 500);
      ctx.set("response.body", {
        code: "REGISTRY_MISSING",
        title: "Internal Error",
        detail:
          "DtoRegistry missing on AppBase. Ops: wire AppBase.getDtoRegistry() to return a concrete registry instance.",
        requestId,
      });
      return;
    }
  } else {
    // Soft touch so MOS controllers can run without registry.
    controller.tryGetDtoRegistry();
  }

  log.debug(
    {
      event: "preflight_ok",
      requestId,
      requireRegistry,
      hasRegistry: requireRegistry ? true : undefined,
    },
    "ControllerBase.preflight — passed"
  );
}

/** Run a pipeline of handlers with preflight semantics. */
export async function runPipelineHandlers(
  controller: ControllerRuntimeDeps,
  ctx: HandlerContext,
  handlers: HandlerBase[],
  opts?: { requireRegistry?: boolean }
): Promise<void> {
  const priorError = ctx.get<string>("handlerStatus") === "error";
  if (!priorError) {
    preflightContext(controller, ctx, opts);
  }

  if (ctx.get<string>("handlerStatus") === "error") return;

  for (const h of handlers) {
    await h.run();
    if (ctx.get<string>("handlerStatus") === "error") break;
  }
}

/** Local helper to generate a simple request id when none is provided. */
function createRequestId(): string {
  return Math.random().toString(36).slice(2, 10);
}
