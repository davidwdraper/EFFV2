// backend/services/svcconfig/src/log.init.ts
import { initLogger } from "@shared/utils/logger";
import { SERVICE_NAME } from "./config";

// Initialize shared logger with the service name (must happen once per process)
initLogger(SERVICE_NAME);

// no exports
