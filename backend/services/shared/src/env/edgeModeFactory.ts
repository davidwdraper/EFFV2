// backend/services/shared/src/env/edgeModeFactory.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0039 (env-service centralized non-secret env; runtime reload endpoint)
 *   - ADR-0044 (DbEnvServiceDto — Key/Value Contract)
 *   - ADR-0072 (Edge Mode Factory — Root Env Switches)
 *
 * Purpose:
 * - Provide a single, boot-time factory for resolving the **effective edge mode**
 *   for a service process:
 *     • EdgeMode.Prod      → production edge helpers
 *     • EdgeMode.FullMock  → future "no real DB/API/FS" mocks
 *     • EdgeMode.DbMock    → future "DB-mock, other rails real" mode
 *
 * - Reads three mock-related switches from the root "service-root" env-service
 *   record and validates them.
 * - As of ADR-0072, this factory **always resolves to EdgeMode.Prod**, regardless
 *   of switch values. This lets us wire the mode into AppBase and downstream
 *   constructors without changing runtime behavior yet.
 *
 * Invariants:
 * - Reads values only from DbEnvServiceDto (svcEnv), never from process.env.
 * - Strict parsing:
 *   • NV_MOCK_GUARD_1: "true" | "false"
 *   • NV_MOCK_GUARD_2: "true" | "false"
 *   • NV_MOCK_MODE: "prod" | "full-mock" | "Db-mock"
 * - Fail-fast on invalid configuration with clear Ops guidance.
 */

import { DbEnvServiceDto } from "../dto/db.env-service.dto";
import { getLogger } from "../logger/Logger";

/**
 * Effective edge behavior for a running process.
 *
 * NOTE:
 * - Callers MUST currently treat EdgeMode.Prod as the only effective behavior.
 *   Future ADR(s) will allow honoring FullMock / DbMock with strict safeguards.
 */
export const enum EdgeMode {
  Prod = "prod",
  FullMock = "full-mock",
  DbMock = "Db-mock",
}

/**
 * Internal representation of the root mock switches.
 */
interface RootMockSettings {
  guard1: boolean;
  guard2: boolean;
  rawMode: string;
}

/**
 * Env keys used by the root "service-root" env-service record to control
 * mock behavior across the fleet.
 *
 * Values are stored as strings in DbEnvServiceDto._vars and retrieved via
 * generic accessors as per ADR-0044.
 */
const ROOT_MOCK_GUARD_1_KEY = "NV_MOCK_GUARD_1";
const ROOT_MOCK_GUARD_2_KEY = "NV_MOCK_GUARD_2";
const ROOT_MOCK_MODE_KEY = "NV_MOCK_MODE";

const logger = getLogger({
  service: "shared",
  component: "edgeModeFactory",
});

/**
 * Parse a string into a strict boolean.
 *
 * Only "true" and "false" (case-insensitive) are allowed.
 * Any other value is treated as a configuration error.
 */
function parseBooleanFlag(raw: string, key: string): boolean {
  const normalized = raw.trim().toLowerCase();

  if (normalized === "true") return true;
  if (normalized === "false") return false;

  const message =
    `EDGE_MODE_INVALID_BOOLEAN: Invalid value "${raw}" for "${key}". ` +
    'Expected "true" or "false". ' +
    "Ops: fix this in the service-root env-service record for this env and redeploy.";
  logger.error(
    {
      component: "edgeModeFactory",
      event: "invalid_boolean_flag",
      key,
      value: raw,
    },
    message
  );
  throw new Error(message);
}

/**
 * Read and validate the three root mock switches from the given DbEnvServiceDto.
 *
 * NOTE:
 * - This assumes the provided dto is the root "service-root" record for the
 *   current env. Callers are responsible for fetching the correct dto.
 */
