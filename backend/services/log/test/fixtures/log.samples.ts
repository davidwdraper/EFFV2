// backend/services/log/test/fixtures/log.samples.ts
import { randomUUID } from "node:crypto";

// Minimal valid event for your LogContract
export function validEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    eventId: randomUUID(),
    timeCreated: new Date().toISOString(),
    channel: "audit",
    level: "audit",
    message: "Created Act",
    service: "unit-test",
    path: "/acts",
    method: "POST",
    status: 201,
    requestId: randomUUID(),
    userId: randomUUID(),
    entityName: "Act",
    entityId: randomUUID(),
    sourceFile: "tests/fixtures/log.samples.ts",
    sourceLine: 1,
    sourceFunction: "validEvent",
    payload: { foo: "bar" },
    v: 1,
    ...overrides,
  };
}

export const invalidEvents = {
  missingMessage: (() => {
    const v = validEvent();
    // @ts-expect-error intentionally remove message
    delete v.message;
    return v;
  })(),
  badTime: validEvent({ timeCreated: "not-iso" }),
  badUuid: validEvent({ eventId: "1234" }),
  badChannel: validEvent({ channel: "warn" }), // not "audit" | "error"
};
