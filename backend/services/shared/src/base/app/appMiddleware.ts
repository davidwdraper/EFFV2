// backend/services/shared/src/base/app/appMiddleware.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0032 (RoutePolicyGate — version-agnostic enforcement; health bypass)
 *   - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *
 * Purpose:
 * - Shared mounting of pre-routing, route-policy, parsers, and post-routing
 *   error funnel for AppBase.
 *
 * Invariants:
 * - No process.env reads here (sandbox / svcenv is the single source of truth).
 * - No silent fallbacks. If a feature is enabled, its required config must exist.
 */

import type { Express } from "express";
import express = require("express");
import { responseErrorLogger } from "@nv/shared/middleware/response.error.logger";
import {
  routePolicyGate,
  type ISvcconfigResolver,
} from "@nv/shared/middleware/policy/routePolicyGate";
import type { IBoundLogger } from "@nv/shared/logger/Logger";
import { createProblemMiddleware } from "@nv/shared/problem/createProblemMiddleware";

export function mountPreRoutingLayer(opts: {
  app: Express;
  service: string;
}): void {
  const { app, service } = opts;
  app.use(responseErrorLogger(service));
}

export function mountRoutePolicyGateLayer(opts: {
  app: Express;
  service: string;
  log: IBoundLogger;
  resolver: ISvcconfigResolver | null;

  /**
   * Required when resolver is provided.
   * Read/validated at boot from svcenv (not here).
   */
  facilitatorBaseUrl?: string;
  ttlMs?: number;
}): void {
  const { app, service, log, resolver, facilitatorBaseUrl, ttlMs } = opts;
  if (!resolver) return;

  if (!facilitatorBaseUrl || !facilitatorBaseUrl.trim()) {
    throw new Error(
      `ROUTE_POLICY_FACILITATOR_BASE_URL_MISSING: routePolicyGate enabled for service="${service}" but facilitatorBaseUrl is missing/empty. Ops: set SVCFACILITATOR_BASE_URL in env-service for this service.`
    );
  }

  if (!Number.isFinite(ttlMs) || (ttlMs as number) <= 0) {
    throw new Error(
      `ROUTE_POLICY_TTL_INVALID: routePolicyGate enabled for service="${service}" but ttlMs is invalid. Ops: set ROUTE_POLICY_TTL_MS to a positive integer string in env-service for this service.`
    );
  }

  app.use(
    routePolicyGate({
      logger: log,
      serviceName: service,
      ttlMs: Math.trunc(ttlMs as number),
      facilitatorBaseUrl: facilitatorBaseUrl.trim(),
      resolver,
    })
  );
}

export function mountParserLayer(opts: { app: Express }): void {
  const { app } = opts;
  app.use(express.json());
}

export function mountPostRoutingLayer(opts: {
  app: Express;
  serviceSlug: string;
  serviceVersion: number;
  envLabel: string;
  log: IBoundLogger;
}): void {
  const { app, serviceSlug, serviceVersion, envLabel, log } = opts;

  // Final error funnel (Express adapter).
  app.use(
    createProblemMiddleware({
      log,
      serviceSlug,
      serviceVersion,
      envLabel,
    })
  );
}
