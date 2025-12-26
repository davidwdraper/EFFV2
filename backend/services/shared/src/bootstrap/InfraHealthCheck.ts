// backend/services/shared/src/bootstrap/InfraHealthCheck.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *   - ADR-0082 (Infra Service Health Boot Check)
 *
 * Purpose:
 * - Boot-time infra dependency verification for services that opt in (usually DOMAIN services).
 * - Hard-fail if required infra services are unreachable/unhealthy.
 *
 * Flow:
 *  1) Check env-service health first (hard fail if down).
 *  2) Fetch service-root EnvServiceDto from env-service.
 *  3) Read INFRA_BOOT_SVCS from service-root vars (CSV list of slugs).
 *  4) Check health for each listed slug (hard fail on first failure).
 *
 * Invariants:
 * - Transport-agnostic (no Express req/res, no controllers/handlers).
 * - Uses canonical SvcClient transport path (callRaw) for health checks.
 * - Bounded retries only; never waits forever.
 * - No new environment variables; infra list is config-driven via service-root.
 *
 * Notes:
 * - Whether a service runs this check is controlled by AppBase.shouldSkipInfraBootHealthCheck().
 */

import type { IBoundLogger } from "../logger/Logger";
import { SvcEnvClient } from "../env/svcenvClient";
import type { SvcClient } from "../s2s/SvcClient";
import type { EnvServiceDto } from "../dto/env-service.dto";
import type { DtoBag } from "../dto/DtoBag";

export type InfraHealthCheckOpts = {
  svcClient: SvcClient;
  envClient: SvcEnvClient;
  log: IBoundLogger;

  /** Current service identity (the one booting). */
  currentServiceSlug: string;

  /** Logical env label (e.g., "dev"). */
  envLabel: string;

  /**
   * Health check assumes infra services are v1 unless/until we teach service-root
   * to carry version pins. Keep it simple and explicit.
   */
  infraServiceVersion?: number;

  /**
   * service-root lives as a config target in env-service.
   * Version is locked as 1 unless/until NV introduces a versioned root record.
   */
  serviceRootVersion?: number;

  /** Retry policy (bounded). */
  attempts?: number;
  sleepMs?: number;

  /**
   * Override health route path if the platform changes.
   * Default assumes AppBase mounts GET <base>/health where base=/api/<slug>/v<version>.
   */
  healthPathSuffix?: string; // e.g., "/health"
};

export class InfraHealthCheck {
  private readonly infraVersion: number;
  private readonly serviceRootVersion: number;
  private readonly attempts: number;
  private readonly sleepMs: number;
  private readonly healthSuffix: string;

  public constructor(private readonly opts: InfraHealthCheckOpts) {
    this.infraVersion = opts.infraServiceVersion ?? 1;
    this.serviceRootVersion = opts.serviceRootVersion ?? 1;
    this.attempts = opts.attempts ?? 3;
    this.sleepMs = opts.sleepMs ?? 500;
    this.healthSuffix =
      (opts.healthPathSuffix ?? "/health").trim() || "/health";

    if (!opts.currentServiceSlug?.trim()) {
      throw new Error(
        "INFRA_HEALTHCHECK_INVALID: currentServiceSlug is required. Dev: pass the booting service slug."
      );
    }
    if (!opts.envLabel?.trim()) {
      throw new Error(
        "INFRA_HEALTHCHECK_INVALID: envLabel is required. Dev: pass the logical env label."
      );
    }
    if (this.attempts <= 0) {
      throw new Error(
        `INFRA_HEALTHCHECK_INVALID: attempts must be > 0, got ${this.attempts}.`
      );
    }
    if (this.sleepMs < 0) {
      throw new Error(
        `INFRA_HEALTHCHECK_INVALID: sleepMs must be >= 0, got ${this.sleepMs}.`
      );
    }
    if (!this.healthSuffix.startsWith("/")) {
      throw new Error(
        `INFRA_HEALTHCHECK_INVALID: healthPathSuffix must start with "/", got "${this.healthSuffix}".`
      );
    }
  }

  public async run(): Promise<void> {
    const { log } = this.opts;

    log.info(
      {
        event: "infra_boot_check_begin",
        currentServiceSlug: this.opts.currentServiceSlug,
        envLabel: this.opts.envLabel,
        infraVersion: this.infraVersion,
        attempts: this.attempts,
        sleepMs: this.sleepMs,
        healthSuffix: this.healthSuffix,
      },
      "Infra boot health check starting"
    );

    // 1) env-service must be healthy first.
    await this.checkHealth("env-service");

    // 2) Read service-root, parse INFRA_BOOT_SVCS
    const slugs = await this.loadInfraBootSlugs();

    // 3) Check each infra dependency (skip env-service; already checked).
    for (const slug of slugs) {
      if (slug === "env-service") continue;
      await this.checkHealth(slug);
    }

    log.info(
      {
        event: "infra_boot_check_complete",
        currentServiceSlug: this.opts.currentServiceSlug,
        envLabel: this.opts.envLabel,
        checkedSlugs: [
          "env-service",
          ...slugs.filter((s) => s !== "env-service"),
        ],
      },
      "Infra boot health check complete"
    );
  }

