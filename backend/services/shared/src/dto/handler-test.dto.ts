// backend/services/shared/src/dto/handler-test.dto.ts
/**
 * Docs:
 * - SOP: DTO-first; DTO internals never leak
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0047 (DtoBag, DtoBagView, and DB-Level Batching)
 *   - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 *   - LDD-38 (Test Runner vNext Design)
 *   - LDD-39 (StepIterator Micro-Contract — Revised, KISS)
 *   - ADR-0078 (DTO write-once private fields; setters in / getters out)
 *   - ADR-0079 (DtoBase.check — single normalization/validation gate)
 *
 * Purpose:
 * - Represents ONE handler-test execution record (one document per handler test).
 * - Persisted by the handler-test service (formerly test-log).
 * - Seeded (Started) by StepIterator before runTest(), then updated (finalized) after runTest().
 *
 * Invariants (locked):
 * - Single collection: "handler-test"
 * - All state/header info is write-once (cannot be mutated after initial seed)
 * - Scenario logging is enforced via: await dto.runScenario("name", async () => { ... })
 * - Each scenario record MUST include: name + structured status
 * - No nested DTOs
 */

import { DtoBase, DtoValidationError, type CheckKind } from "./DtoBase";
import type { IndexHint } from "./persistence/index-hints";
import type { IDto } from "./IDto";

export type HandlerTestStatus =
  | "Started"
  | "Passed"
  | "Failed"
  | "TestError"
  | "RailError";

export type HandlerTestScenarioStatus = "Passed" | "Failed" | "RailError";

export type HandlerTestScenario = {
  name: string;
  status: HandlerTestScenarioStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  details?: unknown;
  errorMessage?: string;
  errorStack?: string;
};

type HandlerTestJson = {
  _id?: string;
  type?: "handler-test";

  // Write-once header (seeded before runTest, immutable thereafter)
  env?: string;
  dbState?: string;
  dbMocks?: boolean;
  s2sMocks?: boolean;

  targetServiceSlug?: string;
  targetServiceName?: string;
  targetServiceVersion?: number | string;

  indexRelativePath?: string;
  pipelineName?: string;

  handlerName?: string;
  handlerPurpose?: string;

  // Mutable outcome fields (updated after runTest)
  status?: HandlerTestStatus;

  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;

  scenarios?: HandlerTestScenario[];

  requestId?: string;
  notes?: string;

  // meta
  createdAt?: string;
  updatedAt?: string;
  updatedByUserId?: string;
};

type ScenarioResult =
  | boolean
  | {
      passed: boolean;
      details?: unknown;
    }
  | {
      status: "Passed" | "Failed";
      details?: unknown;
    };

export class HandlerTestDto extends DtoBase implements IDto {
  // ─────────────── Static: Collection & Index Hints ───────────────

  public static dbCollectionName(): string {
    return "handler-test";
  }

  public static readonly indexHints: ReadonlyArray<IndexHint> = [
    // Drill down by target service.
    { kind: "lookup", fields: ["targetServiceSlug", "targetServiceVersion"] },

    // Pipeline/file targeting (useful for reruns and regressions).
    { kind: "lookup", fields: ["indexRelativePath", "pipelineName"] },

    // Filter by outcome.
    { kind: "lookup", fields: ["status"] },

    // Environment/state-based filtering.
    { kind: "lookup", fields: ["env", "dbState", "dbMocks", "s2sMocks"] },

    // Time-based drill-down.
    { kind: "lookup", fields: ["startedAt"] },
  ];

  // ─────────────── Private write-once header fields (ADR-0078) ───────────────

  private _env = "";
  private _dbState = "";
  private _dbMocks = false;
  private _s2sMocks = false;

  private _targetServiceSlug = "";
  private _targetServiceName = "";
  private _targetServiceVersion = 1;

  private _indexRelativePath = "";
  private _pipelineName = "";

  private _handlerName = "";
  private _handlerPurpose = "";

