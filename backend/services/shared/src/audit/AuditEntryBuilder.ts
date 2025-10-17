// backend/services/shared/src/audit/AuditEntryBuilder.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0025 — Audit WAL with Opaque Payloads & Writer Injection
 * - ADR-0029 — Contract-ID + BodyHandler pipeline
 * - ADR-0030 — ContractBase & idempotent contract identification
 *
 * Purpose:
 * - Single source of truth to construct audit entries that MATCH the locked contract.
 * - Eliminates hand-rolled JSON in middleware/replayers; prevents drift.
 *
 * Invariants:
 * - phase = "begin" | "end" (lowercase, per contract)
 * - target lives under blob
 * - ts is nonnegative integer epoch ms
 * - Runtime schema parse enforces contract in all envs (no toggles)
 */

import { z } from "zod";
import {
  AuditEntry,
  AuditEntriesRequest,
} from "../contracts/audit/audit.entries.v1.contract";

// Public shapes (kept tiny; derived from contract intent)
export type TTarget = {
  slug: string;
  version: number;
  route: string;
  method: string;
};

export type TBeginParams = {
  service: string;
  requestId: string;
  target: TTarget;
  ts?: number;
  note?: string;
};

export type TEndParams = {
  service: string;
  requestId: string;
  target: TTarget;
  httpCode: number;
  ts?: number;
  note?: string;
};

export const AuditEntryBuilder = {
  begin(p: TBeginParams) {
    const entry = {
      meta: {
        service: mustNonEmptyString(p.service, "service"),
        requestId: mustNonEmptyString(p.requestId, "requestId"),
        ts: toEpochMs(p.ts),
      },
      blob: {
        phase: "begin" as const,
        target: mustTarget(p.target),
        ...(p.note ? { note: String(p.note) } : {}),
      },
    } as const;

    AuditEntry.parse(entry); // runtime lock
    return entry;
  },

  end(p: TEndParams) {
    const entry = {
      meta: {
        service: mustNonEmptyString(p.service, "service"),
        requestId: mustNonEmptyString(p.requestId, "requestId"),
        ts: toEpochMs(p.ts),
      },
      blob: {
        phase: "end" as const,
        target: mustTarget(p.target),
        status: p.httpCode >= 400 ? ("error" as const) : ("ok" as const),
        httpCode: mustInt(p.httpCode, "httpCode"),
        ...(p.note ? { note: String(p.note) } : {}),
      },
    } as const;

    AuditEntry.parse(entry); // runtime lock
    return entry;
  },

  /**
   * Validates a full request body (array of entries) matches the contract.
   * Useful for WAL flush/replay before network I/O.
   */
  assertRequestBody(
    body: unknown
  ): asserts body is z.infer<typeof AuditEntriesRequest> {
    AuditEntriesRequest.parse(body);
  },
};

// ── tiny helpers ────────────────────────────────────────────────────────────
function toEpochMs(ts?: number): number {
  const n = ts ?? Date.now();
  const i = Math.trunc(n);
  if (!Number.isFinite(i) || i < 0) throw new Error("invalid ts");
  return i;
}

function mustNonEmptyString(v: unknown, name: string): string {
  if (typeof v !== "string" || v.length === 0)
    throw new Error(`invalid ${name}`);
  return v;
}

function mustInt(v: unknown, name: string): number {
  if (typeof v !== "number" || !Number.isInteger(v))
    throw new Error(`invalid ${name}`);
  return v;
}

function mustTarget(t: unknown): TTarget {
  const ok =
    !!t &&
    typeof (t as any).slug === "string" &&
    Number.isInteger((t as any).version) &&
    typeof (t as any).route === "string" &&
    typeof (t as any).method === "string";
  if (!ok) throw new Error("invalid target");
  return t as TTarget;
}
