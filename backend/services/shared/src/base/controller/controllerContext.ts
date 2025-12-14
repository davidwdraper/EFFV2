// backend/services/shared/src/base/controller/controllerContext.ts
/**
 * Docs:
 * - ADR-0041 (Controller & Handler Architecture)
 * - ADR-0042 (HandlerContext Bus)
 * - ADR-0043 (DTO Hydration & Failure Propagation)
 * - ADR-0044 (EnvServiceDto as DTO — Key/Value Contract)
 * - ADR-0059 (dtoType and dbCollectionName addition to handler ctx)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 *
 * Purpose:
 * - Shared helpers for seeding HandlerContext, DTO/operation metadata,
 *   preflight checks, and pipeline execution.
 *
 * Update:
 * - Seeds AsyncLocal request scope from inbound headers so negative-test intent
 *   can propagate across S2S hops without requiring every caller to remember headers.
 */

import type { Request, Response } from "express";
import { HandlerContext } from "../../http/handlers/HandlerContext";
import type { HandlerBase } from "../../http/handlers/HandlerBase";
import type { EnvServiceDto } from "../../dto/env-service.dto";
import type { ControllerRuntimeDeps } from "./controllerTypes";
import { enterRequestScopeFromInbound } from "../../http/requestScope";

export function seedHydratorIntoContext(
  controller: ControllerRuntimeDeps,
  ctx: HandlerContext,
  dtoType: string,
  opts?: { validate?: boolean }
): void {
  const reg: any = controller.getDtoRegistry();
  const hydrate = reg.hydratorFor(dtoType, { validate: !!opts?.validate });
  ctx.set("hydrate.fromBody", hydrate);

  controller
    .getLogger()
    .debug(
      { event: "seed_hydrator", dtoType, validate: !!opts?.validate },
      "ControllerBase.seedHydrator"
    );
}

/** Seed a basic HandlerContext with request/response + env. */
export function makeHandlerContext(
  controller: ControllerRuntimeDeps,
  req: Request,
  res: Response
): HandlerContext {
  const ctx = new HandlerContext();
  const requestId =
    (req.headers["x-request-id"] as string) ?? createRequestId();

  // ───────────────────────────────────────────
  // Seed request-scope (AsyncLocalStorage)
  // ───────────────────────────────────────────
  const scope = enterRequestScopeFromInbound({ req, requestId });

  ctx.set("requestId", requestId);
  ctx.set("headers", req.headers);
  ctx.set("params", req.params);
  ctx.set("query", req.query);
  ctx.set("body", req.body);
  ctx.set("res", res);

  // Optional convenience keys for handlers/tests (not a source of truth).
  if (scope.testRunId) ctx.set("test.runId", scope.testRunId);
  if (scope.expectErrors === true) ctx.set("test.expectErrors", true);

  const svcEnv: EnvServiceDto | undefined = controller.getSvcEnv();
  if (svcEnv) {
    ctx.set("svcEnv", svcEnv);
  } else {
    ctx.set("handlerStatus", "error");
    ctx.set("response.status", 500);
    ctx.set("response.body", {
      code: "ENV_DTO_MISSING",
      title: "Internal Error",
      detail:
        "EnvServiceDto not available. Ops: ensure AppBase exposes svcEnv via a public getter.",
      hint: "AppBase owns envDto; export via a public getter returning EnvServiceDto.",
    });
  }

  // Seed the runtime environment label from the App, if available.
  // Single source of truth is AppBase.getEnvLabel() surfaced via ControllerBase.getEnvLabel().
  let envLabel: string | undefined;
  try {
    const label = (controller as any).getEnvLabel?.() as string | undefined;
    if (label && label.trim()) {
      envLabel = label;
      ctx.set("svc.env", envLabel);
    }
  } catch {
    // Intentionally ignore here; handlers that require env can enforce it
    // and emit a focused Problem+JSON with Ops guidance.
  }

  controller.getLogger().debug(
    {
      event: "make_context",
      requestId,
      hasSvcEnv: !!svcEnv,
      envLabel,
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

  ctx.set("dtoType", dtoType);
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

/** Preflight env + registry checks, setting error response on failure. */
export function preflightContext(
  controller: ControllerRuntimeDeps,
  ctx: HandlerContext,
  opts?: { requireRegistry?: boolean }
): void {
  const requireRegistry =
    opts?.requireRegistry ?? controller.needsRegistry() ?? true;

  const requestId = ctx.get<string>("requestId") ?? "unknown";
  const log = controller.getLogger();

  const svcEnv = ctx.get<EnvServiceDto>("svcEnv");
  if (!svcEnv) {
    ctx.set("handlerStatus", "error");
    ctx.set("response.status", 500);
    ctx.set("response.body", {
      code: "ENV_DTO_MISSING",
      title: "Internal Error",
      detail:
        "EnvServiceDto missing in context. Ops: AppBase must expose the environment DTO; ControllerBase seeds it into HandlerContext.",
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
  }
}

/** Local helper to generate a simple request id when none is provided. */
function createRequestId(): string {
  return Math.random().toString(36).slice(2, 10);
}
