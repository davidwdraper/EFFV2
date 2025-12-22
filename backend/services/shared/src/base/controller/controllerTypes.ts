// backend/services/shared/src/base/controller/controllerTypes.ts
/**
 * Docs:
 * - ADR-0041 (Controller & Handler Architecture)
 * - ADR-0042 (HandlerContext Bus)
 *
 * Purpose:
 * - Common controller-related types shared by helper modules.
 */

import type { IBoundLogger } from "../../logger/Logger";
import type { EnvServiceDto } from "../../dto/env-service.dto";
import type { IDtoRegistry } from "../../registry/RegistryBase";
import type { AppBase } from "../app/AppBase";

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

/** Narrow structural interface used by helpers; ControllerBase satisfies this. */
export interface ControllerRuntimeDeps {
  getDtoRegistry(): IDtoRegistry;
  getSvcEnv(): EnvServiceDto;
  getEnvLabel(): string;
  getLogger(): IBoundLogger;
  getApp(): AppBase;
  /** Whether a registry is required for this controller. */
  // eslint-disable-next-line @typescript-eslint/ban-types
  ["needsRegistry"](): boolean;
}
