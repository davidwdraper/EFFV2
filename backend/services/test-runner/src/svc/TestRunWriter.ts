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
 * - Writer ONLY sees HandlerTestDto instances.
 * - Identity comes from the DTO (dto.id / dto._id), not from external ids.
 * - Wire envelope is produced via DtoBag.toBody() per ADR-0047/0050/0069.
 */

import type { HandlerTestDto } from "@nv/shared/dto/handler-test.dto";
import type { HandlerTestResult } from "@nv/shared/http/handlers/testing/HandlerTestBase";
import type { ILogger } from "@nv/shared/logger/Logger";
import { DtoBag } from "@nv/shared/dto/DtoBag";
import { SvcClient } from "@nv/shared/s2s/SvcClient";
import type { WireBagJson } from "@nv/shared/s2s/SvcClient";

// ─────────────────────────────────────────────────────────────
// Public contract
// ─────────────────────────────────────────────────────────────

/**
 * StepIterator’s view of handler-test terminal status.
 * These are pure classification labels; no semantics baked in.
 */
export type TestHandlerTerminalStatus =
  | "Passed"
  | "Failed"
  | "TestError"
  | "RailError";

/**
 * Optional helper type if you want to stash the raw test result
 * on the DTO (e.g. dto.rawResultJson).
 */
export type TestHandlerResultPayload = HandlerTestResult | undefined;

/**
 * Minimal contract.
 *
 * StepIterator lifecycle per opted-in handler:
 *   1) Mint HandlerTestDto via shared registry.
 *   2) Seed DTO with known metadata (run id, handler name, path, etc).
 *   3) await writer.startHandlerTest(dto)   // insert initial record
 *   4) Pass dto into handler.runTest(dto)   // handler mutates scenario-specific fields
 *   5) Patch dto with terminal status/duration/error info.
 *   6) await writer.finalizeHandlerTest(dto) // update record
 *
 * Writer implementation MAY:
 *   - bag the DTO for transport,
 *   - call handler-test via SvcClient,
 *   - mutate dto.id/_id based on DB insert responses.
 */
export interface TestRunWriter {
  /**
   * Persist the initial state of a handler-test record.
   *
   * Called exactly once per opted-in handler BEFORE runTest() executes.
   * Implementations may:
   *   - insert the record in DB,
   *   - set dto.id/dto._id from DB/S2S response,
   *   - perform any internal enrichment needed for later updates.
   */
  startHandlerTest(dto: HandlerTestDto): Promise<void>;

  /**
   * Persist the finalized state of a handler-test record.
   *
   * Called exactly once per opted-in handler AFTER runTest() completes
   * (or throws). The DTO already contains:
   *   - all the startup metadata,
   *   - any scenario-specific fields mutated by the handler’s test,
   *   - terminalStatus / durationMs / error details set by StepIterator.
   */
  finalizeHandlerTest(dto: HandlerTestDto): Promise<void>;
}

// ─────────────────────────────────────────────────────────────
// SvcClient-backed writer
// ─────────────────────────────────────────────────────────────

