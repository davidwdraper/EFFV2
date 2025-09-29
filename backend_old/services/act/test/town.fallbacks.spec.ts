import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import Town from "../src/models/Town";

const NV_PREFIX = "NVTEST_";

describe("Town list fallbacks", () => {
  it("Fallback 1 (tokens) or Fallback 2 (unfiltered) returns something", async () => {
    const query = `${NV_PREFIX}GARBAGE_NO_MATCH_TOKEN`;

    const count = await Town.countDocuments({
      name: { $regex: new RegExp(`^${NV_PREFIX}`) },
    });
    expect(count).toBeGreaterThan(0);

    const r = await request(app)
      .get(`/towns?query=${encodeURIComponent(query)}&limit=10`)
      .expect(200);

    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body.length).toBeGreaterThan(0);
  });

  it("State filter still applies during fallbacks", async () => {
    const r = await request(app)
      .get(
        `/towns?query=${encodeURIComponent(
          `${NV_PREFIX}NOPE`
        )}&state=AK&limit=10`
      )
      .expect(200);

    expect(
      r.body.length === 0 || r.body.every((t: any) => t.state === "AK")
    ).toBe(true);
  });
});
