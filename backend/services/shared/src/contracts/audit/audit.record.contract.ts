// backend/services/shared/src/contracts/audit/audit.record.contract.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - adr0022-shared-wal-and-db-base
 *
 * Purpose:
 * - Persisted (Mongo) record aligned 1:1 with your sample document.
 * - Provides factory to finalize a begin+end pair into a DB-ready record.
 */

import { AuditContractBase } from "./audit.base.contract";
import { AuditEntryContract } from "./audit.entry.contract";

export interface AuditRecordJson {
  eventId: string;
  billableUnits: number;
  durationMs: number;
  finalizeReason: string; // e.g., "finish" | "error" | "timeout"
  method: string; // e.g., "PUT"
  path: string; // e.g., "/api/acts"
  requestId: string;
  slug: string; // e.g., "act"
  status: number; // 100..599
  ts: string; // ISO-8601
}

export class AuditRecordContract extends AuditContractBase<AuditRecordJson> {
  public readonly eventId: string;
  public readonly billableUnits: number;
  public readonly durationMs: number;
  public readonly finalizeReason: string;
  public readonly method: string;
  public readonly path: string;
  public readonly requestId: string;
  public readonly slug: string;
  public readonly status: number;
  public readonly ts: string;

  public constructor(json: AuditRecordJson) {
    super();
    this.eventId = AuditContractBase.takeString(
      { eventId: json.eventId },
      "eventId"
    )!;
    this.billableUnits = AuditContractBase.toNonNegInt(
      json.billableUnits,
      "billableUnits"
    );
    this.durationMs = AuditContractBase.toNonNegInt(
      json.durationMs,
      "durationMs"
    );
    this.finalizeReason = AuditContractBase.takeString(
      { finalizeReason: json.finalizeReason },
      "finalizeReason"
    )!;
    this.method = AuditContractBase.normalizeMethod(json.method);
    this.path = AuditContractBase.normalizePath(json.path);
    this.requestId = AuditContractBase.takeString(
      { requestId: json.requestId },
      "requestId"
    )!;
    this.slug = AuditContractBase.normalizeSlug(json.slug);
    this.status = AuditContractBase.toIntInRange(
      json.status,
      AuditContractBase.HTTP_MIN,
      AuditContractBase.HTTP_MAX,
      "status"
    );
    if (!AuditContractBase.isIsoLike(json.ts)) {
      throw new Error("ts: expected ISO-8601 string");
    }
    this.ts = json.ts;
  }

  public static parse(
    input: unknown,
    ctx = "AuditRecord"
  ): AuditRecordContract {
    const obj = AuditContractBase.ensurePlainObject(input, ctx);

    const eventId = AuditContractBase.takeString(obj, "eventId")!;
    const finalizeReason = AuditContractBase.takeString(obj, "finalizeReason")!;
    const method = AuditContractBase.takeString(obj, "method")!;
    const path = AuditContractBase.takeString(obj, "path")!;
    const requestId = AuditContractBase.takeString(obj, "requestId")!;
    const slug = AuditContractBase.takeString(obj, "slug")!;
    const ts = AuditContractBase.takeString(obj, "ts")!;

    const billableUnits = obj["billableUnits"];
    const durationMs = obj["durationMs"];
    const status = obj["status"];

    return new AuditRecordContract({
      eventId,
      billableUnits: AuditContractBase.toNonNegInt(
        billableUnits,
        "billableUnits"
      ),
      durationMs: AuditContractBase.toNonNegInt(durationMs, "durationMs"),
      finalizeReason,
      method,
      path,
      requestId,
      slug,
      status: AuditContractBase.toIntInRange(status, 100, 599, "status"),
      ts,
    });
  }

  /**
   * Build a persisted record from a begin+end wire pair.
   * - eventId: provided or derived (evt-<requestId>-<end.ts>)
   * - billableUnits: defaults to 1
   * - durationMs: max(0, end.ts - begin.ts)
   * - finalizeReason: "finish" on ok; "error" otherwise (overrideable)
   * - method/path/slug: from end.target (normalize path via arg if needed)
   */
  public static fromEntries(params: {
    begin: AuditEntryContract;
    end: AuditEntryContract;
    eventId?: string;
    billableUnits?: number;
    finalizeReason?: string;
    normalizedPath?: string;
  }): AuditRecordContract {
    const { begin, end } = params;

    if (begin.phase !== "begin" || end.phase !== "end") {
      throw new Error("fromEntries requires a begin and an end entry.");
    }
    if (begin.requestId !== end.requestId) {
      throw new Error("begin/end requestId mismatch.");
    }

    const durationMs = Math.max(0, end.ts - begin.ts);
    const endJson = end.toJSON();
    const status = endJson.http?.code ?? 0;
    if (!Number.isInteger(status) || status < 100 || status > 599) {
      throw new Error(
        "status missing on end entry (http.code 100..599 required)"
      );
    }

    const finalizeReason =
      params.finalizeReason ?? (endJson.status === "ok" ? "finish" : "error");

    const tsIso = AuditContractBase.toIso(end.ts);

    return new AuditRecordContract({
      eventId:
        params.eventId ??
        AuditContractBase.finalizeEventId(begin.requestId, end.ts),
      billableUnits:
        params.billableUnits ?? AuditContractBase.DEFAULT_BILLABLE_UNITS,
      durationMs,
      finalizeReason,
      method: endJson.target.method,
      path: params.normalizedPath ?? endJson.target.route,
      requestId: begin.requestId,
      slug: endJson.target.slug,
      status,
      ts: tsIso,
    });
  }

  public toJSON(): AuditRecordJson {
    return {
      eventId: this.eventId,
      billableUnits: this.billableUnits,
      durationMs: this.durationMs,
      finalizeReason: this.finalizeReason,
      method: this.method,
      path: this.path,
      requestId: this.requestId,
      slug: this.slug,
      status: this.status,
      ts: this.ts,
    };
  }
}
