// backend/services/log/test/helpers/server.ts
import type { SuperTest, Test } from "supertest";
// Use CJS-style require — plays nicest with @types/supertest
// and avoids ESM default/namespace import weirdness.
const supertest: (app: any) => SuperTest<Test> = require("supertest");

/**
 * Import the Express app (no .listen()) and expose a SuperTest client.
 * We do NOT use request.agent(...) anywhere in this helper.
 */
export async function buildServer(): Promise<{
  request: SuperTest<Test>;
  close: () => Promise<void>;
}> {
  const { default: app } = (await import("../../src/app")) as {
    default: import("express").Express;
  };

  // Some toolchains infer TestAgent<Test>; do the recommended unknown hop.
  const raw = (supertest as unknown as (app: any) => unknown)(app);
  const request = raw as unknown as SuperTest<Test>;

  const close = async () => {
    /* no-op */
  };
  return { request, close };
}
