// backend/services/gateway/src/log.init.ts

/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADR: docs/adr/0022-standardize-shared-import-namespace-to-eff-shared.md
 *
 * Why:
 * - Side-effect init so logs carry { service: "gateway" } everywhere.
 */

import { initLogger } from "@eff/shared/src/utils/logger";
import { SERVICE_NAME } from "./config";

initLogger(SERVICE_NAME);
