// backend/services/gateway/src/types/audit.ts
import { z } from "zod";
import { auditEventContract } from "@shared/src/contracts/auditEvent.contract";

// Canonical event type — inferred from shared contract (single source of truth)
export type AuditEvent = z.infer<typeof auditEventContract>;

// Gateway-local config/result types stay local
export interface WalConfig {
  dir: string;
  fileMaxMB: number;
  retentionDays: number;
  ringMaxEvents: number;
  batchSize: number;
  flushMs: number;
  maxRetryMs: number;
  dropAfterMB: number;
}

export interface DispatchResult {
  ok: boolean;
  delivered: number;
  retriable: boolean;
  status?: number;
  error?: unknown;
}