  // ─────────────── Private mutable outcome fields ───────────────

  private _status: HandlerTestStatus = "TestError";

  private _startedAt = "";
  private _finishedAt = "";
  private _durationMs = 0;

  private _scenarios: HandlerTestScenario[] = [];

  private _requestId: string | undefined;
  private _notes: string | undefined;

  // ─────────────── Internal write-once enforcement ───────────────

  private _writeOnceFrozen = false;
  private readonly _writeOnceTouched = new Set<string>();

  // ─────────────── Construction ───────────────

  public constructor(
    secretOrMeta?:
      | symbol
      | { createdAt?: string; updatedAt?: string; updatedByUserId?: string }
  ) {
    super(secretOrMeta);
    this.setCollectionName(HandlerTestDto.dbCollectionName());
  }

  // ─────────────── Getters only (ADR-0078) ───────────────

  public getEnv(): string {
    return this._env;
  }
  public getDbState(): string {
    return this._dbState;
  }
  public getDbMocks(): boolean {
    return this._dbMocks;
  }
  public getS2sMocks(): boolean {
    return this._s2sMocks;
  }

  public getTargetServiceSlug(): string {
    return this._targetServiceSlug;
  }
  public getTargetServiceName(): string {
    return this._targetServiceName;
  }
  public getTargetServiceVersion(): number {
    return this._targetServiceVersion;
  }

  public getIndexRelativePath(): string {
    return this._indexRelativePath;
  }
  public getPipelineName(): string {
    return this._pipelineName;
  }

  public getHandlerName(): string {
    return this._handlerName;
  }
  public getHandlerPurpose(): string {
    return this._handlerPurpose;
  }

  public getStatus(): HandlerTestStatus {
    return this._status;
  }

  public getStartedAt(): string {
    return this._startedAt;
  }
  public getFinishedAt(): string {
    return this._finishedAt;
  }
  public getDurationMs(): number {
    return this._durationMs;
  }

  public getScenarios(): ReadonlyArray<HandlerTestScenario> {
    return this._scenarios;
  }

  public getRequestId(): string | undefined {
    return this._requestId;
  }
  public getNotes(): string | undefined {
    return this._notes;
  }

  // ─────────────── Write-once header lifecycle ───────────────

  /**
   * Freeze write-once header fields. Call once after seeding from StepIterator or hydration.
   */
  public freezeWriteOnce(): void {
    this._writeOnceFrozen = true;
  }

  public setEnvOnce(v: string): void {
    this._setOnceString("env", (x) => (this._env = x), v);
  }

  public setDbStateOnce(v: string): void {
    this._setOnceString("dbState", (x) => (this._dbState = x), v);
  }

  public setDbMocksOnce(v: boolean): void {
    this._setOnceBool("dbMocks", (x) => (this._dbMocks = x), v);
  }

  public setS2sMocksOnce(v: boolean): void {
    this._setOnceBool("s2sMocks", (x) => (this._s2sMocks = x), v);
  }

  public setTargetServiceSlugOnce(v: string): void {
    this._setOnceString(
      "targetServiceSlug",
      (x) => (this._targetServiceSlug = x),
      v
    );
  }

  public setTargetServiceNameOnce(v: string): void {
    this._setOnceString(
      "targetServiceName",
      (x) => (this._targetServiceName = x),
      v
    );
  }

  public setTargetServiceVersionOnce(v: number): void {
    this._setOncePosInt(
      "targetServiceVersion",
      (x) => (this._targetServiceVersion = x),
      v
    );
  }

  public setIndexRelativePathOnce(v: string): void {
    this._setOnceString(
      "indexRelativePath",
      (x) => (this._indexRelativePath = x),
      v
    );
  }

  public setPipelineNameOnce(v: string): void {
    this._setOnceString("pipelineName", (x) => (this._pipelineName = x), v);
  }

