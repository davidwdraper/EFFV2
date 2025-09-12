// backend/services/gateway-core/src/log.init.ts
import { initLogger } from "@eff/shared/src/utils/logger";
import { SERVICE_NAME } from "./config";

/**
 * Side-effect module: initializes the shared logger with this service's name.
 * Import this ONCE at the very start of your gateway entrypoint:
 *   import "./src/log.init";
 *
 * Ensures gateway logs carry { service: "gateway" } consistently.
 */
initLogger(SERVICE_NAME);
