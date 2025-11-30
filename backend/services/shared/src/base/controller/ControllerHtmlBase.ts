// backend/services/shared/src/base/controller/ControllerHtmlBase.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence via Managers)
 *   - ADR-0041 (Controller & Handler Architecture)
 *   - ADR-0042 (HandlerContext Bus)
 *   - ADR-0043 (DTO Hydration & Failure Propagation)
 *   - ADR-0044 (EnvServiceDto as DTO — Key/Value Contract)
 *   - ADR-0049 (DTO Registry & Wire Discrimination)
 *   - ADR-0050 (Wire Bag Envelope; bag-only edges)
 *   - ADR-0059 (dtoType and dbCollectionName addition to handler ctx)
 *   - ADR-0064 (Prompts Service, PromptsClient, Missing-Prompt Semantics)
 *   - ADR-0069 (Multi-Format Controllers & DTO Body Semantics)
 *
 * Purpose:
 * - HTML/Problem+JSON concrete controller base.
 * - Implements finalize() for:
 *   - Success: bag-only edges → HTML response.
 *   - Error: normalized Problem+JSON (same semantics as JSON controllers).
 *
 * Notes:
 * - Success responses are built strictly from ctx["bag"] (DtoBag.toBody()).
 * - HTML DTOs are free to:
 *   - Return a bare string (items[0] is string), or
 *   - Return an object like:
 *       { html: string; status?: number; contentType?: string; headers?: Record<string,string> }
 */

import type { Response } from "express";
import type { HandlerContext } from "../../http/handlers/HandlerContext";
import type { IBoundLogger } from "../../logger/Logger";
import type { AppBase } from "../app/AppBase";
import {
  DuplicateKeyError,
  parseDuplicateKey,
} from "../../dto/persistence/adapters/mongo/dupeKeyError";
import type { ProblemJson } from "./controllerTypes";
import { ControllerBase } from "./ControllerBase";

export abstract class ControllerHtmlBase extends ControllerBase {
  // ───────────────────────────────────────────
  // Finalize (bag-or-error) — HTML wire format
  // ───────────────────────────────────────────

