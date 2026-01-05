// backend/services/test-runner/src/svc/TreeWalker.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0077 (Test-Runner vNext — Single Orchestrator Handler)
 *
 * Purpose:
 * - TreeWalker V1: return exactly one hard-coded pipeline index path.
 *
 * IMPORTANT (dist-first):
 * - absolutePath MUST point at the runtime-compiled pipeline index in dist (.js).
 * - relativePath MUST remain the human/stable src path (.ts) for reporting/DTOs.
 *
 * Invariants:
 * - Deterministic output order.
 * - No filesystem scanning in V1.
 */

export type TreeWalkerResult = {
  rootDir: string;
  pipelines: Array<{ absolutePath: string; relativePath: string }>;
};

export class TreeWalker {
  public execute(): TreeWalkerResult {
    // Runtime (dist) absolute path used for module loading.

    // ** for testing we return a single pipeline...
    const absolutePath =
      "/Users/ddraper005/eff/backend/services/auth/dist/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/UserSignupPL.js";

    // Stable human path used for reporting and persisted DTO fields.
    const relativePath =
      "backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/UserSignupPL.ts";

    const marker = "/eff/";
    const markerIdx = absolutePath.indexOf(marker);

    const rootDir =
      markerIdx >= 0
        ? absolutePath.slice(0, markerIdx + marker.length - 1) // "/Users/.../eff"
        : "";

    return {
      rootDir,
      pipelines: [{ absolutePath, relativePath }],
    };
  }
}
