// backend/services/shared/src/dto/persistence/dbWriter/DbWriter.ts
/**
 * Docs:
 * - ADR-0040/41/42/43 (DTO-first, handlers, context bus, failure propagation)
 * - ADR-0048 (Writers accept DtoBag only)
 * - ADR-0053 (Bag Purity — return DTOs, not wire)
 * - ADR-0057 (IDs are canonical; immutable; never minted by DbWriter)
 * - ADR-0104 (Drop getType(); replace with getDtoKey(); cloning via dtoKey)
 * - ADR-0074 (DB_STATE guardrail, getDbVar())
 * - ADR-0106 (Lazy index ensure via persistence IndexGate)
 *
 * Purpose:
 * - Public DbWriter<TDto> facade used by handlers.
 * - DbWriter NEVER mints ids.
 * - DbWriter enforces a final invariant check:
 *     dto.isValidOwnId() MUST be true.
 *
 * ADR-0106:
 * - This facade MUST ensure indexes via rt.getCap("db.indexGate") before DB ops.
 * - This facade MUST source DB config via SvcRuntime (no param sprawl).
 */

import type { DtoBase } from "../../DtoBase";
import type { ILogger } from "../../../logger/Logger";
import { DtoBag } from "../../../dto/DtoBag";
import { MongoDbWriterWorker, consoleLogger } from "./DbWriter.mongoWorker";
import { DbWriterMockWorker } from "./DbWriter.mockWorker";
import { resolveDbWriterMode } from "./DbWriter.edgeMode";
import type { SvcRuntime } from "../../../runtime/SvcRuntime";
import type { IIndexGate } from "../indexes/IndexGate";

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

/**
 * Handler-facing DTO ctor contract (ADR-0106):
 * - Handlers MUST NOT mention index concepts/types.
 * - DbWriter accepts a minimal ctor for collection targeting; index contracts
 *   are validated internally and used only at the DB boundary.
 */
export type DbWriteDtoCtor<TDto extends DtoBase> = {
  dbCollectionName: () => string;
  name?: string;
};

/** Internal-only contract required to interact with IndexGate (ADR-0106). */
type DbWriteDtoCtorWithIndex<TDto extends DtoBase> = DbWriteDtoCtor<TDto> & {
  indexHints: ReadonlyArray<unknown>;
};

export interface DbWriterConstructorParams<TDto extends DtoBase> {
  rt: SvcRuntime;
  dtoCtor: DbWriteDtoCtor<TDto>;
  bag: DtoBag<TDto>;
  log?: ILogger;
  userId?: string;
  worker?: IDbWriterWorker<TDto>;
  /**
   * Existing edge-mode switch (kept for now).
   * When present, mode decision uses rt.getDbState().
   */
  mockMode?: boolean;
}

export class DbWriter<TDto extends DtoBase> {
  private readonly worker: IDbWriterWorker<TDto>;
  private readonly bag: DtoBag<TDto>;
  private readonly log: ILogger;
  private readonly rt: SvcRuntime;

  // Keep both views:
  // - handler-facing (no index typing)
  // - internal (validated to include indexHints)
  private readonly dtoCtor: DbWriteDtoCtor<TDto>;
  private readonly dtoCtorWithIndex: DbWriteDtoCtorWithIndex<TDto>;

  constructor(params: DbWriterConstructorParams<TDto>) {
    this.rt = params.rt;
    this.dtoCtor = params.dtoCtor;

    // Validate once up-front so ensureIndexes() can call IndexGate safely.
    this.dtoCtorWithIndex = this.requireDtoIndexContract(params.dtoCtor);

    this.bag = params.bag;
    this.log = params.log ?? consoleLogger({ component: "DbWriter" });

    if (params.worker) {
      this.worker = params.worker;
      return;
    }

    const mongoUri = this.rt.getDbVar("NV_MONGO_URI");
    const mongoDb = this.rt.getDbVar("NV_MONGO_DB");

    // Keep existing edge-mode semantics for now; decision inputs come from runtime.
    if (typeof params.mockMode === "boolean") {
      const decision = resolveDbWriterMode({
        dbState: this.rt.getDbState(),
        mockMode: params.mockMode,
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
              mongoUri,
              mongoDb,
              log: this.log,
              userId: params.userId,
            });

      return;
    }

    this.worker = new MongoDbWriterWorker<TDto>({
      bag: params.bag,
      mongoUri,
      mongoDb,
      log: this.log,
      userId: params.userId,
    });
  }

  /** ADR-0106: ensure indexes before any DB operation. */
  private async ensureIndexes(): Promise<void> {
    const gate = this.rt.getCap<IIndexGate>("db.indexGate");
    await gate.ensureForDtoCtor(this.dtoCtorWithIndex as unknown as any);
  }

  /**
   * ADR-0106: Runtime contract enforcement (handler must remain ignorant).
   * Throws actionable errors if a non-DB DTO (or malformed ctor) is used at the DB boundary.
   */
  private requireDtoIndexContract(
    dtoCtor: DbWriteDtoCtor<TDto>
  ): DbWriteDtoCtorWithIndex<TDto> {
    const name = this.safeCtorName(dtoCtor);

    if (!dtoCtor || typeof dtoCtor !== "object") {
      throw new Error(
        `DbWriter(dtoCtor): expected an object ctor, got ${typeof dtoCtor} (dto=${name}).`
      );
    }
    if (typeof dtoCtor.dbCollectionName !== "function") {
      throw new Error(
        `DbWriter(dtoCtor): missing dbCollectionName() function (dto=${name}).`
      );
    }

    const anyCtor = dtoCtor as unknown as { indexHints?: unknown };
    const hints = anyCtor.indexHints;

    if (!Array.isArray(hints)) {
      throw new Error(
        `DbWriter(dtoCtor): DTO is missing index contract (indexHints[]). ` +
          `Only DB DTOs are valid for persistence ops. (dto=${name}, collection=${dtoCtor.dbCollectionName()})`
      );
    }

    return dtoCtor as unknown as DbWriteDtoCtorWithIndex<TDto>;
  }

  private safeCtorName(dtoCtor: DbWriteDtoCtor<TDto>): string {
    try {
      return (dtoCtor as any)?.name ?? "unknown";
    } catch {
      return "unknown";
    }
  }

  /** Introspection hook for handlers to log target collection. */
  public async targetInfo(): Promise<{ collectionName: string }> {
    await this.ensureIndexes();
    return this.worker.targetInfo();
  }

  /** Insert a single DTO. */
  public async write(): Promise<DtoBag<TDto>> {
    await this.ensureIndexes();
    this.assertDtosHaveValidIds(this.bag, "write");
    return this.worker.write();
  }

  /** Batch insert. */
  public async writeMany(bag?: DtoBag<TDto>): Promise<DtoBag<TDto>> {
    await this.ensureIndexes();
    this.assertDtosHaveValidIds(bag ?? this.bag, "writeMany");
    return this.worker.writeMany(bag);
  }

  /** Update by canonical id. */
  public async update(): Promise<{ id: string }> {
    await this.ensureIndexes();
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
