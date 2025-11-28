// backend/services/shared/src/base/controller/controllerFinalize.ts
/**
 * Docs:
 * - ADR-0040 (DTO-Only Persistence via Managers)
 * - ADR-0041 (Controller & Handler Architecture)
 * - ADR-0042 (HandlerContext Bus)
 * - ADR-0043 (DTO Hydration & Failure Propagation)
 * - ADR-0049 (DTO Registry & Wire Discrimination)
 * - ADR-0050 (Wire Bag Envelope; bag-only edges)
 *
 * Purpose:
 * - Centralized finalize() logic for all controllers.
 * - Success: bag-only edges → { ok:true, items, meta[, warnings][, nextCursor] }.
 * - Error: normalized Problem+JSON, with optional user-facing prompt text.
 */

import type { Response } from "express";
import type { HandlerContext } from "../../http/handlers/HandlerContext";
import type { IBoundLogger } from "../../logger/Logger";
import type { EnvServiceDto } from "../../dto/env-service.dto";
import type { AppBase } from "../app/AppBase";
import {
  DuplicateKeyError,
  parseDuplicateKey,
} from "../../dto/persistence/adapters/mongo/dupeKeyError";
import type { ProblemJson, ControllerRuntimeDeps } from "./controllerTypes";

/**
 * Finalize a request given the handler context.
 * - `controller` is a ControllerBase (or compatible) exposing runtime deps.
 * - `ctx` is the HandlerContext populated by the pipeline.
 */
