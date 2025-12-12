// backend/services/shared/src/dto/test-handler.dto.ts
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
 * - Represents a single handler-level test result within a test run.
 * - Child record of TestRunDto:
 *     • runId   → logical grouping key
 *     • runRefId → FK to TestRunDto.id
 *
 * Invariants:
 * - One document per (runId, handlerName, pipelineLabel, scenarioName?).
 * - Failed assertions are captured as simple strings for easy human scanning.
 */

import { DtoBase, DtoValidationError } from "./DtoBase";
import type { IndexHint } from "./persistence/index-hints";
import type { IDto } from "./IDto";

export type TestHandlerStatus = "pass" | "fail" | "error" | "skip";

type TestHandlerJson = {
  _id?: string;
  type?: "test-handler";

  runId?: string;
  runRefId?: string;

  env?: string;
  dbState?: string;

  serviceSlug?: string;
  serviceVersion?: number | string;

  controllerName?: string;
  pipelineLabel?: string;
  pipelinePath?: string;

  handlerName?: string;
  handlerPath?: string;

  dtoType?: string;
  scenarioName?: string;

  status?: TestHandlerStatus;
  assertionCount?: number;
  failedAssertions?: string[];

  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;

  requestId?: string;
  notes?: string;

  createdAt?: string;
  updatedAt?: string;
  updatedByUserId?: string;
};

export class TestHandlerDto extends DtoBase implements IDto {
  // ─────────────── Static: Collection & Index Hints ───────────────

  public static dbCollectionName(): string {
    return "test-handler";
  }

  public static readonly indexHints: ReadonlyArray<IndexHint> = [
    // Parent/child navigation.
    { kind: "lookup", fields: ["runRefId"] },
    { kind: "lookup", fields: ["runId"] },

    // Drill-down by service/pipeline/handler.
    {
      kind: "lookup",
      fields: ["serviceSlug", "pipelineLabel", "handlerName"],
    },

    // Filter by outcome.
    { kind: "lookup", fields: ["status"] },

    // Optional: environment/state.
    { kind: "lookup", fields: ["env", "dbState"] },
  ];

  // ─────────────── Instance: Domain Fields ───────────────

  public runId = "";
  public runRefId = "";

  public env = "";
  public dbState = "";

  public serviceSlug = "";
  public serviceVersion = 1;

  public controllerName = "";
  public pipelineLabel = "";
  public pipelinePath = "";

  public handlerName = "";
  public handlerPath = "";

  public dtoType: string | undefined;
  public scenarioName: string | undefined;

