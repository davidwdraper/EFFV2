// backend/services/shared/src/dto/test-run.dto.ts
/**
 * Docs:
 * - SOP: DTO-first; DTO internals never leak
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0047 (DtoBag, DtoBagView, and DB-Level Batching)
 *   - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 *
 * Purpose:
 * - Represents a single test-run of a handler pipeline:
 *   • one document per logical runId
 *   • denormalized summary of controller + pipeline + aggregate handler results
 *
 * Invariants:
 * - No nested DTOs; snapshots/children live in separate collections (e.g. TestHandlerDto).
 * - runId is the logical grouping key for all TestHandlerDto children.
 */

import { DtoBase, DtoValidationError } from "./DtoBase";
import type { IndexHint } from "./persistence/index-hints";
import type { IDto } from "./IDto";

export type TestRunStatus = "pass" | "fail" | "error";

type TestRunJson = {
  _id?: string;
  type?: "test-run";

  runId?: string;

  env?: string;
  dbState?: string;

  serviceSlug?: string;
  serviceVersion?: number | string;

  controllerName?: string;
  controllerPath?: string;

  pipelineLabel?: string;
  pipelinePath?: string;

  status?: TestRunStatus;

  handlerCount?: number;
  passedHandlerCount?: number;
  failedHandlerCount?: number;
  errorHandlerCount?: number;

  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;

  requestId?: string;
  notes?: string;

  createdAt?: string;
  updatedAt?: string;
  updatedByUserId?: string;
};

export class TestRunDto extends DtoBase implements IDto {
  // ─────────────── Static: Collection & Index Hints ───────────────

  public static dbCollectionName(): string {
    return "test-run";
  }

  public static readonly indexHints: ReadonlyArray<IndexHint> = [
    // Fast lookup by logical run id.
    { kind: "lookup", fields: ["runId"] },

    // Group by service + pipeline.
    {
      kind: "lookup",
      fields: ["serviceSlug", "controllerName", "pipelineLabel"],
    },

    // Filter by outcome.
    { kind: "lookup", fields: ["status"] },

    // Optional: environment/state-based drill-down.
    { kind: "lookup", fields: ["env", "dbState"] },
  ];

  // ─────────────── Instance: Domain Fields ───────────────

  public runId = "";

  public env = "";
  public dbState = "";

  public serviceSlug = "";
  public serviceVersion = 1;

  public controllerName = "";
  public controllerPath = "";

  public pipelineLabel = "";
  public pipelinePath = "";

  public status: TestRunStatus = "error";

  public handlerCount = 0;
  public passedHandlerCount = 0;
  public failedHandlerCount = 0;
  public errorHandlerCount = 0;

  public startedAt = "";
  public finishedAt = "";
  public durationMs = 0;

  public requestId: string | undefined;
  public notes: string | undefined;

  // ─────────────── Construction ───────────────

  public constructor(
    secretOrMeta?:
      | symbol
      | { createdAt?: string; updatedAt?: string; updatedByUserId?: string }
  ) {
    super(secretOrMeta);
    this.setCollectionName(TestRunDto.dbCollectionName());
  }

  // ─────────────── Wire hydration ───────────────

