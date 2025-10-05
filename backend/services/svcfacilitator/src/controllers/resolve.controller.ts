// backend/services/svcfacilitator/src/controllers/resolve.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0010 (Resolve API — fixed read contract)
 *
 * Purpose:
 * - Resolve "<slug>@<version>" to a canonical ServiceConfigRecord JSON.
 * - Keeps routes thin; all logging/envelopes flow through BaseController.
 */

import {
  BaseController,
  type HandlerResult,
} from "@nv/shared/controllers/base.controller";
import {
  ServiceConfigRecord,
  svcKey,
} from "@nv/shared/contracts/svcconfig.contract";
import { mirrorStore } from "../services/mirrorStore";

function pickRecordByKey(key: string): unknown | undefined {
  if (typeof (mirrorStore as any).get === "function") {
    return (mirrorStore as any).get(key);
  }
  if (typeof (mirrorStore as any).snapshot === "function") {
    const snap = (mirrorStore as any).snapshot();
    return snap ? snap[key] : undefined;
  }
  const raw =
    (mirrorStore as any).mirror ??
    (mirrorStore as any).current ??
    (mirrorStore as any)._mirror;
  return raw ? raw[key] : undefined;
}

export class ResolveController extends BaseController {
  constructor() {
    super("svcfacilitator");
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

    const raw = pickRecordByKey(keyQ);
    if (!raw) {
      return this.fail(
        404,
        "not_found",
        `no record for key=${keyQ}`,
        requestId
      );
    }

    const rec = ServiceConfigRecord.parse(raw).toJSON();
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
    const raw = pickRecordByKey(key);
    if (!raw) {
      return this.fail(404, "not_found", `no record for key=${key}`, requestId);
    }

    const rec = ServiceConfigRecord.parse(raw).toJSON();
    return this.ok(200, { key, record: rec, etag: rec.etag }, requestId);
  }
}