  public setHandlerNameOnce(v: string): void {
    this._setOnceString("handlerName", (x) => (this._handlerName = x), v);
  }

  public setHandlerPurposeOnce(v: string): void {
    this._setOnceString("handlerPurpose", (x) => (this._handlerPurpose = x), v);
  }

  private _guardWriteOnce(fieldKey: string): void {
    if (this._writeOnceFrozen) {
      throw new Error(
        `HandlerTestDto write-once field "${fieldKey}" is frozen`
      );
    }
    if (this._writeOnceTouched.has(fieldKey)) {
      throw new Error(
        `HandlerTestDto write-once field "${fieldKey}" already set`
      );
    }
  }

  private _touchWriteOnce(fieldKey: string): void {
    this._writeOnceTouched.add(fieldKey);
  }

  private _setOnceString(
    fieldKey: string,
    assign: (v: string) => void,
    v: string
  ): void {
    this._guardWriteOnce(fieldKey);
    assign((v ?? "").trim());
    this._touchWriteOnce(fieldKey);
  }

  private _setOnceBool(
    fieldKey: string,
    assign: (v: boolean) => void,
    v: boolean
  ): void {
    this._guardWriteOnce(fieldKey);
    assign(!!v);
    this._touchWriteOnce(fieldKey);
  }

  private _setOncePosInt(
    fieldKey: string,
    assign: (v: number) => void,
    v: number
  ): void {
    this._guardWriteOnce(fieldKey);
    const n = Math.trunc(Number(v));
    assign(Number.isFinite(n) && n > 0 ? n : 1);
    this._touchWriteOnce(fieldKey);
  }

  // ─────────────── Mutable outcome setters ───────────────

  public markStarted(): void {
    this._status = "Started";
    if (!this._startedAt) this._startedAt = new Date().toISOString();
  }

  public markTestError(): void {
    this._status = "TestError";
  }

  public markRailError(): void {
    this._status = "RailError";
  }

  public setStatus(v: HandlerTestStatus): void {
    this._status = v;
  }

  public setStartedAt(v: string): void {
    this._startedAt = (v ?? "").trim();
  }

  public setFinishedAt(v: string): void {
    this._finishedAt = (v ?? "").trim();
  }

  public setDurationMs(v: number): void {
    const n = Math.trunc(Number(v));
    this._durationMs = Number.isFinite(n) ? Math.max(0, n) : 0;
  }

  public setRequestId(v: string | undefined): void {
    const rid = typeof v === "string" ? v.trim() : "";
    this._requestId = rid || undefined;
  }

  public setNotes(v: string | undefined): void {
    const notes = typeof v === "string" ? v.trim() : "";
    this._notes = notes || undefined;
  }

  // ─────────────── Scenario enforcement ───────────────

  /**
   * Forced scenario pattern (locked):
   *   await dto.runScenario("happy path", async () => { ... })
   *
   * The scenario status is STRUCTURED and always recorded.
   * - Throw => RailError (and the throw is rethrown by default)
   * - Return => Passed/Failed based on the return shape
   */
  public async runScenario(
    name: string,
    fn: () => Promise<ScenarioResult> | ScenarioResult,
    opts?: { rethrowOnRailError?: boolean }
  ): Promise<void> {
    const scenarioName = (name ?? "").trim();
    if (!scenarioName) {
      throw new Error(
        `HandlerTestDto.runScenario requires a non-empty scenario name`
      );
    }

    const startedAt = new Date().toISOString();
    const t0 = Date.now();

    let status: HandlerTestScenarioStatus = "RailError";
    let details: unknown | undefined;
    let errorMessage: string | undefined;
    let errorStack: string | undefined;

    try {
      const r = await fn();
      const parsed = this._parseScenarioResult(r);
      status = parsed.status;
      details = parsed.details;
    } catch (err) {
      status = "RailError";
      errorMessage =
        err instanceof Error ? err.message : String(err ?? "unknown error");
      errorStack = err instanceof Error ? err.stack : undefined;

      const shouldRethrow = opts?.rethrowOnRailError !== false;
      this._appendScenario({
        name: scenarioName,
        status,
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Math.max(0, Date.now() - t0),
        details,
        errorMessage,
        errorStack,
      });

      if (shouldRethrow) {
        throw err;
      }
      return;
    }

    this._appendScenario({
      name: scenarioName,
      status,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Math.max(0, Date.now() - t0),
      details,
      errorMessage,
      errorStack,
    });
  }

