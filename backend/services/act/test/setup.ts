// backend/services/act/test/setup.ts
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { vi } from "vitest";

/**
 * 1) Stub pino-http BEFORE anything imports it.
 *    We return a no-op middleware that attaches a minimal req.log/res.log.
 */
vi.mock("pino-http", () => {
  const noop = () => {};
  const mkLog = () => ({
    level: "silent",
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    fatal: noop,
    trace: noop,
    child() {
      return this;
    },
  });
  const pinoHttp = () => {
    const mw = (req: any, res: any, next: any) => {
      const log = mkLog();
      req.log = log;
      res.log = log;
      next();
    };
    return mw;
  };
  return { default: pinoHttp };
});

/**
 * 2) Stub shared logger to avoid network/audit I/O in tests.
 *    Keep shape pino-ish enough for code that calls .child(), etc.
 */
vi.mock("@shared/utils/logger", () => {
  const noop = () => {};
  const logger = {
    level: "silent",
    levels: {
      values: {
        fatal: 60,
        error: 50,
        warn: 40,
        info: 30,
        debug: 20,
        trace: 10,
      },
    },
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    fatal: noop,
    trace: noop,
    child() {
      return this as any;
    },
  };
  return {
    logger,
    postAudit: vi.fn().mockResolvedValue(undefined),
    extractLogContext: () => ({}),
  };
});

/**
 * 3) Load service-local .env.test if provided; fall back to optional file.
 */
loadEnv({
  path: path.resolve(
    process.cwd(),
    process.env.ENV_FILE || "backend/services/act/.env.test"
  ),
});

/**
 * 4) Hermetic defaults for tests ONLY (never in service code).
 */
process.env.NODE_ENV ??= "test";
process.env.LOG_LEVEL ??= "silent";
process.env.LOG_SERVICE_URL ??= "http://127.0.0.1:4999/logs";
process.env.LOG_SERVICE_TOKEN_CURRENT ??= "test-token";
process.env.REDIS_DISABLED ??= "1";
process.env.ACT_SERVICE_NAME ??= "act-test";
process.env.ACT_PORT ??= "0"; // ephemeral in-process server
process.env.ACT_MONGO_URI ??= "mongodb://127.0.0.1:27017/eff_act_db_test";
process.env.ACT_SEARCH_UNFILTERED_CUTOFF ??= "25"; // ensure lazy env in controller never throws
