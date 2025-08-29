// backend/services/gateway-core/src/routes/health.router.ts
import type express from "express";
import axios from "axios";
import { createHealthRouter, type ReadinessFn } from "../../../shared/health";

// ⬇️ default to shallow readiness (enumerate *_SERVICE_URL)
// flip DEEP_PING=1 to probe upstreams quickly (timeout 500ms)
const readiness: ReadinessFn = async (_req: express.Request) => {
  const deep = (process.env.DEEP_PING || "") === "1";
  const urls = Object.fromEntries(
    Object.entries(process.env)
      .filter(([k]) => k.endsWith("_SERVICE_URL"))
      .map(([k, v]) => [k, v])
  );

  if (!deep) {
    // Shallow: just report configured upstreams
    return { upstreams: urls, deepPing: false };
  }

  // Deep: HEAD /healthz (or /health) with short timeout
  const results: Record<string, any> = {};
  await Promise.all(
    Object.entries(urls).map(async ([key, base]) => {
      const url = String(base).replace(/\/+$/, "") + "/healthz";
      try {
        const r = await axios.head(url, {
          timeout: 500,
          validateStatus: () => true,
        });
        results[key] = { url, status: r.status };
      } catch (err: any) {
        results[key] = { url, error: err?.code || err?.message || "ERR" };
      }
    })
  );

  return { upstreams: urls, deepPing: true, results };
};

export function buildGatewayCoreHealthRouter() {
  return createHealthRouter({
    service: "gateway-core",
    env: process.env.NODE_ENV,
    version: process.env.npm_package_version, // okay if undefined in non-npm boot
    gitSha: process.env.GIT_SHA, // optional
    readiness,
  });
}
