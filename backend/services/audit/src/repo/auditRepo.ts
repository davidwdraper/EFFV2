// backend/services/--audit--/src/repo/auditRepo.ts
import { AuditModel } from "../models/audit.model";
import type { AuditDomain } from "@shared/contracts/audit.contract";
import { dbToDomain } from "../mappers/audit.mapper";

/**
 * Repo layer: returns domain objects only (no raw mongoose docs)
 */
export async function create(domain: AuditDomain): Promise<AuditDomain> {
  const doc = new AuditModel(domain);
  const saved = await doc.save();
  return dbToDomain(saved);
}


export async function findById(id: string): Promise<AuditDomain | null> {
  const doc = await AuditModel.findById(id).exec();
  return doc ? dbToDomain(doc as any) : null;
}

export async function list(opts: { limit?: number; offset?: number } = {}): Promise<AuditDomain[]> {
  const { limit = 50, offset = 0 } = opts;
  const docs = await AuditModel.find({}).skip(offset).limit(limit).exec();
  return docs.map((d: any) => dbToDomain(d));
}

export async function update(id: string, patch: Partial<AuditDomain>): Promise<AuditDomain | null> {
  const now = new Date();
  const updateDoc: any = { ...patch, dateLastUpdated: now };
  delete updateDoc._id;
  delete updateDoc.dateCreated;

  const doc = await AuditModel.findByIdAndUpdate(id, updateDoc, { new: true }).exec();
  return doc ? dbToDomain(doc as any) : null;
}

export async function remove(id: string): Promise<boolean> {
  const res = await AuditModel.deleteOne({ _id: id }).exec();
  return (res.deletedCount ?? 0) > 0;
}
