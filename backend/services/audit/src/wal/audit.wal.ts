// backend/services/audit/src/wal/audit.wal.ts
/**
 * Docs:
 * - adr0022-shared-wal-and-db-base
 *
 * Purpose:
 * - Singleton WAL instance for the Audit service.
 * - We disable the Wal’s internal background loop (flushIntervalMs=0); the
 *   service-owned flusher drives persistence explicitly.
 */

import { Wal } from "@nv/shared/wal/Wal";

export const auditWal = Wal.fromEnv({
  defaults: {
    flushIntervalMs: 0, // prevent internal no-op draining
  },
});
