// shared/utils/logger.ts
import axios from "axios";
import { Request } from "express";
import { getCallerInfo, CallerInfo } from "./logMeta";

const NODE_ENV = process.env.NODE_ENV || "dev";
const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const LOG_SERVICE_URL =
  process.env.LOG_SERVICE_URL || "http://localhost:4006/log";

const levelMap: Record<string, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const currentLevel = levelMap[LOG_LEVEL.toLowerCase()] ?? 2;

function extractLogContext(req: Request): Record<string, any> {
  return {
    path: req.originalUrl,
    method: req.method,
    userId: (req as any).user?._id,
    entityId: req.params?.id,
    entityName: (req as any).entityName,
    ip: req.ip,
  };
}

export const logger = {
  async log(
    type: "error" | "warn" | "info" | "debug",
    message: string,
    meta: Record<string, any> = {},
    callerInfo?: CallerInfo
  ) {
    const level = levelMap[type];
    if (level > currentLevel) return;

    const info: CallerInfo | undefined =
      callerInfo ?? getCallerInfo(3) ?? undefined;
    const { file, line, functionName } = info || {};

    const payload = {
      logType: level,
      logSeverity: level,
      message,
      ...meta,
      sourceFile: file,
      sourceLine: line,
      sourceFunction: functionName,
      timeCreated: new Date().toISOString(),
    };

    // 🖨️ Console logging (only in non-prod)
    if (NODE_ENV !== "production") {
      const prefix = `[${type.toUpperCase()}]`;
      if (level <= 1) console.warn(prefix, message, meta);
      else if (level <= 3) console.log(prefix, message, meta);
    }

    // 📝 Only write error/warn to DB
    if (level <= 1) {
      try {
        await axios.post(LOG_SERVICE_URL, payload);
      } catch (err) {
        if (NODE_ENV !== "production") {
          console.warn(
            "[logger] Failed to send log:",
            err instanceof Error ? err.message : err
          );
        }
      }
    }
  },

  error(msg: string, meta?: Record<string, any>, callerInfo?: CallerInfo) {
    return this.log("error", msg, meta, callerInfo);
  },

  warn(msg: string, meta?: Record<string, any>, callerInfo?: CallerInfo) {
    return this.log("warn", msg, meta, callerInfo);
  },

  info(msg: string, meta?: Record<string, any>, callerInfo?: CallerInfo) {
    return this.log("info", msg, meta, callerInfo);
  },

  debug(msg: string, meta?: Record<string, any>, callerInfo?: CallerInfo) {
    return this.log("debug", msg, meta, callerInfo);
  },

  extractLogContext,
};
