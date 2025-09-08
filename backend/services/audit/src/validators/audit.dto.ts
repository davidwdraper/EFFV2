// backend/services/audit/src/validators/audit.dto.ts
import { z } from "zod";
import { auditContract } from "@shared/contracts/audit.contract";

/**
 * CREATE (API surface): caller supplies only business fields.
 */
export const createAuditDto = auditContract.pick({
  firstname: true,
  lastname: true,
  email: true,
}).passthrough();

/**
 * UPDATE (API surface): partial allowed on business fields.
 * System fields are controlled by the service.
 */
export const updateAuditDto = auditContract.pick({
  firstname: true,
  lastname: true,
  email: true,
}).partial();

/**
 * PARAMS: /:id
 * We accept any non-empty string id (ObjectId or custom), not forcing UUID.
 */
export const findByIdDto = z.object({
  id: z.string().min(1),
});

export type CreateAuditDto = z.infer<typeof createAuditDto>;
export type UpdateAuditDto = z.infer<typeof updateAuditDto>;
