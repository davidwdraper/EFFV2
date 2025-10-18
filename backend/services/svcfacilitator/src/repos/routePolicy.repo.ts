// backend/services/svcfacilitator/src/repos/routePolicy.repo.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: env invariance; single-concern classes; DI everywhere
 * - ADR-0038 — Route Policy Gate at Gateway & Facilitator Endpoints
 * - ADR-0029 — Contract-ID + BodyHandler pipeline
 *
 * Purpose:
 * - Repository for routePolicies collection (Mongo).
 * - No env lookups here; DB is injected by the owning service.
 */

import type {
  Collection,
  Document,
  Filter,
  UpdateFilter,
  WithId,
} from "mongodb";
import { ObjectId } from "mongodb";
import { DbClient } from "@nv/shared/db/DbClient";
import {
  RoutePolicyDto,
  RoutePolicyCreate,
  RoutePolicyGetRequest,
  type HttpMethod,
} from "@nv/shared/contracts/routePolicy.contract";

type RoutePolicyDoc = {
  _id: ObjectId;
  svcconfigId: ObjectId;
  version: number;
  method: HttpMethod;
  path: string;
  minAccessLevel: number;
  createdAt: string;
  updatedAt: string;
};

export class RoutePolicyRepo {
  private readonly db: DbClient;
  private _coll?: Collection<RoutePolicyDoc>;
  private _indexesEnsured = false;

  /** DI: service passes a ready DbClient it owns. */
  public constructor(dbClient: DbClient) {
    this.db = dbClient;
  }

  /** Lazily connect and return the collection. */
  private async coll(): Promise<Collection<RoutePolicyDoc>> {
    if (this._coll) return this._coll;
    const c = (await this.db.getCollection<RoutePolicyDoc>(
      "routePolicies"
    )) as Collection<RoutePolicyDoc>;
    this._coll = c;
    await this.ensureIndexes(c);
    return c;
  }

  /** Ensure uniqueness index exists (idempotent). */
  private async ensureIndexes(c: Collection<RoutePolicyDoc>): Promise<void> {
    if (this._indexesEnsured) return;
    await c.createIndex(
      { svcconfigId: 1, version: 1, method: 1, path: 1 },
      { unique: true, name: "uniq_svc_ver_method_path" }
    );
    this._indexesEnsured = true;
  }

  private toDto(doc: RoutePolicyDoc): RoutePolicyDto {
    return {
      _id: doc._id.toHexString(),
      svcconfigId: doc.svcconfigId.toHexString(),
      version: doc.version,
      method: doc.method,
      path: doc.path,
      minAccessLevel: doc.minAccessLevel,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  public async findOneByKey(
    req: RoutePolicyGetRequest
  ): Promise<RoutePolicyDto | null> {
    const c = await this.coll();
    const doc = await c.findOne({
      svcconfigId: new ObjectId(req.svcconfigId),
      version: req.version,
      method: req.method,
      path: req.path,
    } as Document);
    return doc ? this.toDto(doc) : null;
  }

  public async createOne(body: RoutePolicyCreate): Promise<RoutePolicyDto> {
    const c = await this.coll();
    const now = new Date().toISOString();

    const toInsert: RoutePolicyDoc = {
      _id: new ObjectId(),
      svcconfigId: new ObjectId(body.svcconfigId),
      version: body.version,
      method: body.method,
      path: body.path,
      minAccessLevel: body.minAccessLevel,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await c.insertOne(toInsert);
      return this.toDto(toInsert);
    } catch (err: any) {
      if (
        err &&
        (err.code === 11000 || String(err?.message ?? "").includes("E11000"))
      ) {
        const e = new Error("duplicate_route_policy");
        (e as any).httpStatus = 409;
        (e as any).detail = {
          key: {
            svcconfigId: body.svcconfigId,
            version: body.version,
            method: body.method,
            path: body.path,
          },
        };
        throw e;
      }
      throw err;
    }
  }

  public async updateMinAccessLevel(
    id: string,
    minAccessLevel: number
  ): Promise<RoutePolicyDto | null> {
    const c = await this.coll();
    const _id = new ObjectId(id);
    const now = new Date().toISOString();

    const filter: Filter<RoutePolicyDoc> = { _id };
    const update: UpdateFilter<RoutePolicyDoc> = {
      $set: { minAccessLevel, updatedAt: now },
    };

    // Driver returns either { value?: WithId<T>|null } or directly WithId<T>|null across versions.
    const result: any = await c.findOneAndUpdate(filter, update, {
      returnDocument: "after",
    });

    const doc: WithId<RoutePolicyDoc> | null =
      (result && typeof result === "object" && "value" in result
        ? (result.value as WithId<RoutePolicyDoc> | null | undefined)
        : (result as WithId<RoutePolicyDoc> | null)) ?? null;

    return doc ? this.toDto(doc) : null;
  }
}
