// backend/services/shared/src/dto/persistence/dbWriter/DbWriter.ts
/**
 * Docs:
 * - ADR-0040/41/42/43 (DTO-first, handlers, context bus, failure propagation)
 * - ADR-0045 (Index Hints ensured at boot)
 * - ADR-0048 (Writers accept DtoBag only)
 * - ADR-0053 (Bag Purity — return DTOs, not wire)
 * - ADR-0057 (IDs are UUIDv4; assign BEFORE toBody; immutable thereafter)
 * - ADR-0070 (DbDto/MemDto hierarchy — DB_STATE patterns)
 * - ADR-0072 (Edge Mode Factory — Root Env Switches; mock vs real DbWriter worker)
 *
 * Purpose:
 * - Public DbWriter<TDto> facade used by handlers.
 * - Exposes ctor + write/writeMany/update/targetInfo while delegating to an
 *   IDbWriterWorker<TDto> internally.
 * - Default behavior uses MongoDbWriterWorker<TDto>.
 * - When dbState + mockMode are supplied (and no explicit worker is given),
 *   DbWriter selects mock vs real worker via resolveDbWriterMode(), enforcing
 *   DB safety rules centrally.
 */

import type { DtoBase } from "../../DtoBase";
import type { ILogger } from "../../../logger/Logger";
import { DtoBag } from "../../../dto/DtoBag";
import { MongoDbWriterWorker, consoleLogger } from "./DbWriter.mongoWorker";
import { DbWriterMockWorker } from "./DbWriter.mockWorker";
import { resolveDbWriterMode } from "./DbWriter.edgeMode";

export interface IDbWriterWorker<TDto extends DtoBase> {
  targetInfo(): Promise<{ collectionName: string }>;
  write(): Promise<DtoBag<TDto>>;
  writeMany(bag?: DtoBag<TDto>): Promise<DtoBag<TDto>>;
  update(): Promise<{ id: string }>;
}

/**
 * Error used when DbWriter's edge-mode configuration is invalid or unsafe.
 * - httpStatus=409 so the error sink can surface a proper Problem+JSON
 *   "configuration conflict" instead of a generic 500.
 */
export class DbWriterEdgeModeConfigError extends Error {
  public readonly httpStatus = 409;
  public readonly code = "DBWRITER_EDGE_MODE_CONFIG_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "DbWriterEdgeModeConfigError";
  }
}

export interface DbWriterConstructorParams<TDto extends DtoBase> {
  bag: DtoBag<TDto>;
  mongoUri: string;
  mongoDb: string;
  log?: ILogger;
  userId?: string;

  /**
   * Explicit worker injection.
   * - If provided, DbWriter uses this worker as-is and does not apply
   *   edge-mode logic.
   */
  worker?: IDbWriterWorker<TDto>;

  /**
   * Edge-mode configuration.
   *
   * Semantics:
   * - If neither dbState nor mockMode is provided, DbWriter uses
   *   MongoDbWriterWorker directly (no edge-mode).
   * - If either dbState or mockMode is provided (but not both), DbWriter:
   *     • logs a WARN,
   *     • throws DbWriterEdgeModeConfigError (httpStatus=409).
   * - If both dbState and mockMode are provided, DbWriter:
   *     • calls resolveDbWriterMode({ dbState, mockMode }),
   *     • logs and throws DbWriterEdgeModeConfigError if blocked,
   *     • otherwise picks DbWriterMockWorker or MongoDbWriterWorker.
   */
  dbState?: string;
  mockMode?: boolean;
}

export class DbWriter<TDto extends DtoBase> {
  private readonly worker: IDbWriterWorker<TDto>;

  constructor(params: DbWriterConstructorParams<TDto>) {
    const log = params.log ?? consoleLogger({ component: "DbWriter" });

    // 1) If a custom worker is injected, honor it and skip edge-mode logic.
    if (params.worker) {
      this.worker = params.worker;
      return;
    }

    // 2) Edge-mode semantics: both dbState and mockMode are required if
    //    either is provided. Partial config is treated as a 409 conflict.
    const hasDbState =
      typeof params.dbState === "string" && params.dbState.trim() !== "";
    const hasMockMode = typeof params.mockMode === "boolean";
    const anyEdgeConfig = hasDbState || hasMockMode;

    if (anyEdgeConfig && (!hasDbState || !hasMockMode)) {
      log.warn(
        {
          dbState: params.dbState,
          mockMode: params.mockMode,
        },
        "DbWriter: invalid edge-mode configuration (dbState and mockMode must both be supplied when using edge-mode)."
      );

      throw new DbWriterEdgeModeConfigError(
        "DbWriter edge-mode configuration is invalid: both DB_STATE (dbState) and DB_MOCKING-derived mockMode are required when constructing DbWriter with edge-mode. " +
          "Ops: ensure DB_STATE and DB_MOCKING are defined in env-service for this service/version and that mockMode is computed from DB_MOCKING before constructing DbWriter."
      );
    }

    if (hasDbState && hasMockMode) {
      const decision = resolveDbWriterMode({
        dbState: params.dbState as string,
        mockMode: params.mockMode as boolean,
      });

      if (!decision.ok) {
        log.warn(
          {
            dbState: params.dbState,
            mockMode: params.mockMode,
            reason: decision.reason,
          },
          "DbWriter: edge-mode safety block; refusing to perform DB writes for this configuration."
        );

        throw new DbWriterEdgeModeConfigError(
          "DbWriter edge-mode safety block: " +
            decision.reason +
            " Ops: adjust DB_STATE and DB_MOCKING in env-service so that writes are directed only at safe, non-prod databases, " +
            'and ensure DB_STATE is set to values like "smoke" or "testsuite" for non-mocked test runs.'
        );
      }

      if (decision.mode === "mock") {
        this.worker = new DbWriterMockWorker<TDto>({
          bag: params.bag,
          log,
          userId: params.userId,
        });
        return;
      }

      // decision.mode === "real"
      this.worker = new MongoDbWriterWorker<TDto>({
        bag: params.bag,
        mongoUri: params.mongoUri,
        mongoDb: params.mongoDb,
        log,
        userId: params.userId,
      });
      return;
    }

    // 3) No edge-mode configuration supplied at all:
    //    use MongoDbWriterWorker directly.
    this.worker = new MongoDbWriterWorker<TDto>({
      bag: params.bag,
      mongoUri: params.mongoUri,
      mongoDb: params.mongoDb,
      log,
      userId: params.userId,
    });
  }

  /** Introspection hook for handlers to log target collection. */
  public async targetInfo(): Promise<{ collectionName: string }> {
    return this.worker.targetInfo();
  }

  /**
   * Insert a single DTO from the singleton bag.
   * Assign meta + id BEFORE toBody.
   */
  public async write(): Promise<DtoBag<TDto>> {
    return this.worker.write();
  }

  /**
   * Batch insert with per-item duplicate handling.
   * Returns a DtoBag containing all successfully inserted DTOs (with any retried clones).
   */
  public async writeMany(bag?: DtoBag<TDto>): Promise<DtoBag<TDto>> {
    return this.worker.writeMany(bag);
  }

  /** Update by canonical id (no id mutation). */
  public async update(): Promise<{ id: string }> {
    return this.worker.update();
  }
}

/**
 * Re-export DuplicateKeyError so existing imports from "DbWriter" continue to
 * work without touching call sites.
 */
export { DuplicateKeyError } from "../adapters/mongo/dupeKeyError";
