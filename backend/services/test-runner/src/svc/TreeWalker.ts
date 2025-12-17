// backend/services/test-runner/src/svc/TreeWalker.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0077 (Test-Runner vNext — Single Orchestrator Handler)
 *
 * Purpose:
 * - TreeWalker V1: return exactly one hard-coded pipeline index.ts path.
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
    const absolutePath =
      "/Users/ddraper005/eff/backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/index.ts";

    // V1: infer rootDir and relativePath from the hard-coded absolute path.
    const marker = "/eff/";
    const markerIdx = absolutePath.indexOf(marker);

    const rootDir =
      markerIdx >= 0
        ? absolutePath.slice(0, markerIdx + marker.length - 1) // "/Users/.../eff"
        : "";

    const relativePath =
      markerIdx >= 0
        ? absolutePath.slice(markerIdx + marker.length) // "backend/..."
        : absolutePath;

    return {
      rootDir,
      pipelines: [{ absolutePath, relativePath }],
    };
  }
}
