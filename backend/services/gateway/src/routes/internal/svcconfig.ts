// backend/services/gateway/src/routes/internal/svcconfig.ts
/**
 * NowVibin — Gateway (Internal)
 *
 * Purpose:
 * - Internal-only discovery endpoints backed by the shared svcconfig mirror.
 * - Factory export to avoid TS2742 (portable types).
 */

import { Router } from "express";

// Defensive getter for the live mirror instance (no env fallbacks).
function getMirror():
  | { baseUrlOf?: (slug: string) => string | undefined }
  | undefined {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require("@eff/shared/src/svcconfig/client");
  const maybe =
    mod?.svcconfigMirror?.current?.() ??
    mod?.mirror?.current?.() ??
    (typeof mod?.current === "function" ? mod.current() : undefined) ??
    (typeof mod?.default?.current === "function"
      ? mod.default.current()
      : undefined);
  return maybe;
}

export function createSvcconfigRouter(): import("express").Router {
  const r = Router();

  // Self-reference: return svcconfig’s own baseUrl, if known.
  r.get("/base-url", (_req, res) => {
    const m = getMirror();
    const baseUrl = m?.baseUrlOf?.("svcconfig");
    if (!baseUrl) {
      return res.status(503).json({
        error: "svcconfig_unavailable",
        detail: "mirror not hydrated or svcconfig entry missing",
      });
    }
    res.json({ baseUrl });
  });

  // Resolve any service slug to its baseUrl.
  r.get("/resolve/:slug", (req, res) => {
    const slug = String(req.params.slug || "").trim();
    if (!slug) return res.status(400).json({ error: "missing slug" });

    const m = getMirror();
    const baseUrl = m?.baseUrlOf?.(slug);

    if (!baseUrl)
      return res.status(404).json({ error: `unknown slug: ${slug}` });
    res.json({ slug, baseUrl });
  });

  return r;
}
