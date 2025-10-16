// backend/services/svcfacilitator/src/controllers/resolve.controller.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: svcfacilitator is the source of truth; gateway mirrors from it.
 * - ADRs:
 *   - ADR-0010 (Resolve API — fixed read contract)
 *   - ADR-0020 (SvcConfig Mirror & Push Design)
 *   - ADR-0007 (SvcConfig Contract — fixed shapes & keys, OO form)
 *
 * Purpose:
 * - Resolve "<slug>@<version>" against the in-memory mirror with operator-friendly
 *   messaging. We validate at runtime so callers get clear reasons:
 *     - invalid_record (422)
 *     - service_disabled (403)
 *     - proxying_disabled (403)
 *     - not_found (404)
 *
 * Response shape (authoritative; required by shared FacilitatorResolver):
 *   200 OK:
 *     {
 *       "slug": "<slug>",
 *       "version": <number>,
 *       "baseUrl": "http(s)://host:port",
 *       "outboundApiPrefix": "/api",
 *       "etag": "<opaque>"
 *     }
 */

import {
  ControllerBase,
  type HandlerResult,
} from "@nv/shared/base/ControllerBase";
import {
  ServiceConfigRecord,
  svcKey,
  type ServiceConfigRecordJSON,
} from "@nv/shared/contracts/svcconfig.contract";
import { mirrorStore } from "../services/mirrorStore";

function getFromMirror(key: string): unknown | undefined {
  const m = mirrorStore.getMirror?.() ?? {};
  return (m as Record<string, unknown>)[key];
}

type OkPayload = {
  slug: string;
  version: number;
  baseUrl: string;
  outboundApiPrefix: string;
  etag: string;
};

function classifyRecord(raw: unknown):
  | { ok: true; json: ServiceConfigRecordJSON }
  | {
      ok: false;
      code: "invalid_record" | "service_disabled" | "proxying_disabled";
      msg: string;
    } {
  // Validate & normalize via contract; contract enforces shapes and invariants.
  try {
    const parsed = ServiceConfigRecord.parse(raw).toJSON();

    if (parsed.enabled !== true) {
      return {
        ok: false,
        code: "service_disabled",
        msg: "service is disabled in svcconfig",
      };
    }
    if (parsed.allowProxy !== true) {
      return {
        ok: false,
        code: "proxying_disabled",
        msg: "proxying is disabled for this service",
      };
    }

    return { ok: true, json: parsed };
  } catch (e) {
    return { ok: false, code: "invalid_record", msg: String(e) };
  }
}

function toOkPayload(rec: ServiceConfigRecordJSON): OkPayload {
  // No defaults; outboundApiPrefix must be present and validated by contract.
  return {
    slug: rec.slug,
    version: rec.version,
    baseUrl: rec.baseUrl,
    outboundApiPrefix: rec.outboundApiPrefix,
    etag: rec.etag,
  };
}

export class ResolveController extends ControllerBase {
  constructor() {
    super({ service: "svcfacilitator" });
  }

  /** GET /resolve?key=<slug@version> */
  public async resolveByKey(ctx: {
    body: unknown;
    key?: string;
  }): Promise<HandlerResult> {
    const keyQ = String((ctx as any)?.key ?? "").trim();
    if (!keyQ) {
      return this.fail(
        400,
        "missing_key",
        "expected query ?key=<slug@version>"
      );
    }

    const raw = getFromMirror(keyQ);
    if (!raw) {
      return this.fail(404, "not_found", `no record for key=${keyQ}`);
    }

    const cls = classifyRecord(raw);
    if (!cls.ok) {
      // invalid_record -> 422, everything else -> 403
      const status = cls.code === "invalid_record" ? 422 : 403;
      return this.fail(status, cls.code, cls.msg);
    }

    const payload = toOkPayload(cls.json);
    return this.ok(200, payload);
  }

  /** GET /resolve/:slug/v:version */
  public async resolveByParams(ctx: {
    body: unknown;
    slug: string;
    version: string;
  }): Promise<HandlerResult> {
    const slug = String(ctx.slug ?? "")
      .trim()
      .toLowerCase();
    const vRaw = Number(ctx.version);
    const version = Number.isFinite(vRaw) ? Math.trunc(vRaw) : NaN;

    if (!slug || !Number.isFinite(version) || version < 1) {
      return this.fail(
        400,
        "bad_params",
        "expected /resolve/:slug/v:version with version >= 1"
      );
    }

    const key = svcKey(slug, version);
    const raw = getFromMirror(key);
    if (!raw) {
      return this.fail(404, "not_found", `no record for key=${key}`);
    }

    const cls = classifyRecord(raw);
    if (!cls.ok) {
      const status = cls.code === "invalid_record" ? 422 : 403;
      return this.fail(status, cls.code, cls.msg);
    }

    const payload = toOkPayload(cls.json);
    return this.ok(200, payload);
  }
}
