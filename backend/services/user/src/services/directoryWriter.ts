// backend/services/user/src/services/directoryWriter.ts
import Directory from "../models/Directory";

function fold(s?: string) {
  return String(s || "")
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

export async function upsertDirectory(i: DirectoryUpsertInput) {
  const now = new Date().toISOString();
  const givenFold = i.givenName ? fold(i.givenName) : undefined;
  const familyFold = i.familyName ? fold(i.familyName) : undefined;
  const nameFold = fold([i.givenName, i.familyName].filter(Boolean).join(" "));

  await Directory.updateOne(
    { userId: i.userId },
    {
      $set: {
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
      },
      $setOnInsert: { dateCreated: i.dateCreated || now },
    },
    { upsert: true, collation: { locale: "en", strength: 2 } }
  );
}

export async function deleteFromDirectory(userId: string) {
  await Directory.deleteOne({ userId });
}
