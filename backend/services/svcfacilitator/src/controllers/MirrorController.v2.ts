// backend/services/svcfacilitator/src/controllers/MirrorController.v2.ts
/**
 * Path: backend/services/svcfacilitator/src/controllers/MirrorController.v2.ts
 *
 * Purpose:
 * - Accept a pushed combined mirror, validate it, and atomically replace the in-memory mirror while persisting LKG.
 * - Provide a thin READ API to expose the current mirror snapshot.
 *
 * Invariants:
 * - No environment reads. DI only. Single concern: validate → orchestrate → return/throw.
 */

import type { Request, Response } from "express";
import { ControllerBase } from "@nv/shared/base/ControllerBase";
import { SvcReceiver } from "@nv/shared/svc/SvcReceiver";

import {
  ServiceConfigRecord,
  svcKey,
} from "@nv/shared/contracts/svcconfig.contract";
import { routePolicyDocArraySchema } from "@nv/shared/contracts/route_policies.contract";

import {
  MirrorStoreV2,
  type MirrorSnapshotV2,
} from "../services/mirrorStore.v2";
import type { MirrorMapV2 } from "../services/MirrorDbLoader.v2";
import type {
  ServiceConfigParent,
  EdgeRoutePolicyDoc,
  S2SRoutePolicyDoc,
} from "../repos/SvcConfigWithPoliciesRepo.v2";

type MirrorEntryIncoming = {
  serviceConfig: {
    _id: unknown;
    slug: string;
    version: number;
    enabled: boolean;
    internalOnly: boolean;
    baseUrl: string;
    outboundApiPrefix: string;
    exposeHealth: boolean;
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
   * READ: return current in-memory mirror snapshot.
   * Throws { status, body } to be formatted by global problem middleware.
   */
  public async getMirror(): Promise<Record<string, unknown>> {
    try {
      const snap = await this.store.getMirror();
      if (!snap || Object.keys(snap).length === 0) {
        // log, then throw a structured 503 — DO NOT down-convert to 500
        this.log.warn(
          { stage: "getMirror", reason: "empty_snapshot" },
          "mirror_unavailable"
        );
        throw {
          status: 503,
          body: {
            type: "about:blank",
            title: "mirror_unavailable",
            detail: "Mirror is not ready (empty snapshot)",
          },
        };
      }
      return snap;
    } catch (err: any) {
      // If upstream already threw a handler-style error, do not mask it.
      if (isHandlerResult(err)) {
        const hb = (err.body ?? {}) as any;
        this.log.warn(
          {
            stage: "getMirror",
            rethrowing: true,
            status: err.status,
            title: hb?.title,
            detail: hb?.detail,
          },
          "mirror_handler_result"
        );
        throw err;
      }

      // Unexpected error: log and throw clean 500
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
        // 1) Envelope check
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

            // normalize _id to strict string (ServiceConfigParent requires it)
            const idStrict = asStringIdStrict(parentJson._id, `parent ${key}`);

            // children: validate arrays with Zod, then partition by type
            const edgesAny = routePolicyDocArraySchema.parse(
              value.policies.edge
            );
            const s2sAny = routePolicyDocArraySchema.parse(value.policies.s2s);

            const edgesOnly = edgesAny.filter((p) => p.type === "Edge");
            const s2sOnly = s2sAny.filter((p) => p.type === "S2S");
            if (edgesOnly.length !== edgesAny.length) {
              throw new Error(
                `policies.edge contains non-Edge entries for '${key}'`
              );
            }
            if (s2sOnly.length !== s2sAny.length) {
              throw new Error(
                `policies.s2s contains non-S2S entries for '${key}'`
              );
            }

            // STRICT normalize children to repo contract types (assert _id/svcconfigId)
            const edge: EdgeRoutePolicyDoc[] = edgesOnly.map((p: any) =>
              toEdgePolicyStrict(p, key)
            );
            const s2s: S2SRoutePolicyDoc[] = s2sOnly.map((p: any) =>
              toS2SPolicyStrict(p, key)
            );

            // project FULL parent required by ServiceConfigParent
            const parentFull: ServiceConfigParent = {
              _id: idStrict,
              slug: parentJson.slug,
              version: parentJson.version,
              enabled: parentJson.enabled,
              internalOnly: parentJson.internalOnly,
              baseUrl: parentJson.baseUrl,
              outboundApiPrefix: parentJson.outboundApiPrefix,
              exposeHealth: parentJson.exposeHealth,
              updatedAt: parentJson.updatedAt,
              updatedBy: parentJson.updatedBy,
              ...(parentJson.notes ? { notes: parentJson.notes } : {}),
            };

            outputMap[key] = {
              serviceConfig: parentFull,
              policies: { edge, s2s },
            };
          }
        } catch (e: any) {
          this.log.warn(
            { stage: "mirrorLoad.validate", requestId, error: String(e) },
            "mirror_validation_failed"
          );
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
    return { status, body: { ok: false, requestId, error, detail } };
  }
}

// ── Local strict normalizers ─────────────────────────────────────────────────

function asStringIdStrict(id: unknown, who: string): string {
  if (typeof id === "string" && id.length > 0) return id;
  if (id && typeof id === "object" && typeof (id as any).$oid === "string") {
    return (id as any).$oid as string;
  }
  throw new Error(`${who}: _id is required and must be a string`);
}

function asIsoString(v: unknown, who: string): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string" && v.length > 0) return v;
  const d = new Date(v as any);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  throw new Error(`${who}: updatedAt must be a Date or ISO string`);
}

function toEdgePolicyStrict(p: any, parentKey: string): EdgeRoutePolicyDoc {
  return {
    _id: asStringIdStrict(p._id, `edge policy for '${parentKey}'`),
    svcconfigId: asStringIdStrict(
      p.svcconfigId,
      `edge policy.svcconfigId for '${parentKey}'`
    ),
    type: "Edge",
    slug: String(p.slug),
    method: p.method as EdgeRoutePolicyDoc["method"],
    path: String(p.path),
    bearerRequired: Boolean(p.bearerRequired),
    enabled: Boolean(p.enabled),
    updatedAt: asIsoString(p.updatedAt, `edge policy for '${parentKey}'`),
    notes: p.notes != null ? String(p.notes) : undefined,
    minAccessLevel:
      p.minAccessLevel != null ? Number(p.minAccessLevel) : undefined,
  };
}

function toS2SPolicyStrict(p: any, parentKey: string): S2SRoutePolicyDoc {
  const out: S2SRoutePolicyDoc = {
    _id: asStringIdStrict(p._id, `s2s policy for '${parentKey}'`),
    svcconfigId: asStringIdStrict(
      p.svcconfigId,
      `s2s policy.svcconfigId for '${parentKey}'`
    ),
    type: "S2S",
    slug: String(p.slug),
    method: p.method as S2SRoutePolicyDoc["method"],
    path: String(p.path),
    enabled: Boolean(p.enabled),
    updatedAt: asIsoString(p.updatedAt, `s2s policy for '${parentKey}'`),
    notes: p.notes != null ? String(p.notes) : undefined,
    minAccessLevel:
      p.minAccessLevel != null ? Number(p.minAccessLevel) : undefined,
  };
  if (Array.isArray((p as any).allowedCallers)) {
    (out as any).allowedCallers = (p as any).allowedCallers.map((s: any) =>
      String(s)
    );
  }
  if (Array.isArray((p as any).scopes)) {
    (out as any).scopes = (p as any).scopes.map((s: any) => String(s));
  }
  return out;
}
