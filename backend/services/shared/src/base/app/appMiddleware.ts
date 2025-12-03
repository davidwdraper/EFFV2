// backend/services/shared/src/base/app/appMiddleware.ts
/**
 * Docs:
 * - ADR-0032 (RoutePolicyGate — version-agnostic enforcement; health bypass)
 *
 * Purpose:
 * - Shared mounting of pre-routing, route-policy, parsers, and post-routing
 *   error funnel for AppBase.
 */

import type { Express, Request, Response, NextFunction } from "express";
import express = require("express");
import { responseErrorLogger } from "@nv/shared/middleware/response.error.logger";
import {
  routePolicyGate,
  type ISvcconfigResolver,
} from "@nv/shared/middleware/policy/routePolicyGate";
import type { IBoundLogger } from "@nv/shared/logger/Logger";

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
  envLabel: string;
}): void {
  const { app, service, log, resolver } = opts;
  if (!resolver) return;

  const facilitatorBaseUrl = process.env.SVCFACILITATOR_BASE_URL;
  if (!facilitatorBaseUrl) {
    log.warn("routePolicyGate skipped — SVCFACILITATOR_BASE_URL missing");
    return;
  }

  app.use(
    routePolicyGate({
      logger: log,
      serviceName: service,
      ttlMs: Number(process.env.ROUTE_POLICY_TTL_MS ?? 5000),
      facilitatorBaseUrl,
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
  service: string;
  envLabel: string;
  log: IBoundLogger;
}): void {
  const { app, service, envLabel, log } = opts;

  // Final error funnel.
  // NOTE: this is intentionally simple; Problem+JSON handling still sits
  // in the controllers/pipelines as per ADR-0043.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    log.error(
      {
        service,
        env: envLabel,
        error:
          err instanceof Error
            ? { message: err.message, stack: err.stack }
            : err,
      },
      "unhandled error in request pipeline"
    );
    res
      .status(500)
      .json({ type: "about:blank", title: "Internal Server Error" });
  });
}