  public status: TestHandlerStatus = "error";
  public assertionCount = 0;
  public failedAssertions: string[] = [];

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
    this.setCollectionName(TestHandlerDto.dbCollectionName());
  }

  // ─────────────── Wire hydration ───────────────

  public static fromBody(
    json: unknown,
    opts?: { validate?: boolean }
  ): TestHandlerDto {
    const dto = new TestHandlerDto(DtoBase.getSecret());
    const j = (json ?? {}) as Partial<TestHandlerJson>;

    // id
    if (typeof j._id === "string" && j._id.trim()) {
      dto.setIdOnce(j._id.trim());
    }

    if (typeof j.runId === "string") dto.runId = j.runId.trim();
    if (typeof j.runRefId === "string") dto.runRefId = j.runRefId.trim();

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

    if (typeof j.pipelineLabel === "string") {
      dto.pipelineLabel = j.pipelineLabel.trim();
    }

    if (typeof j.pipelinePath === "string") {
      dto.pipelinePath = j.pipelinePath.trim();
    }

    if (typeof j.handlerName === "string") {
      dto.handlerName = j.handlerName.trim();
    }

    if (typeof j.handlerPath === "string") {
      dto.handlerPath = j.handlerPath.trim();
    }

    if (typeof j.dtoType === "string") {
      const t = j.dtoType.trim();
      dto.dtoType = t || undefined;
    }

    if (typeof j.scenarioName === "string") {
      const s = j.scenarioName.trim();
      dto.scenarioName = s || undefined;
    }

    if (
      j.status === "pass" ||
      j.status === "fail" ||
      j.status === "error" ||
      j.status === "skip"
    ) {
      dto.status = j.status;
    }

    if (typeof j.assertionCount === "number") {
      dto.assertionCount = Math.max(0, Math.trunc(j.assertionCount));
    }

    if (Array.isArray(j.failedAssertions)) {
      dto.failedAssertions = j.failedAssertions
        .map((v) => (typeof v === "string" ? v.trim() : String(v)))
        .filter((v) => v.length > 0);
    }

    if (typeof j.startedAt === "string") {
      dto.startedAt = j.startedAt.trim();
    }
    if (typeof j.finishedAt === "string") {
      dto.finishedAt = j.finishedAt.trim();
    }

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

      if (!dto.handlerName) {
        issues.push({
          path: "handlerName",
          code: "required",
          message: "handlerName is required",
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
          `Invalid TestHandlerDto payload — ${issues.length} issue(s) found.`,
          issues
        );
      }
    }

    return dto;
  }

  // ─────────────── Outbound wire shape ───────────────

  public toBody(): TestHandlerJson {
    const body: TestHandlerJson = {
      _id: this.hasId() ? this.getId() : undefined,
      type: "test-handler",

      runId: this.runId || undefined,
      runRefId: this.runRefId || undefined,

      env: this.env || undefined,
      dbState: this.dbState || undefined,

      serviceSlug: this.serviceSlug || undefined,
      serviceVersion: this.serviceVersion,

      controllerName: this.controllerName || undefined,
      pipelineLabel: this.pipelineLabel || undefined,
      pipelinePath: this.pipelinePath || undefined,

      handlerName: this.handlerName || undefined,
      handlerPath: this.handlerPath || undefined,

      dtoType: this.dtoType,
      scenarioName: this.scenarioName,

      status: this.status,
      assertionCount: this.assertionCount,
      failedAssertions:
        this.failedAssertions && this.failedAssertions.length > 0
          ? [...this.failedAssertions]
          : [],

      startedAt: this.startedAt || undefined,
      finishedAt: this.finishedAt || undefined,
      durationMs: this.durationMs,

      requestId: this.requestId,
      notes: this.notes,
    };

    return this._finalizeToJson(body);
  }

  // ─────────────── DTO-to-DTO patch helper ───────────────

  public patchFrom(other: TestHandlerDto): this {
    if (other.runId) this.runId = other.runId;
    if (other.runRefId) this.runRefId = other.runRefId;

    if (other.env) this.env = other.env;
    if (other.dbState) this.dbState = other.dbState;

    if (other.serviceSlug) this.serviceSlug = other.serviceSlug;
    if (other.serviceVersion && other.serviceVersion > 0) {
      this.serviceVersion = Math.trunc(other.serviceVersion);
    }

    if (other.controllerName) this.controllerName = other.controllerName;
    if (other.pipelineLabel) this.pipelineLabel = other.pipelineLabel;
    if (other.pipelinePath) this.pipelinePath = other.pipelinePath;

    if (other.handlerName) this.handlerName = other.handlerName;
    if (other.handlerPath) this.handlerPath = other.handlerPath;

    if (other.dtoType) this.dtoType = other.dtoType;
    if (other.scenarioName) this.scenarioName = other.scenarioName;

    if (other.status) this.status = other.status;

    if (other.assertionCount > 0) {
      this.assertionCount = Math.trunc(other.assertionCount);
    }

    if (other.failedAssertions && other.failedAssertions.length > 0) {
      this.failedAssertions = [...other.failedAssertions];
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

  public patchFromDto(other: TestHandlerDto): this {
    return this.patchFrom(other);
  }

  // ─────────────── IDto contract ───────────────

  public getType(): string {
    return "test-handler";
  }
}
