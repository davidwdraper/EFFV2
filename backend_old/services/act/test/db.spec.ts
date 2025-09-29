// backend/services/act/test/db.spec.ts

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Build a fresh mock for mongoose in each test via vi.doMock
function makeMongooseMock() {
  const state = { readyState: 0 }; // 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
  const mock = {
    set: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    connection: {
      get readyState() {
        return state.readyState;
      },
      set readyState(v: number) {
        state.readyState = v;
      },
      asPromise: vi.fn().mockResolvedValue(undefined),
    },
    __state: state,
  };
  // default to "connecting" so we hit the asPromise branch unless overridden
  mock.__state.readyState = 2;
  return mock;
}
type MongooseMock = ReturnType<typeof makeMongooseMock>;

const ENV_KEYS = ["ACT_MONGO_URI", "ACT_SERVICE_NAME", "LOG_LEVEL", "NODE_ENV"];
const envBackup: Record<string, string | undefined> = {};

function mockLogger() {
  vi.doMock("@shared/utils/logger", () => {
    const l: any = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(() => l),
    };
    return { logger: l };
  });
}

beforeEach(() => {
  // snapshot env
  for (const k of ENV_KEYS) envBackup[k] = process.env[k];
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = process.env.LOG_LEVEL || "silent";
  process.env.ACT_SERVICE_NAME = process.env.ACT_SERVICE_NAME || "act";
  process.env.ACT_MONGO_URI =
    process.env.ACT_MONGO_URI ||
    "mongodb://user:pass@localhost:27017/eff_act_db";
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();

  // restore env
  for (const k of ENV_KEYS) {
    const v = envBackup[k];
    if (v == null) delete process.env[k];
    else process.env[k] = v;
  }

  // restore URL if we stubbed it
  // @ts-ignore
  if ((globalThis as any).__ORIG_URL__) {
    // @ts-ignore
    globalThis.URL = (globalThis as any).__ORIG_URL__;
    // @ts-ignore
    delete (globalThis as any).__ORIG_URL__;
  }
});

describe("db.connectDb / disconnectDb", () => {
  it("connects (waits if not ready) and then short-circuits on subsequent calls", async () => {
    const mongooseMock: MongooseMock = makeMongooseMock();

    mockLogger();
    vi.doMock("mongoose", () => ({ default: mongooseMock }));

    const db = await import("../src/db");
    await db.connectDb();

    expect(mongooseMock.set).toHaveBeenCalledWith("bufferCommands", false);
    expect(mongooseMock.set).toHaveBeenCalledWith("strictQuery", true);
    expect(mongooseMock.connect).toHaveBeenCalledTimes(1);
    expect(mongooseMock.connection.asPromise).toHaveBeenCalledTimes(1);

    // second call should early-return (no additional connect)
    await db.connectDb();
    expect(mongooseMock.connect).toHaveBeenCalledTimes(1);
  });

  it("skips waiting when already ready (readyState === 1)", async () => {
    const mongooseMock: MongooseMock = makeMongooseMock();
    mongooseMock.__state.readyState = 1; // already ready

    mockLogger();
    vi.doMock("mongoose", () => ({ default: mongooseMock }));

    const db = await import("../src/db");
    await db.connectDb();

    expect(mongooseMock.connect).toHaveBeenCalledTimes(1);
    expect(mongooseMock.connection.asPromise).not.toHaveBeenCalled();
  });

  it("redacts URI using fallback branch when URL parsing throws", async () => {
    const mongooseMock: MongooseMock = makeMongooseMock();

    // Force new URL(uri) to throw to hit redact catch branch
    // @ts-ignore
    (globalThis as any).__ORIG_URL__ = globalThis.URL;
    // @ts-ignore
    globalThis.URL = function () {
      throw new Error("URL boom");
    } as any;

    mockLogger();
    vi.doMock("mongoose", () => ({ default: mongooseMock }));

    const db = await import("../src/db");
    await db.connectDb();

    expect(mongooseMock.connect).toHaveBeenCalledTimes(1);
  });

  it("throws when mongoose.connect rejects (error path)", async () => {
    const mongooseMock: MongooseMock = makeMongooseMock();
    const boom = new Error("connect failed");
    mongooseMock.connect.mockRejectedValueOnce(boom);

    mockLogger();
    vi.doMock("mongoose", () => ({ default: mongooseMock }));

    const db = await import("../src/db");
    await expect(db.connectDb()).rejects.toThrow("connect failed");
  });

  it("throws when ACT_MONGO_URI is missing (requireEnv branch)", async () => {
    delete process.env.ACT_MONGO_URI;

    const mongooseMock: MongooseMock = makeMongooseMock();

    mockLogger();
    vi.doMock("mongoose", () => ({ default: mongooseMock }));

    const db = await import("../src/db");
    await expect(db.connectDb()).rejects.toThrow(
      /Missing required env var: ACT_MONGO_URI/
    );
    expect(mongooseMock.connect).not.toHaveBeenCalled();
  });

  it("disconnects when connection is open, and skips when already disconnected", async () => {
    const mongooseMock: MongooseMock = makeMongooseMock();
    mongooseMock.__state.readyState = 1; // open

    mockLogger();
    vi.doMock("mongoose", () => ({ default: mongooseMock }));

    const db = await import("../src/db");

    await db.disconnectDb();
    expect(mongooseMock.disconnect).toHaveBeenCalledTimes(1);

    // now disconnected
    mongooseMock.disconnect.mockClear();
    mongooseMock.__state.readyState = 0;

    await db.disconnectDb();
    expect(mongooseMock.disconnect).not.toHaveBeenCalled();
  });
});
