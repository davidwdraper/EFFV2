// backend/services/template/src/mappers/template.mapper.ts
import type { TemplateDomain } from "@shared/src/contracts/template.contract";
import type { TemplateDoc } from "../models/template.model";

/**
 * Domain ↔ DB mappers. Keep thin; no business logic here.
 */

export function dbToDomain(doc: TemplateDoc): TemplateDomain {
  const o = doc.toObject({ getters: true });
  return {
    _id: o._id && o._id.toString ? o._id.toString() : String(o._id),
    firstname: o.firstname,
    lastname: o.lastname,
    email: o.email,
    userCreateId: o.userCreateId,
    userOwnerId: o.userOwnerId,
    dateCreated: o.dateCreated,
    dateLastUpdated: o.dateLastUpdated,
  };
}

export function domainToDb(
  partial: Partial<TemplateDomain>
): Record<string, unknown> {
  const o: Record<string, unknown> = { ...partial };
  // DB-managed fields
  delete o._id;
  delete o.dateCreated;
  delete o.dateLastUpdated;
  return o;
}
