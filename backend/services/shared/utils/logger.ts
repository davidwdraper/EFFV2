// File: shared/utils/logger.ts
import axios from 'axios';
import { Request } from 'express';

const NODE_ENV = process.env.NODE_ENV || 'dev';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_SERVICE_URL = process.env.LOG_SERVICE_URL || 'http://localhost:4006/log';

console.warn('[logger] 🧪 This is the real logger.ts being loaded');

const levelMap: Record<string, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

const currentLevel = levelMap[LOG_LEVEL.toLowerCase()] ?? 2;

function getCallerLocation(): { service?: string; file?: string; line?: number } {
  const err = new Error();
  const stack = err.stack?.split('\n') || [];

  // Find first stack line outside logger.ts and node_modules
  const callerLine = stack.find(line =>
    line.includes('/services/') &&
    line.includes('.ts') &&
    !line.includes('node_modules')
  );

  if (!callerLine) {
    console.warn('[logger] No matching caller line found');
    return {};
  }

  const match = callerLine.match(/at\s+(.*):(\d+):(\d+)/);
  if (!match) {
    console.warn('[logger] Regex failed to extract location from:', callerLine);
    return {};
  }

  const fullPath = match[1];
  const line = parseInt(match[2], 10);

  const pathParts = fullPath.split('/');
  const file = pathParts.slice(-2).join('/');
  const service = pathParts.includes('services') ? pathParts[pathParts.indexOf('services') + 1] : undefined;

  return { service, file, line };
}

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
async log(type: 'error' | 'warn' | 'info' | 'debug', message: string, meta: Record<string, any> = {}) {
  const level = levelMap[type];
  console.warn(`[logger] log() called with type="${type}" | level=${level} | currentLevel=${currentLevel}`); // ✅ Add this
  if (level > currentLevel) return;

  const { service, file, line } = getCallerLocation();

    try {
      await axios.post(LOG_SERVICE_URL, {
        logType: level,
        logSeverity: level,
        message,
        ...meta,
        service,
        sourceFile: file,
        sourceLine: line,
        timeCreated: new Date().toISOString(),
      });
    } catch (err: unknown) {
      if (NODE_ENV === 'dev') {
        if (err instanceof Error) {
          // TODO: write to filesystem
          console.warn('[logger] Failed to send log:', err.message);
        } else {
          console.warn('[logger] Failed to send log:', err);
        }
      }
    }
  },

  error(msg: string, meta?: Record<string, any>) {
    return this.log('error', msg, meta);
  },
  warn(msg: string, meta?: Record<string, any>) {
    return this.log('warn', msg, meta);
  },
  info(msg: string, meta?: Record<string, any>) {
    return this.log('info', msg, meta);
  },
  debug(msg: string, meta?: Record<string, any>) {
    return this.log('debug', msg, meta);
  },

  extractLogContext,
};