  private _parseScenarioResult(r: ScenarioResult): {
    status: "Passed" | "Failed";
    details?: unknown;
  } {
    if (typeof r === "boolean") {
      return { status: r ? "Passed" : "Failed" };
    }

    const anyR = r as any;

    if (typeof anyR?.passed === "boolean") {
      return {
        status: anyR.passed ? "Passed" : "Failed",
        details: anyR.details,
      };
    }

    if (anyR?.status === "Passed" || anyR?.status === "Failed") {
      return { status: anyR.status, details: anyR.details };
    }

    // Unknown return shape: treat as Failed (better than lying).
    return { status: "Failed" };
  }

  private _appendScenario(s: HandlerTestScenario): void {
    const name = (s.name ?? "").trim();
    if (!name) {
      throw new Error(`Scenario name is required`);
    }
    if (
      s.status !== "Passed" &&
      s.status !== "Failed" &&
      s.status !== "RailError"
    ) {
      throw new Error(`Scenario status is invalid`);
    }

    this._scenarios.push({
      name,
      status: s.status,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
      durationMs: Math.max(0, Math.trunc(s.durationMs)),
      details: s.details,
      errorMessage: s.errorMessage,
      errorStack: s.errorStack,
    });
  }

  // ─────────────── Finalization (status derived from scenarios) ───────────────

  /**
   * Compute final status from scenarios (preferred single truth).
   * - Any RailError => RailError
   * - Else any Failed => Failed
   * - Else at least one Passed => Passed
   * - Else (no scenarios) => TestError
   */
  public finalizeFromScenarios(): void {
    const finishedAt = new Date().toISOString();
    this._finishedAt = this._finishedAt || finishedAt;

    const startMs = this._startedAt ? Date.parse(this._startedAt) : NaN;
    const finishMs = Date.parse(this._finishedAt);
    if (Number.isFinite(startMs) && Number.isFinite(finishMs)) {
      this._durationMs = Math.max(0, Math.trunc(finishMs - startMs));
    }

    if (!this._scenarios.length) {
      this._status = "TestError";
      return;
    }

    if (this._scenarios.some((s) => s.status === "RailError")) {
      this._status = "RailError";
      return;
    }

    if (this._scenarios.some((s) => s.status === "Failed")) {
      this._status = "Failed";
      return;
    }

    if (this._scenarios.some((s) => s.status === "Passed")) {
      this._status = "Passed";
      return;
    }

    this._status = "TestError";
  }

  // ─────────────── Wire hydration (via DtoBase.check) ───────────────

