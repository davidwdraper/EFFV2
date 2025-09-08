// backend/services/audit/src/mappers/audit.mapper.ts
import type { AuditDomain } from "@shared/contracts/audit.contract";
import type { AuditDoc } from "../models/audit.model";

/**
 * Domain ↔ DB mappers. Keep thin; no business logic here.
 */

export function dbToDomain(doc: AuditDoc): AuditDomain {
  const o = doc.toObject({ getters: true });
  return {
    _id: (o._id && o._id.toString ? o._id.toString() : String(o._id)),
    firstname: o.firstname,
    lastname: o.lastname,
    email: o.email,
    userCreateId: o.userCreateId,
    userOwnerId: o.userOwnerId,
    dateCreated: o.dateCreated,
    dateLastUpdated: o.dateLastUpdated,
  };
}

export function domainToDb(partial: Partial<AuditDomain>): Record<string, unknown> {
  const o: Record<string, unknown> = { ...partial };
  // DB-managed fields
  delete o._id;
  delete o.dateCreated;
  delete o.dateLastUpdated;
  return o;
}
