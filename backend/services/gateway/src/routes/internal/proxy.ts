/**
 * NowVibin — Gateway (Internal)
 * File: backend/services/gateway/src/routes/internal/proxy.ts
 *
 * Purpose:
 * - Internal S2S proxy: ANY /internal/call/:slug/* → forwards to resolved service.
 * - Factory export to avoid TS2742 (portable types). Fail-closed; no env fallbacks.
 */

import type { Request } from "express";
import { Router } from "express";
import { Readable } from "node:stream";
import { mintS2S } from "@eff/shared/src/utils/s2s/mintS2S";

// Defensive getter for svcconfig mirror (no env fallbacks)
function getMirror():
  | { baseUrlOf?: (slug: string) => string | undefined }
  | undefined {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require("@eff/shared/src/svcconfig/client");
  return (
    mod?.svcconfigMirror?.current?.() ??
    mod?.mirror?.current?.() ??
    (typeof mod?.current === "function" ? mod.current() : undefined) ??
    (typeof mod?.default?.current === "function"
      ? mod.default.current()
      : undefined)
  );
}

// Compute remainder after ":slug" without using req.params[0]
function extractTail(req: Request, slug: string): string {
  const base = `/${slug}`; // router is mounted at "/internal/call"
  let tail = req.path.startsWith(base) ? req.path.slice(base.length) : "";
  if (!tail) tail = "/";
  if (!tail.startsWith("/")) tail = `/${tail}`;
  return tail;
}

export function createProxyRouter(): import("express").Router {
  const r = Router();

  // Keep the wildcard; typings don’t expose params[0], so we avoid it.
  r.all("/:slug/*", async (req, res) => {
    const slug = String(req.params.slug || "").trim();
    if (!slug) return res.status(400).json({ error: "missing slug" });

    const m = getMirror();
    const base = m?.baseUrlOf?.(slug);
    if (!base) {
      return res.status(502).json({
        error: "unresolvable_slug",
        detail: `no baseUrl for slug: ${slug}`,
      });
    }

    const tail = extractTail(req, slug);
    const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    const target = `${base.replace(/\/+$/, "")}${tail}${qs}`;

    // Copy headers except Authorization; normalize to strings
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      const key = k.toLowerCase();
      if (key === "authorization") continue;
      if (Array.isArray(v)) headers[key] = v.join(", ");
      else if (v != null) headers[key] = String(v);
    }

    // Mint S2S for this hop (internal audience/issuer only)
    headers["authorization"] = `Bearer ${await mintS2S({
      extra: { nv: { proxiedBy: "gateway", purpose: "internal_proxy" } },
    })}`;

    let upstream: Response;
    try {
      upstream = await fetch(target, {
        method: req.method,
        headers,
        body: (req as any).readable ? (req as any) : undefined,
      });
    } catch (e: any) {
      return res.status(502).json({
        error: "upstream_connect_error",
        detail: String(e?.message || e),
        slug,
        target,
      });
    }

    res.status(upstream.status);
    upstream.headers.forEach((val, key) => {
      if (key.toLowerCase() !== "transfer-encoding") res.setHeader(key, val);
    });

    // Bridge WHATWG ReadableStream → Node stream for piping
    const body = upstream.body;
    if (body) {
      // Node 18+: Readable.fromWeb exists
      const nodeStream =
        typeof (Readable as any).fromWeb === "function"
          ? (Readable as any).fromWeb(body as any)
          : (body as any); // On older fetch impls it may already be a Node stream

      if (typeof (nodeStream as any).pipe === "function") {
        (nodeStream as any).pipe(res);
      } else if (typeof (body as any).pipeTo === "function") {
        // Fallback: use WHATWG piping to a web WritableStream wrapper
        // but Express expects Node streams; safest is to buffer small bodies.
        const chunks: Uint8Array[] = [];
        const reader = (body as ReadableStream<Uint8Array>).getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) chunks.push(value);
          }
          res.end(Buffer.concat(chunks));
        } catch (e: any) {
          res.status(502).json({
            error: "upstream_body_read_error",
            detail: String(e?.message || e),
          });
        }
      } else {
        // Last resort
        const chunks: Uint8Array[] = [];
        const reader = (body as ReadableStream<Uint8Array>).getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) chunks.push(value);
          }
          res.end(Buffer.concat(chunks));
        } catch (e: any) {
          res.status(502).json({
            error: "upstream_body_read_error",
            detail: String(e?.message || e),
          });
        }
      }
    } else {
      res.end();
    }
  });

  return r;
}
