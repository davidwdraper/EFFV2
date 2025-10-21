// backend/services/svcfacilitator/src/routes/resolve.router.ts
/**
 * Routes:
 *   GET /api/svcfacilitator/v1/resolve?slug=<slug>&version=<ver>
 *   GET /api/svcfacilitator/v1/resolve?key=<slug@ver>
 *   GET /api/svcfacilitator/v1/resolve/:slug/v:version
 *
 * Contract (RouterBase.jsonOk):
 *   { ok: true, service: "svcfacilitator", data: {
 *       slug: string,               // lowercased
 *       version: number >= 1,       // integer
 *       baseUrl: "http(s)://host[:port]",
 *       outboundApiPrefix: "/api",  // no trailing '/'
 *       etag: string
 *   } }
 *
 * Invariants:
 * - Router is the canonical producer of the Resolve contract.
 * - We unwrap ControllerBase HandlerResult safely (body/data/plain) and validate.
 * - No silent defaults. Fail fast with jsonProblem on violations.
 */

import type { Request, Response } from "express";
import { RouterBase } from "@nv/shared/base/RouterBase";
import { ResolveController } from "../controllers/ResolveController";

const API_PREFIX_RE = /^\/[A-Za-z0-9/-]*$/; // must start with "/", no trailing "/"

export class ResolveRouter extends RouterBase {
  private readonly ctrl = new ResolveController();

  protected configure(): void {
    this.get("/resolve", this.resolveQuery);
    this.get("/resolve/:slug/v:version", this.resolveParams);
  }

  private resolveQuery = async (req: Request, res: Response) => {
    if (!this.requireVersionedApiPath(req, res, "svcfacilitator")) return;

    const slug = (req.query.slug as string | undefined)?.trim();
    const version = (req.query.version as string | undefined)?.trim();
    const key = (req.query.key as string | undefined)?.trim();

    try {
      const result =
        key != null && key !== ""
          ? await this.ctrl.resolveByKey({ body: undefined, key })
          : await this.ctrl.resolveByParams({
              body: undefined,
              slug: slug ?? "",
              version: version ?? "",
            });

      const raw = unwrapControllerResult(result);
      const data = normalizeResolveRecord(raw);
      this.jsonOk(res, data);
    } catch (err: any) {
      this.jsonProblem(
        res,
        asInt(err?.status, 500),
        err?.code || "error",
        err?.message || "error"
      );
    }
  };

  private resolveParams = async (req: Request, res: Response) => {
    if (!this.requireVersionedApiPath(req, res, "svcfacilitator")) return;

    try {
      const result = await this.ctrl.resolveByParams({
        body: undefined,
        slug: (req.params.slug || "").trim(),
        version: (req.params.version || "").trim(),
      });

      const raw = unwrapControllerResult(result);
      const data = normalizeResolveRecord(raw);
      this.jsonOk(res, data);
    } catch (err: any) {
      this.jsonProblem(
        res,
        asInt(err?.status, 500),
        err?.code || "error",
        err?.message || "error"
      );
    }
  };
}

// ── Unwraps ControllerBase HandlerResult variants ───────────────────────────

function unwrapControllerResult(input: any): any {
  // 1) If it already looks like our payload, pass through.
  if (looksLikeResolvePayload(input)) return input;

  // 2) Common ControllerBase shapes:
  //    { status, body }, { status, data }, or RouterBase-like { ok, data }
  if (input && typeof input === "object") {
    if (typeof input.status === "number") {
      if (input.body && typeof input.body === "object") return input.body;
      if (input.data && typeof input.data === "object") return input.data;
    }
    if (input.ok === true && input.data && typeof input.data === "object") {
      // Someone returned RouterBase envelope by mistake; unwrap
      return input.data;
    }
  }

  // 3) Last resort — nothing matches
  const err: any = new Error(
    "resolve_contract_violation: unable to unwrap controller result"
  );
  err.status = 500;
  err.code = "resolve_contract_violation";
  throw err;
}

function looksLikeResolvePayload(v: any): boolean {
  return (
    v &&
    typeof v === "object" &&
    typeof v.slug === "string" &&
    (Number.isInteger(v.version) || Number.isInteger(Number(v.version))) &&
    typeof v.baseUrl === "string" &&
    typeof v.outboundApiPrefix === "string" &&
    typeof v.etag === "string"
  );
}

// ── Normalization to canonical contract (type-safe) ─────────────────────────

function normalizeResolveRecord(src: any): {
  slug: string;
  version: number;
  baseUrl: string;
  outboundApiPrefix: string;
  etag: string;
} {
  const fails: string[] = [];

  const slug =
    typeof src?.slug === "string" && src.slug.trim()
      ? src.slug.trim().toLowerCase()
      : (fails.push("slug"), "");

  const version = asInt(src?.version, NaN);
  if (!Number.isInteger(version) || version < 1) fails.push("version");

  const baseUrl =
    typeof src?.baseUrl === "string" && src.baseUrl.trim()
      ? src.baseUrl.trim()
      : (fails.push("baseUrl"), "");

  // Normalize to a guaranteed string or throw
  const outboundApiPrefix = normalizeOutboundApiPrefix(
    src?.outboundApiPrefix,
    fails
  );

  const etag =
    typeof src?.etag === "string" && src.etag.trim()
      ? src.etag.trim()
      : (fails.push("etag"), "");

  if (fails.length) {
    const err: any = new Error(
      `resolve_contract_violation: ${fails.join(", ")}`
    );
    err.status = 500;
    err.code = "resolve_contract_violation";
    throw err;
  }

  return { slug, version, baseUrl, outboundApiPrefix, etag };
}

function normalizeOutboundApiPrefix(input: unknown, fails: string[]): string {
  if (typeof input !== "string" || !input.trim()) {
    fails.push("outboundApiPrefix");
    return ""; // will be rejected by the fails check above
  }
  const prefix = input.trim();
  if (!API_PREFIX_RE.test(prefix)) {
    fails.push("outboundApiPrefix");
    return "";
  }
  if (prefix.length > 1 && prefix.endsWith("/")) {
    fails.push("outboundApiPrefix (trailing slash)");
    return "";
  }
  return prefix;
}

function asInt(v: any, fallback: number): number {
  const n = Number(v);
  return Number.isInteger(n) ? n : fallback;
}
