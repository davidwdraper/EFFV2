// backend/services/user/src/services/directoryWriter.ts
import Directory from "../models/user.directory.model";
import { clean } from "@shared/utils/clean";

function fold(s?: string) {
  return String(s ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export type DirectoryUpsertInput = {
  userId: string;
  bucket: number;
  email: string;
  emailNorm: string;
  givenName?: string;
  familyName?: string;
  city?: string;
  state?: string;
  country?: string;
  dateCreated?: string; // optional on upsert
};

/**
 * Upsert the discovery read-model for a user (no PII beyond email).
 * Writes only defined fields; preserves dateCreated on existing docs.
 */
export async function upsertDirectory(i: DirectoryUpsertInput): Promise<void> {
  const now = new Date().toISOString();
  const givenFold = i.givenName ? fold(i.givenName) : undefined;
  const familyFold = i.familyName ? fold(i.familyName) : undefined;
  const nameFold = fold([i.givenName, i.familyName].filter(Boolean).join(" "));

  const setPayload = clean({
    userId: i.userId,
    bucket: i.bucket,
    email: i.email,
    emailNorm: i.emailNorm,
    givenName: i.givenName,
    familyName: i.familyName,
    nameFold,
    givenFold,
    familyFold,
    city: i.city,
    state: i.state,
    country: i.country,
    dateLastUpdated: now,
  });

  await Directory.updateOne(
    { userId: i.userId },
    {
      $set: setPayload,
      $setOnInsert: { dateCreated: i.dateCreated || now },
    },
    { upsert: true, collation: { locale: "en", strength: 2 } }
  ).exec();
}

/** Remove the discovery record for a user (idempotent). */
export async function deleteFromDirectory(userId: string): Promise<void> {
  await Directory.deleteOne({ userId }).exec();
}
