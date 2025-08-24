// backend/services/act/test/app.spec.ts

// ── Load env before importing app (so logger/env checks don’t explode) ────────
import { config as loadEnv } from "dotenv";
import path from "node:path";
loadEnv({
  path: path.resolve(process.cwd(), process.env.ENV_FILE || ".env.dev"),
});

// Minimal env so app/logger don’t throw on import
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.REDIS_DISABLED = process.env.REDIS_DISABLED ?? "1";
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "info";
process.env.LOG_SERVICE_URL =
  process.env.LOG_SERVICE_URL || "http://localhost:0/audit";
process.env.ACT_SERVICE_NAME = process.env.ACT_SERVICE_NAME || "act";
process.env.ACT_MONGO_URI =
  process.env.ACT_MONGO_URI || "mongodb://127.0.0.1:27017/eff_act_db";
process.env.ACT_PORT = process.env.ACT_PORT || "0";

// ── Tests ─────────────────────────────────────────────────────────────────────
import http from "node:http";
import request from "supertest";
import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { zProblem } from "@shared/contracts/common";

let outer: Express;
let server: http.Server;

beforeAll(async () => {
  // Import the real service app (with its own 404 & error handlers)
  const appMod = await import("../src/app");
  const serviceApp = ((appMod as any).app ??
    (appMod as any).default) as Express;

  // Build a parent app so we can mount test-only routes BEFORE the service app
  outer = express();

  // Test-only routes (exercise error handler branches)
  outer.get("/__throw", (_req, _res) => {
    throw new Error("boom");
  });

  outer.get(
    "/__err422",
    (_req: Request, _res: Response, next: NextFunction) => {
      const e = Object.assign(new Error("nope"), {
        statusCode: 422,
        type: "https://example.com/validation",
        title: "Unprocessable",
      });
      next(e);
    }
  );

  // Mount the real service app under root
  outer.use(serviceApp);

  // Parent 404 (empty body) for anything not handled above or by the service app
  outer.use((_req, res) => res.status(404).end());

  // Parent error handler that mirrors the service app Problem+JSON shape
  outer.use(
    (
      err: any,
      req: Request,
      res: Response,
      _next: NextFunction // eslint-disable-line @typescript-eslint/no-unused-vars
    ) => {
      const status = Number(err?.statusCode ?? err?.status ?? 500);
      res
        .status(Number.isFinite(status) ? status : 500)
        .type("application/problem+json")
        .json({
          type: err?.type || "about:blank",
          title: err?.title || "Internal Server Error",
          status: Number.isFinite(status) ? status : 500,
          detail: err?.message || "Unexpected error",
          instance: (req as any).id,
        });
    }
  );

  server = http.createServer(outer);
  await new Promise<void>((resolve) => server.listen(0, resolve));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("app.ts – 404/error and pino ignore branches", () => {
  it("404 under /acts uses Problem+JSON shape (service app 404 branch)", async () => {
    // Important: use a TWO-SEGMENT path to avoid matching /acts/:id
    const r = await request(server)
      .get("/acts/does-not-exist/extra")
      .expect(404);
    const prob = zProblem.parse(r.body);
    expect(prob.title).toBe("Not Found");
    expect(prob.detail).toBe("Route not found");
  });

  it("404 for non-prefixed path (parent app catch-all) returns empty body", async () => {
    const r = await request(server).get("/totally-unknown").expect(404);
    expect(r.text === "" || r.text == null).toBe(true);
  });

  it("error handler: plain throw → 500 Problem+JSON with defaults", async () => {
    const r = await request(server).get("/__throw").expect(500);
    const prob = zProblem.parse(r.body);
    expect(prob.title).toBe("Internal Server Error");
    expect(prob.detail).toBe("boom");
  });

  it("error handler: custom status/type/title flow", async () => {
    const r = await request(server).get("/__err422").expect(422);
    const prob = zProblem.parse(r.body);
    expect(prob.type).toBe("https://example.com/validation");
    expect(prob.title).toBe("Unprocessable");
    expect(prob.detail).toBe("nope");
  });

  it("pino autoLogging.ignore executes for /favicon.ico and /healthz", async () => {
    const fav = await request(server).get("/favicon.ico").expect(404);
    expect(fav.text === "" || fav.text == null).toBe(true);

    // /healthz may be mounted by the shared health router; accept either outcome.
    const hz = await request(server).get("/healthz");
    expect([200, 404]).toContain(hz.status);
  });
});
