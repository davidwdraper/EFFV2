// backend/services/user/src/controllers/userController.ts
import type { Request, Response, NextFunction, RequestHandler } from "express";
import mongoose from "mongoose";
import UserModel from "../models/User";
import { normalizeEmail, emailToBucket } from "../../../shared/tenant/bucket";
import {
  upsertDirectory,
  deleteFromDirectory,
} from "../services/directoryWriter";
import { invalidateNamespace } from "../../../shared/utils/cache";

// Small async wrapper to keep routes one-liners and centralize try/catch
const asyncHandler =
  (fn: RequestHandler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// Helpers
const required = (v: any) =>
  v !== undefined && v !== null && String(v).trim() !== "";

const sanitize = (doc: any) => {
  if (!doc) return doc;
  // prefer lean() objects, but handle Mongoose documents too
  const { password, __v, _id, ...rest } = doc.toObject ? doc.toObject() : doc;
  return { id: String(doc._id ?? _id), ...rest };
};

const isDupKey = (err: any) =>
  err && (err.code === 11000 || String(err?.message || "").includes("E11000"));

const isValidId = (id: string) => mongoose.isValidObjectId(id);

// ---------- Handlers ----------

// POST /users  (public signup)
export const create: RequestHandler = asyncHandler(async (req, res) => {
  const {
    email,
    password,
    firstname,
    lastname,
    middlename,
    // any other fields the UI already sends (keep free-form)
    ...rest
  } = req.body ?? {};

  if (
    !required(email) ||
    !required(password) ||
    !required(firstname) ||
    !required(lastname)
  ) {
    req.log?.debug(
      {
        email: !!email,
        password: !!password,
        firstname: !!firstname,
        lastname: !!lastname,
      },
      "users:create missing fields"
    );
    return res.status(400).json({ error: "Missing required user fields" });
  }

  const emailNorm = normalizeEmail(String(email));
  const bucket = emailToBucket(emailNorm);

  // fast pre-check (still race-protected by unique index)
  const existing = await UserModel.findOne({ email: emailNorm }).lean();
  if (existing) {
    req.log?.debug(
      { email: emailNorm },
      "users:create conflict (email exists)"
    );
    return res.status(409).json({ error: "User already exists" });
  }

  const now = new Date();
  try {
    const doc = await UserModel.create({
      // canonical
      email: emailNorm,
      password, // hashing remains your auth flow concern
      // names as your UI uses them
      firstname,
      lastname,
      middlename,
      // bucket fields (future-proofing; safe to ignore downstream if model doesn't yet store them)
      emailNorm, // duplicate field if your model uses separate emailNorm
      bucket,
      // timestamps + defaults you already use
      dateCreated: now,
      dateLastUpdated: now,
      userStatus: 0,
      userType: 0,
      imageIds: [],
      // pass through any extra fields the UI sent (e.g., userEntryId, userOwnerId, etc.)
      ...rest,
    });

    // Directory upsert (does not expose email to clients)
    await upsertDirectory({
      userId: String(doc._id),
      bucket: bucket,
      email: doc.email,
      emailNorm: emailNorm,
      givenName: doc.firstname, // map -> directory
      familyName: doc.lastname, // map -> directory
      city: (doc as any).city,
      state: (doc as any).state,
      country: (doc as any).country,
      dateCreated: now.toISOString(),
    });

    // Audit
    req.audit?.push({
      type: "create",
      model: "User",
      id: String(doc._id),
      email: doc.email,
    });

    // Invalidate caches
    void invalidateNamespace("user");
    void invalidateNamespace("user-directory");

    req.log?.info({ userId: String(doc._id) }, "users:create success");
    return res.status(201).json(sanitize(doc));
  } catch (err: any) {
    if (isDupKey(err)) {
      req.log?.debug({ email: emailNorm }, "users:create duplicate index");
      return res.status(409).json({ error: "User already exists" });
    }
    throw err;
  }
});

// GET /users  (public list)
export const list: RequestHandler = asyncHandler(async (_req, res) => {
  const users = await UserModel.find().lean();
  return res.status(200).json(users.map((u) => sanitize(u)));
});

// GET /users/:id
export const getById: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id))
    return res.status(400).json({ error: "Invalid id format" });

  const user = await UserModel.findById(id).lean();
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.status(200).json(sanitize(user));
});

// PUT /users/:id  (protected)
export const update: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id))
    return res.status(400).json({ error: "Invalid id format" });

  const patch: Record<string, any> = { ...(req.body || {}) };
  // Canonicalize email if provided
  if (required(patch.email)) {
    const emailNorm = normalizeEmail(String(patch.email));
    patch.email = emailNorm;
    patch.emailNorm = emailNorm;
    patch.bucket = emailToBucket(emailNorm);
  }
  patch.dateLastUpdated = new Date();

  try {
    const user = await UserModel.findByIdAndUpdate(id, patch, {
      new: true,
      runValidators: true,
    }).lean();

    if (!user) return res.status(404).json({ error: "User not found" });

    // Directory upsert (reflect latest profile fields)
    await upsertDirectory({
      userId: String(user._id),
      bucket:
        (user as any).bucket ??
        emailToBucket(normalizeEmail(String(user.email))),
      email: user.email,
      emailNorm: normalizeEmail(String(user.email)),
      givenName: (user as any).firstname,
      familyName: (user as any).lastname,
      city: (user as any).city,
      state: (user as any).state,
      country: (user as any).country,
    });

    // Audit
    req.audit?.push({
      type: "update",
      model: "User",
      id,
      fields: Object.keys(patch),
    });

    // Invalidate caches
    void invalidateNamespace("user");
    void invalidateNamespace("user-directory");

    return res.status(200).json(sanitize(user));
  } catch (err: any) {
    if (isDupKey(err)) {
      return res.status(409).json({ error: "User already exists" });
    }
    throw err;
  }
});

// DELETE /users/:id  (protected)
export const remove: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id))
    return res.status(400).json({ error: "Invalid id format" });

  const result = await UserModel.findByIdAndDelete(id).lean();
  if (!result) return res.status(404).json({ error: "User not found" });

  await deleteFromDirectory(String(id));

  // Audit
  req.audit?.push({ type: "delete", model: "User", id });

  // Invalidate caches
  void invalidateNamespace("user");
  void invalidateNamespace("user-directory");

  return res.status(200).json({ success: true });
});

// GET /users/private/email/:email  (internal helper returning password hash)
export const getUserByEmailWithPassword: RequestHandler = asyncHandler(
  async (req, res) => {
    const { email } = req.params;
    if (!required(email))
      return res.status(400).json({ error: "email required" });

    const emailNorm = normalizeEmail(String(email));
    // Keep current query shape; we also store emailNorm for future
    const user = await UserModel.findOne({ email: emailNorm }).lean();
    if (!user) return res.status(404).json({ error: "User not found" });

    // No sanitize here—auth service expects password/hash
    return res.status(200).json({
      id: String(user._id),
      email: user.email,
      password: user.password,
      firstname: (user as any).firstname,
      middlename: (user as any).middlename,
      lastname: (user as any).lastname,
      userStatus: (user as any).userStatus,
      userType: (user as any).userType,
    });
  }
);

// GET /users/email/:email (no password)
export const getUserByEmail: RequestHandler = asyncHandler(async (req, res) => {
  const { email } = req.params;
  if (!required(email))
    return res.status(400).json({ error: "email required" });

  const emailNorm = normalizeEmail(String(email));
  const user = await UserModel.findOne({ email: emailNorm }).lean();
  if (!user) return res.status(404).json({ error: "User not found" });

  return res.status(200).json(sanitize(user));
});
