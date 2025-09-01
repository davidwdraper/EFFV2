// backend/services/user/src/services/userService.ts
import { normalizeEmail, emailToBucket } from "@shared/tenant/bucket";
import * as repo from "../repo/userRepo";
import {
  upsertDirectory,
  deleteFromDirectory,
} from "../services/directoryWriter";
import { dbToDomain } from "../mappers/user.mapper";
import type { User } from "@shared/contracts/user.contract";

// Treat Mongo dup-key as conflict
const isDupKey = (err: any) =>
  err && (err.code === 11000 || String(err?.message || "").includes("E11000"));

/** Internal-only mapper for the private endpoint that returns password too. */
function toUserWithPasswordDto(doc: any): User & { password: string } {
  const domain = dbToDomain(doc as any);
  return { ...domain, password: String(doc?.password ?? "") };
}

export async function createUser(raw: any) {
  const emailNorm = normalizeEmail(String(raw.email));
  const bucket = emailToBucket(emailNorm);

  const existing = await repo.findByEmail(emailNorm);
  if (existing) return { conflict: true as const };

  const now = new Date();
  const doc = await repo.create({
    email: emailNorm,
    password: raw.password,
    firstname: raw.firstname,
    lastname: raw.lastname,
    middlename: raw.middlename,
    emailNorm,
    bucket,
    dateCreated: now,
    dateLastUpdated: now,
    userStatus: 0,
    userType: 0,
    imageIds: [],
    ...raw, // allow extra UI fields; model validators apply
  });

  await upsertDirectory({
    userId: String((doc as any)._id),
    bucket,
    email: (doc as any).email,
    emailNorm,
    givenName: (doc as any).firstname,
    familyName: (doc as any).lastname,
    city: (doc as any).city,
    state: (doc as any).state,
    country: (doc as any).country,
    dateCreated: now.toISOString(),
  });

  return { doc, dto: dbToDomain(doc as any) };
}

export async function listUsers() {
  const docs = await repo.findAll();
  // Be explicit so TS doesn’t try to force a stricter callback signature
  return docs.map((d) => dbToDomain(d as any));
}

export async function getUserById(id: string) {
  if (!repo.isValidId(id)) return { badId: true as const };
  const doc = await repo.findById(id);
  if (!doc) return { notFound: true as const };
  return { dto: dbToDomain(doc as any) };
}

export async function replaceUser(id: string, body: any) {
  if (!repo.isValidId(id)) return { badId: true as const };

  const emailNorm = normalizeEmail(String(body.email));
  const patch = {
    ...body,
    email: emailNorm,
    emailNorm,
    bucket: emailToBucket(emailNorm),
    dateLastUpdated: new Date(),
  };

  try {
    // replace semantics; model validators enforce required fields
    const updated = await repo.updateById(id, patch);
    if (!updated) return { notFound: true as const };

    await upsertDirectory({
      userId: String((updated as any)._id),
      bucket: (updated as any).bucket,
      email: (updated as any).email,
      emailNorm,
      givenName: (updated as any).firstname,
      familyName: (updated as any).lastname,
      city: (updated as any).city,
      state: (updated as any).state,
      country: (updated as any).country,
    });

    return { dto: dbToDomain(updated as any) };
  } catch (err) {
    if (isDupKey(err)) return { conflict: true as const };
    throw err;
  }
}

export async function patchUser(id: string, body: any) {
  if (!repo.isValidId(id)) return { badId: true as const };

  const patch: Record<string, any> = { ...body, dateLastUpdated: new Date() };
  if (patch.email) {
    const emailNorm = normalizeEmail(String(patch.email));
    patch.email = emailNorm;
    patch.emailNorm = emailNorm;
    patch.bucket = emailToBucket(emailNorm);
  }

  try {
    const updated = await repo.updateById(id, { $set: patch });
    if (!updated) return { notFound: true as const };

    await upsertDirectory({
      userId: String((updated as any)._id),
      bucket:
        (updated as any).bucket ??
        emailToBucket(normalizeEmail(String((updated as any).email))),
      email: (updated as any).email,
      emailNorm: normalizeEmail(String((updated as any).email)),
      givenName: (updated as any).firstname,
      familyName: (updated as any).lastname,
      city: (updated as any).city,
      state: (updated as any).state,
      country: (updated as any).country,
    });

    return { dto: dbToDomain(updated as any) };
  } catch (err) {
    if (isDupKey(err)) return { conflict: true as const };
    throw err;
  }
}

export async function removeUser(id: string) {
  if (!repo.isValidId(id)) return { badId: true as const };

  const removed = await repo.deleteById(id);
  if (!removed) return { notFound: true as const };

  await deleteFromDirectory(String(id));
  return { ok: true as const };
}

export async function getUserByEmail(email: string) {
  const emailNorm = normalizeEmail(String(email));
  const doc = await repo.findByEmail(emailNorm);
  if (!doc) return { notFound: true as const };
  return { dto: dbToDomain(doc as any) };
}

export async function getUserByEmailWithPassword(email: string) {
  const emailNorm = normalizeEmail(String(email));
  const doc = await repo.findByEmail(emailNorm);
  if (!doc) return { notFound: true as const };
  return { dto: toUserWithPasswordDto(doc) };
}
