// backend/services/svcfacilitator/src/controllers/routePolicy.controller.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0038 — Route Policy Gate at Gateway & Facilitator Endpoints
 *   - ADR-0029 — Contract-ID + BodyHandler pipeline
 *   - ADR-0019 — Class Routers via RouterBase
 *
 * Purpose:
 * - Real (DB-backed) controllers for RoutePolicy CRUD.
 * - Controller stays thin: validate → repo → DTO → envelope.
 *
 * Invariants:
 * - Requests are flat; responses enveloped by ControllerBase adapter.
 * - Exact-match policy key: (svcconfigId, version, method, path).
 * - No env reads here; DB client is constructed by the owning service and injected (DI).
 */

import type { RequestHandler } from "express";
import { ControllerBase } from "@nv/shared/base/ControllerBase";
import {
  RoutePolicyCreate,
  RoutePolicyDto,
  RoutePolicyGetRequest,
  RoutePolicyUpdateRequest,
  normalizeMethod,
  normalizePath,
} from "@nv/shared/contracts/routePolicy.contract";
import { RoutePolicyRepo } from "../repos/routePolicy.repo";
import { getSvcFacilitatorDb } from "../services/db";

export class RoutePolicyController extends ControllerBase {
  /** Factory: keeps ctor private and centralizes DI wiring. */
  public static create(service: string): RoutePolicyController {
    // Service owns its DB config; build client explicitly and inject into repo.
    const db = getSvcFacilitatorDb();
    const repo = new RoutePolicyRepo(db);
    return new RoutePolicyController({ service }, repo);
  }

  private readonly repo: RoutePolicyRepo;

  /** Private to enforce factory usage. */
  private constructor(opts: { service?: string }, repo: RoutePolicyRepo) {
    super(opts);
    this.repo = repo;
  }

  /** GET /routePolicy?svcconfigId=...&version=...&method=...&path=... */
  public handleGet(): RequestHandler {
    return this.handle(async ({ query }) => {
      const req = RoutePolicyGetRequest.parse({
        svcconfigId: String(query?.svcconfigId ?? ""),
        version: Number(query?.version ?? 0),
        method: normalizeMethod(String(query?.method ?? "")),
        path: normalizePath(String(query?.path ?? "")),
      });

      const policy = await this.repo.findOneByKey(req);
      return this.ok({ policy } as { policy: RoutePolicyDto | null });
    });
  }

  /** POST /routePolicy */
  public handleCreate(): RequestHandler {
    return this.handle(async ({ body }) => {
      const parsed = RoutePolicyCreate.parse(body ?? {});
      try {
        const policy = await this.repo.createOne(parsed);
        return this.ok({ policy } as { policy: RoutePolicyDto });
      } catch (err: any) {
        if (err?.message === "duplicate_route_policy") {
          return this.fail(409, "conflict", err.detail);
        }
        throw err;
      }
    });
  }

  /** PUT /routePolicy/:id */
  public handleUpdate(): RequestHandler {
    return this.handle(async ({ params, body }) => {
      const req = RoutePolicyUpdateRequest.parse({
        id: String(params?.id ?? ""),
        minAccessLevel: Number((body as any)?.minAccessLevel ?? -1),
      });

      const policy = await this.repo.updateMinAccessLevel(
        req.id,
        req.minAccessLevel
      );
      if (!policy) {
        return this.fail(404, "not_found", { id: req.id });
      }
      return this.ok({ policy } as { policy: RoutePolicyDto });
    });
  }
}
