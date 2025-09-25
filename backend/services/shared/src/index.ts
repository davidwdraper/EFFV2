// /backend/services/shared/src/index.ts
/**
 * NowVibin — shared: barrel removed by SOP.
 *
 * This file intentionally exports nothing.
 * Do NOT import from "@eff/shared". Import only the specific module you need:
 *   import { requestId } from "@eff/shared/src/middleware/requestId";
 *
 * Rationale:
 * - Core SOP forbids barrels/shims to prevent drift and name collisions.
 * - Subpath exports are the canonical contract surface.
 */

// No exports. Use subpath imports per SOP.
export {};
