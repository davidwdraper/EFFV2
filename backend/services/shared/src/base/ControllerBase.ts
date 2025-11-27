// backend/services/shared/src/base/ControllerBase.ts
/**
 * Docs:
 * - ADR-0040 (DTO-Only Persistence via Managers)
 * - ADR-0041 (Controller & Handler Architecture)
 * - ADR-0042 (HandlerContext Bus)
 * - ADR-0043 (DTO Hydration & Failure Propagation)
 * - ADR-0044 (EnvServiceDto as DTO — Key/Value Contract)
 * - ADR-0049 (DTO Registry & Wire Discrimination)
 * - ADR-0050 (Wire Bag Envelope; bag-only edges)
 * - ADR-0059 (dtoType and dbCollectionName addition to handler ctx)
 * - ADR-0064 (Prompts Service, PromptsClient, Missing-Prompt Semantics)
 *
 * Purpose:
 * - Shared abstract controller base for all services.
 * - Owns AppBase reference; seeds HandlerContext; preflights invariants; finalizes responses.
 *
 * Notes:
 * - Indexes are ensured at app boot — never here.
 * - Success responses are always built from ctx["bag"] (DtoBag) only.
 * - Error responses are normalized to Problem+JSON and, when possible, use
 *   PromptsClient (via AppBase.prompt()) to obtain localized, parameterized
 *   human-facing detail text and user-facing hints.
 */

import type { Request, Response } from "express";
import { HandlerContext } from "../http/handlers/HandlerContext";
import type { HandlerBase } from "../http/handlers/HandlerBase";
import { getLogger, type IBoundLogger } from "../logger/Logger";
import type { EnvServiceDto } from "../dto/env-service.dto";
import type { AppBase } from "../base/AppBase";
import type { IDtoRegistry } from "../registry/RegistryBase";
import {
  DuplicateKeyError,
  parseDuplicateKey,
} from "../dto/persistence/adapters/mongo/dupeKeyError";

type ProblemJson = {
  type: string;
  title: string;
  detail?: string;
  status?: number;
  code?: string;
  issues?: Array<{ path: string; code: string; message: string }>;
  requestId?: string;

  /**
   * Optional, localized, user-facing message suitable for direct UI display.
   * - Typically produced via PromptsClient using userPromptKey.
   * - When no template exists, this will fall back to userPromptKey so the UI
   *   can always render userMessage without branching.
   */
  userMessage?: string;

  /**
   * Prompt/catalog key for the user-facing message.
   * - Either supplied explicitly by handlers (err.userPromptKey / err.promptKey),
   *   or derived generically (e.g., "INTERNAL_ERROR"/"BAD_REQUEST") based on
   *   HTTP status when no explicit key is provided.
   */
  userPromptKey?: string;
};

export abstract class ControllerBase {
  protected readonly app: AppBase;
  protected readonly log!: IBoundLogger; // definite assignment OK

  constructor(app: AppBase) {
    this.app = app;

    const appLog = (app as any)?.log as IBoundLogger | undefined;
    this.log =
      appLog?.bind({ component: "ControllerBase" }) ??
      getLogger({ service: "shared", component: "ControllerBase" });

    this.log.debug(
      { event: "construct", hasApp: !!app },
      "ControllerBase ctor"
    );
  }

  // ───────────────────────────────────────────
  // Public getters
  // ───────────────────────────────────────────

  public getApp(): AppBase {
    return this.app;
  }

  public getDtoRegistry(): IDtoRegistry {
    const reg = (this.app as any)?.getDtoRegistry?.();
    if (!reg) {
      throw new Error("DtoRegistry not available from AppBase.");
    }
    return reg as IDtoRegistry;
  }

  public getSvcEnv(): EnvServiceDto {
    const env = (this.app as any)?.svcEnv;
    if (!env) throw new Error("EnvServiceDto not available from AppBase.");
    return env as EnvServiceDto;
  }

  public getLogger(): IBoundLogger {
    return this.log;
  }

  // ───────────────────────────────────────────
  // Context prep helpers
  // ───────────────────────────────────────────

