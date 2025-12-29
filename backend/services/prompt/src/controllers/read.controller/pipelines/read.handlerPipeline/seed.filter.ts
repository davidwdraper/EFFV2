// backend/services/prompt/src/controllers/read.controller/read.handlerPipelines/seed.filter.ts
/**
 * Docs:
 * - SOP: index.ts is order-only; seeding lives in seed.* handlers.
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta)
 *   - ADR-0064 (Prompts Service, PromptsClient, Missing-Prompt Semantics)
 *   - ADR-0087 (Index pipelines; seed.filter handlers)
 *
 * Purpose:
 * - Seed ctx["bag.query.*"] for DbReadOneByFilterHandler to read a single prompt
 *   by business key (language + version + promptKey).
 *
 * Invariants:
 * - This handler performs NO IO. It only seeds ctx for the next db.readOne.byFilter step.
 * - Read-by-business-key expects a single record when present (ensureSingleton=true).
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { PromptDto } from "@nv/shared/dto/prompt.dto";

export class SeedFilterHandler extends HandlerBase {
  public constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  public override handlerName(): string {
    return "seed.filter";
  }

  protected override handlerPurpose(): string {
    return "Seed query dtoCtor + filter for prompt read-by-business-key for the next db.readOne.byFilter step.";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.getRequestId();

    const language = this.requireLanguage(requestId);
    const version = this.requireVersion(requestId);
    const promptKey = this.requirePromptKey(requestId);

    // Required inputs for DbReadOneByFilterHandler:
    this.ctx.set("bag.query.dtoCtor", PromptDto);
    this.ctx.set("bag.query.filter", { language, version, promptKey });

    // Read-one semantics: treat multiple matches as a bug/ops issue.
    this.ctx.set("bag.query.ensureSingleton", true);

    // Prompts are operational text; schema drift should not brick reads.
    // If you want strict validation at read time, flip to true and add tests.
    this.ctx.set("bag.query.validateReads", false);

    this.ctx.set("handlerStatus", "ok");
  }

  private requireLanguage(requestId: string): string {
    const raw = this.safeCtxGet<any>("language");
    if (typeof raw === "string" && raw.trim()) return raw.trim();

    this.failWithError({
      httpStatus: 500,
      title: "seed_filter_language_missing",
      detail:
        "Missing ctx['language'] while building prompt read filter. Dev: controller must seed ctx['language'] from route params before the read pipeline runs.",
      stage: "seed.filter:language_missing",
      requestId,
      origin: { file: __filename, method: "requireLanguage" },
      logMessage: "seed.filter: ctx['language'] missing/invalid.",
      logLevel: "error",
    });

    return "";
  }

  private requireVersion(requestId: string): number {
    const raw = this.safeCtxGet<any>("version");

    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
      return Math.trunc(raw);
    }
    if (typeof raw === "string" && raw.trim()) {
      const n = Number(raw.trim());
      if (Number.isFinite(n) && n > 0) return Math.trunc(n);
    }

    this.failWithError({
      httpStatus: 500,
      title: "seed_filter_version_missing",
      detail:
        "Missing ctx['version'] while building prompt read filter. Dev: controller must seed ctx['version'] from route params before the read pipeline runs.",
      stage: "seed.filter:version_missing",
      requestId,
      origin: { file: __filename, method: "requireVersion" },
      issues: [{ haveVersion: raw !== undefined, versionType: typeof raw }],
      logMessage: "seed.filter: ctx['version'] missing/invalid.",
      logLevel: "error",
    });

    return 0;
  }

  private requirePromptKey(requestId: string): string {
    const raw = this.safeCtxGet<any>("promptKey");
    if (typeof raw === "string" && raw.trim()) return raw.trim();

    this.failWithError({
      httpStatus: 500,
      title: "seed_filter_promptKey_missing",
      detail:
        "Missing ctx['promptKey'] while building prompt read filter. Dev: controller must seed ctx['promptKey'] from route params before the read pipeline runs.",
      stage: "seed.filter:promptKey_missing",
      requestId,
      origin: { file: __filename, method: "requirePromptKey" },
      logMessage: "seed.filter: ctx['promptKey'] missing/invalid.",
      logLevel: "error",
    });

    return "";
  }
}
