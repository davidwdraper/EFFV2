// backend/services/shared/src/http/handlers/seeding/seederRegistry.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0101 (Universal seeder + seeder→handler pairs)
 *
 * Purpose:
 * - Deterministic name → seeder constructor resolver.
 * - Keeps execution rails free of conditionals.
 *
 * Conventions:
 * - "noop" => NoopSeeder
 * - "handlerSeeder" => HandlerSeeder
 * - any other name => error (rails misconfigured)
 */

import type { HandlerContext } from "../HandlerContext";
import type { ControllerBase } from "../../../base/controller/ControllerBase";

import type { SeedSpec, HandlerSeederBase } from "./handlerSeederBase";
import { HandlerSeeder } from "./handlerSeeder";
import { NoopSeeder } from "./noop";

export type SeederCtor = new (
  ctx: HandlerContext,
  controller: ControllerBase,
  seedSpec?: SeedSpec
) => HandlerSeederBase;

export function resolveSeederCtor(seedNameRaw: unknown): SeederCtor {
  const seedName = typeof seedNameRaw === "string" ? seedNameRaw.trim() : "";

  if (!seedName) {
    throw new Error(
      'SEEDER_NAME_INVALID: seedName is blank. Rails: seedName must be non-empty (default is "noop").'
    );
  }

  if (seedName === "noop") return NoopSeeder;
  if (seedName === "handlerSeeder") return HandlerSeeder;

  throw new Error(
    `SEEDER_NAME_UNKNOWN: seedName="${seedName}". Ops/Dev: add the seeder module under seeding/ and register it in seederRegistry.ts.`
  );
}
