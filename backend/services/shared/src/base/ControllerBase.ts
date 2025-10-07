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
 * - Base class for HTTP controllers.
 * - Inherits logger/env context from ServiceBase.
 * - Provides small, reusable utilities commonly needed by controllers.
 *
 * Notes:
 * - Keep focused: helpers here must be broadly useful across controllers.
 */

import fs from "fs";
import path from "path";
import type { Request } from "express";
import { ServiceBase } from "./ServiceBase";

export type HandlerResult = {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
};

export abstract class ControllerBase extends ServiceBase {
  constructor(opts?: { service?: string; context?: Record<string, unknown> }) {
    super({
      service: opts?.service,
      context: { component: "Controller", ...(opts?.context ?? {}) },
    });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Request helpers
  // ────────────────────────────────────────────────────────────────────────────

  /** Extract a request ID from headers (empty string if none). */
  protected getRequestIdFrom(req: Request): string {
    return String(req.get("x-request-id") ?? "").trim();
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Result helpers (SvcReceiver-compatible envelopes)
  // ────────────────────────────────────────────────────────────────────────────

  /** Success envelope for SvcReceiver-style handlers. */
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
        ...(typeof data === "object" && data ? data : { data }),
      },
    };
  }

  /** Error envelope for SvcReceiver-style handlers. */
  protected fail(
    status: number,
    error: string,
    detail?: string | Record<string, unknown>,
    requestId?: string
  ): HandlerResult {
    return { status, body: { ok: false, requestId, error, detail } };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Filesystem helpers (atomic write; repo-relative path resolution)
  // ────────────────────────────────────────────────────────────────────────────

  /** Ensure a directory exists (mkdir -p). */
  protected ensureDir(dirPath: string): void {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  /**
   * Resolve a possibly repo-relative path to an absolute path.
   * If `p` is absolute, return as-is; otherwise resolve from CWD (repo root in our processes).
   */
  protected resolveRepoPath(p: string): string {
    return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
  }

  /**
   * Atomically write text to a file: write to tmp in same dir → rename → fsync dir (best effort).
   */
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

    // Best-effort durability of the rename (platform-tolerant)
    try {
      const fd = fs.openSync(dir, "r");
      fs.fsyncSync(fd);
      fs.closeSync(fd);
    } catch {
      /* non-fatal */
    }
  }
}
