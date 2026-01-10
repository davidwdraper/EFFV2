// backend/services/prompt/src/controllers/read.controller/read.handlerPipelines/handlers/db.ensureUndefinedPlaceholder.ts
/**
 * Docs:
 * - SOP: one operation per handler; DTO-only persistence
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta)
 *   - ADR-0064 (Prompts Service, PromptsClient, Missing-Prompt Semantics)
 *   - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *   - ADR-0106 (DB operators take SvcRuntime; index logic lives at DB boundary)
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
 * - ctx["bag"] MUST be a real DtoBag (if not, warn + skip; upstream drift must be fixed).
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";

import { DtoBag } from "@nv/shared/dto/DtoBag";
import type { DtoBase } from "@nv/shared/dto/DtoBase";
import { DbPromptDto } from "@nv/shared/dto/db.prompt.dto";
import {
  DbWriter,
  DuplicateKeyError,
  type DbWriteDtoCtor,
} from "@nv/shared/dto/persistence/dbWriter/DbWriter";

type WriteDtoCtor = DbWriteDtoCtor<DtoBase>;

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

    const dtoType = this.ctx.get("dtoKey");
    const language = this.ctx.get("language");
    const version = this.ctx.get("version");
    const promptKey = this.ctx.get("promptKey");

    if (dtoType !== "prompt") return;

    const bagUnknown = this.ctx.get("bag") as unknown;

    if (!(bagUnknown instanceof DtoBag)) {
      this.log.warn(
        {
          event: "undefined_prompt_placeholder_skip_non_dtobag",
          requestId,
          dtoType,
          language,
          version,
          promptKey,
          bagType: typeof bagUnknown,
        },
        "prompt placeholder write skipped: ctx['bag'] is not a DtoBag. Ops: ensure db.* read handler stashes a standard DtoBag on ctx['bag']."
      );
      return;
    }

    const bag = bagUnknown as DtoBag<unknown>;
    if (bag.count() > 0) return;

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

    // ADR-0106: no svcEnv/db vars at call sites; DbWriter sources DB config via SvcRuntime.
    // Also: this handler does not require env plumbing; runtime owns it.
    const placeholder = DbPromptDto.fromBody(
      {
        promptKey: promptKey.trim(),
        language: language.trim(),
        version: Math.trunc(version),
        template: "",
        undefined: true,
      },
      { validate: false }
    );

    const placeholderBag = new DtoBag<DbPromptDto>([placeholder]);

    let writer: DbWriter<DbPromptDto>;
    try {
      writer = new DbWriter<DbPromptDto>({
        rt: this.rt,
        dtoCtor: DbPromptDto as unknown as WriteDtoCtor,
        bag: placeholderBag,
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
