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
 *   messaging. We do NOT rely on the loader to pre-filter; we validate/decide at
 *   runtime so callers get clear reasons:
 *     - invalid_record (422)
 *     - service_disabled (403)
 *     - proxying_disabled (403)
 *     - not_found (404)  — key not present in mirror at all
 *
 * Notes:
 * - This assumes the boot hydrate loads the FULL svcconfig collection (no filters).
 *   If it doesn’t, disabled/proxy-disabled/invalid entries won’t be present and will
 *   appear as not_found. We’ll fix that in the loader next.
 */

import {
  ControllerBase,
  type HandlerResult,
} from "@nv/shared/base/ControllerBase";
import {
  ServiceConfigRecord,
  svcKey,
} from "@nv/shared/contracts/svcconfig.contract";
import { mirrorStore } from "../services/mirrorStore";

function getFromMirror(key: string): unknown | undefined {
  const m = mirrorStore.getMirror?.() ?? {};
  return (m as Record<string, unknown>)[key];
}

function classifyRecord(
  raw: any
): { ok: true; json: any } | { ok: false; code: string; msg: string } {
  // Validate shape first; if it fails, we want 422 with a clear label.
  try {
    const parsed = ServiceConfigRecord.parse(raw).toJSON();
    // Runtime flag checks for explicit operator-facing reasons
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

export class ResolveController extends ControllerBase {
  constructor() {
    super({ service: "svcfacilitator" });
  }

  /** GET /resolve?key=<slug@version> */
  public async resolveByKey(ctx: {
    body: unknown;
    requestId: string;
    key?: string;
  }): Promise<HandlerResult> {
    const { requestId } = ctx;
    const keyQ = String((ctx as any)?.key ?? "").trim();
    if (!keyQ) {
      return this.fail(
        400,
        "missing_key",
        "expected query ?key=<slug@version>",
        requestId
      );
    }

    const raw = getFromMirror(keyQ);
    if (!raw) {
      return this.fail(
        404,
        "not_found",
        `no record for key=${keyQ}`,
        requestId
      );
    }

    const cls = classifyRecord(raw);
    if (!cls.ok) {
      // invalid_record -> 422, everything else -> 403
      const status = cls.code === "invalid_record" ? 422 : 403;
      return this.fail(status, cls.code, cls.msg, requestId);
    }

    const rec = cls.json;
    return this.ok(200, { key: keyQ, record: rec, etag: rec.etag }, requestId);
  }

  /** GET /resolve/:slug/v:version */
  public async resolveByParams(ctx: {
    body: unknown;
    requestId: string;
    slug: string;
    version: string;
  }): Promise<HandlerResult> {
    const { requestId } = ctx;
    const slug = String(ctx.slug ?? "")
      .trim()
      .toLowerCase();
    const vRaw = Number(ctx.version);
    const version = Number.isFinite(vRaw) ? Math.trunc(vRaw) : NaN;

    if (!slug || !Number.isFinite(version) || version < 1) {
      return this.fail(
        400,
        "bad_params",
        "expected /resolve/:slug/v:version with version >= 1",
        requestId
      );
    }

    const key = svcKey(slug, version);
    const raw = getFromMirror(key);
    if (!raw) {
      return this.fail(404, "not_found", `no record for key=${key}`, requestId);
    }

    const cls = classifyRecord(raw);
    if (!cls.ok) {
      const status = cls.code === "invalid_record" ? 422 : 403;
      return this.fail(status, cls.code, cls.msg, requestId);
    }

    const rec = cls.json;
    return this.ok(200, { key, record: rec, etag: rec.etag }, requestId);
  }
}