  protected seedHydrator(
    ctx: HandlerContext,
    dtoType: string,
    opts?: { validate?: boolean }
  ): void {
    const reg: any = this.getDtoRegistry();
    const hydrate = reg.hydratorFor(dtoType, { validate: !!opts?.validate });
    ctx.set("hydrate.fromJson", hydrate);
    this.log.debug(
      { event: "seed_hydrator", dtoType, validate: !!opts?.validate },
      "ControllerBase"
    );
  }

  protected makeContext(req: Request, res: Response): HandlerContext {
    const ctx = new HandlerContext();
    const requestId = (req.headers["x-request-id"] as string) ?? this.randId();

    ctx.set("requestId", requestId);
    ctx.set("headers", req.headers);
    ctx.set("params", req.params);
    ctx.set("query", req.query);
    ctx.set("body", req.body);
    ctx.set("res", res);

    const svcEnv: EnvServiceDto | undefined = this.getSvcEnv();
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

    this.log.debug(
      { event: "make_context", requestId, hasSvcEnv: !!svcEnv },
      "Context seeded"
    );
    return ctx;
  }

  protected makeDtoOpContext(
    req: Request,
    res: Response,
    op: string,
    opts?: { resolveCollectionName?: boolean }
  ): HandlerContext {
    const ctx = this.makeContext(req, res);
    const params: any = req.params ?? {};
    const dtoType = typeof params.dtoType === "string" ? params.dtoType : "";
    const requestId = ctx.get<string>("requestId") ?? "unknown";

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

      this.log.warn(
        { event: "bad_request", reason: "no_dtoType", op, requestId },
        "ControllerBase.makeDtoOpContext — missing :dtoType"
      );
      return ctx;
    }

    ctx.set("dtoType", dtoType);
    ctx.set("op", op);

    if (opts?.resolveCollectionName) {
      try {
        const reg = this.getDtoRegistry();
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

        this.log.warn(
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

    this.log.debug(
      {
        event: "pipeline_select",
        op,
        dtoType,
        requestId,
      },
      "selecting pipeline"
    );

    return ctx;
  }

  protected preflight(
    ctx: HandlerContext,
    opts?: { requireRegistry?: boolean }
  ): void {
    const requireRegistry =
      opts?.requireRegistry ?? this.needsRegistry() ?? true;

    const requestId = ctx.get<string>("requestId") ?? "unknown";

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
        void this.getDtoRegistry();
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

    this.log.debug(
      {
        event: "preflight_ok",
        requestId,
        requireRegistry,
        hasRegistry: requireRegistry ? true : undefined,
      },
      "Preflight passed"
    );
  }

  protected async runPipeline(
    ctx: HandlerContext,
    handlers: HandlerBase[],
    opts?: { requireRegistry?: boolean }
  ): Promise<void> {
    const priorError = ctx.get<string>("handlerStatus") === "error";
    if (!priorError) this.preflight(ctx, opts);

    if (ctx.get<string>("handlerStatus") === "error") return;

    for (const h of handlers) {
      await h.run();
    }
  }

  // ───────────────────────────────────────────
  // Finalize (bag-or-error)
  // ───────────────────────────────────────────

  protected async finalize(ctx: HandlerContext): Promise<void> {
    const res = ctx.get<Response>("res")!;
    const requestId = ctx.get<string>("requestId") ?? "";
    const rawStatus = ctx.get<string>("handlerStatus") ?? "ok";
    const handlerStatus = rawStatus.toLowerCase();
    const statusFromCtx =
      ctx.get<number>("response.status") ?? ctx.get<number>("status");
    const warnings = ctx.get<any[]>("warnings");

    this.log.debug(
      { event: "finalize_enter", requestId, handlerStatus, statusFromCtx },
      "Finalize start"
    );

    // ─── ERROR PATH ───────────────────────────
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
          const mappedCode =
            idx === "ux_xxx_business"
              ? "DUPLICATE_CONTENT"
              : idx === "_id_"
              ? "DUPLICATE_ID"
              : "DUPLICATE_KEY";
          normalized = { ...rawError, code: mappedCode };
        }
      }

      const body: ProblemJson =
        normalized && normalized.title && normalized.code
          ? await this.buildProblemJsonWithPrompts(
              ctx,
              normalized,
              status,
              requestId
            )
          : this.toProblemJson(normalized, status, requestId);

      const finalStatus = body.status ?? status;
      res.status(finalStatus).type("application/problem+json").json(body);

      if (finalStatus >= 500) {
        this.log.error(
          {
            event: "finalize_error",
            requestId,
            status: finalStatus,
            problem: body,
          },
          "Controller error response"
        );
      } else {
        this.log.warn(
          {
            event: "finalize_client_error",
            requestId,
            status: finalStatus,
            problem: body,
          },
          "Controller client/data response"
        );
      }

      this.log.debug({ event: "finalize_exit", requestId }, "Finalize end");
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

      this.log.error(
        {
          event: "finalize_bag_missing",
          requestId,
          handlerStatus,
          hasBag: !!bag,
          bagType: bag ? typeof bag : "undefined",
        },
        "Finalize — missing DtoBag"
      );

      this.log.debug({ event: "finalize_exit", requestId }, "Finalize end");
      return;
    }

