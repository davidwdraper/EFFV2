// /backend/tests/e2e/act.e2e.spec.ts
import { describe, it, beforeAll, afterEach, expect } from "vitest";
import { makeClient, expectProblemPayload } from "./helpers/http";
import {
  buildActPayload,
  validateAct,
  validateActList,
  NV_PREFIX,
} from "./helpers/data";

const DIRECT_BASE = process.env.DIRECT_BASE ?? "http://localhost:4002";
const GATEWAY_BASE = process.env.GATEWAY_BASE ?? "http://localhost:4000";

for (const BASE of [DIRECT_BASE, GATEWAY_BASE]) {
  describe(`Act E2E @ ${BASE}`, () => {
    const http = makeClient(BASE);
    const createdIds = new Set<string>();

    const del = async (id: string) => {
      const r = await http.delete(`/acts/${id}`);
      if (r.status === 204) createdIds.delete(id);
      return r.status;
    };

    afterEach(async () => {
      for (const id of Array.from(createdIds)) {
        try {
          await del(id);
        } catch {
          /* ignore */
        }
      }
    });

    it("ping", async () => {
      const r = await http.get("/acts/ping");
      expect(r.status).toBe(200);
      expect(r.data?.ok).toBe(true);
    });

    it("list + filters", async () => {
      const r = await http.get("/acts?limit=5&offset=0");
      expect(r.status).toBe(200);
      const list = validateActList(r.data);
      expect(Array.isArray(list.items)).toBe(true);
      expect(typeof list.total).toBe("number");
    });

    it("create → get → patch → delete", async () => {
      const payload = buildActPayload();
      const c = await http.post("/acts", payload);
      expect(c.status).toBe(201);
      const created = validateAct(c.data);
      createdIds.add(created._id);

      const g = await http.get(`/acts/${created._id}`);
      expect(g.status).toBe(200);
      validateAct(g.data);

      const p = await http.patch(`/acts/${created._id}`, {
        websiteUrl: "https://example.com",
      });
      expect(p.status).toBe(200);
      const upd = validateAct(p.data);
      expect(upd.websiteUrl).toBe("https://example.com");

      const d = await http.delete(`/acts/${created._id}`);
      expect(d.status).toBe(204);
      createdIds.delete(created._id);

      const g2 = await http.get(`/acts/${created._id}`);
      expect(g2.status).toBe(404);
    });

    it("bad id returns Problem+JSON", async () => {
      const r = await http.get("/acts/not-a-valid-id");
      expect(r.status).toBe(400);
      expectProblemPayload(r.data, "BAD_REQUEST", 400);
    });

    it("final sweep by NVTEST_", async () => {
      // If list supports it, sweep; otherwise this is a no-op sanity check
      const r = await http.get("/acts?limit=100&offset=0");
      if (r.status === 200 && Array.isArray(r.data?.items)) {
        for (const it of r.data.items as any[]) {
          if (typeof it.name === "string" && it.name.startsWith(NV_PREFIX)) {
            await http.delete(`/acts/${it._id}`);
          }
        }
      }
      expect(true).toBe(true);
    });
  });
}
