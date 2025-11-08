// backend/services/gateway/src/middleware/audit/AuditBase.ts
/**
 * Purpose:
 * - Gateway-side audit accessors (DI-only, zero env reads here).
 * - Middleware consumes the WAL engine and WAL dir published by app.ts.
 */

import type { Request } from "express";
import type { IWalEngine } from "../../../../shared/src/wal/IWalEngine";

const APP_WAL_KEY_PRIMARY = "wal";
const APP_WAL_KEY_LEGACY = "gatewayWal";
const APP_WAL_DIR_KEY = "WAL_DIR";

export class AuditBase {
  static getWal(req: Request): IWalEngine {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const locals = (req.app as any)?.locals ?? {};
    const wal: IWalEngine | undefined =
      locals[APP_WAL_KEY_PRIMARY] ?? locals[APP_WAL_KEY_LEGACY];

    if (!wal) {
      throw new Error(
        "[gateway] WAL not initialized. app.ts must publish (app.locals.wal = <IWalEngine>) before mounting audit.*"
      );
    }
    return wal;
  }

  static getWalDir(req: Request): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const locals = (req.app as any)?.locals ?? {};
    const walDir = locals[APP_WAL_DIR_KEY];
    if (typeof walDir !== "string" || walDir.trim() === "") {
      throw new Error(
        "[gateway] WAL_DIR not published. app.ts must set (app.locals.WAL_DIR = <absolute path>) after EnvLoader validation."
      );
    }
    return walDir;
  }

  private static readonly REQ_AUDIT_RID_KEY = "__auditRequestId";

  static getOrCreateRequestId(req: Request): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyReq = req as any;
    if (typeof anyReq[AuditBase.REQ_AUDIT_RID_KEY] === "string")
      return anyReq[AuditBase.REQ_AUDIT_RID_KEY];

    const rid =
      (req.headers["x-request-id"] as string) ||
      (anyReq.id as string | undefined) ||
      AuditBase.randomId();

    anyReq[AuditBase.REQ_AUDIT_RID_KEY] = rid;
    return rid;
  }

  static peekRequestId(req: Request): string | undefined {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (req as any)[AuditBase.REQ_AUDIT_RID_KEY] as string | undefined;
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
