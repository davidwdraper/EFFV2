// backend/services/shared/contracts/user.directory.contract.ts
import { z } from "zod";
import { zIsoDate } from "@eff/shared/src/contracts/common";

export const zDirectoryDiscovery = z.object({
  id: z.string(),
  name: z.string(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  bucket: z.number().optional(),
  dateCreated: zIsoDate.optional(),
  dateLastUpdated: zIsoDate.optional(),
});
export type DirectoryDiscovery = z.infer<typeof zDirectoryDiscovery>;
