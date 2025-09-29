// backend/services/act/test/smoke.health.direct.spec.ts
import { describe, it, expect } from "vitest";
import { getAgent } from "./helpers/server";

/**
 * Direct Act smoke test (non-brittle):
 * - Verifies /health returns 200 and an object
 * - Accepts any of: { status: "ok" } | { healthy: true } | { ok: true }
 * - If "service" is present, it should equal "act"
 */
describe("Act Service (direct) — /health", () => {
  const agent = getAgent();

  it("GET /health → 200 with a sane minimal payload", async () => {
    const res = await agent.get("/health").expect(200);
    expect(res.body).toBeTypeOf("object");

    const b = res.body as Record<string, unknown>;
    const hasStatusOk =
      Object.prototype.hasOwnProperty.call(b, "status") && b.status === "ok";
    const hasHealthyTrue =
      Object.prototype.hasOwnProperty.call(b, "healthy") && b.healthy === true;
    const hasOkTrue =
      Object.prototype.hasOwnProperty.call(b, "ok") && b.ok === true;

    if (!(hasStatusOk || hasHealthyTrue || hasOkTrue)) {
      throw new Error(`Unexpected /health shape: ${JSON.stringify(res.body)}`);
    }

    if (Object.prototype.hasOwnProperty.call(b, "service")) {
      expect(b.service).toBe("act");
    }
  });
});