  public static fromBody(
    json: unknown,
    opts?: { validate?: boolean }
  ): HandlerTestDto {
    const dto = new HandlerTestDto(DtoBase.getSecret());
    const j = (json ?? {}) as Partial<HandlerTestJson>;
    const validate = opts?.validate === true;

    const check = <T>(input: unknown, kind: CheckKind, path: string): T =>
      DtoBase.check<T>(input, kind, { validate, path });

    // id (optional; immutable once set)
    if (typeof j._id === "string" && j._id.trim()) {
      dto.setIdOnce(j._id.trim());
    }

    // header (write-once semantics; all through check + write-once setters)
    const env = DtoBase.check<string | undefined>(j.env, "stringOpt", {
      validate,
      path: "env",
    });
    if (env !== undefined) {
      dto.setEnvOnce(env);
    }

    const dbState = DtoBase.check<string | undefined>(j.dbState, "stringOpt", {
      validate,
      path: "dbState",
    });
    if (dbState !== undefined) {
      dto.setDbStateOnce(dbState);
    }

    const dbMocks = check<boolean | undefined>(
      j.dbMocks,
      "booleanOpt",
      "dbMocks"
    );
    if (dbMocks !== undefined) {
      dto.setDbMocksOnce(dbMocks);
    }

    const s2sMocks = check<boolean | undefined>(
      j.s2sMocks,
      "booleanOpt",
      "s2sMocks"
    );
    if (s2sMocks !== undefined) {
      dto.setS2sMocksOnce(s2sMocks);
    }

    const targetServiceSlug = DtoBase.check<string | undefined>(
      j.targetServiceSlug,
      "stringOpt",
      { validate, path: "targetServiceSlug" }
    );
    if (targetServiceSlug !== undefined) {
      dto.setTargetServiceSlugOnce(targetServiceSlug);
    }

    const targetServiceName = DtoBase.check<string | undefined>(
      j.targetServiceName,
      "stringOpt",
      { validate, path: "targetServiceName" }
    );
    if (targetServiceName !== undefined) {
      dto.setTargetServiceNameOnce(targetServiceName);
    }

    const targetServiceVersion = DtoBase.check<number | undefined>(
      j.targetServiceVersion,
      "numberOpt",
      { validate, path: "targetServiceVersion" }
    );
    if (targetServiceVersion !== undefined) {
      dto.setTargetServiceVersionOnce(targetServiceVersion);
    }

    const indexRelativePath = DtoBase.check<string | undefined>(
      j.indexRelativePath,
      "stringOpt",
      { validate, path: "indexRelativePath" }
    );
    if (indexRelativePath !== undefined) {
      dto.setIndexRelativePathOnce(indexRelativePath);
    }

    const pipelineName = DtoBase.check<string | undefined>(
      j.pipelineName,
      "stringOpt",
      { validate, path: "pipelineName" }
    );
    if (pipelineName !== undefined) {
      dto.setPipelineNameOnce(pipelineName);
    }

    const handlerName = DtoBase.check<string | undefined>(
      j.handlerName,
      "stringOpt",
      { validate, path: "handlerName" }
    );
    if (handlerName !== undefined) {
      dto.setHandlerNameOnce(handlerName);
    }

    const handlerPurpose = check<string | undefined>(
      j.handlerPurpose,
      "stringOpt",
      "handlerPurpose"
    );
    if (handlerPurpose !== undefined) {
      dto.setHandlerPurposeOnce(handlerPurpose);
    }

    // outcome fields (mutable)
    if (
      j.status === "Started" ||
      j.status === "Passed" ||
      j.status === "Failed" ||
      j.status === "TestError" ||
      j.status === "RailError"
    ) {
      dto.setStatus(j.status);
    }

    const startedAt = check<string | undefined>(
      j.startedAt,
      "stringOpt",
      "startedAt"
    );
    if (startedAt !== undefined) {
      dto.setStartedAt(startedAt);
    }

    const finishedAt = check<string | undefined>(
      j.finishedAt,
      "stringOpt",
      "finishedAt"
    );
    if (finishedAt !== undefined) {
      dto.setFinishedAt(finishedAt);
    }

    const durationMs = DtoBase.check<number | undefined>(
      j.durationMs,
      "numberOpt",
      { validate, path: "durationMs" }
    );
    if (durationMs !== undefined) {
      dto.setDurationMs(durationMs);
    }

    // scenarios
    if (Array.isArray(j.scenarios)) {
      const scenarios: HandlerTestScenario[] = j.scenarios
        .filter((s) => !!s && typeof s === "object")
        .map((s, idx) => {
          const ss = s as any;
          const basePath = `scenarios[${idx}]`;

          const name = DtoBase.check<string | undefined>(ss.name, "stringOpt", {
            validate,
            path: `${basePath}.name`,
          });
          const startedAtSc = DtoBase.check<string | undefined>(
            ss.startedAt,
            "stringOpt",
            { validate, path: `${basePath}.startedAt` }
          );
          const finishedAtSc = DtoBase.check<string | undefined>(
            ss.finishedAt,
            "stringOpt",
            { validate, path: `${basePath}.finishedAt` }
          );
          const durationMsSc = DtoBase.check<number | undefined>(
            ss.durationMs,
            "numberOpt",
            { validate, path: `${basePath}.durationMs` }
          );

          const status: HandlerTestScenarioStatus =
            ss.status === "Passed" ||
            ss.status === "Failed" ||
            ss.status === "RailError"
              ? ss.status
              : "RailError";

          return {
            name: name ?? "",
            status,
            startedAt: startedAtSc ?? "",
            finishedAt: finishedAtSc ?? "",
            durationMs: durationMsSc ?? 0,
            details: ss.details,
            errorMessage:
              typeof ss.errorMessage === "string" ? ss.errorMessage : undefined,
            errorStack:
              typeof ss.errorStack === "string" ? ss.errorStack : undefined,
          };
        })
        .filter((s) => !!s.name);

      (dto as any)._scenarios = scenarios;
    }

    const requestId = check<string | undefined>(
      j.requestId,
      "stringOpt",
      "requestId"
    );
    dto.setRequestId(requestId);

    const notes = check<string | undefined>(j.notes, "stringOpt", "notes");
    dto.setNotes(notes);

    dto.setMeta({
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
      updatedByUserId: j.updatedByUserId,
    });

    // freeze header post-hydration
    dto.freezeWriteOnce();

    return dto;
  }

