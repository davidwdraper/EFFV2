// backend/services/svcfacilitator/src/controllers/MirrorController.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0007 (SvcConfig Contract — fixed shapes & keys, OO form)
 *   - ADR-0008 (SvcFacilitator LKG — boot resilience when DB is down)
 *   - ADR-0014 (Base Hierarchy: ServiceEntrypoint vs ServiceBase)
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
import os from "os";

import { ControllerBase } from "@nv/shared/base/ControllerBase";
import { SvcReceiver } from "@nv/shared/svc/SvcReceiver";
import { EnvLoader } from "@nv/shared/env/EnvLoader";
import {
  ServiceConfigRecord,
  type ServiceConfigMirror,
} from "@nv/shared/contracts/svcconfig.contract";
import { mirrorStore } from "../services/mirrorStore";

export class MirrorController extends ControllerBase {
  private readonly rx = new SvcReceiver("svcfacilitator");

  constructor() {
    super({ service: "svcfacilitator" });
  }

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

        // 3) Persist LKG atomically (moved shared bits to ControllerBase)
        try {
          const lkgPath = EnvLoader.requireEnv("SVCCONFIG_LKG_PATH");
          const resolvedPath = this.resolveRepoPath(lkgPath);

          const payload = JSON.stringify(
            {
              savedAt: new Date().toISOString(),
              requestId,
              mirror: normalized,
            },
            null,
            2
          );

          this.writeFileAtomic(resolvedPath, payload, ".svcfacilitator-mirror");
        } catch (e) {
          // Failure to persist LKG should not block live operation, but report it.
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
