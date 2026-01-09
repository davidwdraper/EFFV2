// backend/services/test-runner/src/svc/TestRunWriter.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0047 (DtoBag, Views & DB-Level Batching)
 *   - ADR-0049 (DTO Registry & canonical id)
 *   - ADR-0050 (Wire Bag Envelope; bag-only edges)
 *   - ADR-0053 (Instantiation Discipline via Registry Secret)
 *   - ADR-0057 (Shared SvcClient for S2S Calls)
 *   - ADR-0069 (Multi-Format Controllers & DTO Body Semantics)
 *   - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 *   - ADR-0077 (Test-Runner vNext — Single Orchestrator Handler)
 * - LDD:
 *   - LDD-12 (SvcClient & S2S Contract Architecture)
 *   - LDD-19 (S2S Protocol)
 *   - LDD-38 / LDD-39 (Test-runner & StepIterator contracts)
 *
 * Purpose:
 * - Define the DTO-first writer contract for per-handler test records.
 * - Provide a SvcClient-backed implementation that calls the handler-test
 *   service's CRUD endpoints:
 *     • PUT   /api/handler-test/v1/:dtoType/create
 *     • PATCH /api/handler-test/v1/:dtoType/update/:id
 *
 * Invariants:
 * - Writer is "dumb": no orchestration, no step loops, no classification.
 * - Writer persists HandlerTestDto instances; runner metadata lives on
 *   HandlerTestRecord, not on the DTO.
 * - Identity comes from the DTO via dto.ensureId().
 * - Writer never inspects JSON payloads; DtoBag and hydrators own that.
 */

import type { HandlerTestDto } from "@nv/shared/dto/db.handler-test.dto";
import type { HandlerTestResult } from "@nv/shared/http/handlers/testing/HandlerTestBase";
import type { ILogger } from "@nv/shared/logger/Logger";
import { DtoBag } from "@nv/shared/dto/DtoBag";
import { SvcClient } from "@nv/shared/s2s/SvcClient";

// ─────────────────────────────────────────────────────────────
// Public contracts
// ─────────────────────────────────────────────────────────────

/**
 * StepIterator’s view of handler-test terminal status.
 * Pure classification labels; semantics live in docs.
 *
 * NOTE:
 * - These are TEST verdict labels only; rails metadata is kept on the DTO
 *   (railsVerdict / railsStatus / railsHandlerStatus).
 */
export type TestHandlerTerminalStatus =
  | "Passed"
  | "Failed"
  | "Skipped"
  | "TestError";

/**
 * Runner-owned wrapper around a HandlerTestDto.
 *
 * - dto is the only thing that hits the handler-test service.
 * - Everything else is runner metadata for logging and summaries.
 */
export interface HandlerTestRecord {
  dto: HandlerTestDto;

  // Run-level metadata
  testRunId: string;
  stepIndex: number;
  stepCount: number;

  // Target metadata
  indexRelativePath: string;
  handlerName: string;
  targetServiceSlug: string;
  targetServiceVersion: number;

  // Outcome metadata (populated by StepIterator after run)
  terminalStatus?: TestHandlerTerminalStatus;
  errorMessage?: string;
  errorStack?: string;
  rawResult?: HandlerTestResult | null;
}

/**
 * Minimal writer contract.
 *
 * StepIterator lifecycle per handler step:
 *   1) Mint HandlerTestDto via shared registry.
 *   2) Seed DTO with contract metadata (index path, handler name, target, times).
 *   3) Mint HandlerTestRecord with dto + run metadata.
 *   4) await writer.startHandlerTest(record)    // insert initial record
 *   5) Execute scenarios via ScenarioRunner     // test-module orchestration
 *   6) Populate record.terminalStatus / error fields / rawResult.
 *   7) await writer.finalizeHandlerTest(record) // update record
 */
export interface TestRunWriter {
  startHandlerTest(record: HandlerTestRecord): Promise<void>;
  finalizeHandlerTest(record: HandlerTestRecord): Promise<void>;
}

// ─────────────────────────────────────────────────────────────
// SvcClient-backed writer
// ─────────────────────────────────────────────────────────────

