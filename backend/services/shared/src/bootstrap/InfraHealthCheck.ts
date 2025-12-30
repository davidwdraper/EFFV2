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
 * Rails invariant (now enforced):
 * - InfraHealthCheck MUST read INFRA_BOOT_SVCS from SvcRuntime (rt),
 *   which already represents the merged root+service config view.
 * - InfraHealthCheck MUST NOT read service-root directly from env-service.
 */

import type { IBoundLogger } from "../logger/Logger";
import type { SvcClient } from "../s2s/SvcClient";
import type { SvcRuntime } from "../runtime/SvcRuntime";

export type InfraHealthCheckCtorOpts = {
  /**
   * Health check assumes infra services are v1 unless/until we teach config
   * to carry version pins. Keep it simple and explicit.
   */
  infraServiceVersion?: number;

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
  private readonly rt: SvcRuntime;
  private readonly svcClient: SvcClient;
  private readonly log: IBoundLogger;

  private readonly currentServiceSlug: string;
  private readonly envLabel: string;

  private readonly infraVersion: number;
  private readonly attempts: number;
  private readonly sleepMs: number;
  private readonly healthSuffix: string;

  public constructor(rt: SvcRuntime, opts: InfraHealthCheckCtorOpts = {}) {
    if (!rt) {
      throw new Error(
        "INFRA_HEALTHCHECK_INVALID: rt is required. Dev: pass SvcRuntime so INFRA_BOOT_SVCS is read from merged config."
      );
    }

    this.rt = rt;

    // Populate existing “locals” from rt (single source of truth).
    this.log = rt.getLogger();
    this.currentServiceSlug = (rt.getServiceSlug?.() ?? "").trim();
    this.envLabel = (rt.getEnv?.() ?? "").trim();

    if (!this.currentServiceSlug) {
      throw new Error(
        "INFRA_HEALTHCHECK_INVALID: currentServiceSlug is empty from rt. Ops/Dev: ensure rt identity is constructed correctly."
      );
    }
    if (!this.envLabel) {
      throw new Error(
        "INFRA_HEALTHCHECK_INVALID: envLabel is empty from rt. Ops/Dev: ensure rt identity is constructed correctly."
      );
    }

    const svcClient = rt.tryCap<SvcClient>("s2s.svcClient");
    if (!svcClient) {
      throw new Error(
        `INFRA_HEALTHCHECK_SVC_CLIENT_MISSING: rt is missing capability "s2s.svcClient" for ` +
          `service="${
            this.currentServiceSlug
          }" v${rt.getServiceVersion?.()} env="${this.envLabel}". ` +
          `Dev: wire "s2s.svcClient" in AppBase before infra boot check runs.`
      );
    }
    this.svcClient = svcClient;

    this.infraVersion = opts.infraServiceVersion ?? 1;
    this.attempts = opts.attempts ?? 3;
    this.sleepMs = opts.sleepMs ?? 500;
    this.healthSuffix =
      (opts.healthPathSuffix ?? "/health").trim() || "/health";

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
    const log = this.log;

    log.info(
      {
        event: "infra_boot_check_begin",
        currentServiceSlug: this.currentServiceSlug,
        envLabel: this.envLabel,
        infraVersion: this.infraVersion,
        attempts: this.attempts,
        sleepMs: this.sleepMs,
        healthSuffix: this.healthSuffix,
      },
      "Infra boot health check starting"
    );

    // 1) env-service must be healthy first (hard fail if down).
    await this.checkHealth("env-service");

    // 2) Load infra slugs from merged config (rt), NOT service-root direct.
    const slugs = this.loadInfraBootSlugsFromRuntime();

    // 3) Check each infra dependency.
    // We already checked env-service first to make logs deterministic.
    for (const slug of slugs) {
      if (slug === "env-service") continue;
      await this.checkHealth(slug);
    }

    log.info(
      {
        event: "infra_boot_check_complete",
        currentServiceSlug: this.currentServiceSlug,
        envLabel: this.envLabel,
        checkedSlugs: [
          "env-service",
          ...slugs.filter((s) => s !== "env-service"),
        ],
      },
      "Infra boot health check complete"
    );
  }

  private loadInfraBootSlugsFromRuntime(): string[] {
    let raw: string;
    try {
      raw = this.rt.getVar("INFRA_BOOT_SVCS");
    } catch (e) {
      throw new Error(
        `INFRA_BOOT_SVCS_MISSING: INFRA_BOOT_SVCS is required in merged config for env="${this.envLabel}", service="${this.currentServiceSlug}". ` +
          "Ops: set INFRA_BOOT_SVCS in env-service (root default or per-service override). " +
          `Detail: ${(e as Error)?.message ?? String(e)}`
      );
    }

    const slugs = this.parseSlugList(raw);

    if (slugs.length === 0) {
      throw new Error(
        `INFRA_BOOT_SVCS_EMPTY: INFRA_BOOT_SVCS was empty after parsing for env="${this.envLabel}", service="${this.currentServiceSlug}". ` +
          'Ops: set INFRA_BOOT_SVCS to a comma-separated list of infra slugs (e.g., "env-service,svcconfig,prompt,gateway").'
      );
    }

    this.log.info(
      {
        event: "infra_boot_list_loaded",
        envLabel: this.envLabel,
        currentServiceSlug: this.currentServiceSlug,
        infraBootSlugs: slugs,
      },
      "Loaded infra boot slug list from rt (merged config)"
    );

    return slugs;
  }

  private async checkHealth(slug: string): Promise<void> {
    const clean = (slug ?? "").trim();

    if (!clean) {
      throw new Error(
        "INFRA_HEALTHCHECK_SLUG_EMPTY: checkHealth(slug) requires a non-empty slug. Dev: fix caller."
      );
    }

    // Safety: ignore accidental self-checks.
    if (clean === this.currentServiceSlug) {
      this.log.warn(
        {
          event: "infra_boot_check_skip_self",
          slug: clean,
          currentServiceSlug: this.currentServiceSlug,
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
        const res = await this.svcClient.callRaw({
          env: this.envLabel,
          slug: clean,
          version: this.infraVersion,
          method: "GET",
          fullPath,
          timeoutMs: 5_000,
        });

        if (res.status >= 200 && res.status < 300) {
          this.log.info(
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

        this.log.warn(
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
        this.log.warn(
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
      `INFRA_BOOT_HEALTHCHECK_FAILED: Required infra service "${clean}" is not healthy/reachable in env="${this.envLabel}". ` +
        `Tried ${this.attempts} attempt(s). ` +
        `Ops: start/fix "${clean}" (and its deps) before booting "${this.currentServiceSlug}". ` +
        `Detail: ${(lastErr as Error)?.message ?? String(lastErr)}`
    );
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