export async function finalizeResponse(
  controller: ControllerRuntimeDeps,
  ctx: HandlerContext
): Promise<void> {
  const log: IBoundLogger = controller.getLogger();
  const app: AppBase = controller.getApp();
  const res = ctx.get<Response>("res")!;
  const requestId = ctx.get<string>("requestId") ?? "";
  const rawStatus = ctx.get<string>("handlerStatus") ?? "ok";
  const handlerStatus = rawStatus.toLowerCase();
  const statusFromCtx =
    ctx.get<number>("response.status") ?? ctx.get<number>("status");
  const warnings = ctx.get<any[]>("warnings");

  log.debug(
    {
      event: "finalize_enter",
      requestId,
      handlerStatus,
      statusFromCtx,
      origin: {
        file: "backend/services/shared/src/base/controller/controllerFinalize.ts",
        method: "finalizeResponse",
        line: 43,
      },
    },
    "ControllerBase.finalize — start"
  );

  // ─── ERROR PATH ───────────────────────────
  if (handlerStatus === "error" || (statusFromCtx && statusFromCtx >= 400)) {
    const status = statusFromCtx && statusFromCtx >= 400 ? statusFromCtx : 500;

    const rawError =
      ctx.get<any>("response.body") && ctx.get<any>("response.body").code
        ? ctx.get<any>("response.body")
        : ctx.get<any>("error");

    // Duplicate key normalization
    let normalized = rawError;
    if (rawError && rawError.title && rawError.code) {
      const maybeDup =
        parseDuplicateKey({
          message: rawError.detail ?? rawError.message ?? "",
          code: 11000,
        }) ?? parseDuplicateKey(rawError);

      if (maybeDup) {
        const idx = (maybeDup.index ?? "").toString();
        const idxLower = idx.toLowerCase();

        let mappedCode: string;
        if (idxLower === "_id_") {
          // Primary key duplicate
          mappedCode = "DUPLICATE_ID";
        } else if (/^ux_.*_business$/i.test(idxLower)) {
          // Any per-service business unique index (ux_xxx_business, ux_gateway_business, etc.)
          mappedCode = "DUPLICATE_CONTENT";
        } else {
          mappedCode = "DUPLICATE_KEY";
        }

        normalized = { ...rawError, code: mappedCode };
      }
    }

    const body: ProblemJson =
      normalized && normalized.title && normalized.code
        ? await buildProblemJsonWithPrompts(
            app,
            log,
            ctx,
            normalized,
            status,
            requestId
          )
        : toProblemJson(log, normalized, status, requestId);

    const finalStatus = body.status ?? status;
    res.status(finalStatus).type("application/problem+json").json(body);

    if (finalStatus >= 500) {
      log.error(
        {
          event: "finalize_error",
          requestId,
          status: finalStatus,
          problem: body,
        },
        "Controller error response"
      );
    } else {
      log.warn(
        {
          event: "finalize_client_error",
          requestId,
          status: finalStatus,
          problem: body,
        },
        "Controller client/data response"
      );
    }

    log.debug(
      {
        event: "finalize_exit",
        requestId,
        origin: {
          file: "backend/services/shared/src/base/controller/controllerFinalize.ts",
          method: "finalizeResponse",
          line: 131,
        },
      },
      "ControllerBase.finalize — end"
    );
    return;
  }

  // ─── SUCCESS PATH ───────────────────────────

  const bag: any = ctx.get<any>("bag");

  if (!bag || typeof bag.toJson !== "function") {
    const status = 500;
    const body: ProblemJson = {
      type: "about:blank",
      title: "Internal Error",
      detail:
        'Handler pipeline completed without attaching a DtoBag at ctx["bag"].',
      status,
      code: "BAG_MISSING",
      requestId,
    };

    res.status(status).type("application/problem+json").json(body);

    log.error(
      {
        event: "finalize_bag_missing",
        requestId,
        handlerStatus,
        hasBag: !!bag,
        bagType: bag ? typeof bag : "undefined",
      },
      "Finalize — missing DtoBag"
    );

    log.debug(
      {
        event: "finalize_exit",
        requestId,
        origin: {
          file: "backend/services/shared/src/base/controller/controllerFinalize.ts",
          method: "finalizeResponse",
          line: 170,
        },
      },
      "ControllerBase.finalize — end"
    );
    return;
  }

  const items = bag.toJson() as any[];
  const dtoType = ctx.get<string>("dtoType");
  const op = ctx.get<string>("op");
  const idKey = ctx.get<string>("idKey");

  // Cursor & paging hints from list handlers (e.g., DbReadListHandler)
  const nextCursor = ctx.get<string>("list.nextCursor");
  const limitUsed = ctx.get<number>("list.limitUsed");

  const meta: Record<string, unknown> = {
    count: Array.isArray(items) ? items.length : 0,
  };
  if (dtoType) meta.dtoType = dtoType;
  if (op) meta.op = op;
  if (idKey) meta.idKey = idKey;
  if (typeof limitUsed === "number" && Number.isFinite(limitUsed)) {
    meta.limitUsed = limitUsed;
  }

  // bag-only success envelope
  const body: any = { ok: true, items, meta };

  // Keyset pagination: expose cursor at the top level
  if (typeof nextCursor === "string" && nextCursor.trim()) {
    body.nextCursor = nextCursor.trim();
  }

  if (Array.isArray(warnings) && warnings.length > 0) {
    body.warnings = warnings;
    for (const w of warnings) {
      log.warn({ event: "warn", requestId, warning: w }, "Handler warning");
    }
  }

  const successStatus =
    ctx.get<number>("response.status") ??
    (handlerStatus === "warn" ? 200 : 200);

  res.status(successStatus).json(body);

  log.debug(
    {
      event: "finalize_exit",
      requestId,
      dtoType,
      op,
      idKey,
      count: meta.count,
      hasNextCursor: !!nextCursor,
      origin: {
        file: "backend/services/shared/src/base/controller/controllerFinalize.ts",
        method: "finalizeResponse",
        line: 229,
      },
    },
    "ControllerBase.finalize — DtoBag materialized"
  );
}

// ───────────────────────────────────────────
// Internal helpers (error → Problem+JSON)
// ───────────────────────────────────────────

