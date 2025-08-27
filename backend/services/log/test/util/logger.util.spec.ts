// backend/services/log/test/util/logger.util.spec.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { validEvent } from "../fixtures/log.samples";

// ---- Axios mock (module-scoped) ----------------------------------------------
// Export a default function object so code can call axios(...) if needed,
// and also axios.post / axios.get specifically. Logger uses axios.post/get.
vi.mock("axios", () => {
  const fn: any = vi.fn((_cfg?: any) => Promise.resolve({ status: 202 }));
  fn.post = vi.fn(() => Promise.resolve({ status: 202 }));
  fn.get = vi.fn(() =>
    Promise.resolve({
      status: 200,
      data: { ok: true, db: { connected: true } },
    })
  );
  return { default: fn };
});

// Import logger AFTER env is set (fresh module graph each time)
async function getLogger() {
  vi.resetModules();
  return (await import("../../../shared/utils/logger")) as unknown as {
    postAudit: (e: unknown) => Promise<void>;
  };
}

function fsDir(): string {
  return process.env.LOG_FS_DIR!;
}
function dayFile(prefix: "audit" | "error") {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return path.join(fsDir(), `${prefix}-${y}-${m}-${day}.log`);
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

describe("logger util (shared/utils/logger.ts)", () => {
  beforeEach(async () => {
    // Required envs (logger.ts fails fast if missing)
    process.env.NODE_ENV = "test";
    process.env.LOG_LEVEL = "debug";
    process.env.SERVICE_NAME = "log-service-test";

    // Tokens for rotation test
    process.env.LOG_SERVICE_TOKEN_CURRENT = "tc";
    process.env.LOG_SERVICE_TOKEN_NEXT = "tn";

    process.env.LOG_SERVICE_URL = "http://log.service.test/logs";
    process.env.LOG_SERVICE_HEALTH_URL = "http://log.service.test/health/deep";

    process.env.LOG_FS_DIR = path.resolve("tmp-logs/nv-log-cache-test");

    // Clean FS cache dir
    await fsp.mkdir(process.env.LOG_FS_DIR, { recursive: true });
    const entries = await fsp.readdir(process.env.LOG_FS_DIR).catch(() => []);
    await Promise.all(
      entries.map((n) =>
        fsp.rm(path.join(process.env.LOG_FS_DIR!, n), {
          force: true,
          recursive: true,
        })
      )
    );

    vi.restoreAllMocks();
  });

  it("postAudit: fire-and-forget resolves on 202", async () => {
    const Logger = await getLogger();
    await expect(Logger.postAudit(validEvent())).resolves.toBeUndefined();
  });

  it("rotation: retries with NEXT token on 401/403, then succeeds", async () => {
    const axios = (await import("axios")).default as unknown as any;

    // First attempt: reject with 401 so util catches and triggers retry
    axios.post
      .mockRejectedValueOnce({ response: { status: 401 } })
      .mockResolvedValueOnce({ status: 202 });

    const Logger = await getLogger();

    await Logger.postAudit(validEvent());

    expect(axios.post).toHaveBeenCalledTimes(2);

    // Header tokens (CURRENT then NEXT)
    const firstCallArgs = axios.post.mock.calls[0];
    const secondCallArgs = axios.post.mock.calls[1];
    const firstHeaders = firstCallArgs[2]?.headers ?? {};
    const secondHeaders = secondCallArgs[2]?.headers ?? {};
    expect(firstHeaders["x-internal-key"]).toBe("tc");
    expect(secondHeaders["x-internal-key"]).toBe("tn");
  });

  it("FS cache fallback when unreachable; writes NDJSON line", async () => {
    const axios = (await import("axios")).default as unknown as any;
    axios.post.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const Logger = await getLogger();
    await Logger.postAudit(validEvent()); // fire-and-forget → returns before write completes

    const f = dayFile("audit");

    // 🔧 Wait/poll briefly because write happens asynchronously after the catch
    let tries = 0;
    while (!fs.existsSync(f) && tries < 10) {
      await sleep(25); // total up to ~250ms
      tries++;
    }

    expect(fs.existsSync(f)).toBe(true);
    const txt = await fsp.readFile(f, "utf8");
    expect(txt.trim()).not.toBe("");
  });

  it("on breaker open, deep health OK triggers flush and clears .replay", async () => {
    const axios = (await import("axios")).default as unknown as any;

    const Logger1 = await getLogger();
    // 1) Force first send to fail → breaker opens and event is cached
    axios.post.mockRejectedValueOnce(new Error("ECONNRESET"));
    await Logger1.postAudit(validEvent());

    const cacheFile = dayFile("audit");
    // give the writer a moment
    await sleep(25);
    expect(fs.existsSync(cacheFile)).toBe(true);

    // 2) Next: health OK, post succeeds → util should flush cache
    axios.get.mockResolvedValueOnce({
      status: 200,
      data: { ok: true, db: { connected: true } },
    });
    axios.post.mockResolvedValue({ status: 202 });

    const Logger2 = await getLogger();
    await Logger2.postAudit(validEvent());

    // Give flush a moment to process
    await sleep(150);

    const entries = fs.existsSync(fsDir()) ? await fsp.readdir(fsDir()) : [];
    expect(entries.filter((n) => n.endsWith(".replay")).length).toBe(0);
  });
});
