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
 * - Single, strict base for all Express routers.
 * - Lifecycle: preRoute() → configure() → postRoute()
 * - Standardized:
 *   • async handler wrapping (no unhandled rejections)
 *   • consistent, path-aware structured logs
 *   • JSON helpers (ok/problem)
 *   • versioned-path parsing guard
 *   • small HTTP utilities (headers/body/ports/host)
 *
 * Environment Invariance:
 * - Absolutely no hardcoded addresses or environment assumptions.
 * - All network surfaces resolved via env vars or config layers.
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
  #r: Router;
  #configured = false;
  #configuring = false;

  constructor(opts?: { service?: string; context?: Record<string, unknown> }) {
    super({
      service: opts?.service,
      context: { component: "Router", ...(opts?.context ?? {}) },
    });
    this.#r = express.Router();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ──────────────────────────────────────────────────────────────────────────

  protected preRoute(): void {}
  protected abstract configure(): void;
  protected postRoute(): void {}

  public router(): Router {
    if (this.#configured) return this.#r;
    if (this.#configuring) return this.#r;
    this.#configuring = true;
    try {
      this.preRoute();
      this.configure();
      this.postRoute();
      this.#configured = true;
    } finally {
      this.#configuring = false;
    }
    return this.#r;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Async wrapper + logging (response-lifecycle based)
  // ──────────────────────────────────────────────────────────────────────────
  //
  // Rationale:
  // - Handlers may stream/pipe and return before headers are sent.
  // - The only reliable truth is the HTTP response lifecycle (`finish`/`close`).
  // - We attach listeners BEFORE invoking the handler and log on settle.
  //
  protected wrap<T extends AnyHandler>(path: string, fn: T): RequestHandler {
    const baseLog = this.bindLog({ kind: "http", path });

    return (req, res, next) => {
      const start = Date.now();
      let settled = false;

      const meta = {
        method: req.method,
        url: req.originalUrl,
      };

      const settle = (kind: "finish" | "close" | "error", err?: unknown) => {
        if (settled) return;
        settled = true;

        // Clear watchdog timer if armed
        if (timer) clearTimeout(timer);

        if (kind === "error") {
          baseLog.error({ ...meta, err: String(err) }, "router_error");
          return next(err as any);
        }

        baseLog.debug(
          {
            ...meta,
            tookMs: Date.now() - start,
            statusCode: res.statusCode,
            headersSent: res.headersSent,
            kind,
          },
          "router_exit"
        );
      };

      // Enter log fires immediately
      baseLog.debug(meta, "router_enter");

      // Attach lifecycle listeners BEFORE executing handler
      res.once("finish", () => settle("finish"));
      res.once("close", () => settle("close"));
      res.once("error", (e) => settle("error", e));

      // Optional watchdog: warn if neither finish/close occurs within N ms
      // (defaults to 30000ms if ROUTER_FINISH_WARN_MS not provided)
      const warnMs = Number(process.env.ROUTER_FINISH_WARN_MS ?? 30000);
      const timer =
        Number.isFinite(warnMs) && warnMs > 0
          ? setTimeout(() => {
              if (!settled) {
                baseLog.warn(
                  { ...meta, tookMs: Date.now() - start, warnMs },
                  "response_may_be_stuck"
                );
              }
            }, warnMs)
          : undefined;

      // Execute handler (sync/async)
      Promise.resolve(fn.call(this, req, res, next)).catch((err) =>
        settle("error", err)
      );
    };
  }

  protected get(path: string, handler: AnyHandler): void {
    this.#r.get(path, this.wrap(path, handler));
  }
  protected post(path: string, handler: AnyHandler): void {
    this.#r.post(path, this.wrap(path, handler));
  }
  protected put(path: string, handler: AnyHandler): void {
    this.#r.put(path, this.wrap(path, handler));
  }
  protected patch(path: string, handler: AnyHandler): void {
    this.#r.patch(path, this.wrap(path, handler));
  }
  protected delete(path: string, handler: AnyHandler): void {
    this.#r.delete(path, this.wrap(path, handler));
  }
  protected use(pathOrMw: string | RequestHandler, mw?: RequestHandler): void {
    if (typeof pathOrMw === "string") {
      const path = pathOrMw;
      if (!mw) throw new Error("use(path, mw) requires a middleware function");
      this.#r.use(path, this.wrap(path, mw));
    } else {
      this.#r.use(this.wrap("(anonymous)", pathOrMw));
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // JSON helpers (canonical envelopes)
  // ──────────────────────────────────────────────────────────────────────────

  protected jsonOk(res: Response, data: unknown, status = 200): Response {
    return res.status(status).json({ ok: true, service: this.service, data });
  }

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

  protected requireVersionedApiPath(
    req: Request,
    res: Response,
    allowSlug?: string
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
  // Small HTTP utilities (no environment assumptions)
  // ──────────────────────────────────────────────────────────────────────────

  protected getInboundHost(req: Request): string {
    // Return whatever Host header client provided; never assume local
    const host = (req.get("host") || "").trim();
    return host || process.env.NV_DEFAULT_HOST || "unknown-host";
  }

  protected absoluteUrl(req: Request, hostname: string, port: number): string {
    const proto = (req.protocol || "http").toLowerCase();
    return `${proto}://${hostname}:${port}${req.originalUrl}`;
  }

  protected portFromBaseUrl(baseUrl: string): number {
    const u = new URL(baseUrl);
    if (u.port) return Number(u.port);
    return u.protocol === "https:" ? 443 : 80;
  }

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

  protected svcKey(slug: string, version: number): string {
    return `${slug.toLowerCase()}@${version}`;
  }
}
