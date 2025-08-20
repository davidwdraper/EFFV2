// backend/services/image/src/config.ts
import { requireEnv, requireNumber } from "../../shared/env";

/**
 * Image service config (validated; no defaults baked in).
 * Env is loaded in ./bootstrap.ts before this is imported.
 */

export const serviceName = requireEnv("IMAGE_SERVICE_NAME");
export const port = requireNumber("IMAGE_PORT");
export const mongoUri = requireEnv("IMAGE_MONGO_URI");
export const logLevel = requireEnv("LOG_LEVEL");
export const logServiceUrl = requireEnv("LOG_SERVICE_URL");

export const config = {
  serviceName,
  port,
  mongoUri,
  logLevel,
  logServiceUrl,
};
