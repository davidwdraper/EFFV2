// backend/services/prompt/src/controllers/read.controller/read.handlerPipelines/handlers/db.ensureUndefinedPlaceholder.ts
/**
 * Docs:
 * - SOP: one operation per handler; DTO-only persistence
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0045 (Index Hints — boot ensure via shared helper)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta)
 *   - ADR-0064 (Prompts Service, PromptsClient, Missing-Prompt Semantics)
 *
 * Purpose:
 * - Post-read operational handler:
 *   If a prompt read-by-business-key returns no item, enqueue (fire-and-forget)
 *   a placeholder prompt record with:
 *     - template=""
 *     - undefined=true
 *
 * Invariants:
 * - Does not alter the response bag semantics (empty bag remains empty).
 * - Does not convert background write failures into request failure.
 * - Fire-and-forget must log failures with triage guidance.
 * - No DB safety policy here: DbWriter owns all edge-mode / safety decisions.
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";

import { DtoBag } from "@nv/shared/dto/DtoBag";
import { PromptDto } from "@nv/shared/dto/prompt.dto";
import {
  DbWriter,
  DuplicateKeyError,
} from "@nv/shared/dto/persistence/dbWriter/DbWriter";

type SvcEnvLike = {
  getEnvVar(name: string): string;
  getDbVar(name: string): string;
};

export class DbEnsureUndefinedPlaceholderHandler extends HandlerBase {
  public constructor(ctx: HandlerContext, controller: ControllerJsonBase) {
    super(ctx, controller);
  }

  public handlerName(): string {
    return "db.mongo.prompt.ensure-undefined-placeholder";
  }

  public handlerPurpose(): string {
    return "If a prompt read returns an empty bag, enqueue a fire-and-forget placeholder insert with undefined=true so Ops can discover missing prompts via index.";
  }

  public isStrict(): boolean {
    return true;
  }

  public async execute(): Promise<void> {
    const requestId = this.ctx.get("requestId");

    const dtoType = this.ctx.get("dtoType");
    const language = this.ctx.get("language");
    const version = this.ctx.get("version");
    const promptKey = this.ctx.get("promptKey");

    if (dtoType !== "prompt") return;

    const bag = this.ctx.get("bag") as unknown;

    const bagCount =
      bag && typeof (bag as any).count === "function"
        ? Number((bag as any).count())
        : bag && Array.isArray((bag as any).items)
        ? Number((bag as any).items.length)
        : bag && Array.isArray((bag as any)._items)
        ? Number((bag as any)._items.length)
        : typeof (bag as any)?.size === "number"
        ? Number((bag as any).size)
        : undefined;

    if (bagCount === undefined) {
      this.log.warn(
        {
          event: "undefined_prompt_placeholder_skip_unknown_bag_shape",
          requestId,
          dtoType,
          language,
          version,
          promptKey,
        },
        "prompt placeholder write skipped: ctx['bag'] shape is unknown (cannot determine item count). Ops: ensure DbReadOneByFilterHandler stashes a standard DtoBag on ctx['bag']."
      );
      return;
    }

    if (bagCount > 0) return;

    if (
      typeof language !== "string" ||
      !language.trim() ||
      typeof version !== "number" ||
      !Number.isFinite(version) ||
      typeof promptKey !== "string" ||
      !promptKey.trim()
    ) {
      this.log.warn(
        {
          event: "undefined_prompt_placeholder_skip_bad_ctx",
          requestId,
          dtoType,
          language,
          version,
          promptKey,
        },
        "prompt placeholder write skipped: missing/invalid ctx identity fields. Ops: ensure controller seeds language/version/promptKey for read pipeline."
      );
      return;
    }

    const svcEnv = this.ctx.get("svcEnv") as SvcEnvLike | undefined;
    if (
      !svcEnv ||
      typeof svcEnv.getDbVar !== "function" ||
      typeof svcEnv.getEnvVar !== "function"
    ) {
      this.log.warn(
        {
          event: "undefined_prompt_placeholder_skip_missing_env",
          requestId,
          dtoType,
          language,
          version,
          promptKey,
        },
        "prompt placeholder write skipped: ctx['svcEnv'] missing or invalid. Ops: verify envBootstrap populated svcEnv on HandlerContext."
      );
      return;
    }

    const placeholder = PromptDto.fromBody(
      {
        promptKey: promptKey.trim(),
        language: language.trim(),
        version: Math.trunc(version),
        template: "",
        undefined: true,
      },
      { validate: false }
    );

    /**
     * Critical:
     * This DTO is created inside a handler (not via Registry.hydratorFor),
     * so it will NOT have collectionName seeded automatically.
     * DbWriter requires collectionName for all DTO instances.
     */
    placeholder.setCollectionName(PromptDto.dbCollectionName());

    const placeholderBag = new DtoBag<PromptDto>([placeholder]);

    let writer: DbWriter<PromptDto>;
    try {
      const mongoUri = svcEnv.getDbVar("NV_MONGO_URI");
      const mongoDb = svcEnv.getDbVar("NV_MONGO_DB");

      writer = new DbWriter<PromptDto>({
        bag: placeholderBag,
        mongoUri,
        mongoDb,
        log: this.log,
      });
    } catch (err: unknown) {
      this.log.warn(
        {
          event: "undefined_prompt_placeholder_writer_ctor_failed",
          requestId,
          dtoType,
          language,
          version,
          promptKey,
          err,
        },
        "prompt placeholder write skipped: DbWriter construction failed. Ops: verify env-service DB vars (NV_MONGO_URI/NV_MONGO_DB) and DbWriter health."
      );
      return;
    }

    void writer
      .write()
      .then(() => {
        this.log.debug(
          {
            event: "undefined_prompt_placeholder_write_ok",
            requestId,
            dtoType,
            language,
            version,
            promptKey,
          },
          "prompt placeholder write completed (fire-and-forget)"
        );
      })
      .catch((err: unknown) => {
        if (err instanceof DuplicateKeyError) {
          this.log.debug(
            {
              event: "undefined_prompt_placeholder_dupe_ok",
              requestId,
              dtoType,
              language,
              version,
              promptKey,
              code: (err as any).code,
            },
            "prompt placeholder already exists (duplicate key) — expected under concurrency."
          );
          return;
        }

        this.log.warn(
          {
            event: "undefined_prompt_placeholder_write_failed",
            requestId,
            dtoType,
            language,
            version,
            promptKey,
            err,
          },
          "prompt placeholder write failed (fire-and-forget). Ops: verify DB connectivity, DbWriter edge-mode policy, and prompt indexes. Note: dupe-key is normal; other errors indicate infra issues."
        );
      });

    this.log.debug(
      {
        event: "undefined_prompt_placeholder_write_enqueued",
        requestId,
        dtoType,
        language,
        version,
        promptKey,
      },
      "prompt placeholder write enqueued (fire-and-forget)"
    );
  }
}
