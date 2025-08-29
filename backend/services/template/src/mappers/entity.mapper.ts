// backend/services/template/src/mappers/entity.mapper.ts
import type { Entity } from "../../../shared/contracts/entity.contract";
import type { EntityDocument } from "../models/entity.model";

// Domain ↔ DB mappers. Keep thin; no business logic here.
export function dbToDomain(doc: EntityDocument): Entity {
  const o = doc.toObject({ getters: true });
  return {
    _id: String(o._id),
    dateCreated: o.dateCreated,
    dateLastUpdated: o.dateLastUpdated,
    // 👇 add your entity fields here (keep in sync with the contract/model)
    name: o.name,
    // ...more fields...
  };
}

export function domainToDb(partial: Partial<Entity>): Record<string, unknown> {
  const o: Record<string, unknown> = { ...partial };
  delete o._id;
  delete o.dateCreated;
  delete o.dateLastUpdated;
  return o;
}
