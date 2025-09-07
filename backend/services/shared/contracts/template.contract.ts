// backend/services/shared/contracts/template.contract.ts
import { z } from "zod";

/**
 * Canonical contract for the Template entity (shared).
 * Fields are generic and safe to reuse when cloning the template.
 */
export const templateContract = z.object({
  _id: z.string().uuid().optional(),

  firstname: z.string().min(1),
  lastname: z.string().min(1),
  email: z.string().email(),

  userCreateId: z.string().uuid(),
  userOwnerId: z.string().uuid(),

  dateCreated: z.coerce.date(),
  dateLastUpdated: z.coerce.date(),
});

export type TemplateDomain = z.infer<typeof templateContract>;
