// backend/services/shared/src/index.ts
// Central entrypoint for @eff/shared (CJS build -> dist/index.js)

// App builder (internal-only stack)
export { createServiceApp } from "./app/createServiceApp";

// Bootstrap + HTTP helpers
export { bootstrapService } from "./bootstrap/bootstrapService";
export { startHttpService } from "./bootstrap/startHttpService";

// Health
export { createHealthRouter } from "./health";

// Middlewares (safe for internal services)
export { requestIdMiddleware } from "./middleware/requestId";
export { makeHttpLogger } from "./middleware/httpLogger";
export { trace5xx } from "./middleware/trace5xx";
export { readOnlyGate } from "./middleware/readOnlyGate";
export {
  notFoundProblemJson,
  errorProblemJson,
} from "./middleware/problemJson";

// Utils
export * from "./utils/logger";
export * from "./utils/logMeta";

// Svcconfig client
export * from "./svcconfig/client";

// 🔧 Force a runtime artifact so tsc emits dist/index.js
export const __nowvibin_marker = true;
