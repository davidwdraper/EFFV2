// backend/services/user/src/mappers/user.directory.mapper.ts
import type { DirectoryDocument } from "../models/user.directory.model";
import { clean } from "@eff/shared/src/utils/clean";
import type { DirectoryDiscovery } from "@eff/shared/src/contracts/user.directory.contract";

/** Map DB document → safe discovery DTO (no email). */
export function dbToDirectoryDiscovery(
  d: DirectoryDocument
): DirectoryDiscovery {
  return clean({
    id: d.userId,
    name: [d.givenName, d.familyName].filter(Boolean).join(" "),
    city: d.city,
    state: d.state,
    country: d.country,
    bucket: d.bucket,
    dateCreated: d.dateCreated,
    dateLastUpdated: d.dateLastUpdated,
  });
}