/**
 * SvcTestRunWriter:
 * - Uses SvcClient.call() to talk to the handler-test service.
 * - Uses handler-test's CRUD routes:
 *   - PUT   /api/handler-test/v1/handler-test/create
 *   - PATCH /api/handler-test/v1/handler-test/update/:id
 *
 * Notes:
 * - dtoType is "handler-test" (registry key).
 * - slug is "handler-test"; version is injected via constructor.
 * - env is injected via constructor (same env as test-runner).
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

  /**
   * Start a handler-test record via:
   *   PUT /api/handler-test/v1/handler-test/create
   *
   * Behavior:
   * - Ensures required HandlerTestDto fields (e.g. env) are populated from
   *   the writer's env before hydration on the handler-test service.
   * - Wraps the DTO in a DtoBag singleton and passes bag to SvcClient.call().
   *   DtoBag.toBody() produces the canonical envelope:
   *     { items: [ dto.toBody(), ... ], meta: { count, dtoType? } }
   * - Expects a WireBagJson back.
   * - Extracts the assigned id from the first item and mirrors it into
   *   dto.id/dto._id so finalize() can PATCH the same document.
   */
  public async startHandlerTest(dto: HandlerTestDto): Promise<void> {
    const anyDto = dto as any;

    // Ensure env is present for handler-test DTOs.
    // HandlerTestDto's check() contract expects a non-empty string env.
    if (typeof anyDto.env !== "string" || anyDto.env.trim().length === 0) {
      anyDto.env = this.env;
    }

    const bag = new DtoBag([dto]);

    let response: WireBagJson;
    try {
      response = await this.svcClient.call({
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
          error: msg,
        },
        "SvcTestRunWriter.startHandlerTest: S2S call failed"
      );

      throw err;
    }

    // Extract assigned id from response and mirror onto the DTO.
    const assignedId = this.extractIdFromWireBag(response);
    if (!assignedId) {
      this.log.warn(
        {
          event: "svcTestRunWriter.startHandlerTest.noId",
          env: this.env,
          slug: SvcTestRunWriter.SLUG,
          version: this.handlerTestVersion,
        },
        "SvcTestRunWriter.startHandlerTest: no id found in handler-test response"
      );
      return;
    }

    // Mirror onto DTO (support both id and _id shapes, depending on HandlerTestDto).
    (dto as any).id = assignedId;
    if ((dto as any)._id === undefined) {
      (dto as any)._id = assignedId;
    }
  }

  /**
   * Finalize a handler-test record via:
   *   PATCH /api/handler-test/v1/handler-test/update/:id
   *
   * Behavior:
   * - Requires dto.id (or dto._id) to be set; otherwise throws.
   * - Wraps the DTO in a DtoBag singleton and passes bag to SvcClient.call().
   * - Ignores response body; the run summary will be built elsewhere.
   */
  public async finalizeHandlerTest(dto: HandlerTestDto): Promise<void> {
    const id = this.getDtoId(dto);
    if (!id) {
      const msg =
        "SvcTestRunWriter.finalizeHandlerTest: DTO is missing id/_id; cannot PATCH handler-test record.";
      this.log.error(
        {
          event: "svcTestRunWriter.finalizeHandlerTest.missingId",
          env: this.env,
          slug: SvcTestRunWriter.SLUG,
          version: this.handlerTestVersion,
        },
        msg
      );
      throw new Error(msg);
    }

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
          error: msg,
        },
        "SvcTestRunWriter.finalizeHandlerTest: S2S call failed"
      );

      throw err;
    }
  }

  // ─────────────── Internals ───────────────

  /**
   * Extract the assigned id from a WireBagJson response from handler-test.
   *
   * Expected shapes (outer envelope):
   *   {
   *     items: [ itemBody, ... ],
   *     meta: { count, dtoType? }
   *   }
   *
   * Where itemBody is whatever HandlerTestDto.toBody() emits. For DTOs that
   * follow the BagItemWire pattern, that's typically:
   *   { type: "handler-test", item: { _id: "...", ... } }
   *
   * We look for _id or id at the top level OR one level down under "item".
   */
  private extractIdFromWireBag(
    bag: WireBagJson | undefined
  ): string | undefined {
    if (!bag || typeof bag !== "object") return undefined;

    const anyBag = bag as any;
    const items = Array.isArray(anyBag.items) ? anyBag.items : undefined;
    if (!items || items.length === 0) return undefined;

    const first = items[0];
    if (!first || typeof first !== "object") return undefined;

    // Try both direct and nested under .item
    const topId = (first as any)._id ?? (first as any).id;
    if (typeof topId === "string" && topId.trim().length > 0) {
      return topId.trim();
    }

    const payload = (first as any).item;
    if (!payload || typeof payload !== "object") return undefined;

    const rawId = (payload as any)._id ?? (payload as any).id;
    if (typeof rawId !== "string") return undefined;

    const trimmed = rawId.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  /**
   * Derive the DTO id for PATCH /update/:id.
   *
   * Supports both dto.id and dto._id shapes.
   */
  private getDtoId(dto: HandlerTestDto): string | undefined {
    const anyDto = dto as any;
    const rawId = (anyDto.id ?? anyDto._id) as unknown;
    if (typeof rawId !== "string") return undefined;
    const trimmed = rawId.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
}
