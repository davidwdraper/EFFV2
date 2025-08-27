// backend/services/act/src/controllers/act/handlers/schemas.ts
import { z } from "zod";
import { zObjectId, zPagination } from "@shared/contracts";

export const zIdParam = z.object({ id: zObjectId });

export const zListQuery = zPagination.extend({
  name: z.string().trim().min(1).max(200).optional(),
});
