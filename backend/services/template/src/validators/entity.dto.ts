// backend/services/template/src/validators/entity.dto.ts
import { z } from "zod";
import { entityContract } from "../../../shared/contracts/entity.contract";

// CREATE: everything except DB-managed fields
export const createEntityDto = entityContract.omit({
  _id: true,
  dateCreated: true,
  dateLastUpdated: true,
});

// UPDATE: partial with sane guards
export const updateEntityDto = entityContract
  .omit({ _id: true, dateCreated: true, dateLastUpdated: true })
  .partial();

export const findByIdDto = z.object({ id: z.string().min(1) });

export type CreateEntityDto = z.infer<typeof createEntityDto>;
export type UpdateEntityDto = z.infer<typeof updateEntityDto>;
