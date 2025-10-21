// backend/services/svcfacilitator/src/controllers/resolve.controller.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: svcfacilitator is the source of truth; gateway mirrors from it.
 * - ADRs:
 *   - ADR-0010 (Resolve API — fixed read contract)
 *   - ADR-0020 (SvcConfig Mirror & Push Design)
 *   - ADR-0007 (SvcConfig Contract — fixed shapes & keys, OO form)
 *   - ADR-0033 (Internal-Only Services & S2S Verification Defaults)
 *
 * Purpose:
 * - Resolve "<slug>@<version>" against the in-memory mirror with operator-friendly
 *   messaging. We validate at runtime so callers get clear reasons:
 *     - invalid_record (422)
 *     - service_disabled (403)
 *     - not_found (404)
 *
 * Response shape (authoritative; required by shared FacilitatorResolver):
 *   200 OK:
 *     {
 *       "_id": "<stringified db id>",
 *       "slug": "<slug>",
 *       "version": <number>,
 *       "baseUrl": "http(s)://host:port",
 *       "outboundApiPrefix": "/api"
 *     }
 *
 * Change Log:
 * - 2025-10-21: Remove legacy fields (`etag`, `allowProxy`). `_id` is the stable identifier.
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
  _id: string;
  slug: string;
  version: number;
  baseUrl: string;
  outboundApiPrefix: string;
};

// We no longer support/inspect `allowProxy`. Inclusion policy is enforced upstream:
// mirror only contains enabled && !internalOnly. Still, we defensively check `enabled`.
type ParsedRecord = ServiceConfigRecordJSON;

function classifyRecord(raw: unknown):
  | { ok: true; json: ParsedRecord }
  | {
      ok: false;
      code: "invalid_record" | "service_disabled";
      msg: string;
    } {
  try {
    const parsed = ServiceConfigRecord.parse(raw).toJSON();

    if (parsed.enabled !== true) {
      return {
        ok: false,
        code: "service_disabled",
        msg: "service is disabled in svcconfig",
      };
    }

    return { ok: true, json: parsed };
  } catch (e) {
    return { ok: false, code: "invalid_record", msg: String(e) };
  }
}

function toOkPayload(rec: ParsedRecord): OkPayload {
  // `_id` is preserved verbatim in the mirror. Require it to be a non-empty string.
  const id = (rec as any)?._id;
  if (typeof id !== "string" || id.trim() === "") {
    throw Object.assign(new Error("resolve_contract_violation: missing _id"), {
      status: 500,
      code: "resolve_contract_violation",
    });
  }

  return {
    _id: id.trim(),
    slug: rec.slug,
    version: rec.version,
    baseUrl: rec.baseUrl,
    outboundApiPrefix: rec.outboundApiPrefix,
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
