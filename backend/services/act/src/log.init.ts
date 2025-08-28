// backend/services/act/src/log.init.ts
import { initLogger } from "../../shared/utils/logger";
import { SERVICE_NAME } from "./config";

/**
 * Side-effect module: initializes the shared logger with this service's name.
 * Import this ONCE at the very start of your entrypoint (index.ts or app.ts):
 *   import "./src/log.init";
 *
 * After this runs, any import of `logger` from @shared/utils/logger
 * will be correctly tagged with { service: "act" }.
 */
initLogger(SERVICE_NAME);
