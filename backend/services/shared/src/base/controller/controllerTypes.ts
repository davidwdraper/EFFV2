// backend/services/shared/src/base/controller/controllerTypes.ts
/**
 * Docs:
 * - ADR-0041 (Controller & Handler Architecture)
 * - ADR-0042 (HandlerContext Bus)
 * - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *
 * Purpose:
 * - Common controller-related types shared by helper modules.
 *
 * Hard contract (rails):
 * - ctx["rt"] ALWAYS (required)
 * - ctx["svcEnv"] NEVER (deleted)
 *
 * Notes:
 * - Keep ProblemJson stable (used by finalize/error plumbing).
 * - Keep this interface *structural* so ControllerBase satisfies it without adapters.
 */

import type { IBoundLogger } from "../../logger/Logger";
import type { IDtoRegistry } from "../../registry/IDtoRegistry";
import type { AppBase } from "../app/AppBase";
import type { SvcRuntime } from "../../runtime/SvcRuntime";

/** Problem+JSON envelope used by controller error responses. */
export type ProblemJson = {
  type: string;
  title: string;
  detail?: string;
  status?: number;
  code?: string;
  issues?: Array<{ path: string; code: string; message: string }>;
  requestId?: string;
  userMessage?: string;
  userPromptKey?: string;
};

/**
 * Narrow structural interface used by controller helper modules;
 * ControllerBase satisfies this.
 */
export interface ControllerRuntimeDeps {
  /** Strict registry accessor (throws when missing). */
  getDtoRegistry(): IDtoRegistry;

  /** Soft registry accessor (MOS services may return undefined). */
  tryGetDtoRegistry(): IDtoRegistry | undefined;

  /** ADR-0080: runtime is mandatory and authoritative. */
  getRuntime(): SvcRuntime;

  /** Logger accessor used by helper modules. */
  getLogger(): IBoundLogger;

  /** App accessor for diagnostics (not a source of truth). */
  getApp(): AppBase;

  /** Whether a registry is required for this controller. */
  // eslint-disable-next-line @typescript-eslint/ban-types
  ["needsRegistry"](): boolean;
}
