// backend/services/svcfacilitator/src/controllers/MirrorController.v2.ts
/**
 * Path: backend/services/svcfacilitator/src/controllers/MirrorController.v2.ts
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0007 — SvcConfig Contract (fixed shapes & keys, OO form)
 *   - ADR-0008 — SvcFacilitator LKG (boot resilience when DB is down)
 *   - ADR-0037 — Unified Route Policies (Edge + S2S)
 *   - ADR-0029 — Contract-ID + BodyHandler pipeline
 *
 * Purpose:
 * - Accept a pushed **combined** mirror from the gateway, validate it against
 *   shared contracts, and atomically replace the in-memory mirror while
 *   persisting LKG via the store (filesystem-first, DB secondary).
 *
 * Behavior:
 * - Payload shape:
 *     { mirror: Record<string, {
 *         serviceConfig: { _id, slug, version, enabled, updatedAt, updatedBy, notes? },
 *         policies: { edge: EdgeRoutePolicyDoc[], s2s: S2SRoutePolicyDoc[] }
 *       }> }
 *   Keys must be "<slug>@<version>" (case-normalized per contract).
 *
 * Invariants:
 * - No environment reads here (store handles all persistence).
 * - No filesystem writes here (delegated to store).
 * - Single concern: validate + orchestrate.
 */

import type { Request, Response } from "express";
import { ControllerBase } from "@nv/shared/base/ControllerBase";
import { SvcReceiver } from "@nv/shared/svc/SvcReceiver";

import {
  ServiceConfigRecord,
  svcKey,
  type ServiceConfigRecordJSON,
} from "@nv/shared/contracts/svcconfig.contract";

import {
  routePolicyDocArraySchema,
  type EdgeRoutePolicyDoc,
  type S2SRoutePolicyDoc,
} from "@nv/shared/contracts/route_policies.contract";

import {
  MirrorStoreV2,
  type MirrorSnapshotV2,
} from "../services/mirrorStore.v2";
import type { MirrorMapV2 } from "../services/MirrorDbLoader.v2";

type MirrorEntryIncoming = {
  serviceConfig: {
    _id: unknown;
    slug: string;
    version: number;
    enabled: boolean;
    updatedAt: unknown;
    updatedBy: string;
    notes?: string;
  };
  policies: {
    edge: unknown[];
    s2s: unknown[];
  };
};

type MirrorIncoming = Record<string, MirrorEntryIncoming>;

export class MirrorController extends ControllerBase {
  private readonly rx = new SvcReceiver("svcfacilitator");

  // DI: store owns TTL + LKG (FS-first, DB secondary)
  constructor(private readonly store: MirrorStoreV2) {
    super({ service: "svcfacilitator" });
  }

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
        // 1) Basic envelope check
        const rawMirror: unknown = (body as any)?.mirror;
        if (
          !rawMirror ||
          typeof rawMirror !== "object" ||
          Array.isArray(rawMirror)
        ) {
          return this.bad(
            400,
            requestId,
            "invalid_payload",
            "expected { mirror: Record<string, MirrorEntry> }"
          );
        }

        // 2) Validate & normalize each entry
        const outputMap: MirrorMapV2 = Object.create(null);

        try {
          for (const [key, value] of Object.entries(
            rawMirror as MirrorIncoming
          )) {
            // parent (strict OO parse → JSON)
            const parentJson = new ServiceConfigRecord(
              value.serviceConfig
            ).toJSON();

            // enforce key === "<slug>@<version>"
            const expectedKey = svcKey(parentJson.slug, parentJson.version);
            if (key !== expectedKey) {
              throw new Error(
                `mirror key mismatch: '${key}' !== '${expectedKey}'`
              );
            }

            // normalize _id to strict string (MirrorEntryV2 requires it)
            const idStrict = normalizeIdString(parentJson._id);
            if (!idStrict) {
              throw new Error(
                `serviceConfig._id is required and must be a string for '${key}'`
              );
            }

            // children: validate arrays and partition by type
            const edgesAny = routePolicyDocArraySchema.parse(
              value.policies.edge
            );
            const s2sAny = routePolicyDocArraySchema.parse(value.policies.s2s);

            const edge = edgesAny.filter(
              (p) => p.type === "Edge"
            ) as EdgeRoutePolicyDoc[];
            const s2s = s2sAny.filter(
              (p) => p.type === "S2S"
            ) as S2SRoutePolicyDoc[];

            if (edge.length !== edgesAny.length) {
              throw new Error(
                `policies.edge contains non-Edge entries for '${key}'`
              );
            }
            if (s2s.length !== s2sAny.length) {
              throw new Error(
                `policies.s2s contains non-S2S entries for '${key}'`
              );
            }

            // project minimal parent required by MirrorEntryV2 (with _id: string)
            const parentMinimal: Pick<
              ServiceConfigRecordJSON,
              | "_id"
              | "slug"
              | "version"
              | "enabled"
              | "updatedAt"
              | "updatedBy"
              | "notes"
            > & { _id: string } = {
              _id: idStrict,
              slug: parentJson.slug,
              version: parentJson.version,
              enabled: parentJson.enabled,
              updatedAt: parentJson.updatedAt,
              updatedBy: parentJson.updatedBy,
              ...(parentJson.notes ? { notes: parentJson.notes } : {}),
            };

            outputMap[key] = {
              serviceConfig: parentMinimal,
              policies: { edge, s2s },
            };
          }
        } catch (e) {
          return this.bad(
            400,
            requestId,
            "mirror_validation_failed",
            String(e)
          );
        }

        // 3) Replace in-memory + persist LKG via store (FS-first, DB secondary)
        let snap: MirrorSnapshotV2 | null = null;
        try {
          snap = await this.store.replaceWithPush(outputMap);
        } catch (e) {
          // Store failure shouldn’t leave you blind; we still accept but flag lkgSaved=false
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

        // 4) Success
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
      }
    );
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private bad(
    status: number,
    requestId: string,
    error: string,
    detail: string
  ) {
    return {
      status,
      body: { ok: false, requestId, error, detail },
    };
  }
}

/** Accepts string or {$oid} or other unknown → returns strict string or undefined */
function normalizeIdString(id: unknown): string | undefined {
  if (typeof id === "string" && id.length > 0) return id;
  if (
    id &&
    typeof id === "object" &&
    "$oid" in (id as any) &&
    typeof (id as any).$oid === "string"
  ) {
    return (id as any).$oid as string;
  }
  return undefined;
}
