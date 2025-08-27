// backend/services/log/test/contracts/log.contract.spec.ts
import { describe, it, expect } from "vitest";
import { LogContract } from "../../../shared/contracts/log";
import { validEvent, invalidEvents } from "../fixtures/log.samples";

describe("Log Contract (shared/contracts/log.ts)", () => {
  it("accepts a valid event", () => {
    const v = LogContract.safeParse(validEvent());
    expect(v.success).toBe(true);
  });

  it("rejects missing required fields", () => {
    const v = LogContract.safeParse(invalidEvents.missingMessage as any);
    expect(v.success).toBe(false);
  });

  it("rejects bad time format", () => {
    const v = LogContract.safeParse(invalidEvents.badTime as any);
    expect(v.success).toBe(false);
  });

  it("rejects bad uuid format", () => {
    const v = LogContract.safeParse(invalidEvents.badUuid as any);
    expect(v.success).toBe(false);
  });

  it("rejects invalid channel", () => {
    const v = LogContract.safeParse(invalidEvents.badChannel as any);
    expect(v.success).toBe(false);
  });
});
