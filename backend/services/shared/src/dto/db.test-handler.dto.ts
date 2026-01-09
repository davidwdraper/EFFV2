// backend/services/shared/src/dto/db.test-handler.dto.ts
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
 *     • runId    → logical grouping key
 *     • runRefId → FK to TestRunDto.id
 *
 * Option A Semantics (IMPORTANT):
 * - serviceSlug/serviceVersion/controllerName/pipelineLabel/pipelinePath describe the **TARGET** under test,
 *   not the test-runner service.
 * - runner* fields describe the test-runner invocation context.
 *
 * Invariants:
 * - One document per (runId, handlerName, pipelineLabel, scenarioName?).
 * - Failed assertions are captured as simple strings for easy human scanning.
 */

import { DtoBase } from "./DtoBase";
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

  // TARGET (under test)
  serviceSlug?: string;
  serviceVersion?: number | string;

  controllerName?: string;
  pipelineLabel?: string;
  pipelinePath?: string;

  handlerName?: string;
  handlerPath?: string;

  dtoType?: string;
  scenarioName?: string;

  // RUNNER (test-runner invocation)
  runnerServiceSlug?: string;
  runnerServiceVersion?: number | string;
  runnerControllerName?: string;
  runnerPipelineLabel?: string;
  runnerPipelinePath?: string;

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

export class DbTestHandlerDto extends DtoBase implements IDto {
  public static dbCollectionName(): string {
    return "test-handler";
  }

  public getDtoKey(): string {
    return "db.test-handler.dto";
  }

  public static readonly indexHints: ReadonlyArray<IndexHint> = [
    { kind: "lookup", fields: ["runRefId"] },
    { kind: "lookup", fields: ["runId"] },
    { kind: "lookup", fields: ["serviceSlug", "pipelineLabel", "handlerName"] },
    { kind: "lookup", fields: ["status"] },
    { kind: "lookup", fields: ["env", "dbState"] },
    { kind: "lookup", fields: ["runnerServiceSlug"] },
  ];

  // ─────────────── Instance: Domain Fields ───────────────

  public runId = "";
  public runRefId = "";

  public env = "";
  public dbState = "";

  // TARGET (under test)
  public serviceSlug = "";
  public serviceVersion = 1;

  public controllerName = "";
  public pipelineLabel = "";
  public pipelinePath = "";

  public handlerName = "";
  public handlerPath = "";

  public dtoType: string | undefined;
  public scenarioName: string | undefined;

  // RUNNER (test-runner invocation)
  public runnerServiceSlug = "";
  public runnerServiceVersion = 1;
  public runnerControllerName = "";
  public runnerPipelineLabel = "";
  public runnerPipelinePath = "";

  public status: TestHandlerStatus = "error";
  public assertionCount = 0;
  public failedAssertions: string[] = [];

  public startedAt = "";
  public finishedAt = "";
  public durationMs = 0;

  public requestId: string | undefined;
  public notes: string | undefined;

  public constructor(
    secretOrMeta?:
      | symbol
      | { createdAt?: string; updatedAt?: string; updatedByUserId?: string }
  ) {
    super(secretOrMeta);
    this.setCollectionName(DbTestHandlerDto.dbCollectionName());
  }

  public static fromBody(
    json: unknown,
    opts?: { validate?: boolean }
  ): DbTestHandlerDto {
    const dto = new DbTestHandlerDto(DtoBase.getSecret());
    const j = (json ?? {}) as Partial<TestHandlerJson>;

    if (typeof j._id === "string" && j._id.trim()) {
      dto.setIdOnce(j._id.trim());
    }

    if (typeof j.runId === "string") dto.runId = j.runId.trim();
    if (typeof j.runRefId === "string") dto.runRefId = j.runRefId.trim();

    if (typeof j.env === "string") dto.env = j.env.trim();
    if (typeof j.dbState === "string") dto.dbState = j.dbState.trim();

    if (typeof j.serviceSlug === "string")
      dto.serviceSlug = j.serviceSlug.trim();

    if (typeof j.serviceVersion === "number") {
      dto.serviceVersion = Math.trunc(j.serviceVersion);
    } else if (typeof j.serviceVersion === "string") {
      const n = Number(j.serviceVersion);
      if (Number.isFinite(n) && n > 0) dto.serviceVersion = Math.trunc(n);
    }

    if (typeof j.controllerName === "string")
      dto.controllerName = j.controllerName.trim();
    if (typeof j.pipelineLabel === "string")
      dto.pipelineLabel = j.pipelineLabel.trim();
    if (typeof j.pipelinePath === "string")
      dto.pipelinePath = j.pipelinePath.trim();

    if (typeof j.handlerName === "string")
      dto.handlerName = j.handlerName.trim();
    if (typeof j.handlerPath === "string")
      dto.handlerPath = j.handlerPath.trim();

    if (typeof j.dtoType === "string") {
      const t = j.dtoType.trim();
      dto.dtoType = t || undefined;
    }

    if (typeof j.scenarioName === "string") {
      const s = j.scenarioName.trim();
      dto.scenarioName = s || undefined;
    }

    if (typeof j.runnerServiceSlug === "string")
      dto.runnerServiceSlug = j.runnerServiceSlug.trim();

    if (typeof j.runnerServiceVersion === "number") {
      dto.runnerServiceVersion = Math.trunc(j.runnerServiceVersion);
    } else if (typeof j.runnerServiceVersion === "string") {
      const n = Number(j.runnerServiceVersion);
      if (Number.isFinite(n) && n > 0) dto.runnerServiceVersion = Math.trunc(n);
    }

    if (typeof j.runnerControllerName === "string")
      dto.runnerControllerName = j.runnerControllerName.trim();
    if (typeof j.runnerPipelineLabel === "string")
      dto.runnerPipelineLabel = j.runnerPipelineLabel.trim();
    if (typeof j.runnerPipelinePath === "string")
      dto.runnerPipelinePath = j.runnerPipelinePath.trim();

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

      if (!dto.runId)
        issues.push({
          path: "runId",
          code: "required",
          message: "runId is required",
        });

      if (!dto.serviceSlug)
        issues.push({
          path: "serviceSlug",
          code: "required",
          message: "serviceSlug (TARGET) is required",
        });
      if (!dto.controllerName)
        issues.push({
          path: "controllerName",
          code: "required",
          message: "controllerName (TARGET) is required",
        });
      if (!dto.pipelineLabel)
        issues.push({
          path: "pipelineLabel",
          code: "required",
          message: "pipelineLabel (TARGET) is required",
        });
      if (!dto.handlerName)
        issues.push({
          path: "handlerName",
          code: "required",
          message: "handlerName (TARGET handler) is required",
        });
      if (!dto.env)
        issues.push({
          path: "env",
          code: "required",
          message: "env is required",
        });

      if (issues.length) {
        throw new Error(
          `DTO_VALIDATION_ERROR: Invalid DbTestHandlerDto payload — ${issues.length} issue(s). ` +
            issues.map((x) => `${x.path}:${x.code}`).join(", ")
        );
      }
    }

