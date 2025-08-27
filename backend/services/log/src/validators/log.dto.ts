// backend/services/log/src/validators/log.dto.ts
import { z } from "zod";
import { LogContract } from "../../../shared/contracts/log";

/**
 * DTO for POST /logs
 * Callers provide everything except userId (server may stamp it from auth).
 */
export const LogCreateDto = LogContract.omit({
  // userId is stamped from req.user if present; clients may not set it directly.
  userId: true,
}).extend({
  userId: z.never().optional(),
});

export type LogCreate = z.infer<typeof LogCreateDto>;
