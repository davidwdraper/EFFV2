// backend/services/log/index.ts
/**
 * NowVibin — Backend
 * Service: log
 * -----------------------------------------------------------------------------
 * WHY:
 * - Single boring boot path for every worker via shared bootstrap.
 * - Bind ONLY to LOG_PORT (no PORT fallback) to avoid env ambiguity.
 * - Fail fast on missing envs; print an explicit “listening” line on start.
 *
 * DESIGN / ADR:
 * - docs/architecture/backend/SOP.md
 * - docs/adr/0003-shared-app-builder.md
 * - docs/adr/0017-environment-loading-and-validation.md
 * - docs/adr/0022-standardize-shared-import-namespace-to-eff-shared.md
 * - docs/adr/0028-deprecate-gateway-core-centralize-s2s-in-shared.md
 */
/*
import path from "node:path";
import { bootstrapService } from "@eff/shared/bootstrap/bootstrapService";

export const SERVICE_NAME = "log" as const;

void bootstrapService({
  // WHY: Keep service identity single-sourced here; app.ts stays generic.
  serviceName: SERVICE_NAME,

  // WHY: Absolute path enables shared env cascade (family → service) correctly.
  serviceRootAbs: path.resolve(__dirname),

  // WHY: Defer app creation; shared boot controls env assert + lifecycle.
  createApp: () => require("./src/app").default,

  // WHY: No “or logic”—bind only to LOG_PORT per repo convention.
  portEnv: "LOG_PORT",

  // WHY: Strict env gating prevents runtime surprises in dev/staging/prod.
  requiredEnv: [
    "LOG_PORT",
    "LOG_MONGO_URI",
    "LOG_LEVEL",
    // NOTE: Use the audience name you standardized on; keeping S2S_AUDIENCE here
    //       because your .env.dev uses it. If you switch repo-wide to
    //       S2S_JWT_AUDIENCE, update here and the env files together.
    "S2S_AUDIENCE",
    "S2S_ALLOWED_ISSUERS",
    "S2S_ALLOWED_CALLERS",
  ],

  // WHY: Emit an unambiguous bind line; helpful when multiple workers run.
  //      We don’t destructure since StartedService doesn’t type a `port` field.
  onStarted: (svc) => {
    // eslint-disable-next-line no-console
    console.log(
      `[log] listening (LOG_PORT=${process.env.LOG_PORT}, serviceName=${SERVICE_NAME})`
    );
  },
});
*/
