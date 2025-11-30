// backend/services/shared/src/dto/prompt.dto.ts
/**
 * Docs:
 * - SOP: DTO-first; DTO internals never leak
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0045 (Index Hints — boot ensure via shared helper)
 *   - ADR-0050 (Wire Bag Envelope — canonical wire id is `_id`)
 *   - ADR-0053 (Instantiation discipline via BaseDto secret)
 *   - ADR-0057 (ID Generation & Validation — UUIDv4; immutable; WARN on overwrite attempt)
 *   - ADR-0064 (Prompts Service, PromptsClient, Prompt-Flush MOS, UI Text Catalog)
 *
 * Purpose:
 * - Concrete DTO for the `prompt` service.
 * - Represents a single localized text template identified by (promptKey, language, version).
 * - `version` allows independent evolution of prompts per YAML/UI generation or major-app-version.
 */

import { DtoBase } from "./DtoBase";
import type { IndexHint } from "./persistence/index-hints";

// Wire-friendly shape
export type PromptJson = {
  _id?: string;
  type?: "prompt";

  promptKey: string;
  language: string;
  version: number;
  template: string;

  category?: string;
  tags?: string[];

  createdAt?: string;
  updatedAt?: string;
  updatedByUserId?: string;
};

export class PromptDto extends DtoBase {
  /**
   * MongoDB collection name for this DTO.
   */
  public static dbCollectionName(): string {
    return "prompt";
  }

  /**
   * Index hints consumed by the shared index helper at boot.
   *
   * - ux_prompt_key_language_version:
   *     Ensures each (promptKey, language, version) tuple is unique.
   */
  public static readonly indexHints: ReadonlyArray<IndexHint> = [
    {
      kind: "unique",
      fields: ["promptKey", "language", "version"],
      options: { name: "ux_prompt_key_language_version" },
    },
    {
      kind: "lookup",
      fields: ["promptKey"],
      options: { name: "ix_prompt_promptKey" },
    },
    {
      kind: "lookup",
      fields: ["language"],
      options: { name: "ix_prompt_language" },
    },
    {
      kind: "lookup",
      fields: ["version"],
      options: { name: "ix_prompt_version" },
    },
  ];

  // Core fields
  public promptKey = "";
  public language = "";
  public version = 1;
  public template = "";

  // Optional metadata
  public category?: string;
  public tags?: string[];

  public constructor(
    secretOrMeta?:
      | symbol
      | { createdAt?: string; updatedAt?: string; updatedByUserId?: string }
  ) {
    super(secretOrMeta);
  }

  public static fromBody(
    json: unknown,
    opts?: { validate?: boolean }
  ): PromptDto {
    const dto = new PromptDto(DtoBase.getSecret());
    const j = (json ?? {}) as Partial<PromptJson>;

    // Id discipline — never generate here.
    if (typeof j._id === "string" && j._id.trim()) {
      dto.setIdOnce(j._id.trim());
    }

    if (typeof j.promptKey === "string") {
      dto.promptKey = j.promptKey.trim();
    }

    if (typeof j.language === "string") {
      dto.language = j.language.trim();
    }

    if (typeof j.version === "number" && Number.isFinite(j.version)) {
      dto.version = Math.trunc(j.version);
    }

    if (typeof j.template === "string") {
      dto.template = j.template;
    }

    if (typeof j.category === "string") {
      dto.category = j.category.trim();
    }

    if (Array.isArray(j.tags)) {
      dto.tags = j.tags.filter((t): t is string => typeof t === "string");
    }

    dto.setMeta({
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
      updatedByUserId: j.updatedByUserId,
    });

    return dto;
  }

  public toBody(): PromptJson {
    const body: PromptJson = {
      _id: this.hasId() ? this.getId() : undefined,
      type: "prompt",

      promptKey: this.promptKey,
      language: this.language,
      version: this.version,
      template: this.template,

      category: this.category,
      tags: this.tags,
    };

    return this._finalizeToJson(body);
  }

  public patchFrom(json: Partial<PromptJson>): this {
    if (json.promptKey !== undefined && typeof json.promptKey === "string") {
      this.promptKey = json.promptKey.trim();
    }

    if (json.language !== undefined && typeof json.language === "string") {
      this.language = json.language.trim();
    }

    if (json.version !== undefined) {
      const v =
        typeof json.version === "string" ? Number(json.version) : json.version;
      if (Number.isFinite(v)) this.version = Math.trunc(v as number);
    }

    if (json.template !== undefined && typeof json.template === "string") {
      this.template = json.template;
    }

    if (json.category !== undefined && typeof json.category === "string") {
      this.category = json.category.trim();
    }

    if (json.tags !== undefined && Array.isArray(json.tags)) {
      this.tags = json.tags.filter((t): t is string => typeof t === "string");
    }

    return this;
  }

  public getType(): string {
    return "prompt";
  }
}