/**
 * SvcTestRunWriter:
 * - Uses SvcClient.call() to talk to the handler-test service.
 * - Uses handler-test CRUD routes:
 *   - PUT   /api/handler-test/v1/handler-test/create
 *   - PATCH /api/handler-test/v1/handler-test/update/:id
 *
 * Notes:
 * - dtoType is "handler-test" (registry key).
 * - slug is "handler-test"; version is injected via constructor.
 * - env is injected via constructor (same env as test-runner) and used for
 *   S2S routing, not for mutating the DTO.
 */
export class SvcTestRunWriter implements TestRunWriter {
  private static readonly DTO_TYPE = "handler-test";
  private static readonly SLUG = "handler-test";

  private readonly svcClient: SvcClient;
  private readonly env: string;
  private readonly handlerTestVersion: number;
  private readonly log: ILogger;

  constructor(options: {
    svcClient: SvcClient;
    env: string;
    handlerTestVersion: number;
    log: ILogger;
  }) {
    this.svcClient = options.svcClient;
    this.env = options.env;
    this.handlerTestVersion = options.handlerTestVersion;
    this.log = options.log;
  }

  public async startHandlerTest(record: HandlerTestRecord): Promise<void> {
    const dto = record.dto;
    const bag = new DtoBag([dto]);

    try {
      await this.svcClient.call({
        env: this.env,
        slug: SvcTestRunWriter.SLUG,
        version: this.handlerTestVersion,
        dtoType: SvcTestRunWriter.DTO_TYPE,
        op: "create",
        method: "PUT",
        bag,
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : String(err ?? "unknown error");

      this.log.error(
        {
          event: "svcTestRunWriter.startHandlerTest.failed",
          env: this.env,
          slug: SvcTestRunWriter.SLUG,
          version: this.handlerTestVersion,
          dtoType: SvcTestRunWriter.DTO_TYPE,
          handler: record.handlerName,
          indexRelativePath: record.indexRelativePath,
          testRunId: record.testRunId,
          stepIndex: record.stepIndex,
          stepCount: record.stepCount,
          error: msg,
        },
        "SvcTestRunWriter.startHandlerTest: S2S call failed"
      );

      throw err;
    }
  }

  public async finalizeHandlerTest(record: HandlerTestRecord): Promise<void> {
    const dto = record.dto;

    let id: string;
    if (!dto.hasId()) {
      const msg = "HandlerTestDto is missing an _id";
      const err = new Error(msg);
      this.log.error(
        {
          event: "svcTestRunWriter.finalizeHandlerTest.ensureId.failed",
          env: this.env,
          slug: SvcTestRunWriter.SLUG,
          version: this.handlerTestVersion,
          handler: record.handlerName,
          indexRelativePath: record.indexRelativePath,
          testRunId: record.testRunId,
          stepIndex: record.stepIndex,
          stepCount: record.stepCount,
          error: msg,
        },
        "SvcTestRunWriter.finalizeHandlerTest: dto.ensureId() failed"
      );
      throw err;
    }

    id = dto.getId();
    const bag = new DtoBag([dto]);

    try {
      await this.svcClient.call({
        env: this.env,
        slug: SvcTestRunWriter.SLUG,
        version: this.handlerTestVersion,
        dtoType: SvcTestRunWriter.DTO_TYPE,
        op: "update",
        method: "PATCH",
        id,
        bag,
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : String(err ?? "unknown error");

      this.log.error(
        {
          event: "svcTestRunWriter.finalizeHandlerTest.failed",
          env: this.env,
          slug: SvcTestRunWriter.SLUG,
          version: this.handlerTestVersion,
          dtoType: SvcTestRunWriter.DTO_TYPE,
          id,
          handler: record.handlerName,
          indexRelativePath: record.indexRelativePath,
          testRunId: record.testRunId,
          stepIndex: record.stepIndex,
          stepCount: record.stepCount,
          terminalStatus: record.terminalStatus,
          errorMessage: record.errorMessage,
          error: msg,
        },
        "SvcTestRunWriter.finalizeHandlerTest: S2S call failed"
      );

      throw err;
    }
  }
}
