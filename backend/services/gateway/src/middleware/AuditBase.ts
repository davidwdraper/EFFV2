// backend/services/gateway/src/middleware/audit/AuditBase.ts
/**
 * Resolve registrar paths relative to the service's src root:
 *   <repo>/backend/services/gateway/src
 * This guarantees that an env like "../../shared/src/…"
 * works the SAME in gateway and audit.
 */

import type { Request } from "express";
import type { IWalEngine } from "@nv/shared/wal/IWalEngine";
import { buildWal } from "@nv/shared/wal/WalBuilder";
import { AuditWriterFactory } from "@nv/shared/wal/writer/AuditWriterFactory";
import path from "node:path";
import { pathToFileURL } from "node:url";
import fs from "node:fs";

const APP_WAL_LOCALS_KEY = "gatewayWal";
const REQ_AUDIT_RID_KEY = "__auditRequestId";

/** Find "<repo>/backend/services" by walking up until we hit "services". */
function findServicesRoot(startDir: string): string {
  let dir = startDir;
  const root = path.parse(startDir).root;
  while (dir !== root) {
    if (path.basename(dir) === "services") return dir;
    dir = path.dirname(dir);
  }
  throw new Error(
    `[gateway] Unable to locate 'services' root from ${startDir}. Check project layout.`
  );
}

/** <repo>/backend/services/gateway/src */
const SERVICES_ROOT = findServicesRoot(__dirname);
const SERVICE_SRC_ROOT = path.join(SERVICES_ROOT, "gateway", "src");

function resolveRegistrar(spec: string): string {
  // Absolute path or URL-like -> use as-is
  if (spec.startsWith("/") || /^[a-z]+:\/\//i.test(spec)) return spec;
  // TS path alias or package subpath -> let Node/tsconfig-paths handle it
  if (!spec.startsWith(".") && !spec.startsWith("..")) return spec;
  // Relative path -> resolve against service src root
  const abs = path.resolve(SERVICE_SRC_ROOT, spec);
  if (
    !fs.existsSync(abs + ".ts") &&
    !fs.existsSync(abs + ".js") &&
    !fs.existsSync(abs)
  ) {
    // Helpful error if off-by-one
    throw new Error(
      `[gateway] Registrar not found at resolved path: ${abs} (from ${SERVICE_SRC_ROOT} + ${spec})`
    );
  }
  return pathToFileURL(abs).href;
}

export class AuditBase {
  static async ensureWal(req: Request): Promise<IWalEngine> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyApp = req.app as any;
    const existing = anyApp?.locals?.[APP_WAL_LOCALS_KEY] as
      | IWalEngine
      | undefined;
    if (existing) return existing;

    const regSpec =
      process.env.GATEWAY_WRITER_REGISTER?.trim() ||
      process.env.AUDIT_WRITER_REGISTER?.trim();
    if (!regSpec) {
      throw new Error(
        "[gateway] GATEWAY_WRITER_REGISTER (or AUDIT_WRITER_REGISTER) is required"
      );
    }

    const resolvedReg = resolveRegistrar(regSpec);
    await import(/* @vite-ignore */ resolvedReg); // side-effect: register writer(s)

    const walDir =
      process.env.NV_GATEWAY_WAL_DIR?.trim() || process.env.WAL_DIR?.trim();
    if (!walDir) {
      throw new Error("[gateway] NV_GATEWAY_WAL_DIR (or WAL_DIR) is required");
    }

    const writerName =
      process.env.GATEWAY_WAL_WRITER?.trim() ||
      process.env.AUDIT_WRITER?.trim();

    const nameToUse =
      writerName ??
      (typeof (AuditWriterFactory as any).getDefaultName === "function"
        ? (AuditWriterFactory as any).getDefaultName()
        : undefined);

    if (!nameToUse) {
      throw new Error(
        "[gateway] No writer name provided and no default registered. " +
          "Set GATEWAY_WAL_WRITER (or AUDIT_WRITER) OR ensure registrar sets a default."
      );
    }

    const wal = await buildWal({
      journal: { dir: walDir },
      writer: { name: nameToUse, options: {} },
    });

    anyApp.locals ??= {};
    anyApp.locals[APP_WAL_LOCALS_KEY] = wal;
    return wal;
  }

  static getWal(req: Request): IWalEngine {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyApp = req.app as any;
    const wal = anyApp?.locals?.[APP_WAL_LOCALS_KEY] as IWalEngine | undefined;
    if (!wal)
      throw new Error(
        "[gateway] WAL not initialized (audit.begin must run first)"
      );
    return wal;
  }

  static getOrCreateRequestId(req: Request): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyReq = req as any;
    if (typeof anyReq[REQ_AUDIT_RID_KEY] === "string")
      return anyReq[REQ_AUDIT_RID_KEY];

    const rid =
      (req.headers["x-request-id"] as string) ||
      (anyReq.id as string | undefined) ||
      AuditBase.randomId();

    anyReq[REQ_AUDIT_RID_KEY] = rid;
    return rid;
  }

  static peekRequestId(req: Request): string | undefined {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (req as any)[REQ_AUDIT_RID_KEY] as string | undefined;
  }

  private static randomId(): string {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { randomUUID } = require("crypto");
      return randomUUID();
    } catch {
      return `rid_${Math.random().toString(36).slice(2)}`;
    }
  }
}
