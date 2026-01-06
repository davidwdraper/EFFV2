// backend/services/shared/src/http/handlers/seeding/handlerSeederBase.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0101 (Universal seeder + seeder→handler pairs)
 * - ADR-0042 (HandlerContext Bus — KISS)
 *
 * Purpose:
 * - Shared base + types for all seeders.
 * - Seeders are orchestration rails:
 *   - read from ctx and rt (via ctx["rt"])
 *   - write to ctx only
 *   - no I/O, no payload mutation
 *
 * Notes:
 * - Seeders are NOT handlers and do not produce handler-test records.
 * - Seeders fail-fast by setting error rails on ctx and leaving handlerStatus="error".
 * - Execution loops (controller/test-runner) must stop the pair when ctx is on error rails.
 *
 * ADR-0101 seeding defaults:
 * - Pipelines may omit seedSpec entirely; rails normalize to {}.
 * - Base is tolerant: seedSpec may be {}; rules may be omitted.
 */

import type { HandlerContext } from "../HandlerContext";
import type { ControllerBase } from "../../../base/controller/ControllerBase";

export type SeedRuleSource =
  | { kind: "ctx"; key: string }
  | { kind: "rt"; key: string };

export type SeedRule = {
  from: SeedRuleSource;
  to: string;
  required?: boolean;
};

/**
 * Declarative seed spec. Intentionally tolerant:
 * - rules may be omitted; treated as []
 * - seedSpec may be {}; treated as { rules: [] }
 */
export type SeedSpec = {
  rules?: SeedRule[];
};

export abstract class HandlerSeederBase {
  protected readonly ctx: HandlerContext;
  protected readonly controller: ControllerBase;
  protected readonly seedSpec: SeedSpec;

  public constructor(
    ctx: HandlerContext,
    controller: ControllerBase,
    seedSpec?: SeedSpec
  ) {
    this.ctx = ctx;
    this.controller = controller;

    // Rails default: {} is valid and means "no rules".
    const spec = seedSpec && typeof seedSpec === "object" ? seedSpec : {};
    this.seedSpec = spec;
  }

  public abstract run(): Promise<void>;

  protected failSeed(input: {
    title: string;
    detail: string;
    status?: number;
  }): void {
    const requestId = this.safeGet("requestId");
    this.ctx.set("handlerStatus", "error");
    this.ctx.set("response.status", input.status ?? 500);
    this.ctx.set("response.body", {
      title: input.title,
      detail: input.detail,
      requestId,
    });
  }

  protected safeGet(key: string): any {
    try {
      return this.ctx.get(key as any);
    } catch {
      return undefined;
    }
  }
}