function readRootMockSettings(rootSvcEnv: DbEnvServiceDto): RootMockSettings {
  let guard1Raw: string;
  let guard2Raw: string;
  let modeRaw: string;

  try {
    guard1Raw = rootSvcEnv.getEnvVar(ROOT_MOCK_GUARD_1_KEY);
  } catch (err) {
    const message =
      `EDGE_MODE_FLAG_MISSING: Required flag "${ROOT_MOCK_GUARD_1_KEY}" is missing in service-root. ` +
      'Ops: ensure this key exists and is set to "true" or "false" in the env-service config for this env.';
    logger.error(
      {
        component: "edgeModeFactory",
        event: "missing_guard_1",
        key: ROOT_MOCK_GUARD_1_KEY,
        error: err instanceof Error ? err.message : String(err),
      },
      message
    );
    throw new Error(message);
  }

  try {
    guard2Raw = rootSvcEnv.getEnvVar(ROOT_MOCK_GUARD_2_KEY);
  } catch (err) {
    const message =
      `EDGE_MODE_FLAG_MISSING: Required flag "${ROOT_MOCK_GUARD_2_KEY}" is missing in service-root. ` +
      'Ops: ensure this key exists and is set to "true" or "false" in the env-service config for this env.';
    logger.error(
      {
        component: "edgeModeFactory",
        event: "missing_guard_2",
        key: ROOT_MOCK_GUARD_2_KEY,
        error: err instanceof Error ? err.message : String(err),
      },
      message
    );
    throw new Error(message);
  }

  try {
    modeRaw = rootSvcEnv.getEnvVar(ROOT_MOCK_MODE_KEY);
  } catch (err) {
    const message =
      `EDGE_MODE_FLAG_MISSING: Required flag "${ROOT_MOCK_MODE_KEY}" is missing in service-root. ` +
      'Ops: set this key to "prod", "full-mock", or "Db-mock" in the env-service config for this env.';
    logger.error(
      {
        component: "edgeModeFactory",
        event: "missing_mode",
        key: ROOT_MOCK_MODE_KEY,
        error: err instanceof Error ? err.message : String(err),
      },
      message
    );
    throw new Error(message);
  }

  const guard1 = parseBooleanFlag(guard1Raw, ROOT_MOCK_GUARD_1_KEY);
  const guard2 = parseBooleanFlag(guard2Raw, ROOT_MOCK_GUARD_2_KEY);

  if (
    modeRaw !== EdgeMode.Prod &&
    modeRaw !== EdgeMode.FullMock &&
    modeRaw !== EdgeMode.DbMock
  ) {
    const message =
      `EDGE_MODE_INVALID_MODE: Invalid NV_MOCK_MODE "${modeRaw}". ` +
      'Expected "prod", "full-mock", or "Db-mock". ' +
      "Ops: correct this value in the service-root env-service record for this env.";
    logger.error(
      {
        component: "edgeModeFactory",
        event: "invalid_mode",
        key: ROOT_MOCK_MODE_KEY,
        value: modeRaw,
      },
      message
    );
    throw new Error(message);
  }

  return {
    guard1,
    guard2,
    rawMode: modeRaw,
  };
}

/**
 * Resolve the effective edge mode from the root "service-root" DbEnvServiceDto.
 *
 * CURRENT BEHAVIOR (ADR-0072):
 * - Reads and validates the three root switches.
 * - Logs the settings for observability.
 * - **Always returns EdgeMode.Prod**, ignoring any requested mock modes.
 *
 * Future ADR(s) will:
 * - Map (guard1, guard2, rawMode) → effective EdgeMode,
 * - Enforce production safety (e.g., fail-fast if non-prod modes are enabled in prod env),
 * - Drive injection of real vs mock workers for DbWriter/DbReader/DbDeleter and other edges.
 */
export function resolveEffectiveEdgeMode(
  rootSvcEnv: DbEnvServiceDto
): EdgeMode {
  const settings = readRootMockSettings(rootSvcEnv);

  logger.info(
    {
      component: "edgeModeFactory",
      event: "root_mock_settings_read",
      guard1: settings.guard1,
      guard2: settings.guard2,
      mockMode: settings.rawMode,
    },
    "Root mock settings read from service-root; mock modes are currently ignored and production edge mode is enforced."
  );

  // IMPORTANT:
  // For now, we **always** enforce production edge behavior, regardless of the
  // current switch values. This keeps behavior stable while we wire in edgeMode
  // and design mock injectors.
  return EdgeMode.Prod;
}