  // ─────────────── Outbound wire shape ───────────────

  public toBody(): HandlerTestJson {
    const body: HandlerTestJson = {
      _id: this.hasId() ? this.getId() : undefined,
      type: "handler-test",

      env: this.getEnv() || undefined,
      dbState: this.getDbState() || undefined,
      dbMocks: this.getDbMocks(),
      s2sMocks: this.getS2sMocks(),

      targetServiceSlug: this.getTargetServiceSlug() || undefined,
      targetServiceName: this.getTargetServiceName() || undefined,
      targetServiceVersion: this.getTargetServiceVersion(),

      indexRelativePath: this.getIndexRelativePath() || undefined,
      pipelineName: this.getPipelineName() || undefined,

      handlerName: this.getHandlerName() || undefined,
      handlerPurpose: this.getHandlerPurpose() || undefined,

      status: this.getStatus(),

      startedAt: this.getStartedAt() || undefined,
      finishedAt: this.getFinishedAt() || undefined,
      durationMs: this.getDurationMs(),

      scenarios: this.getScenarios().length
        ? [...this.getScenarios()]
        : undefined,

      requestId: this.getRequestId(),
      notes: this.getNotes(),
    };

    return this._finalizeToJson(body);
  }

  // ─────────────── DTO-to-DTO patch helper ───────────────

  public patchFrom(other: HandlerTestDto): this {
    // Header is write-once: patch MUST NOT mutate it.
    // Outcome fields may be patched during upsert flows.
    this._status = other.getStatus();

    if (other.getStartedAt()) this._startedAt = other.getStartedAt();
    if (other.getFinishedAt()) this._finishedAt = other.getFinishedAt();
    if (other.getDurationMs() > 0)
      this._durationMs = Math.trunc(other.getDurationMs());

    const otherScenarios = other.getScenarios();
    if (otherScenarios.length) {
      this._scenarios = otherScenarios.slice();
    }

    if (other.getRequestId()) this._requestId = other.getRequestId();
    if (other.getNotes()) this._notes = other.getNotes();

    return this;
  }

  public patchFromDto(other: HandlerTestDto): this {
    return this.patchFrom(other);
  }

  // ─────────────── IDto contract ───────────────

  public getType(): string {
    return "handler-test";
  }
}
