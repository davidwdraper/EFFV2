// backend/services/shared/src/dto/persistence/dbWriter/DbWriter.mockWorker.ts
/**
 * Docs:
 * - ADR-0040/41/42/43 (DTO-first, handlers, context bus, failure propagation)
 * - ADR-0048 (Writers accept DtoBag only)
 * - ADR-0053 (Bag Purity — return DTOs, not wire)
 * - ADR-0057 (IDs are UUIDv4; assign BEFORE toBody; immutable thereafter)
 * - ADR-0072 (Edge Mode Factory — Root Env Switches; mock DbWriter worker)
 *
 * Purpose:
 * - In-memory / no-op implementation of IDbWriterWorker<TDto> used in mock modes.
 * - Never touches Mongo; stamps meta only.
 *
 * Critical invariant (ADR-0057):
 * - DbWriter workers MUST NOT mint ids. Identity must be assigned upstream.
 */

import type { DtoBase } from "../../DtoBase";
import type { ILogger } from "../../../logger/Logger";
import { DtoBag } from "../../../dto/DtoBag";
import type { IDbWriterWorker } from "./DbWriter";

function requireSingleton<TDto extends DtoBase>(
  bag: DtoBag<TDto>,
  op: "write" | "update"
): TDto {
  const items = Array.from(bag.items());
  if (items.length !== 1) {
    const msg =
      items.length === 0
        ? `${op}: singleton bag required; received 0 items`
        : `${op}: singleton bag required; received ${items.length} items`;
    throw new Error(`DBWRITER_MOCK_SINGLETON_REQUIRED: ${msg}`);
  }
  return items[0] as TDto;
}

function requireId(
  base: DtoBase,
  op: "write" | "writeMany" | "update"
): string {
  const id = String(base.getId() ?? "").trim();
  if (!id) {
    throw new Error(
      `DBWRITER_MOCK_ID_REQUIRED: ${op} requires canonical id to be assigned upstream (ADR-0057).`
    );
  }
  return id;
}

export class DbWriterMockWorker<TDto extends DtoBase>
  implements IDbWriterWorker<TDto>
{
  private readonly bag: DtoBag<TDto>;
  private readonly log: ILogger;
  private readonly userId?: string;

  constructor(params: { bag: DtoBag<TDto>; log: ILogger; userId?: string }) {
    this.bag = params.bag;
    this.log = params.log;
    this.userId = params.userId;
  }

  /** Introspection hook for handlers to log target collection. */
  public async targetInfo(): Promise<{ collectionName: string }> {
    const dto = requireSingleton(this.bag, "write");
    const collectionName = (dto as DtoBase).requireCollectionName();
    return { collectionName };
  }

  /**
   * Mock insert of a single DTO from the singleton bag.
   * Stamps meta only; never mints ids.
   */
  public async write(): Promise<DtoBag<TDto>> {
    const dto = requireSingleton(this.bag, "write");
    const base = dto as DtoBase;

    // must already exist (no minting in worker)
    const id = requireId(base, "write");

    base.stampCreatedAt();
    base.stampOwnerUserId(this.userId);
    base.stampUpdatedAt(this.userId);

    const collectionName = base.requireCollectionName();
    this.log.info(
      {
        collection: collectionName,
        id,
      },
      "dbwriter-mock: write() simulated (no DB I/O)"
    );

    return new DtoBag<TDto>([dto]);
  }

  /**
   * Mock batch insert.
   * Stamps meta only; never mints ids.
   */
  public async writeMany(bag?: DtoBag<TDto>): Promise<DtoBag<TDto>> {
    const source = bag ?? this.bag;
    const inserted: TDto[] = [];

    for (const item of source.items()) {
      const dto = item as TDto;
      const base = dto as DtoBase;

      const id = requireId(base, "writeMany");

      base.stampCreatedAt();
      base.stampOwnerUserId(this.userId);
      base.stampUpdatedAt(this.userId);

      const collectionName = base.requireCollectionName();
      this.log.info(
        {
          collection: collectionName,
          id,
        },
        "dbwriter-mock: writeMany() simulated (no DB I/O)"
      );

      inserted.push(dto);
    }

    return new DtoBag<TDto>(inserted);
  }

  /**
   * Mock update:
   * - Requires DTO already has an id
   * - Stamps updatedAt
   * - Returns id without DB I/O
   */
  public async update(): Promise<{ id: string }> {
    const dto = requireSingleton(this.bag, "update");
    const base = dto as DtoBase;

    const id = requireId(base, "update");

    base.stampUpdatedAt(this.userId);

    const collectionName = base.requireCollectionName();
    this.log.info(
      {
        collection: collectionName,
        id,
      },
      "dbwriter-mock: update() simulated (no DB I/O)"
    );

    return { id };
  }
}
