// File: services/shared/utils/logger.ts
import axios from 'axios';
import { Request } from 'express';

const NODE_ENV = process.env.NODE_ENV || 'dev';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_SERVICE_URL = process.env.LOG_SERVICE_URL || 'http://localhost:4006/log';

const levelMap: Record<string, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};const currentLevel = levelMap[LOG_LEVEL.toLowerCase()] ?? 2;

function getCallerLocation(): { service?: string; file?: string; line?: number } {
  const err = new Error();
  const stack = err.stack?.split('\n') || [];
  const callerLine = stack[3] || '';
  const match = callerLine.match(/\((.*):(\d+):(\d+)\)/);

  if (!match) return {};

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
    if (level > currentLevel) return;

    const { service, file, line } = getCallerLocation();

    if (NODE_ENV !== 'production') {
      console[type](`[${type.toUpperCase()}]`, message, { ...meta, service, file, line });
    }

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