  protected async finalize(ctx: HandlerContext): Promise<void> {
    const log: IBoundLogger = this.getLogger();
    const app: AppBase = this.getApp();
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
          file: "backend/services/shared/src/base/controller/ControllerHtmlBase.ts",
          method: "finalize",
          line: 65,
        },
      },
      "ControllerHtmlBase.finalize — start"
    );

    // ─── ERROR PATH (Problem+JSON) ───────────────────────────
    if (handlerStatus === "error" || (statusFromCtx && statusFromCtx >= 400)) {
      const status =
        statusFromCtx && statusFromCtx >= 400 ? statusFromCtx : 500;

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
            mappedCode = "DUPLICATE_ID";
          } else if (/^ux_.*_business$/i.test(idxLower)) {
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
          "ControllerHtmlBase error response"
        );
      } else {
        log.warn(
          {
            event: "finalize_client_error",
            requestId,
            status: finalStatus,
            problem: body,
          },
          "ControllerHtmlBase client/data response"
        );
      }

      log.debug(
        {
          event: "finalize_exit",
          requestId,
          origin: {
            file: "backend/services/shared/src/base/controller/ControllerHtmlBase.ts",
            method: "finalize",
            line: 143,
          },
        },
        "ControllerHtmlBase.finalize — end (error)"
      );
      return;
    }

    // ─── SUCCESS PATH (HTML) ───────────────────────────

    const bag: any = ctx.get<any>("bag");

    if (!bag || typeof bag.toBody !== "function") {
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
        "ControllerHtmlBase.finalize — missing DtoBag"
      );

      log.debug(
        {
          event: "finalize_exit",
          requestId,
          origin: {
            file: "backend/services/shared/src/base/controller/ControllerHtmlBase.ts",
            method: "finalize",
            line: 182,
          },
        },
        "ControllerHtmlBase.finalize — end (bag missing)"
      );
      return;
    }

    const items = bag.toBody() as unknown;

    // We expect a bag of “HTML bodies”:
    // - Preferred: items is an array, first element is either:
    //   - string (HTML), or
    //   - { html, status?, contentType?, headers? }
    // - If items is directly a string/object, we still accept it.
    let htmlBody: string | undefined;
    let contentType = "text/html; charset=utf-8";
    let status =
      ctx.get<number>("response.status") ??
      (handlerStatus === "warn" ? 200 : 200);
    let extraHeaders: Record<string, string> | undefined;

    const pickPayload = (value: unknown) => {
      if (typeof value === "string") {
        htmlBody = value;
        return;
      }

      if (value && typeof value === "object") {
        const v = value as {
          html?: unknown;
          status?: unknown;
          contentType?: unknown;
          headers?: unknown;
        };

        if (typeof v.html === "string") {
          htmlBody = v.html;
        }

        if (
          typeof v.status === "number" &&
          Number.isFinite(v.status) &&
          ctx.get<number>("response.status") == null
        ) {
          status = v.status;
        }

        if (typeof v.contentType === "string" && v.contentType.trim()) {
          contentType = v.contentType.trim();
        }

        if (v.headers && typeof v.headers === "object") {
          extraHeaders = {};
          for (const [k, val] of Object.entries(
            v.headers as Record<string, unknown>
          )) {
            if (typeof val === "string") {
              extraHeaders[k] = val;
            }
          }
        }
      }
    };

    if (Array.isArray(items)) {
      if (items.length === 0) {
        // Empty bag on "success" is a contract violation for HTML controllers.
        const errStatus = 500;
        const body: ProblemJson = {
          type: "about:blank",
          title: "Internal Error",
          detail:
            "HTML controller finalize expected at least one HTML DTO in the DtoBag, but the bag was empty.",
          status: errStatus,
          code: "BAG_EMPTY",
          requestId,
        };

        res.status(errStatus).type("application/problem+json").json(body);

        log.error(
          {
            event: "finalize_bag_empty",
            requestId,
            handlerStatus,
          },
          "ControllerHtmlBase.finalize — empty DtoBag for HTML"
        );

        log.debug(
          {
            event: "finalize_exit",
            requestId,
            origin: {
              file: "backend/services/shared/src/base/controller/ControllerHtmlBase.ts",
              method: "finalize",
              line: 271,
            },
          },
          "ControllerHtmlBase.finalize — end (bag empty)"
        );
        return;
      }

      pickPayload(items[0]);
    } else {
      pickPayload(items);
    }

    if (!htmlBody) {
      const errStatus = 500;
      const body: ProblemJson = {
        type: "about:blank",
        title: "Internal Error",
        detail:
          "HTML controller finalize could not resolve an HTML body from the DtoBag.toBody() payload.",
        status: errStatus,
        code: "HTML_BODY_MISSING",
        requestId,
      };

      res.status(errStatus).type("application/problem+json").json(body);

      log.error(
        {
          event: "finalize_html_body_missing",
          requestId,
          handlerStatus,
          itemsType: typeof items,
        },
        "ControllerHtmlBase.finalize — missing HTML body"
      );

      log.debug(
        {
          event: "finalize_exit",
          requestId,
          origin: {
            file: "backend/services/shared/src/base/controller/ControllerHtmlBase.ts",
            method: "finalize",
            line: 311,
          },
        },
        "ControllerHtmlBase.finalize — end (html body missing)"
      );
      return;
    }

    if (Array.isArray(warnings) && warnings.length > 0) {
      for (const w of warnings) {
        log.warn({ event: "warn", requestId, warning: w }, "Handler warning");
      }
    }

    if (extraHeaders) {
      for (const [k, v] of Object.entries(extraHeaders)) {
        res.setHeader(k, v);
      }
    }

    res.status(status).type(contentType).send(htmlBody);

    log.debug(
      {
        event: "finalize_exit",
        requestId,
        status,
        contentType,
        hasExtraHeaders: !!extraHeaders,
        origin: {
          file: "backend/services/shared/src/base/controller/ControllerHtmlBase.ts",
          method: "finalize",
          line: 342,
        },
      },
      "ControllerHtmlBase.finalize — HTML body sent"
    );
  }
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
