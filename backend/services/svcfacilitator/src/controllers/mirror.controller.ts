// backend/services/svcfacilitator/src/controllers/MirrorController.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0007 (SvcConfig Contract — fixed shapes & keys, OO form)
 *   - ADR-0008 (SvcFacilitator LKG — boot resilience when DB is down)
 *
 * Purpose:
 * - Accept a pushed mirror from gateway, validate against the canonical contract,
 *   replace in-memory copy, and persist a Last-Known-Good (LKG) snapshot atomically.
 *
 * Behavior:
 * - Payload shape: { mirror: Record<string, ServiceConfigRecordJSON> }
 *   where keys are "<slug>@<version>" and values match the canonical record.
 * - On success: store normalized mirror to memory and write LKG JSON to disk.
 * - On any validation error: 400 with a clear message (no partial writes).
 *
 * Env (required):
 * - SVCCONFIG_LKG_PATH: absolute or repo-root-relative path to the JSON snapshot file.
 */

import type { Request, Response } from "express";
import fs from "fs";
import path from "path";
import os from "os";

import { SvcReceiver } from "@nv/shared/svc/SvcReceiver";
import { EnvLoader } from "@nv/shared/env/EnvLoader";
import {
  ServiceConfigRecord,
  type ServiceConfigMirror,
} from "@nv/shared/contracts/svcconfig.contract";
import { mirrorStore } from "../services/mirrorStore";

export class MirrorController {
  private readonly rx = new SvcReceiver("svcfacilitator");

  public async mirrorLoad(req: Request, res: Response): Promise<void> {
    await this.rx.receive(
      {
        method: req.method,
        url: req.originalUrl ?? req.url,
        headers: req.headers as Record<string, unknown>,
        params: req.params,
        query: req.query as Record<string, unknown>,
        body: req.body,
      },
      {
        status: (code) => {
          res.status(code);
          return res;
        },
        setHeader: (k, v) => res.setHeader(k, v),
        json: (payload) => res.json(payload),
      },
      async ({ requestId, body }) => {
        // 1) Validate shape and normalize via OO contract (throws on any error)
        const rawMirror = (body as any)?.mirror;
        if (
          !rawMirror ||
          typeof rawMirror !== "object" ||
          Array.isArray(rawMirror)
        ) {
          return {
            status: 400,
            body: {
              ok: false,
              requestId,
              error: "invalid_payload",
              detail:
                "expected { mirror: Record<string, ServiceConfigRecordJSON> }",
            },
          };
        }

        let normalized: ServiceConfigMirror;
        try {
          normalized = ServiceConfigRecord.parseMirror(rawMirror);
        } catch (e) {
          return {
            status: 400,
            body: {
              ok: false,
              requestId,
              error: "mirror_validation_failed",
              detail: String(e),
            },
          };
        }

        // 2) Swap in-memory copy
        mirrorStore.setMirror(normalized);

        // 3) Persist LKG atomically
        try {
          const lkgPath = EnvLoader.requireEnv("SVCCONFIG_LKG_PATH");
          const resolvedPath = path.isAbsolute(lkgPath)
            ? lkgPath
            : path.join(EnvLoader.findRepoRoot?.() ?? process.cwd(), lkgPath);

          // Ensure directory exists
          fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

          // Write atomically: tmp → rename
          const tmpFile = path.join(
            path.dirname(resolvedPath),
            `.svcfacilitator-mirror.${Date.now()}.${process.pid}.${Math.random()
              .toString(36)
              .slice(2)}.tmp`
          );

          const payload = JSON.stringify(
            {
              savedAt: new Date().toISOString(),
              requestId,
              mirror: normalized,
            },
            null,
            2
          );

          fs.writeFileSync(tmpFile, payload, { encoding: "utf8", mode: 0o600 });
          fs.renameSync(tmpFile, resolvedPath);
          // Best-effort: fsync the directory to reduce rename loss on crash (optional, macOS-safe)
          try {
            const dirFd = fs.openSync(path.dirname(resolvedPath), "r");
            fs.fsyncSync(dirFd);
            fs.closeSync(dirFd);
          } catch {
            /* non-fatal */
          }
        } catch (e) {
          // Failure to persist LKG should not block live operation, but we report it.
          return {
            status: 200, // accept the mirror to keep system live
            body: {
              ok: true,
              requestId,
              accepted: true,
              services: Object.keys(normalized).length,
              lkgSaved: false,
              lkgError: String(e),
            },
          };
        }

        // 4) Success
        return {
          status: 200,
          body: {
            ok: true,
            requestId,
            accepted: true,
            services: Object.keys(normalized).length,
            lkgSaved: true,
            host: os.hostname(),
          },
        };
      }
    );
  }
}
