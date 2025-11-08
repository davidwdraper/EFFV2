// // backend/shared/src/health/Health.ts
// /**
//  * Docs:
//  * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
//  *
//  * Purpose:
//  * - Shared health router factory to eliminate per-service boilerplate.
//  * - Uniform envelope via SvcReceiver. Optional per-service hooks.
//  */

// import { Router } from "express";
// import type { Express } from "express";
// //import { SvcReceiver } from "../svc/SvcReceiver";

// export type ReadyCheck = () => Promise<{ ok: boolean; detail?: unknown }>;
// export type LiveCheck = () => Promise<{ ok: boolean; detail?: unknown }>;

// export interface HealthOptions {
//   service: string; // e.g., "auth"
//   live?: LiveCheck; // optional override
//   ready?: ReadyCheck; // optional override
//   extraRoutes?: (r: Router) => void; // add /metrics or /info if desired
// }

// export function createHealthRouter(opts: HealthOptions): Router {
//   const rx = new SvcReceiver(opts.service);
//   const r = Router();

//   // Default “live” just means the process is up and can run JS
//   const defaultLive: LiveCheck = async () => ({
//     ok: true,
//     detail: { uptime: process.uptime() },
//   });
//   // Default “ready” = same as live (services can override to check deps)
//   const defaultReady: ReadyCheck = defaultLive;

//   r.get("/live", (req, res) =>
//     rx.receive(req as any, res as any, async () => {
//       const probe = opts.live ?? defaultLive;
//       const { ok, detail } = await probe();
//       return {
//         status: ok ? 200 : 503,
//         body: { status: ok ? "live" : "down", detail },
//       };
//     })
//   );

//   r.get("/ready", (req, res) =>
//     rx.receive(req as any, res as any, async () => {
//       const probe = opts.ready ?? defaultReady;
//       const { ok, detail } = await probe();
//       return {
//         status: ok ? 200 : 503,
//         body: { status: ok ? "ready" : "not_ready", detail },
//       };
//     })
//   );

//   if (opts.extraRoutes) opts.extraRoutes(r);
//   return r;
// }

// /** Convenience helper to mount at /health with one line. */
// export function mountHealth(app: Express, opts: HealthOptions): void {
//   app.use("/health", createHealthRouter(opts));
// }