    return dto;
  }

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

      runnerServiceSlug: this.runnerServiceSlug || undefined,
      runnerServiceVersion: this.runnerServiceVersion,
      runnerControllerName: this.runnerControllerName || undefined,
      runnerPipelineLabel: this.runnerPipelineLabel || undefined,
      runnerPipelinePath: this.runnerPipelinePath || undefined,

      status: this.status,
      assertionCount: this.assertionCount,
      failedAssertions: this.failedAssertions?.length
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

  public patchFrom(other: DbTestHandlerDto): this {
    if (other.runId) this.runId = other.runId;
    if (other.runRefId) this.runRefId = other.runRefId;

    if (other.env) this.env = other.env;
    if (other.dbState) this.dbState = other.dbState;

    if (other.serviceSlug) this.serviceSlug = other.serviceSlug;
    if (other.serviceVersion && other.serviceVersion > 0)
      this.serviceVersion = Math.trunc(other.serviceVersion);

    if (other.controllerName) this.controllerName = other.controllerName;
    if (other.pipelineLabel) this.pipelineLabel = other.pipelineLabel;
    if (other.pipelinePath) this.pipelinePath = other.pipelinePath;

    if (other.handlerName) this.handlerName = other.handlerName;
    if (other.handlerPath) this.handlerPath = other.handlerPath;

    if (other.dtoType) this.dtoType = other.dtoType;
    if (other.scenarioName) this.scenarioName = other.scenarioName;

    if (other.runnerServiceSlug)
      this.runnerServiceSlug = other.runnerServiceSlug;
    if (other.runnerServiceVersion && other.runnerServiceVersion > 0)
      this.runnerServiceVersion = Math.trunc(other.runnerServiceVersion);
    if (other.runnerControllerName)
      this.runnerControllerName = other.runnerControllerName;
    if (other.runnerPipelineLabel)
      this.runnerPipelineLabel = other.runnerPipelineLabel;
    if (other.runnerPipelinePath)
      this.runnerPipelinePath = other.runnerPipelinePath;

    this.status = other.status;

    if (other.assertionCount >= 0)
      this.assertionCount = Math.max(0, Math.trunc(other.assertionCount));
    if (other.failedAssertions)
      this.failedAssertions = [...other.failedAssertions];

    if (other.startedAt) this.startedAt = other.startedAt;
    if (other.finishedAt) this.finishedAt = other.finishedAt;
    if (other.durationMs >= 0)
      this.durationMs = Math.max(0, Math.trunc(other.durationMs));

    if (other.requestId) this.requestId = other.requestId;
    if (other.notes) this.notes = other.notes;

    return this;
  }

  public patchFromDto(other: DbTestHandlerDto): this {
    return this.patchFrom(other);
  }

  public clone(newId?: string): this {
    const dto = new DbTestHandlerDto(DtoBase.getSecret()) as this;

    // ID: caller may supply; otherwise preserve current id if present.
    if (typeof newId === "string" && newId.trim()) {
      (dto as any).setIdOnce(newId.trim());
    } else if ((this as any).hasId?.() && (this as any).getId) {
      // Best effort; does not require getMeta().
      const existing = (this as any).getId();
      if (typeof existing === "string" && existing.trim()) {
        (dto as any).setIdOnce(existing.trim());
      }
    }

    dto.patchFromDto(this as any);
    return dto;
  }

  public getType(): string {
    return "test-handler";
  }
}