  private async checkHealth(slug: string): Promise<void> {
    const { svcClient, envLabel, log, currentServiceSlug } = this.opts;
    const clean = (slug ?? "").trim();

    if (!clean) {
      throw new Error(
        "INFRA_HEALTHCHECK_SLUG_EMPTY: checkHealth(slug) requires a non-empty slug. Dev: fix caller."
      );
    }

    // Safety: ignore accidental self-checks.
    if (clean === currentServiceSlug) {
      log.warn(
        {
          event: "infra_boot_check_skip_self",
          slug: clean,
          currentServiceSlug,
        },
        "Ignoring self-check in infra boot list"
      );
      return;
    }

    const fullPath = `/api/${encodeURIComponent(clean)}/v${this.infraVersion}${
      this.healthSuffix
    }`;

    let lastErr: unknown;

    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      try {
        const res = await svcClient.callRaw({
          env: envLabel,
          slug: clean,
          version: this.infraVersion,
          method: "GET",
          fullPath,
          timeoutMs: 5_000,
        });

        if (res.status >= 200 && res.status < 300) {
          log.info(
            {
              event: "infra_health_ok",
              slug: clean,
              attempt,
              status: res.status,
            },
            "Infra service healthy"
          );
          return;
        }

        lastErr = new Error(
          `Non-2xx from "${clean}" health endpoint: status=${res.status}`
        );

        log.warn(
          {
            event: "infra_health_non2xx",
            slug: clean,
            attempt,
            status: res.status,
            bodySnippet: (res.bodyText ?? "").slice(0, 256),
          },
          "Infra service health returned non-2xx"
        );
      } catch (e) {
        lastErr = e;
        log.warn(
          {
            event: "infra_health_error",
            slug: clean,
            attempt,
            detail: (e as Error)?.message ?? String(e),
          },
          "Infra service health check failed"
        );
      }

      if (attempt < this.attempts && this.sleepMs > 0) {
        await this.sleep(this.sleepMs);
      }
    }

    throw new Error(
      `INFRA_BOOT_HEALTHCHECK_FAILED: Required infra service "${clean}" is not healthy/reachable in env="${envLabel}". ` +
        `Tried ${this.attempts} attempt(s). ` +
        `Ops: start/fix "${clean}" (and its deps) before booting "${currentServiceSlug}". ` +
        `Detail: ${(lastErr as Error)?.message ?? String(lastErr)}`
    );
  }

  private async loadInfraBootSlugs(): Promise<string[]> {
    const { envClient, envLabel, log } = this.opts;

    let bag: DtoBag<EnvServiceDto>;
    try {
      bag = await envClient.getConfig({
        env: envLabel,
        slug: "service-root",
        version: this.serviceRootVersion,
      });
    } catch (e) {
      throw new Error(
        `INFRA_BOOT_SERVICE_ROOT_FETCH_FAILED: Failed to read service-root from env-service for env="${envLabel}". ` +
          `Ops: ensure env-service has a config document for slug="service-root" version=${this.serviceRootVersion} in env="${envLabel}". ` +
          `Detail: ${(e as Error)?.message ?? String(e)}`
      );
    }

    let primary: EnvServiceDto | undefined;
    for (const dto of bag as unknown as Iterable<EnvServiceDto>) {
      primary = dto;
      break;
    }

    if (!primary) {
      throw new Error(
        `INFRA_BOOT_SERVICE_ROOT_EMPTY: env-service returned an empty bag for service-root in env="${envLabel}". ` +
          "Ops: create the service-root record and set INFRA_BOOT_SVCS."
      );
    }

    let raw: string;
    try {
      raw = primary.getEnvVar("INFRA_BOOT_SVCS");
    } catch (e) {
      throw new Error(
        `INFRA_BOOT_SVCS_MISSING: INFRA_BOOT_SVCS is required in service-root for env="${envLabel}". ` +
          "Ops: set INFRA_BOOT_SVCS (CSV list of infra slugs) in env-service service-root config. " +
          `Detail: ${(e as Error)?.message ?? String(e)}`
      );
    }

    const slugs = this.parseSlugList(raw);

    if (slugs.length === 0) {
      throw new Error(
        `INFRA_BOOT_SVCS_EMPTY: INFRA_BOOT_SVCS was empty after parsing for env="${envLabel}". ` +
          'Ops: set INFRA_BOOT_SVCS to a comma-separated list of infra slugs (e.g., "svcconfig,log-service,prompts").'
      );
    }

    log.info(
      {
        event: "infra_boot_list_loaded",
        envLabel,
        serviceRootVersion: this.serviceRootVersion,
        infraBootSlugs: slugs,
      },
      "Loaded infra boot slug list from service-root"
    );

    return slugs;
  }

  private parseSlugList(raw: string): string[] {
    const src = typeof raw === "string" ? raw.trim() : "";
    if (!src) return [];

    const parts = src
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const out: string[] = [];
    const seen = new Set<string>();

    for (const p of parts) {
      if (seen.has(p)) continue;
      seen.add(p);
      out.push(p);
    }

    return out;
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }
}
