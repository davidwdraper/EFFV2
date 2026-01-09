// backend/services/shared/src/dto/persistence/dbWriter/DbWriter.ts
/**
 * Docs:
 * - ADR-0040/41/42/43 (DTO-first, handlers, context bus, failure propagation)
 * - ADR-0048 (Writers accept DtoBag only)
 * - ADR-0053 (Bag Purity — return DTOs, not wire)
 * - ADR-0057 (IDs are canonical; immutable; never minted by DbWriter)
 * - ADR-0104 (Drop getType(); replace with getDtoKey(); cloning via dtoKey)
 *
 * Purpose:
 * - Public DbWriter<TDto> facade used by handlers.
 * - DbWriter NEVER mints ids.
 * - DbWriter performs a final invariant check only:
 *     dto.isValidOwnId() MUST be true.
 *
 * If this fails, upstream rails are broken — and we fail fast.
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

export class DbWriterMissingIdError extends Error {
  public readonly httpStatus = 400;
  public readonly code = "DBWRITER_ID_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "DbWriterMissingIdError";
  }
}

export interface DbWriterConstructorParams<TDto extends DtoBase> {
  bag: DtoBag<TDto>;
  mongoUri: string;
  mongoDb: string;
  log?: ILogger;
  userId?: string;
  worker?: IDbWriterWorker<TDto>;
  dbState?: string;
  mockMode?: boolean;
}

export class DbWriter<TDto extends DtoBase> {
  private readonly worker: IDbWriterWorker<TDto>;
  private readonly bag: DtoBag<TDto>;
  private readonly log: ILogger;

  constructor(params: DbWriterConstructorParams<TDto>) {
    this.bag = params.bag;
    this.log = params.log ?? consoleLogger({ component: "DbWriter" });

    if (params.worker) {
      this.worker = params.worker;
      return;
    }

    const hasDbState =
      typeof params.dbState === "string" && params.dbState.trim() !== "";
    const hasMockMode = typeof params.mockMode === "boolean";

    if (hasDbState !== hasMockMode) {
      throw new Error(
        "DBWRITER_EDGE_MODE_CONFIG_INVALID: dbState and mockMode must be supplied together."
      );
    }

    if (hasDbState && hasMockMode) {
      const decision = resolveDbWriterMode({
        dbState: params.dbState as string,
        mockMode: params.mockMode as boolean,
      });

      if (!decision.ok) {
        throw new Error("DBWRITER_EDGE_MODE_BLOCKED: " + decision.reason);
      }

      this.worker =
        decision.mode === "mock"
          ? new DbWriterMockWorker<TDto>({
              bag: params.bag,
              log: this.log,
              userId: params.userId,
            })
          : new MongoDbWriterWorker<TDto>({
              bag: params.bag,
              mongoUri: params.mongoUri,
              mongoDb: params.mongoDb,
              log: this.log,
              userId: params.userId,
            });

      return;
    }

    this.worker = new MongoDbWriterWorker<TDto>({
      bag: params.bag,
      mongoUri: params.mongoUri,
      mongoDb: params.mongoDb,
      log: this.log,
      userId: params.userId,
    });
  }

  /** Introspection hook for handlers to log target collection. */
  public async targetInfo(): Promise<{ collectionName: string }> {
    return this.worker.targetInfo();
  }

  /** Insert a single DTO. */
  public async write(): Promise<DtoBag<TDto>> {
    this.assertDtosHaveValidIds(this.bag, "write");
    return this.worker.write();
  }

  /** Batch insert. */
  public async writeMany(bag?: DtoBag<TDto>): Promise<DtoBag<TDto>> {
    this.assertDtosHaveValidIds(bag ?? this.bag, "writeMany");
    return this.worker.writeMany(bag);
  }

  /** Update by canonical id. */
  public async update(): Promise<{ id: string }> {
    this.assertDtosHaveValidIds(this.bag, "update");
    return this.worker.update();
  }

  // ───────────────────────────────────────────
  // KISS invariant enforcement
  // ───────────────────────────────────────────

  private assertDtosHaveValidIds(
    bag: DtoBag<TDto>,
    op: "write" | "writeMany" | "update"
  ): void {
    for (const dto of bag.items()) {
      if (!dto.isValidOwnId()) {
        this.log.error(
          {
            op,
            dtoKey: dto.getDtoKey(),
          },
          "DbWriter received DTO with missing or invalid _id; refusing persistence."
        );

        throw new DbWriterMissingIdError(
          `DbWriter ${op} requires DTO to already have a valid canonical _id. ` +
            `This indicates a broken upstream invariant (ADR-0102 / ADR-0057).`
        );
      }
    }
  }
}

/**
 * Re-export DuplicateKeyError so existing imports remain valid.
 */
export { DuplicateKeyError } from "../adapters/mongo/dupeKeyError";