    const items = bag.toJson() as any[];
    const dtoType = ctx.get<string>("dtoType");
    const op = ctx.get<string>("op");
    const idKey = ctx.get<string>("idKey");

    const meta: Record<string, unknown> = {
      count: Array.isArray(items) ? items.length : 0,
    };
    if (dtoType) meta.dtoType = dtoType;
    if (op) meta.op = op;
    if (idKey) meta.idKey = idKey;

    const body: any = { items, meta };

    if (Array.isArray(warnings) && warnings.length > 0) {
      body.warnings = warnings;
      for (const w of warnings) {
        this.log.warn(
          { event: "warn", requestId, warning: w },
          "Handler warning"
        );
      }
    }

    const successStatus =
      ctx.get<number>("response.status") ??
      (handlerStatus === "warn" ? 200 : 200);

    res.status(successStatus).json(body);

    this.log.debug(
      {
        event: "finalize_exit",
        requestId,
        dtoType,
        op,
        idKey,
        count: meta.count,
      },
      "Finalize — DtoBag materialized"
    );
  }

  protected needsRegistry(): boolean {
    return true;
  }

  private toProblemJson(
    err: any,
    status: number,
    requestId?: string
  ): ProblemJson {
    if (err instanceof DuplicateKeyError) {
      const idx = (err.index ?? "").toString();
      const code =
        idx === "ux_xxx_business"
          ? "DUPLICATE_CONTENT"
          : idx === "_id_"
          ? "DUPLICATE_ID"
          : "DUPLICATE_KEY";

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

  private async buildProblemJsonWithPrompts(
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

    const language = this.resolveLanguage(acceptLang);
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
      this.defaultPromptKeyForStatus(code, status);

    const promptParams: Record<string, string | number> | undefined =
      err?.promptParams ?? err?.params;
    const promptMeta: Record<string, unknown> = {
      code,
      ...(err?.meta && typeof err.meta === "object" ? err.meta : {}),
    };

    let userMessage: string | undefined;

    if (effectivePromptKey) {
      try {
        userMessage = await this.app.prompt(
          language,
          effectivePromptKey,
          promptParams,
          promptMeta
        );
      } catch (e) {
        this.log.error(
          {
            event: "prompt_render_failed",
            requestId,
            code,
            promptKey: effectivePromptKey,
            err: this.log.serializeError(e),
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

  private resolveLanguage(acceptLanguageHeader: string): string {
    if (!acceptLanguageHeader || typeof acceptLanguageHeader !== "string") {
      return "en";
    }

    const first = acceptLanguageHeader.split(",")[0]?.trim();
    if (!first) return "en";
    return first;
  }

  private defaultPromptKeyForStatus(
    code: string | undefined,
    status: number
  ): string | undefined {
    if (status >= 500) return "INTERNAL_ERROR";
    if (status >= 400) return "BAD_REQUEST";
    return code || undefined;
  }

  private randId(): string {
    return Math.random().toString(36).slice(2, 10);
  }
}
