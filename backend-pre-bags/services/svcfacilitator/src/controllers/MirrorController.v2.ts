// backend/services/svcfacilitator/src/controllers/MirrorController.v2.ts
/**
 * Path: backend/services/svcfacilitator/src/controllers/MirrorController.v2.ts
 *
 * Purpose:
 * - Serve the current mirror snapshot.
 * - On each GET, *refresh via store.getWithTtl()* (DB→Mirror→LKG or LKG→Mirror).
 * - Never 503 just because in-memory is empty; let the store decide cold-start failure.
 *
 * Invariants:
 * - No env reads. DI only. Single concern: orchestrate and return.
 */

import type { Request, Response } from "express";
import { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import { SvcReceiver } from "@nv/shared/svc/SvcReceiver";
import {
  MirrorStoreV2,
  type MirrorSnapshotV2,
  ColdStartNoDbNoLkgError,
} from "../services/mirrorStore.v2";

type HandlerResult = { status: number; body: unknown };
function isHandlerResult(e: unknown): e is HandlerResult {
  return (
    !!e &&
    typeof e === "object" &&
    "status" in (e as any) &&
    "body" in (e as any)
  );
}

export class MirrorController extends ControllerBase {
  private readonly rx = new SvcReceiver("svcfacilitator");

  constructor(private readonly store: MirrorStoreV2) {
    super({
      service: "svcfacilitator",
      context: { component: "MirrorController" },
    });
  }

  /**
   * GET /mirror
   * Always attempts refresh via store.getWithTtl().
   * Returns 200 with { mirror, meta } even if mirror is empty,
   * except in the *first boot* hard-fail case (DB down + no FS LKG), where we bubble 503.
   */
  public async getMirror(): Promise<Record<string, unknown>> {
    try {
      // 🔁 This is the key change: refresh path, not a peek.
      const snap: MirrorSnapshotV2 = await this.store.getWithTtl();

      const map = snap?.map ?? Object.create(null);
      const count = Object.keys(map).length;

      if (count === 0) {
        this.log.warn(
          {
            stage: "getMirror",
            source: snap?.source,
            fetchedAt: snap?.fetchedAt,
          },
          "mirror_empty_snapshot"
        );
      } else {
        this.log.debug(
          {
            stage: "getMirror",
            source: snap.source,
            fetchedAt: snap.fetchedAt,
            count,
          },
          "mirror_snapshot_ok"
        );
      }

      return {
        mirror: map,
        meta: {
          source: snap.source, // "db" | "lkg"
          fetchedAt: snap.fetchedAt, // ISO
          count, // entries in mirror
        },
      };
    } catch (err: any) {
      if (err instanceof ColdStartNoDbNoLkgError) {
        // Hard fail on true cold start with no DB and no LKG
        this.log.error(
          { stage: "getMirror", err: err.message },
          "cold_start_no_db_no_lkg"
        );
        throw {
          status: 503,
          body: {
            type: "about:blank",
            title: "mirror_unavailable",
            detail: "Cold start failed: DB unavailable and no FS LKG present",
          },
        };
      }

      // Unexpected error
      this.log.error(
        { stage: "getMirror", err: String(err) },
        "mirror_read_error"
      );
      throw {
        status: 500,
        body: {
          type: "about:blank",
          title: "mirror_unavailable",
          detail: "Failed to load mirror snapshot",
        },
      };
    }
  }

  /**
   * POST /mirror (push)
   * Validate envelope and atomically replace in-memory mirror, persist FS LKG.
   */
  public async mirrorLoad(req: Request, res: Response): Promise<void> {
    await this.rx.receive(
      {
        method: req.method,
        url: req.originalUrl ?? req.url,
        headers: req.headers as Record<string, unknown>,
        params: req.params,
        query: req.query as Record<string, unknown>,
        body: req.body,
      },
      {
        status: (code) => {
          res.status(code);
          return res;
        },
        setHeader: (k, v) => res.setHeader(k, v),
        json: (payload) => res.json(payload),
      },
      async ({ requestId, body }) => {
        const rawMirror: unknown = (body as any)?.mirror;
        if (
          !rawMirror ||
          typeof rawMirror !== "object" ||
          Array.isArray(rawMirror)
        ) {
          this.log.warn(
            { stage: "mirrorLoad", requestId },
            "invalid_payload_no_mirror"
          );
          return this.bad(
            400,
            requestId,
            "invalid_payload",
            "expected { mirror: Record<string, ServiceConfigJSON> }"
          );
        }

        const outputMap = rawMirror as Record<string, unknown>;

        try {
          const snap = await this.store.replaceWithPush(outputMap as any);
          return {
            status: 200,
            body: {
              ok: true,
              requestId,
              accepted: true,
              services: Object.keys(outputMap).length,
              source: snap.source,
              lkgSaved: true,
              fetchedAt: snap.fetchedAt,
            },
          };
        } catch (e: any) {
          this.log.error(
            { stage: "mirrorLoad.store", requestId, error: String(e) },
            "mirror_store_replace_failed"
          );
          return {
            status: 200,
            body: {
              ok: true,
              requestId,
              accepted: true,
              services: Object.keys(outputMap).length,
              source: "db",
              lkgSaved: false,
              lkgError: String(e),
            },
          };
        }
      }
    );
  }

  private bad(
    status: number,
    requestId: string,
    error: string,
    detail: string
  ) {
    return { status, body: { ok: false, requestId, error, detail } };
  }
}
