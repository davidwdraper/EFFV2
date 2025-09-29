// backend/services/gateway/src/routes/internal/proxy.ts
/**
 * NowVibin — Gateway (Internal)
 * File: backend/services/gateway/src/routes/internal/proxy.ts
 *
 * Purpose:
 * - Internal S2S proxy: ANY /internal/call/:slug/* → forwards to resolved service.
 * - Fail-closed; no env fallbacks. Uses svcconfig mirror (or snapshot shim).
 */

import type { Request } from "express";
import { Router } from "express";
import { Readable } from "node:stream";
import { mintS2S } from "@eff/shared/src/utils/s2s/mintS2S";

// Timeout for upstream calls (ms)
const TIMEOUT_MS = Number(process.env.INTERNAL_PROXY_TIMEOUT_MS ?? 6000);

// --- svcconfig access (mirror first, snapshot shim second) ---
function getMirrorApi(): { baseUrlOf: (slug: string) => string | undefined } {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require("@eff/shared/src/svcconfig/client");
  // Prefer real mirror object
  if (mod?.svcconfigMirror?.baseUrlOf) return mod.svcconfigMirror as any;
  if (mod?.mirror?.baseUrlOf) return mod.mirror as any;

  // Fallback shim over snapshot
  const getSnap =
    mod?.getSvcconfigSnapshot ??
    mod?.current ??
    mod?.default?.current ??
    (() => null);

  return {
    baseUrlOf(slug: string) {
      const snap = getSnap?.();
      const s = snap?.services?.[String(slug || "").toLowerCase()];
      return s?.baseUrl;
    },
  };
}

// Compute remainder after ":slug" without using params[0] typings
function extractTail(req: Request, slug: string): string {
  const base = `/${slug}`; // router is mounted at "/internal/call"
  let tail = req.path.startsWith(base) ? req.path.slice(base.length) : "";
  if (!tail) tail = "/";
  if (!tail.startsWith("/")) tail = `/${tail}`;
  return tail;
}

// Drop hop-by-hop / unsupported headers for fetch/undici
function sanitizeHeaders(input: Record<string, string | string[] | undefined>) {
  const drop = new Set([
    "connection",
    "proxy-connection",
    "transfer-encoding",
    "keep-alive",
    "upgrade",
    "te",
    "expect",
    "host",
  ]);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    const key = k.toLowerCase();
    if (drop.has(key)) continue;
    if (Array.isArray(v)) {
      if (v.length) out[k] = v.join(", ");
    } else if (v != null) {
      out[k] = String(v);
    }
  }
  return out;
}

// Buffer request body into a fetch-compatible type (string/Uint8Array)
// Never used for GET/HEAD.
async function bufferBody(
  req: Request
): Promise<string | Uint8Array | undefined> {
  // If body middleware already parsed JSON, reuse it
  const ct = String(req.headers["content-type"] || "").toLowerCase();
  const method = String(req.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") return undefined;

  if (
    req.body &&
    typeof req.body === "object" &&
    ct.startsWith("application/json")
  ) {
    return JSON.stringify(req.body);
  }

  // Otherwise consume the raw stream
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(
      typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer)
    );
  }
  if (!chunks.length) return undefined;
  return Buffer.concat(chunks);
}

export function createProxyRouter(): import("express").Router {
  const r = Router();

  // ANY method under /internal/call/:slug/*
  r.all("/:slug/*", async (req, res) => {
    const slug = String(req.params.slug || "")
      .trim()
      .toLowerCase();
    if (!/^[a-z][a-z0-9-]*$/.test(slug)) {
      return res.status(404).json({ error: "unknown_slug", detail: slug });
    }

    const mirror = getMirrorApi();
    const base = mirror.baseUrlOf(slug);
    if (!base) {
      return res.status(502).json({
        error: "unresolvable_slug",
        detail: `no baseUrl for slug: ${slug}`,
      });
    }

    const tail = extractTail(req, slug);
    const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    const target = `${base.replace(/\/+$/, "")}${tail}${qs}`.replace(
      /([^:]\/)\/+/g,
      "$1"
    );

    // Sanitize inbound headers and mint S2S
    const headers = sanitizeHeaders(req.headers);
    delete headers.authorization; // never forward client auth
    headers.authorization = `Bearer ${await mintS2S({
      extra: { nv: { proxiedBy: "gateway", purpose: "internal_proxy" } },
    })}`;
    headers["accept"] = headers["accept"] || "application/json";

    // Prepare body: never for GET/HEAD; otherwise buffer to string/Uint8Array
    const method = String(req.method || "GET").toUpperCase();
    const body =
      method === "GET" || method === "HEAD" ? undefined : await bufferBody(req);

    // Timeout
    let controller: AbortController | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let signal: AbortSignal;
    if (typeof (AbortSignal as any)?.timeout === "function") {
      signal = (AbortSignal as any).timeout(TIMEOUT_MS);
    } else {
      controller = new AbortController();
      timeoutId = setTimeout(() => controller!.abort(), TIMEOUT_MS);
      signal = controller.signal;
    }

    let upstream: Response;
    try {
      upstream = await fetch(target, {
        method,
        headers,
        body: body as any,
        signal,
      });
    } catch (e: any) {
      if (timeoutId) clearTimeout(timeoutId);
      return res
        .status(
          /AbortError|timeout/i.test(String(e?.message || "")) ? 504 : 502
        )
        .json({
          error: "upstream_connect_error",
          detail: String(e?.message || e),
          slug,
          target,
        });
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }

    res.status(upstream.status);
    upstream.headers.forEach((val, key) => {
      const k = key.toLowerCase();
      if (k === "transfer-encoding" || k === "connection") return;
      res.setHeader(key, val);
    });

    const bodyStream = upstream.body;
    if (!bodyStream) return res.end();

    // Bridge WHATWG ReadableStream → Node stream for piping
    if (typeof (Readable as any).fromWeb === "function") {
      const nodeStream = (Readable as any).fromWeb(bodyStream as any);
      return nodeStream.pipe(res);
    }

    // Fallback: manual read for environments without fromWeb
    try {
      const reader = (bodyStream as ReadableStream<Uint8Array>).getReader();
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      return res.end(Buffer.concat(chunks));
    } catch (e: any) {
      return res.status(502).json({
        error: "upstream_body_read_error",
        detail: String(e?.message || e),
      });
    }
  });

  return r;
}
