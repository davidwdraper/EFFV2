import axios from "axios";
import { Request } from "express";
import { getCallerInfo } from "./logMeta";

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
    meta: Record<string, any> = {}
  ) {
    const level = levelMap[type];
    if (level > currentLevel) return;

    // 🧠 Automatically determine caller info
    const caller = getCallerInfo(3);
    const { file, line, functionName } = caller || {};

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

    // 🖨️ Console log for non-production (all levels)
    if (NODE_ENV !== "production") {
      const prefix = `[${type.toUpperCase()}]`;
      if (level <= 1) console.warn(prefix, message, payload);
      else console.log(prefix, message, payload);
    }

    // 📝 Send only errors and warnings to DB
    if (level <= 1) {
      try {
        await axios.post(LOG_SERVICE_URL, payload);
      } catch (err) {
        if (NODE_ENV !== "production") {
          console.warn(
            "[logger] Failed to POST to log service:",
            err instanceof Error ? err.message : err
          );
        }
      }
    }
  },

  error(msg: string, meta?: Record<string, any>) {
    return logger.log("error", msg, meta);
  },

  warn(msg: string, meta?: Record<string, any>) {
    return logger.log("warn", msg, meta);
  },

  info(msg: string, meta?: Record<string, any>) {
    return logger.log("info", msg, meta);
  },

  debug(msg: string, meta?: Record<string, any>) {
    return logger.log("debug", msg, meta);
  },

  extractLogContext,
};
