// backend/services/template/src/validators/template.dto.ts
import { z } from "zod";
import { templateContract } from "@shared/contracts/template.contract";

/**
 * CREATE (API surface): caller supplies only business fields.
 */
export const createTemplateDto = templateContract.pick({
  firstname: true,
  lastname: true,
  email: true,
}).passthrough();

/**
 * UPDATE (API surface): partial allowed on business fields.
 * System fields are controlled by the service.
 */
export const updateTemplateDto = templateContract.pick({
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

export type CreateTemplateDto = z.infer<typeof createTemplateDto>;
export type UpdateTemplateDto = z.infer<typeof updateTemplateDto>;
