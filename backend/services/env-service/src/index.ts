// backend/services/env-service/src/index.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0039 (svcenv centralized non-secret env)
 *
 * Purpose (template/final):
 * - Strict, synchronous bootstrap:
 *   1) read minimal bootstrap env (SVCENV_URI)
 *   2) resolve current environment from svcenv
 *   3) fetch non-secret config DTO for env@slug@version
 *   4) create app with { slug, version, envDto, envReloader }
 *   5) start HTTP listener from DTO (no process.env knobs beyond SVCENV_URI)
 */

import createApp from "./app"; // accepts { slug, version, envDto, envReloader }
import { SvcEnvClient } from "@nv/shared/env/svcenvClient";
import type { SvcEnvDto } from "@nv/shared/dto/svcenv.dto";

// ———————————————————————————————————————————————————————————————
// Service identity (explicit; no env needed for these)
// ———————————————————————————————————————————————————————————————
const SERVICE_SLUG = "env-service"; // update per cloned service
const SERVICE_VERSION = 1; // major API version

// ———————————————————————————————————————————————————————————————
// Minimal bootstrap helper (strict, no defaults)
// ———————————————————————————————————————————————————————————————
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(
      `Missing required bootstrap env "${name}". ` +
        `Set ${name} in the repo root .env (temporary until svc discovery).`
    );
  }
  return v.trim();
}

// ———————————————————————————————————————————————————————————————
// Bootstrap & start
// ———————————————————————————————————————————————————————————————
(async () => {
  // 1) Bootstrap locator
  const SVCENV_URI = requireEnv("SVCENV_URI");

  // 2) Resolve current environment (ordered awaits to avoid races)
  const envClient = new SvcEnvClient(SVCENV_URI);

  let currentEnv: string;
  try {
    currentEnv = await envClient.getCurrentEnv({
      slug: SERVICE_SLUG,
      version: SERVICE_VERSION,
    });
  } catch (err) {
    console.error("[entrypoint] current_env_failed", {
      error: (err as Error)?.message,
      hint: "Verify svcenv health and policies; ensure SVCENV_URI is reachable.",
    });
    process.exit(1);
    return;
  }

  // 3) Fetch non-secret config as a DTO for env@slug@version
  let envDto: SvcEnvDto;
  try {
    envDto = await envClient.getConfig({
      slug: SERVICE_SLUG,
      version: SERVICE_VERSION,
      env: currentEnv,
    });
  } catch (err) {
    console.error("[entrypoint] env_config_failed", {
      error: (err as Error)?.message,
      hint: "Ensure svcenv contains the document for env@slug@version and matches ADR-0039.",
    });
    process.exit(1);
    return;
  }

  // 4) Derive listener settings from DTO (strict, no fallbacks)
  let host: string;
  let port: number;
  try {
    host = envDto.getVar("NV_HTTP_HOST"); // e.g., "0.0.0.0"
    const rawPort = envDto.getVar("NV_HTTP_PORT"); // e.g., "4999"
    const n = Number(rawPort);
    if (!Number.isFinite(n) || n <= 0)
      throw new Error(
        `NV_HTTP_PORT must be a positive integer, got "${rawPort}"`
      );
    port = Math.trunc(n);
  } catch (err) {
    console.error("[entrypoint] listener_config_invalid", {
      error: (err as Error)?.message,
      hint: "Required vars: NV_HTTP_HOST, NV_HTTP_PORT. Update svcenv for this key.",
    });
    process.exit(1);
    return;
  }

  // 5) Create app with envReloader (final fix: provide required callback)
  const envReloader = async (): Promise<SvcEnvDto> => {
    // Re-resolve env synchronously to allow Op-driven env flips, then fetch fresh config
    const env = await envClient.getCurrentEnv({
      slug: SERVICE_SLUG,
      version: SERVICE_VERSION,
    });
    return envClient.getConfig({
      slug: SERVICE_SLUG,
      version: SERVICE_VERSION,
      env,
    });
  };

  let appObj: {
    app: { listen: (port: number, host: string, cb: () => void) => void };
  };
  try {
    appObj = await createApp({
      slug: SERVICE_SLUG,
      version: SERVICE_VERSION,
      envDto,
      envReloader,
    });
  } catch (err) {
    console.error("[entrypoint] app_create_failed", {
      error: (err as Error)?.message,
      hint: "app.ts must accept { slug, version, envDto, envReloader } and perform orchestration only.",
    });
    process.exit(1);
    return;
  }

  try {
    appObj.app.listen(port, host, () => {
      console.info("[entrypoint] http_listening", {
        slug: SERVICE_SLUG,
        version: SERVICE_VERSION,
        host,
        port,
      });
    });
  } catch (err) {
    console.error("[entrypoint] http_listen_failed", {
      error: (err as Error)?.message,
      hint: "Confirm port availability and server adapter signature (port, host, cb).",
    });
    process.exit(1);
  }
})().catch((err) => {
  console.error("[entrypoint] unhandled_bootstrap_error", {
    error: (err as Error)?.message,
  });
  // eslint-disable-next-line no-process-exit
  process.exit(1);
});
