// backend/services/act/test/smoke.health.direct.spec.ts
import { describe, it, expect } from "vitest";
import { getAgent } from "./helpers/server";

/**
 * Direct Act smoke test:
 * - Verifies /health returns 200 and a minimal shape
 * - Ensures pino/logger wiring doesn’t crash test env
 */
describe("Act Service (direct) — /health", () => {
  const agent = getAgent();

  it("GET /health → 200 with { status: 'ok', service: 'act' }", async () => {
    const res = await agent.get("/health").expect(200);
    expect(res.body).toBeTypeOf("object");
    expect(res.body.status).toBe("ok");
    if (res.body.service) {
      expect(res.body.service).toBe("act");
    }
  });
});