function toProblemJson(
  log: IBoundLogger,
  err: any,
  status: number,
  requestId?: string
): ProblemJson {
  if (err instanceof DuplicateKeyError) {
    const idx = (err.index ?? "").toString();
    const idxLower = idx.toLowerCase();

    let code: string;
    if (idxLower === "_id_") {
      code = "DUPLICATE_ID";
    } else if (/^ux_.*_business$/i.test(idxLower)) {
      code = "DUPLICATE_CONTENT";
    } else {
      code = "DUPLICATE_KEY";
    }

    return {
      type: "about:blank",
      title: "Conflict",
      detail: err.message,
      status: 409,
      code,
      requestId,
    };
  }

  const code = err?.code ?? "UNSPECIFIED";
  const detail = err?.detail ?? err?.message ?? "Unhandled error";
  const issues = Array.isArray(err?.issues) ? err.issues : undefined;

  return {
    type: "about:blank",
    title:
      err?.title ?? (status >= 500 ? "Internal Server Error" : "Bad Request"),
    detail,
    status,
    code,
    issues,
    requestId,
  };
}

async function buildProblemJsonWithPrompts(
  app: AppBase,
  log: IBoundLogger,
  ctx: HandlerContext,
  err: any,
  status: number,
  requestId?: string
): Promise<ProblemJson> {
  const headers = ctx.get<Record<string, unknown>>("headers") ?? {};
  const acceptLang =
    (headers["accept-language"] as string) ??
    (headers["Accept-Language"] as string) ??
    "";

  const language = resolveLanguage(acceptLang);
  const code: string = err?.code ?? "UNSPECIFIED";
  const title: string =
    err?.title ?? (status >= 500 ? "Internal Server Error" : "Bad Request");
  const issues = Array.isArray(err?.issues) ? err.issues : undefined;

  const explicitUserKey =
    typeof err?.userPromptKey === "string" && err.userPromptKey.trim()
      ? err.userPromptKey.trim()
      : undefined;
  const explicitPromptKey =
    typeof err?.promptKey === "string" && err.promptKey.trim()
      ? err.promptKey.trim()
      : undefined;

  const effectivePromptKey =
    explicitUserKey ??
    explicitPromptKey ??
    defaultPromptKeyForStatus(code, status);

  const promptParams: Record<string, string | number> | undefined =
    err?.promptParams ?? err?.params;
  const promptMeta: Record<string, unknown> = {
    code,
    ...(err?.meta && typeof err.meta === "object" ? err.meta : {}),
  };

  let userMessage: string | undefined;

  if (effectivePromptKey) {
    try {
      userMessage = await app.prompt(
        language,
        effectivePromptKey,
        promptParams,
        promptMeta
      );
    } catch (e) {
      log.error(
        {
          event: "prompt_render_failed",
          requestId,
          code,
          promptKey: effectivePromptKey,
          err: log.serializeError
            ? log.serializeError(e)
            : (e as Error)?.message ?? String(e),
        },
        "buildProblemJsonWithPrompts — falling back"
      );
    }
  }

  if (!userMessage && effectivePromptKey) {
    userMessage = effectivePromptKey;
  }

  let detail: string | undefined = err?.detail ?? err?.message;
  if (!detail && userMessage) {
    detail = userMessage;
  }
  if (!detail) {
    detail = "Unhandled error";
  }

  return {
    type: "about:blank",
    title,
    detail,
    status,
    code,
    issues,
    requestId,
    userMessage,
    userPromptKey: effectivePromptKey,
  };
}

function resolveLanguage(acceptLanguageHeader: string): string {
  if (!acceptLanguageHeader || typeof acceptLanguageHeader !== "string") {
    return "en";
  }

  const first = acceptLanguageHeader.split(",")[0]?.trim();
  if (!first) return "en";
  return first;
}

function defaultPromptKeyForStatus(
  code: string | undefined,
  status: number
): string | undefined {
  if (status >= 500) return "INTERNAL_ERROR";
  if (status >= 400) return "BAD_REQUEST";
  return code || undefined;
}
