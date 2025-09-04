// backend/services/svcconfig/src/repo/svcconfig.repo.ts
import SvcConfig from "../models/svcconfig.model";
import type { SvcConfigDoc } from "../models/svcconfig.model";

export async function create(fields: Partial<SvcConfigDoc>) {
  const doc = await SvcConfig.create(fields);
  return doc;
}

export async function list() {
  return SvcConfig.find().lean<SvcConfigDoc[]>();
}

export async function getBySlug(slug: string) {
  return SvcConfig.findOne({ slug });
}

export async function patchBySlug(slug: string, fields: Partial<SvcConfigDoc>) {
  const doc = await SvcConfig.findOne({ slug });
  if (!doc) return null;
  Object.assign(doc, fields);
  doc.version = (doc.version || 1) + 1;
  doc.updatedAt = new Date();
  return doc.save();
}

export async function disable(slug: string) {
  const doc = await SvcConfig.findOne({ slug });
  if (!doc) return null;
  doc.enabled = false;
  doc.allowProxy = false;
  doc.version = (doc.version || 1) + 1;
  doc.updatedAt = new Date();
  return doc.save();
}
