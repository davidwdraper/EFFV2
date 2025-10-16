// backend/services/shared/src/svc/s2s/BodyHandlerBase.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0029 — Contract-ID + BodyHandler pipeline
 *   - ADR-0030 — ContractBase & idempotent contract identification
 *
 * Purpose:
 * - Shared base class for service-specific BodyHandlers.
 * - Single concern: validate request (shared schema) → run domain op → validate response (shared schema).
 * - No transport or framework logic here.
 *
 * Invariants:
 * - Contract ID is **declared by the contract class** (extends ContractBase).
 * - Handlers validate both request and response using the same shared contract class.
 * - Errors are thrown and handled by global problem middleware (RFC7807) — not wrapped here.
 */

import type { z } from "zod";
import { ContractBase } from "../../contracts/base/ContractBase";
import type { ContractId } from "./headers";

export interface RequestContext {
  requestId: string;
  now: () => Date;
  logger: {
    info(o: any, m?: string): void;
    warn(o: any, m?: string): void;
    error(o: any, m?: string): void;
  };
  // add service-local ctx (repos, clocks, etc.) in your concrete handler ctor
}

/** Utility types if you want to surface inferred shapes */
export type ReqShape<C extends ContractBase<any, any>> = C extends ContractBase<
  infer R,
  any
>
  ? R
  : never;
export type ResShape<C extends ContractBase<any, any>> = C extends ContractBase<
  any,
  infer S
>
  ? S
  : never;

/**
 * BodyHandlerBase
 * CContract is the contract *class* (not instance), extending ContractBase<Req, Res>.
 */
export abstract class BodyHandlerBase<
  TReq,
  TRes,
  CContract extends typeof ContractBase<TReq, TRes>
> {
  protected readonly contract: CContract;
  protected readonly logger: RequestContext["logger"];

  constructor(opts: { contract: CContract; logger: RequestContext["logger"] }) {
    this.contract = opts.contract;
    this.logger = opts.logger;
  }

  /** Contract IDs (request/response). Override response if it differs. */
  public expectedRequestId(): ContractId {
    return this.contract.getContractId() as ContractId;
  }
  public expectedResponseId(): ContractId {
    return this.contract.getContractId() as ContractId;
  }

  /** Zod schemas exposed by the concrete contract class (instance not required). */
  protected requestSchema(): z.ZodType<TReq> {
    // access via the prototype to avoid needing an instance
    const tmp = new (this.contract as any)();
    return tmp.request as z.ZodType<TReq>;
  }
  protected responseSchema(): z.ZodType<TRes> {
    const tmp = new (this.contract as any)();
    return tmp.response as z.ZodType<TRes>;
  }

  /** Domain logic — implement in your concrete handler. No transport concerns here. */
  protected abstract handle(ctx: RequestContext, req: TReq): Promise<TRes>;

  /**
   * Orchestrates: parse-in → handle → validate-out.
   * Returns both the validated response body and the response contract ID to set in headers.
   */
  public async run(
    ctx: RequestContext,
    rawBody: unknown
  ): Promise<{ responseBody: TRes; responseContractId: ContractId }> {
    const t0 = Date.now();
    try {
      const req = this.requestSchema().parse(rawBody);
      const out = await this.handle(ctx, req);
      const resBody = this.responseSchema().parse(out);

      this.logger.info(
        {
          requestId: ctx.requestId,
          tookMs: Date.now() - t0,
          contractReq: this.expectedRequestId(),
          contractRes: this.expectedResponseId(),
        },
        "bodyHandler.ok"
      );

      return {
        responseBody: resBody,
        responseContractId: this.expectedResponseId(),
      };
    } catch (err: any) {
      this.logger.error(
        {
          requestId: ctx.requestId,
          tookMs: Date.now() - t0,
          err: err?.message,
          stack: err?.stack,
          contractReq: this.expectedRequestId(),
        },
        "bodyHandler.error"
      );
      // Let global error middleware map to RFC7807 — do not swallow
      throw err;
    }
  }
}
