// /backend/tests/e2e/helpers/data.ts
import { customAlphabet } from "nanoid/non-secure";
import { zActDto, zActListDto } from "@shared/contracts/act";
import { z } from "zod";

const nano = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);
export const NV_PREFIX = "NVTEST_";

const oid = () =>
  Array.from(
    { length: 24 },
    () => "0123456789abcdef"[Math.floor(Math.random() * 16)]
  ).join("");

export function buildActPayload(overrides: Record<string, any> = {}) {
  return {
    actType: [1],
    userCreateId: oid(),
    userOwnerId: oid(),
    name: `${NV_PREFIX}${nano()}`,
    homeTown: "Austin, TX",
    homeTownId: oid(),
    homeTownLoc: { type: "Point", coordinates: [-97.7431, 30.2672] },
    ...overrides,
  };
}

export const zDeleteOk = z.unknown().transform(() => true);

export function validateAct(dto: unknown) {
  return zActDto.parse(dto);
}

export function validateActList(dto: unknown) {
  return zActListDto.parse(dto);
}
