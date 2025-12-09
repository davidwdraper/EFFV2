// backend/services/shared/src/dto/test-runner.dto.ts
/**
 * Docs:
 * - SOP: DTO-first; DTO internals never leak
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0045 (Index Hints — boot ensure via shared helper)
 *   - ADR-0050 (Wire Bag Envelope — canonical wire id is `_id`)
 *   - ADR-0053 (Instantiation discipline via BaseDto secret)
 *   - ADR-0057 (ID Generation & Validation — UUIDv4; immutable; WARN on overwrite attempt)
 *
 * Purpose:
 * - DTO for the test-runner MOS service.
 * - Represents the discovered code tree (rootDir + pipelines) for handler
 *   pipelines that can be tested.
 *
 * Invariants:
 * - Service is MOS (no DB); this DTO is not persisted.
 * - `_id` remains immutable and UUIDv4-normalized via DtoBase.
 */

import { DtoBase } from "./DtoBase";
import type { IndexHint } from "./persistence/index-hints";

export type TestRunnerPipelineJson = {
  absolutePath: string;
  relativePath: string;
};

export type TestRunnerJson = {
  _id?: string;
  rootDir?: string;
  pipelines?: TestRunnerPipelineJson[];
};

export class TestRunnerDto extends DtoBase {
  public static dbCollectionName(): string {
    // MOS: never actually used, but registry requires a value.
    return "test-runner";
  }

  // MOS: no DB = no indexes
  public static readonly indexHints: ReadonlyArray<IndexHint> = [];

  // Public fields, MOS-style
  public rootDir = "";
  public pipelines: TestRunnerPipelineJson[] = [];

  public constructor(
    secretOrMeta?:
      | symbol
      | { createdAt?: string; updatedAt?: string; updatedByUserId?: string }
  ) {
    super(secretOrMeta);
  }

  // ──────────────────────────────────────────────────────────
  // Hydration: fromBody (canonical)
  // ──────────────────────────────────────────────────────────

  public static fromBody(
    json: unknown,
    _opts?: { validate?: boolean }
  ): TestRunnerDto {
    const dto = new TestRunnerDto(DtoBase.getSecret());
    const j = (json ?? {}) as Partial<TestRunnerJson>;

    if (typeof j._id === "string" && j._id.trim()) {
      dto.setIdOnce(j._id.trim());
    }

    if (typeof j.rootDir === "string") {
      dto.rootDir = j.rootDir;
    }

    if (Array.isArray(j.pipelines)) {
      dto.pipelines = j.pipelines
        .filter(
          (p): p is TestRunnerPipelineJson =>
            !!p &&
            typeof p.absolutePath === "string" &&
            typeof p.relativePath === "string"
        )
        .map((p) => ({
          absolutePath: p.absolutePath,
          relativePath: p.relativePath,
        }));
    }

    // _opts?.validate → future Zod hook if needed.
    return dto;
  }

  // ──────────────────────────────────────────────────────────
  // Outbound shape: toBody (canonical)
  // ──────────────────────────────────────────────────────────

  public toBody(): TestRunnerJson {
    const body: TestRunnerJson = {
      _id: this.hasId() ? this.getId() : undefined,
      rootDir: this.rootDir,
      pipelines: this.pipelines,
    };

    return this._finalizeToJson(body);
  }

  // ──────────────────────────────────────────────────────────
  // Patch
  // ──────────────────────────────────────────────────────────

  public patchFrom(json: Partial<TestRunnerJson>): this {
    if (typeof json.rootDir === "string") {
      this.rootDir = json.rootDir;
    }

    if (Array.isArray(json.pipelines)) {
      this.pipelines = json.pipelines
        .filter(
          (p): p is TestRunnerPipelineJson =>
            !!p &&
            typeof p.absolutePath === "string" &&
            typeof p.relativePath === "string"
        )
        .map((p) => ({
          absolutePath: p.absolutePath,
          relativePath: p.relativePath,
        }));
    }

    return this;
  }

  // ──────────────────────────────────────────────────────────

  public getType(): string {
    return "test-runner";
  }
}
