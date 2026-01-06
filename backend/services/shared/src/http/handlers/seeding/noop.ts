// backend/services/shared/src/http/handlers/seeding/noop.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0101 (Universal seeder + seeder→handler pairs)
 *
 * Purpose:
 * - Literal no-op seeder module.
 *
 * Rule:
 * - Rails treat omitted seeding as seedName="noop", seedSpec={}
 * - No special-casing in runners/controllers; noop is resolved like any other seeder.
 */

import { HandlerSeederBase } from "./handlerSeederBase";

export class NoopSeeder extends HandlerSeederBase {
  public async run(): Promise<void> {
    // Intentionally do nothing.
    // No rails mutations. No logging. No side-effects.
  }
}
