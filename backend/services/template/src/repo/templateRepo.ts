// backend/services/--template--/src/repo/templateRepo.ts
import { TemplateModel } from "../models/template.model";
import type { TemplateDomain } from "@shared/src/contracts/template.contract";
import { dbToDomain } from "../mappers/template.mapper";

/**
 * Repo layer: returns domain objects only (no raw mongoose docs)
 */
export async function create(domain: TemplateDomain): Promise<TemplateDomain> {
  const doc = new TemplateModel(domain);
  const saved = await doc.save();
  return dbToDomain(saved);
}

export async function findById(id: string): Promise<TemplateDomain | null> {
  const doc = await TemplateModel.findById(id).exec();
  return doc ? dbToDomain(doc as any) : null;
}

export async function list(
  opts: { limit?: number; offset?: number } = {}
): Promise<TemplateDomain[]> {
  const { limit = 50, offset = 0 } = opts;
  const docs = await TemplateModel.find({}).skip(offset).limit(limit).exec();
  return docs.map((d: any) => dbToDomain(d));
}

export async function update(
  id: string,
  patch: Partial<TemplateDomain>
): Promise<TemplateDomain | null> {
  const now = new Date();
  const updateDoc: any = { ...patch, dateLastUpdated: now };
  delete updateDoc._id;
  delete updateDoc.dateCreated;

  const doc = await TemplateModel.findByIdAndUpdate(id, updateDoc, {
    new: true,
  }).exec();
  return doc ? dbToDomain(doc as any) : null;
}

export async function remove(id: string): Promise<boolean> {
  const res = await TemplateModel.deleteOne({ _id: id }).exec();
  return (res.deletedCount ?? 0) > 0;
}
