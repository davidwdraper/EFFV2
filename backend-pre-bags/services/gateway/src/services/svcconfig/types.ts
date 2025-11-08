// backend/services/gateway/src/services/svcconfig/types.ts
/**
 * Purpose:
 * - Gateway-local helper types that lean on shared contracts.
 * - Keep this tiny to avoid drift.
 */
import type { ServiceConfigRecord } from "@nv/shared/contracts/svcconfig.contract";

export type ServiceKey = `${string}@${number}`;
export type SvcMirror = Record<ServiceKey, ServiceConfigRecord>;
export type { ServiceConfigRecord };
