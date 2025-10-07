// backend/services/shared/src/base/ControllerBase.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0014 (Base Hierarchy: ServiceEntrypoint vs ServiceBase)
 *   - ADR-0015 (Structured Logger with bind() Context)
 *
 * Purpose:
 * - Canonical base for all HTTP controllers.
 * - Provides the `handle()` adapter for wrapping async controller logic.
 * - Supplies consistent logging, context, and JSON envelope handling.
 */

import fs from "fs";
import path from "path";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { ServiceBase } from "./ServiceBase";

export type HandlerResult = {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
};

export type HandlerCtx = {
  requestId: string;
  method: string;
  url: string;
  headers: Record<string, unknown>;
  params: Record<string, unknown>;
  query: Record<string, unknown>;
  body: unknown;
};

export abstract class ControllerBase extends ServiceBase {
  constructor(opts?: { service?: string; context?: Record<string, unknown> }) {
    super({
      service: opts?.service,
      context: { component: "Controller", ...(opts?.context ?? {}) },
    });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Express adapter — canonical handle()
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Turn an async `(ctx) => HandlerResult` into a standard Express handler.
   * Handles JSON response writing, error logging, and context building.
   */
  public handle(
    fn: (ctx: HandlerCtx) => Promise<HandlerResult> | HandlerResult
  ): RequestHandler {
    const log = this.bindLog({ kind: "http" });
    return async (req: Request, res: Response, next: NextFunction) => {
      const ctx = this.buildCtx(req);
      try {
        log.debug({ route: req.route?.path, method: req.method }, "ctrl_enter");
        const result = await Promise.resolve(fn.call(this, ctx));
        if (result?.headers) {
          for (const [k, v] of Object.entries(result.headers))
            res.setHeader(k, v);
        }
        res.status(result?.status ?? 200).json(result?.body ?? { ok: true });
        log.debug({ status: res.statusCode }, "ctrl_exit");
      } catch (err) {
        log.error({ err: String(err) }, "ctrl_error");
        next(err);
      }
    };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Context + helpers
  // ────────────────────────────────────────────────────────────────────────────

  protected buildCtx(req: Request): HandlerCtx {
    return {
      requestId: this.getRequestIdFrom(req),
      method: req.method,
      url: req.originalUrl ?? req.url,
      headers: req.headers as Record<string, unknown>,
      params: (req.params ?? {}) as Record<string, unknown>,
      query: (req.query ?? {}) as Record<string, unknown>,
      body: req.body,
    };
  }

  protected getRequestIdFrom(req: Request): string {
    return String(req.get("x-request-id") ?? "").trim();
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Response helpers
  // ────────────────────────────────────────────────────────────────────────────

  /** Success envelope — used by controllers returning SvcReceiver-compatible results. */
  protected ok(
    status: number,
    data: unknown,
    requestId?: string
  ): HandlerResult {
    return {
      status,
      body: {
        ok: true,
        requestId,
        ...(typeof data === "object" && data ? (data as object) : { data }),
      },
    };
  }

  /** Error envelope — canonical problem response. */
  protected fail(
    status: number,
    error: string,
    detail?: string | Record<string, unknown>,
    requestId?: string
  ): HandlerResult {
    return { status, body: { ok: false, requestId, error, detail } };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // File utilities (atomic writes, repo-safe resolution)
  // ────────────────────────────────────────────────────────────────────────────

  protected ensureDir(dirPath: string): void {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  protected resolveRepoPath(p: string): string {
    return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
  }

  protected writeFileAtomic(
    targetPath: string,
    contents: string,
    tmpPrefix = ".nv-tmp"
  ): void {
    const dir = path.dirname(targetPath);
    this.ensureDir(dir);
    const tmpFile = path.join(
      dir,
      `${tmpPrefix}.${Date.now()}.${process.pid}.${Math.random()
        .toString(36)
        .slice(2)}.tmp`
    );
    fs.writeFileSync(tmpFile, contents, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmpFile, targetPath);
    try {
      const fd = fs.openSync(dir, "r");
      fs.fsyncSync(fd);
      fs.closeSync(fd);
    } catch {
      /* non-fatal */
    }
  }
}
