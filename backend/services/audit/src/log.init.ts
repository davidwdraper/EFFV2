// backend/services/<svc>/src/log.init.ts

/**
 * Service-local logging/audit bootstrap.
 *
 * Purpose:
 *  - Ensure the shared logger is initialized early.
 *  - Tag boot logs with the canonical service identity.
 *  - Keep index.ts clean.
 *
 * Note:
 *  - SERVICE_NAME is baked into bootstrap.ts (single source of truth).
 *  - No service should redefine or shadow SERVICE_NAME elsewhere.
 */

import { SERVICE_NAME } from "./bootstrap/bootstrap";
import { logger } from "@eff/shared/src/utils/logger";

try {
  logger.debug(
    { service: SERVICE_NAME },
    `[${SERVICE_NAME}] logger initialized`
  );
} catch {
  // Non-fatal: don't crash boot if debug logging fails.
}
