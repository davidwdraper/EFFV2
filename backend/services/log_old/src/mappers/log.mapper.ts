// backend/services/log/src/mappers/log.mapper.ts
/**
 * NowVibin — Backend
 * Service: log
 * Why:
 *   Explicit domain↔DB mapping keeps models swappable and tests deterministic.
 * ADRs:
 *   - SOP v4 (Reduced, Clean)
 */

import type { LogEvent } from "@eff/shared/src/contracts/log";
import type { LogDocument } from "../models/Log";

export function dbToDomain(doc: LogDocument): LogEvent {
  const o = doc.toObject ? doc.toObject() : (doc as any);
  return {
    eventId: o.eventId,
    timeCreated: o.timeCreated,
    service: o.service,
    channel: o.channel,
    level: o.level,
    message: o.message,
    path: o.path,
    method: o.method,
    status: o.status,
    requestId: o.requestId,
    userId: o.userId,
    entityName: o.entityName,
    entityId: o.entityId,
    sourceFile: o.sourceFile,
    sourceLine: o.sourceLine,
    sourceFunction: o.sourceFunction,
    payload: o.payload,
    v: o.v ?? 1,
  };
}

export function domainToDb(e: LogEvent) {
  return { ...e };
}
