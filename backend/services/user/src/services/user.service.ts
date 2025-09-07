// backend/services/user/src/services/user.service.ts
import UserModel from "../models/user.model";

export type ListArgs = { q?: string; limit?: number; offset?: number };

export async function listUsers({
  q = "",
  limit = 50,
  offset = 0,
}: ListArgs = {}) {
  const filter = q.trim()
    ? {
        $or: [
          { name: { $regex: q, $options: "i" } },
          { email: { $regex: q, $options: "i" } },
        ],
      }
    : {};
  const docs = await UserModel.find(filter).skip(offset).limit(limit).lean();
  return docs.map(dbToDomain);
}

export async function getUserById(id: string) {
  const doc = await UserModel.findById(id).lean();
  return doc ? dbToDomain(doc) : null;
}

/** Case-insensitive exact match on email (uses collation to hit index). */
export async function getUserByEmail(email: string) {
  const e = String(email || "").trim();
  if (!e) return null;
  const doc = await UserModel.findOne({ email: e })
    .collation({ locale: "en", strength: 2 })
    .lean();
  return doc ? dbToDomain(doc) : null;
}

/** Same as above, but includes password fields if schema marks them select:false. */
export async function getUserByEmailWithPassword(email: string) {
  const e = String(email || "").trim();
  if (!e) return null;
  const doc = await UserModel.findOne({ email: e })
    .collation({ locale: "en", strength: 2 })
    .select("+password +passwordHash +hash")
    .lean();
  return doc ? dbToDomain(doc) : null;
}

export async function createUser(input: Record<string, unknown>) {
  const doc = await UserModel.create(input as any);
  return dbToDomain(doc);
}

/** PUT semantics (replace entire doc). */
export async function replaceUser(id: string, input: Record<string, unknown>) {
  const doc = await UserModel.findOneAndReplace({ _id: id }, input, {
    new: true,
    runValidators: true,
  }).lean();
  return doc ? dbToDomain(doc) : null;
}

/** PATCH semantics (partial). */
export async function patchUser(id: string, input: Record<string, unknown>) {
  const doc = await UserModel.findByIdAndUpdate(id, input, {
    new: true,
    runValidators: true,
  }).lean();
  return doc ? dbToDomain(doc) : null;
}

/** DELETE semantics. */
export async function removeUser(id: string) {
  const doc = await UserModel.findByIdAndDelete(id).lean();
  return !!doc;
}

// ──────────────────────────────────────────────────────────────────────────────
function dbToDomain(doc: any) {
  if (!doc) return doc;
  const o = doc?.toObject ? doc.toObject({ getters: true }) : doc;
  if (o?._id) o._id = String(o._id);
  return o;
}

export default {
  listUsers,
  getUserById,
  getUserByEmail,
  getUserByEmailWithPassword,
  createUser,
  replaceUser,
  patchUser,
  removeUser,
};
