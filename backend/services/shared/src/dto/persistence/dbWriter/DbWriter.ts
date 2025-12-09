// backend/services/shared/src/dto/persistence/DbWriter.ts
/**
 * Docs:
 * - ADR-0040/41/42/43 (DTO-first, handlers, context bus, failure propagation)
 * - ADR-0045 (Index Hints ensured at boot)
 * - ADR-0048 (Writers accept DtoBag only)
 * - ADR-0053 (Bag Purity — return DTOs, not wire)
 * - ADR-0057 (IDs are UUIDv4; assign BEFORE toBody; immutable thereafter)
 * - ADR-0072 (Edge Mode Factory — Root Env Switches) [future mock injection]
 *
 * Purpose:
 * - Public DbWriter<TDto> facade used by handlers.
 * - Exposes the original API (ctor + write/writeMany/update/targetInfo) while
 *   delegating to an IDbWriterWorker<TDto> internally.
 * - Default worker is MongoDbWriterWorker<TDto>, preserving existing behavior.
 * - Future Db-mock / full-mock workers can be injected via the optional
 *   `worker` parameter without changing handler call sites.
 */

import type { DtoBase } from "../../DtoBase";
import type { ILogger } from "../../../logger/Logger";
import { DtoBag } from "../../../dto/DtoBag";
import { MongoDbWriterWorker, consoleLogger } from "./DbWriter.mongoWorker";

export interface IDbWriterWorker<TDto extends DtoBase> {
  targetInfo(): Promise<{ collectionName: string }>;
  write(): Promise<DtoBag<TDto>>;
  writeMany(bag?: DtoBag<TDto>): Promise<DtoBag<TDto>>;
  update(): Promise<{ id: string }>;
}

export class DbWriter<TDto extends DtoBase> {
  private readonly worker: IDbWriterWorker<TDto>;

  constructor(params: {
    bag: DtoBag<TDto>;
    mongoUri: string;
    mongoDb: string;
    log?: ILogger;
    userId?: string;
    /**
     * Optional custom worker implementing IDbWriterWorker<TDto>.
     * - When omitted, DbWriter uses MongoDbWriterWorker<TDto>, preserving
     *   the existing Mongo-backed behavior.
     * - The test engine and future mock modes can inject their own workers
     *   here without changing handler call sites.
     */
    worker?: IDbWriterWorker<TDto>;
  }) {
    const log = params.log ?? consoleLogger({ component: "DbWriter" });

    this.worker =
      params.worker ??
      new MongoDbWriterWorker<TDto>({
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
