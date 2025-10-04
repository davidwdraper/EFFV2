// backend/services/svcfacilitator/src/controllers/resolve.controller.ts
/**
 * Docs:
 * - SOP: svcfacilitator is source of truth; gateway mirrors from it.
 *
 * Purpose:
 * - Controller for resolving (slug, version) → baseUrl from in-memory mirrorStore.
 * - No DB/network calls here. Pure cache lookup, clean JSON envelopes.
 *
 * Contract:
 *   GET /api/svcfacilitator/resolve?slug=<slug>&version=<major>
 *   → 200: { ok: true,  service: "svcfacilitator", data: { baseUrl } }
 *   → 400: { ok: false, service: "svcfacilitator", data: { status:"invalid_request", detail } }
 *   → 404: { ok: false, service: "svcfacilitator", data: { status:"not_found", detail } }
 */

import type { Request, Response } from "express";
import { mirrorStore } from "../services/mirrorStore";

const SERVICE = "svcfacilitator";

export class ResolveController {
  public handle(req: Request, res: Response): void {
    const slug = String(req.query.slug ?? "").trim();
    const versionRaw = req.query.version ?? 1;
    const version = Number(versionRaw);

    if (!slug) {
      res.status(400).json({
        ok: false,
        service: SERVICE,
        data: { status: "invalid_request", detail: "slug is required" },
      });
      return;
    }

    if (!Number.isFinite(version) || version <= 0) {
      res.status(400).json({
        ok: false,
        service: SERVICE,
        data: {
          status: "invalid_request",
          detail: "version must be a positive integer",
        },
      });
      return;
    }

    try {
      const baseUrl = mirrorStore.getUrlFromSlug(slug, version);
      res.status(200).json({ ok: true, service: SERVICE, data: { baseUrl } });
      return;
    } catch (e: any) {
      // mirrorStore throws for unknown/disabled entries
      res.status(404).json({
        ok: false,
        service: SERVICE,
        data: {
          status: "not_found",
          detail:
            typeof e?.message === "string"
              ? e.message
              : `no mapping for ${slug}@v${version}`,
        },
      });
      return;
    }
  }
}
