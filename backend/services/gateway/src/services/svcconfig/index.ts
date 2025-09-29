// backend/services/gateway/src/services/svcconfig/index.ts
/**
 * Purpose:
 * - Expose SvcConfig singleton and related shared types
 *   so other parts of the gateway (and tests) can just import
 *   from "../services/svcconfig".
 */
import { SvcConfig } from "./SvcConfig";

let _instance: SvcConfig | null = null;

export function getSvcConfig(): SvcConfig {
  if (!_instance) _instance = new SvcConfig();
  return _instance;
}

export type { SvcMirror, ServiceKey } from "./types";
export type { ServiceConfigRecord } from "@nv/shared/contracts/ServiceConfig";
