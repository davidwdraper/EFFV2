// backend/services/shared/src/http/handlers/seeding/handlerSeeder.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0101 (Universal seeder + seeder→handler pairs)
 * - ADR-0042 (HandlerContext Bus — KISS)
 *
 * Purpose:
 * - Universal seeder implementation used by default for pipeline steps that declare
 *   seeding rules.
 *
 * Notes:
 * - Seeders are orchestration rails:
 *   - read from ctx and rt (via ctx["rt"])
 *   - write to ctx only
 *   - no I/O, no payload mutation
 *
 * ADR-0101 seeding defaults:
 * - Pipelines may omit seedSpec entirely; rails normalize to {}.
 * - This seeder treats missing/invalid rules as an empty ruleset.
 */

import { HandlerSeederBase, SeedRule } from "./handlerSeederBase";

/**
 * Default universal seeder.
 * - Interprets seedSpec.rules (if present) and copies values from ctx/rt into ctx.
 */
export class HandlerSeeder extends HandlerSeederBase {
  public async run(): Promise<void> {
    const rules = Array.isArray(this.seedSpec?.rules)
      ? (this.seedSpec.rules as SeedRule[])
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

      // Only write when we actually have a value.
      if (value !== undefined && value !== null) {
        this.ctx.set(toKey as any, value);
      }
    }
  }
}