  public static fromBody(
    json: unknown,
    opts?: { validate?: boolean }
  ): TestRunDto {
    const dto = new TestRunDto(DtoBase.getSecret());
    const j = (json ?? {}) as Partial<TestRunJson>;

    // id (optional; immutable once set)
    if (typeof j._id === "string" && j._id.trim()) {
      dto.setIdOnce(j._id.trim());
    }

    if (typeof j.runId === "string") dto.runId = j.runId.trim();

    if (typeof j.env === "string") dto.env = j.env.trim();
    if (typeof j.dbState === "string") dto.dbState = j.dbState.trim();

    if (typeof j.serviceSlug === "string") {
      dto.serviceSlug = j.serviceSlug.trim();
    }

    if (typeof j.serviceVersion === "number") {
      dto.serviceVersion = Math.trunc(j.serviceVersion);
    } else if (typeof j.serviceVersion === "string") {
      const n = Number(j.serviceVersion);
      if (Number.isFinite(n) && n > 0) {
        dto.serviceVersion = Math.trunc(n);
      }
    }

    if (typeof j.controllerName === "string") {
      dto.controllerName = j.controllerName.trim();
    }
    if (typeof j.controllerPath === "string") {
      dto.controllerPath = j.controllerPath.trim();
    }

    if (typeof j.pipelineLabel === "string") {
      dto.pipelineLabel = j.pipelineLabel.trim();
    }
    if (typeof j.pipelinePath === "string") {
      dto.pipelinePath = j.pipelinePath.trim();
    }

    if (j.status === "pass" || j.status === "fail" || j.status === "error") {
      dto.status = j.status;
    }

    if (typeof j.handlerCount === "number") {
      dto.handlerCount = Math.max(0, Math.trunc(j.handlerCount));
    }
    if (typeof j.passedHandlerCount === "number") {
      dto.passedHandlerCount = Math.max(0, Math.trunc(j.passedHandlerCount));
    }
    if (typeof j.failedHandlerCount === "number") {
      dto.failedHandlerCount = Math.max(0, Math.trunc(j.failedHandlerCount));
    }
    if (typeof j.errorHandlerCount === "number") {
      dto.errorHandlerCount = Math.max(0, Math.trunc(j.errorHandlerCount));
    }

    if (typeof j.startedAt === "string") dto.startedAt = j.startedAt.trim();
    if (typeof j.finishedAt === "string") dto.finishedAt = j.finishedAt.trim();

    if (typeof j.durationMs === "number") {
      dto.durationMs = Math.max(0, Math.trunc(j.durationMs));
    }

    if (typeof j.requestId === "string") {
      const rid = j.requestId.trim();
      dto.requestId = rid || undefined;
    }

    if (typeof j.notes === "string") {
      const notes = j.notes.trim();
      dto.notes = notes || undefined;
    }

    dto.setMeta({
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
      updatedByUserId: j.updatedByUserId,
    });

    if (opts?.validate) {
      const issues: { path: string; code: string; message: string }[] = [];

      if (!dto.runId) {
        issues.push({
          path: "runId",
          code: "required",
          message: "runId is required",
        });
      }

      if (!dto.serviceSlug) {
        issues.push({
          path: "serviceSlug",
          code: "required",
          message: "serviceSlug is required",
        });
      }

      if (!dto.controllerName) {
        issues.push({
          path: "controllerName",
          code: "required",
          message: "controllerName is required",
        });
      }

      if (!dto.pipelineLabel) {
        issues.push({
          path: "pipelineLabel",
          code: "required",
          message: "pipelineLabel is required",
        });
      }

      if (!dto.env) {
        issues.push({
          path: "env",
          code: "required",
          message: "env is required",
        });
      }

      if (issues.length) {
        throw new DtoValidationError(
          `Invalid TestRunDto payload — ${issues.length} issue(s) found.`,
          issues
        );
      }
    }

    return dto;
  }

  // ─────────────── Outbound wire shape ───────────────

  public toBody(): TestRunJson {
    const body: TestRunJson = {
      _id: this.hasId() ? this.getId() : undefined,
      type: "test-run",

      runId: this.runId || undefined,

      env: this.env || undefined,
      dbState: this.dbState || undefined,

      serviceSlug: this.serviceSlug || undefined,
      serviceVersion: this.serviceVersion,

      controllerName: this.controllerName || undefined,
      controllerPath: this.controllerPath || undefined,

      pipelineLabel: this.pipelineLabel || undefined,
      pipelinePath: this.pipelinePath || undefined,

      status: this.status,

      handlerCount: this.handlerCount,
      passedHandlerCount: this.passedHandlerCount,
      failedHandlerCount: this.failedHandlerCount,
      errorHandlerCount: this.errorHandlerCount,

      startedAt: this.startedAt || undefined,
      finishedAt: this.finishedAt || undefined,
      durationMs: this.durationMs,

      requestId: this.requestId,
      notes: this.notes,
    };

    return this._finalizeToJson(body);
  }

  // ─────────────── DTO-to-DTO patch helper ───────────────

  public patchFrom(other: TestRunDto): this {
    if (other.runId) this.runId = other.runId;

    if (other.env) this.env = other.env;
    if (other.dbState) this.dbState = other.dbState;

    if (other.serviceSlug) this.serviceSlug = other.serviceSlug;
    if (other.serviceVersion && other.serviceVersion > 0) {
      this.serviceVersion = Math.trunc(other.serviceVersion);
    }

    if (other.controllerName) this.controllerName = other.controllerName;
    if (other.controllerPath) this.controllerPath = other.controllerPath;

    if (other.pipelineLabel) this.pipelineLabel = other.pipelineLabel;
    if (other.pipelinePath) this.pipelinePath = other.pipelinePath;

    if (other.status) this.status = other.status;

    if (other.handlerCount > 0) {
      this.handlerCount = Math.trunc(other.handlerCount);
    }
    if (other.passedHandlerCount > 0) {
      this.passedHandlerCount = Math.trunc(other.passedHandlerCount);
    }
    if (other.failedHandlerCount > 0) {
      this.failedHandlerCount = Math.trunc(other.failedHandlerCount);
    }
    if (other.errorHandlerCount > 0) {
      this.errorHandlerCount = Math.trunc(other.errorHandlerCount);
    }

    if (other.startedAt) this.startedAt = other.startedAt;
    if (other.finishedAt) this.finishedAt = other.finishedAt;
    if (other.durationMs > 0) {
      this.durationMs = Math.trunc(other.durationMs);
    }

    if (other.requestId) this.requestId = other.requestId;
    if (other.notes) this.notes = other.notes;

    return this;
  }

  public patchFromDto(other: TestRunDto): this {
    return this.patchFrom(other);
  }

  // ─────────────── IDto contract ───────────────

  public getType(): string {
    return "test-run";
  }
}
