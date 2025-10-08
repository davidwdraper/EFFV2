// backend/services/shared/src/contracts/audit/audit.entry.contract.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - adr0022-shared-wal-and-db-base
 *
 * Purpose:
 * - Wire-level audit entry (single event), emitted twice per request:
 *   - phase "begin": after guardrails/auth, before proxy/handler.
 *   - phase "end": after proxy/handler completes (success/failure).
 */

import { AuditContractBase } from "./audit.base.contract";
import {
  AuditTargetContract,
  type AuditTargetJson,
} from "./audit.target.contract";

export type AuditPhase = "begin" | "end";
export type AuditStatus = "ok" | "error";

export interface AuditErrorJson {
  name?: string;
  message?: string;
  stack?: string;
}

export interface AuditEntryJson {
  requestId: string; // x-request-id
  service: string; // emitter slug, e.g., "gateway"
  target: AuditTargetJson; // destination metadata
  phase: AuditPhase; // "begin" | "end"
  ts: number; // ms epoch (emitter clock)
  status?: AuditStatus; // set on "end"
  http?: { code?: number }; // set on "end"
  err?: AuditErrorJson; // set on failures
  meta?: Record<string, unknown>; // additive, schemaless
}

export class AuditEntryContract extends AuditContractBase<AuditEntryJson> {
  public readonly requestId: string;
  public readonly service: string;
  public readonly target: AuditTargetContract;
  public readonly phase: AuditPhase;
  public readonly ts: number;

  public readonly status?: AuditStatus;
  public readonly httpCode?: number;
  public readonly err?: AuditErrorJson;
  public readonly meta?: Record<string, unknown>;

  public constructor(json: AuditEntryJson) {
    super();
    if (!Number.isInteger(json.ts) || json.ts < 0) {
      throw new Error("ts: expected nonnegative integer (ms epoch)");
    }
    if (json.status && json.status !== "ok" && json.status !== "error") {
      throw new Error("status: must be 'ok' | 'error'");
    }
    if (json.http && json.http.code != null) {
      const c = json.http.code;
      if (
        !Number.isInteger(c) ||
        c < AuditContractBase.HTTP_MIN ||
        c > AuditContractBase.HTTP_MAX
      ) {
        throw new Error(
          `http.code: expected ${AuditContractBase.HTTP_MIN}..${AuditContractBase.HTTP_MAX}`
        );
      }
    }
    if (json.phase !== "begin" && json.phase !== "end") {
      throw new Error("phase: must be 'begin' | 'end'");
    }

    this.requestId = json.requestId;
    this.service = AuditContractBase.normalizeSlug(json.service);
    this.target = new AuditTargetContract(json.target);
    this.phase = json.phase;
    this.ts = json.ts;
    this.status = json.status;
    this.httpCode = json.http?.code;
    this.err = json.err;
    this.meta = AuditContractBase.redactMeta(json.meta);
  }

  public static parse(input: unknown, ctx = "AuditEntry"): AuditEntryContract {
    const obj = AuditContractBase.ensurePlainObject(input, ctx);

    const requestId = AuditContractBase.takeString(obj, "requestId")!;
    const service = AuditContractBase.takeString(obj, "service", {
      lower: true,
    })!;
    const phase = AuditContractBase.takeString(obj, "phase")!;
    if (phase !== "begin" && phase !== "end") {
      throw new Error("phase: must be 'begin' | 'end'");
    }
    const ts = obj["ts"];
    if (!Number.isInteger(ts) || (ts as number) < 0) {
      throw new Error("ts: expected nonnegative integer (ms epoch)");
    }

    const target = AuditTargetContract.parse(obj["target"], "AuditTarget");

    // optional status
    let status: AuditStatus | undefined;
    const s = obj["status"];
    if (s != null) {
      if (s !== "ok" && s !== "error")
        throw new Error("status: must be 'ok' | 'error'");
      status = s as AuditStatus;
    }

    // optional http
    let http: { code?: number } | undefined;
    const h = obj["http"];
    if (h != null) {
      const httpObj = AuditContractBase.ensurePlainObject(h, "http");
      const code = httpObj["code"];
      if (code != null) {
        AuditContractBase.toIntInRange(
          code,
          AuditContractBase.HTTP_MIN,
          AuditContractBase.HTTP_MAX,
          "http.code"
        );
      }
      http = { code: code as number | undefined };
    }

    // optional err
    let err: AuditErrorJson | undefined;
    const e = obj["err"];
    if (e != null) {
      const eo = AuditContractBase.ensurePlainObject(e, "err");
      const name = eo["name"];
      if (name != null && typeof name !== "string")
        throw new Error("err.name: expected string");
      const message = eo["message"];
      if (message != null && typeof message !== "string")
        throw new Error("err.message: expected string");
      const stack = eo["stack"];
      if (stack != null && typeof stack !== "string")
        throw new Error("err.stack: expected string");
      err = {
        name: name as string | undefined,
        message: message as string | undefined,
        stack: stack as string | undefined,
      };
    }

    // optional meta
    let meta: Record<string, unknown> | undefined;
    const m = obj["meta"];
    if (m != null) {
      const mo = AuditContractBase.ensurePlainObject(m, "meta");
      meta = {};
      for (const [k, v] of Object.entries(mo)) {
        meta[k] = v;
      }
      meta = AuditContractBase.redactMeta(meta);
    }

    return new AuditEntryContract({
      requestId,
      service,
      target: target.toJSON(),
      phase: phase as AuditPhase,
      ts: ts as number,
      status,
      http,
      err,
      meta,
    });
  }

  public static makeBegin(params: {
    requestId: string;
    service: string;
    target: AuditTargetJson;
    ts?: number;
    meta?: Record<string, unknown>;
  }): AuditEntryContract {
    return new AuditEntryContract({
      requestId: params.requestId,
      service: params.service,
      target: params.target,
      phase: "begin",
      ts: params.ts ?? Date.now(),
      meta: AuditContractBase.redactMeta(params.meta),
    });
  }

  public static makeEnd(params: {
    requestId: string;
    service: string;
    target: AuditTargetJson;
    status: AuditStatus;
    httpCode?: number;
    err?: AuditErrorJson;
    ts?: number;
    meta?: Record<string, unknown>;
  }): AuditEntryContract {
    return new AuditEntryContract({
      requestId: params.requestId,
      service: params.service,
      target: params.target,
      phase: "end",
      ts: params.ts ?? Date.now(),
      status: params.status,
      http: params.httpCode ? { code: params.httpCode } : undefined,
      err: params.err,
      meta: AuditContractBase.redactMeta(params.meta),
    });
  }

  public toJSON(): AuditEntryJson {
    return {
      requestId: this.requestId,
      service: this.service,
      target: this.target.toJSON(),
      phase: this.phase,
      ts: this.ts,
      status: this.status,
      http: this.httpCode != null ? { code: this.httpCode } : undefined,
      err: this.err,
      meta: this.meta,
    };
  }
}
