// backend/services/act/test/bootstrap.spec.ts

import path from "node:path";
import {
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
  vi,
  type MockInstance,
} from "vitest";

// IMPORTANT: must be a string literal; vi.mock() is hoisted before code runs.
vi.mock("../../shared/config/env", () => ({
  loadEnvFromFileOrThrow: vi.fn(),
  assertRequiredEnv: vi.fn(),
}));

const getEnvMocks = async () => {
  const mod = await import("../../shared/config/env");
  return {
    loadEnvFromFileOrThrow:
      mod.loadEnvFromFileOrThrow as unknown as MockInstance<
        (p: string) => void
      >,
    assertRequiredEnv: mod.assertRequiredEnv as unknown as MockInstance<
      (keys: string[]) => void
    >,
  };
};

describe("bootstrap.ts", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    const { loadEnvFromFileOrThrow, assertRequiredEnv } = await getEnvMocks();
    loadEnvFromFileOrThrow.mockReset();
    assertRequiredEnv.mockReset();
    delete process.env.ENV_FILE;
  });

  it("loads ENV_FILE (or default) from monorepo root and asserts required vars", async () => {
    process.env.ENV_FILE = ".env.test";
    const expectedPath = path.resolve(__dirname, "../../../..", ".env.test");

    // Import AFTER setting ENV_FILE so bootstrap reads it
    await import("../src/bootstrap");

    const { loadEnvFromFileOrThrow, assertRequiredEnv } = await getEnvMocks();

    expect(loadEnvFromFileOrThrow).toHaveBeenCalledTimes(1);
    expect(loadEnvFromFileOrThrow).toHaveBeenCalledWith(expectedPath);

    expect(assertRequiredEnv).toHaveBeenCalledTimes(1);
    const [keys] = assertRequiredEnv.mock.calls[0] as [string[]];
    expect(keys).toEqual([
      "LOG_LEVEL",
      "LOG_SERVICE_URL",
      "ACT_SERVICE_NAME",
      "ACT_MONGO_URI",
      "ACT_PORT",
    ]);
  });

  it("falls back to .env.dev when ENV_FILE is missing/blank", async () => {
    process.env.ENV_FILE = "   ";
    const expectedPath = path.resolve(__dirname, "../../../..", ".env.dev");

    await import("../src/bootstrap");

    const { loadEnvFromFileOrThrow } = await getEnvMocks();
    expect(loadEnvFromFileOrThrow).toHaveBeenCalledWith(expectedPath);
  });
});
