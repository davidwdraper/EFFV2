// backend/services/shared/src/base/RouterBase.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0014 (Base Hierarchy — ServiceEntrypoint → AppBase → ServiceBase)
 *   - ADR-0015 (Structured Logger with bind() Context)
 *   - ADR-0019 (Class Routers via RouterBase)
 *
 * Purpose:
 * - Common base for all Express routers across services.
 * - Standardizes:
 *    - async handler wrapping (no unhandled rejections)
 *    - structured entry/exit/error logs
 *    - JSON helpers (ok/problem)
 *    - versioned-path parsing guard
 *    - small HTTP utilities (headers/body/ports/host)
 *
 * Usage:
 *   export class MyRouter extends RouterBase {
 *     protected configure(): void {
 *       this.r.get("/things/:id", this.wrap(this.getThing));
 *     }
 *     private async getThing(req, res) {
 *       return this.jsonOk(res, { thing: "🧱" });
 *     }
 *   }
 */

import type {
  Request,
  Response,
  NextFunction,
  RequestHandler,
  Router,
} from "express";
import express = require("express");
import { ServiceBase } from "./ServiceBase";
import { UrlHelper } from "../http/UrlHelper";

type AnyHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => unknown | Promise<unknown>;

export abstract class RouterBase extends ServiceBase {
  protected readonly r: Router;

  constructor(opts?: { service?: string; context?: Record<string, unknown> }) {
    super({
      service: opts?.service,
      context: { component: "Router", ...(opts?.context ?? {}) },
    });
    this.r = express.Router();
    this.configure();
  }

  /** Subclasses implement this to register routes (use this.wrap for handlers). */
  protected abstract configure(): void;

  /** Expose the underlying express.Router (read-only). */
  public router(): Router {
    return this.r;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Async wrapper + logging
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Wrap an async handler:
   *  - routes rejections to Express error pipeline
   *  - logs entry/exit and errors with route & method
   *  - warns if handler returns without writing a response
   */
  protected wrap<T extends AnyHandler>(fn: T): RequestHandler {
    const baseLog = this.bindLog({ kind: "http" });
    return (req, res, next) => {
      const routePath = (req.route && req.route.path) || "unknown";
      baseLog.debug(
        { method: req.method, url: req.originalUrl, route: routePath },
        "router_enter"
      );
      Promise.resolve(fn.call(this, req, res, next))
        .then(() => {
          if (!res.headersSent) {
            baseLog.warn(
              { method: req.method, url: req.originalUrl, route: routePath },
              "handler_completed_without_response"
            );
          } else {
            baseLog.debug({ status: res.statusCode }, "router_exit");
          }
        })
        .catch((err) => {
          baseLog.error(
            {
              err: String(err),
              method: req.method,
              url: req.originalUrl,
              route: routePath,
            },
            "router_error"
          );
          next(err);
        });
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // JSON helpers (canonical envelopes)
  // ──────────────────────────────────────────────────────────────────────────

  /** 200 JSON `{ ok:true, service, data }` */
  protected jsonOk(res: Response, data: unknown, status = 200): Response {
    return res.status(status).json({ ok: true, service: this.service, data });
  }

  /** Error JSON `{ ok:false, service, data:{status, detail} }` */
  protected jsonProblem(
    res: Response,
    statusCode: number,
    status: string,
    detail?: string | Record<string, unknown>
  ): Response {
    return res
      .status(statusCode)
      .json({ ok: false, service: this.service, data: { status, detail } });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // API path guard (versioned convention)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Require canonical API path: `/api/<slug>/v<major>/...`.
   * - Returns `{ slug, version }` or sends 400 and returns `undefined`.
   * - Never forces gateway paths — caller can special-case before calling.
   */
  protected requireVersionedApiPath(
    req: Request,
    res: Response,
    allowSlug?: string // optional: allow only this slug
  ): { slug: string; version: number } | undefined {
    try {
      const { slug, version } = UrlHelper.parseApiPath(req.originalUrl);
      if (allowSlug && slug.toLowerCase() !== allowSlug.toLowerCase()) {
        this.jsonProblem(
          res,
          400,
          "invalid_request",
          `Expected slug=${allowSlug}`
        );
        return undefined;
      }
      if (version == null) {
        this.jsonProblem(
          res,
          400,
          "invalid_request",
          "Missing API version. Expected /api/<slug>/v<major>/..."
        );
        return undefined;
      }
      return { slug, version };
    } catch {
      // If it looks like an API path but isn’t versioned, complain.
      const m = req.originalUrl.match(/^\/api\/([^/]+)(?:\/|$)/i);
      if (m && m[1]) {
        this.jsonProblem(
          res,
          400,
          "invalid_request",
          "Missing API version. Expected /api/<slug>/v<major>/..."
        );
        return undefined;
      }
      return undefined;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Small HTTP utilities (host/ports/headers/body)
  // ──────────────────────────────────────────────────────────────────────────

  /** Extract hostname from Host header, minus :port (IPv6 safe). */
  protected getInboundHost(req: Request): string {
    const host = (req.get("host") || "").trim();
    if (!host) return "127.0.0.1";
    const idx = host.lastIndexOf(":");
    if (idx > 0 && !host.endsWith("]")) return host.slice(0, idx);
    return host;
  }

  /** Compose absolute URL with swapped port, same scheme/host/path/query. */
  protected absoluteUrl(req: Request, hostname: string, port: number): string {
    const proto = (req.protocol || "http").toLowerCase();
    return `${proto}://${hostname}:${port}${req.originalUrl}`;
  }

  /** Parse explicit/implicit port from a base URL. */
  protected portFromBaseUrl(baseUrl: string): number {
    const u = new URL(baseUrl);
    if (u.port) return Number(u.port);
    return u.protocol === "https:" ? 443 : 80;
  }

  /** Build outbound headers: strip Host/Authorization; ensure Accept. */
  protected outboundHeaders(req: Request): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (v == null) continue;
      const key = k.toLowerCase();
      if (key === "host" || key === "authorization") continue;
      headers[key] = Array.isArray(v) ? v[0] : String(v);
    }
    headers["accept"] = headers["accept"] || "application/json";
    headers["x-service-name"] = this.service;
    return headers;
  }

  /** Build outbound body for non-GET/HEAD, including JSON if applicable. */
  protected outboundBodyAndType(req: Request): {
    body?: BodyInit;
    contentType?: string;
  } {
    if (["GET", "HEAD"].includes(req.method)) return {};
    if (req.is("application/json") && typeof req.body === "object") {
      return {
        body: JSON.stringify(req.body),
        contentType: "application/json",
      };
    }
    if (
      typeof (req as any).body === "string" ||
      (req as any).body instanceof Buffer
    ) {
      return { body: (req as any).body as any };
    }
    return {};
  }

  /** Compose svc config key `slug@version` */
  protected svcKey(slug: string, version: number): string {
    return `${slug.toLowerCase()}@${version}`;
  }
}
