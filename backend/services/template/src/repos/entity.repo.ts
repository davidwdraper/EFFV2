// backend/services/template/src/repos/entity.repo.ts
import EntityModel, { EntityDocument } from "../models/entity.model";
import { dbToDomain, domainToDb } from "../mappers/entity.mapper";
import type {
  CreateEntityDto,
  UpdateEntityDto,
} from "../validators/entity.dto";

// ──────────────────────────────────────────────────────────────────────────────
// CRUD (template, zero domain-specific side effects)
// ──────────────────────────────────────────────────────────────────────────────
export async function create(input: CreateEntityDto) {
  const doc = await EntityModel.create(domainToDb(input));
  return dbToDomain(doc as EntityDocument);
}

export async function update(id: string, input: UpdateEntityDto) {
  const updated = await EntityModel.findByIdAndUpdate(id, domainToDb(input), {
    new: true,
    runValidators: true,
  });
  return updated ? dbToDomain(updated as EntityDocument) : null;
}

export async function findById(id: string) {
  const doc = await EntityModel.findById(id);
  return doc ? dbToDomain(doc as EntityDocument) : null;
}

export async function removeById(id: string) {
  const doc = await EntityModel.findByIdAndDelete(id);
  return !!doc;
}
