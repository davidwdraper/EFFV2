// /backend/tests/e2e/setup.validate.ts
import { beforeAll, describe, it, expect } from "vitest";
import { waitForPort } from "./helpers/ports";
import { execa } from "execa";

const DIRECT_PORT = Number(process.env.ACT_PORT ?? 4002);
const GATEWAY_PORT = Number(process.env.GATEWAY_PORT ?? 4000);

let procs: Array<{ cmd: string; child: any }> = [];

describe("E2E setup sanity", () => {
  beforeAll(async () => {
    if (process.env.SPAWN_SERVICES === "1") {
      // Optional auto-spawn for CI/local one-liner
      const env = { ...process.env, ENV_FILE: ".env.test" };
      procs.push({
        cmd: "act",
        child: execa("yarn", ["workspace", "act", "start"], {
          stdio: "inherit",
          env,
        }),
      });
      procs.push({
        cmd: "gateway",
        child: execa("yarn", ["workspace", "gateway", "start"], {
          stdio: "inherit",
          env,
        }),
      });
    }
    await waitForPort(DIRECT_PORT, 120_000);
    await waitForPort(GATEWAY_PORT, 120_000);
  }, 150_000);

  it("ports reachable", () => {
    expect(true).toBe(true);
  });

  // NOTE: vitest kills child processes when it exits; if not, we could add afterAll() to cleanup.
});
