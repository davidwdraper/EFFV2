// backend/services/user/src/dto/directoryDto.ts
import { clean } from "@shared/contracts";

/** Public discovery record (no email) */
export function toDirectoryDiscovery(d: any) {
  return clean({
    id: d?.userId,
    name: [d?.givenName, d?.familyName].filter(Boolean).join(" "),
    city: d?.city,
    state: d?.state,
    country: d?.country,
    bucket: d?.bucket,
  });
}
