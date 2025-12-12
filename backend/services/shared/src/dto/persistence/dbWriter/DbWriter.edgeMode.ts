// backend/services/shared/src/dto/persistence/dbWriter/DbWriter.edgeMode.ts
/**
 * Docs:
 * - ADR-0070 (DbDto/MemDto hierarchy) [context for DB_STATE patterns]
 * - ADR-0072 (Edge Mode Factory — Root Env Switches)
 *
 * Purpose:
 * - Small, testable state machine that decides:
 *   - Whether DbWriter should operate in "real" or "mock" mode for the
 *     current DB_STATE/mockMode.
 *   - Whether DB writes are allowed at all for the given DB_STATE/mockMode.
 * - This module has **no side effects**: it does not construct DbWriter or
 *   any workers; it only returns decisions. DbWriter.ts owns worker wiring.
 */

export type DbWriterMode = "real" | "mock";

export interface DbWriterEdgeModeConfig {
  dbState: string;
  mockMode: boolean;
}

export function resolveDbWriterMode(
  cfg: DbWriterEdgeModeConfig
): { ok: true; mode: DbWriterMode } | { ok: false; reason: string } {
  const normalized = (cfg.dbState || "").trim().toLowerCase();
  const mockMode = !!cfg.mockMode;

  // 1) prod is a hard block, regardless of mockMode
  if (normalized === "prod" || normalized === "production") {
    return {
      ok: false,
      reason:
        'DB_STATE="prod" is forbidden for DbWriter in test/mocked flows; refusing to run any writes against prod. Ops: check DB_STATE and mock_mode configuration.',
    };
  }

  // 2) Non-prod + mockMode === true → mock mode
  if (mockMode) {
    return { ok: true, mode: "mock" };
  }

  // 3) mockMode === false → DB_STATE cannot be dev, stage, or prod
  const forbiddenNonMockStates = new Set([
    "dev",
    "development",
    "stage",
    "staging",
    "prod",
    "production",
  ]);

  if (forbiddenNonMockStates.has(normalized)) {
    return {
      ok: false,
      reason:
        `DB_STATE="${cfg.dbState}" is not allowed when mock_mode=false. ` +
        `Use a dedicated test DB state (e.g. "smoke", "testsuite") before running non-mocked writes. ` +
        `Ops: verify DB_STATE and mock_mode before re-running.`,
    };
  }

  // Anything else (e.g. "smoke", "ci", "testsuite") is allowed with real DB
  return { ok: true, mode: "real" };
}
