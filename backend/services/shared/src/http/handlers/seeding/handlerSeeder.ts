// backend/services/shared/src/http/handlers/seeding/handlerSeeder.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0101 (Universal seeder + seeder→handler pairs)
 * - ADR-0042 (HandlerContext Bus — KISS)
 *
 * Purpose:
 * - Universal seeder implementation used by default for every pipeline step.
 * - Seeders are orchestration rails:
 *   - read from ctx and rt (via ctx["rt"])
 *   - write to ctx only
 *   - no I/O, no payload mutation
 *
 * Notes:
 * - Seeders are NOT handlers and do not produce handler-test records.
 * - Seeders fail-fast by setting error rails on ctx and leaving handlerStatus="error".
 * - Execution loops (controller/test-runner) must stop the pair when ctx is on error rails.
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

export type SeedSpec = {
  rules: SeedRule[];
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
    this.seedSpec = seedSpec ?? { rules: [] };
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

/**
 * Default universal seeder.
 */
export class HandlerSeeder extends HandlerSeederBase {
  public async run(): Promise<void> {
    const rules = Array.isArray(this.seedSpec?.rules)
      ? this.seedSpec.rules
      : [];

    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];

      const toKey = typeof r?.to === "string" ? r.to.trim() : "";
      if (!toKey) {
        this.failSeed({
          title: "seed_rule_invalid",
          detail: `Seed rule at index=${i} has blank 'to' key.`,
          status: 500,
        });
        return;
      }

      const from = r?.from;
      const required = r?.required === undefined ? true : !!r.required;

      let value: any = undefined;

      if (from?.kind === "ctx") {
        const fromKey = typeof from.key === "string" ? from.key.trim() : "";
        if (!fromKey) {
          this.failSeed({
            title: "seed_rule_invalid",
            detail: `Seed rule at index=${i} has blank ctx from.key for to="${toKey}".`,
            status: 500,
          });
          return;
        }

        value = this.safeGet(fromKey);
      } else if (from?.kind === "rt") {
        const fromKey = typeof from.key === "string" ? from.key.trim() : "";
        if (!fromKey) {
          this.failSeed({
            title: "seed_rule_invalid",
            detail: `Seed rule at index=${i} has blank rt from.key for to="${toKey}".`,
            status: 500,
          });
          return;
        }

        const rt = this.safeGet("rt");
        value = rt && typeof rt === "object" ? (rt as any)[fromKey] : undefined;
      } else {
        this.failSeed({
          title: "seed_rule_invalid",
          detail: `Seed rule at index=${i} has invalid 'from' (kind must be "ctx" or "rt"). to="${toKey}".`,
          status: 500,
        });
        return;
      }

      if ((value === undefined || value === null) && required) {
        const fromDesc =
          from?.kind === "ctx"
            ? `ctx["${String((from as any)?.key)}"]`
            : `rt["${String((from as any)?.key)}"]`;

        this.failSeed({
          title: "seed_required_value_missing",
          detail: `Required seed value missing: ${fromDesc} -> ctx["${toKey}"].`,
          status: 500,
        });
        return;
      }

      // Always write (even undefined) only when not required; required already returned above.
      if (value !== undefined && value !== null) {
        this.ctx.set(toKey as any, value);
      }
    }
  }
}
